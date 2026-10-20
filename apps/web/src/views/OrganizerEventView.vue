<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { zonedWallTimeToUtc } from '@esp/contracts';
import type { ApiClientError } from '../api/client';
import { esp03, type ManageView, type Registration } from '../api/esp03';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import MoneyLabel from '../components/MoneyLabel.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';

/** template alias (vue-tsc mis-types direct use of this import inside template arrow functions) */
const call: typeof esp03 = esp03;

/**
 * EVT-001..008, STG-001..006, REG-005..007, ROS-003..006, CHK-002..004, FIN-007/008/010/011:
 * organizer panel for one event. Every action is re-checked by the server (publication gate, ACL, approvals).
 */
type Obj = Record<string, unknown>;
const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id));
const m = ref<ManageView | null>(null);
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const tz = (s: string) => (s ? zonedWallTimeToUtc(s) : null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    m.value = await esp03.manage(id.value);
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
watch(id, () => void load(), { immediate: true });

async function act(fn: () => Promise<unknown>, msg = '✓') {
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = msg;
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const ev = computed(() => m.value?.event);
const transitionsFor: Record<string, string[]> = {
  published: ['open_registration'],
  registration_open: ['close_registration'],
  registration_closed: ['reopen_registration', 'start_preparation'],
  preparing: ['activate'],
  active: ['pause', 'finish'],
  paused: ['resume'],
  finished: ['close'],
  closed: ['archive'],
  cancelled: ['archive'],
};
const transition = (name: string) => act(() => esp03.transition(id.value, name, ev.value!.version));

// ---- schedule, duplicate, cancel
const sched = ref('');
const dup = reactive({ slug: '', name: '', asTemplate: false });
const cancel = reactive({ approvalId: '', reason: '' });
async function requestCancel() {
  await act(async () => {
    const a = await esp03.requestApproval('event.cancel', { type: 'event', id: id.value }, cancel.reason || 'event cancellation');
    cancel.approvalId = a.id;
  }, t('evm.approvalRequested'));
}
async function duplicate() {
  failure.value = null;
  try {
    const r = await esp03.duplicate(id.value, dup.slug, dup.name, dup.asTemplate);
    await router.push(`/organizer/events/${r.id}`);
  } catch (e) {
    failure.value = toClientError(e);
  }
}

// ---- disciplines and stages
const dsc = reactive({ name: '', gameId: '', gameVersion: '', platform: 'pc', mode: '', rulesPackageId: '', participantKind: 'team', capacity: 16, minParticipants: 2, feeRial: 0, opens: '', closes: '', withdrawal: '', autoApprove: false, checkinPolicy: 'captain', checkinOpens: 60, checkinCloses: 10, grace: 5 });
function addDiscipline() {
  return act(() =>
    esp03.addDiscipline(id.value, {
      name: dsc.name, gameId: dsc.gameId, gameVersion: dsc.gameVersion, platform: dsc.platform, mode: dsc.mode, rulesPackageId: dsc.rulesPackageId || null, participantKind: dsc.participantKind,
      capacity: dsc.capacity, minParticipants: dsc.minParticipants, feeRial: dsc.feeRial, registrationOpensAt: tz(dsc.opens), registrationClosesAt: tz(dsc.closes), withdrawalDeadline: tz(dsc.withdrawal), autoApprove: dsc.autoApprove,
      checkin: { opensMinutesBefore: dsc.checkinOpens, closesMinutesBefore: dsc.checkinCloses, graceMinutes: dsc.grace, policy: dsc.checkinPolicy, minMembers: null },
    }),
  );
}
// STG-001..004: stages with presence, dependency and one incoming link (origin, slots, points carry/reset/factor)
const stg = reactive<Record<string, { name: string; order: number; format: string; presence: string; from: string; kind: string; slots: number; points: string; factor: number }>>({});
const stageForm = (dId: string) => (stg[dId] ??= { name: '', order: 1, format: 'single_elim', presence: 'online', from: '', kind: 'qualifier', slots: 0, points: 'reset', factor: 1 });
function stagePayload(dId: string) {
  const f = stageForm(dId);
  return {
    name: f.name, order: f.order, format: f.format, presence: f.presence,
    dependsOnStageIds: f.from ? [f.from] : [],
    links: f.slots > 0 ? [{ fromStageId: f.from || null, kind: f.kind, slots: f.slots, points: f.points, factor: f.points === 'factor' ? f.factor : null }] : [],
  };
}
// STG-006: a dependent stage starts only after its dependencies, or with an approved exception and a recorded impact
const startInfo = reactive<Record<string, { ok: boolean; reasons: string[] }>>({});
const exc = reactive({ approvalId: '', reason: '' });
const checkStart = (stageId: string) => act(async () => {
  const r = (await esp03.canStart(stageId)) as { ok: boolean; waitingFor: string[] };
  startInfo[stageId] = { ok: r.ok, reasons: r.waitingFor.map((w) => t('evm.waitingFor', { s: m.value?.stages.find((s) => s.id === w)?.name ?? w })) };
}, '');
const requestStageException = (stageId: string) => act(async () => {
  exc.approvalId = (await esp03.requestApproval('stage.start_exception', { type: 'event', id: id.value }, `${stageId}: ${exc.reason}`)).id;
}, t('evm.approvalRequested'));
// STG-002/005: qualification slots record their origin; the server refuses duplicates and unfinished sources
const slotList = reactive<Record<string, Obj[]>>({});
const loadSlots = (dId: string) => act(async () => (slotList[dId] = (await esp03.slots(dId)).items), '');
const slf = reactive<Record<string, { kind: string; ref: string; rank: number | null; holderKey: string; target: string; reason: string }>>({});
const slotForm = (dId: string) => (slf[dId] ??= { kind: 'stage', ref: '', rank: 1, holderKey: '', target: '', reason: '' });
function slotPayload(dId: string) {
  const f = slotForm(dId);
  return { targetStageId: f.target || null, source: { kind: f.kind, ref: f.ref, rank: f.rank || null }, holderKey: f.holderKey, reason: f.reason };
}
const seasons = ref<Obj[]>([]);
const season = reactive({ name: '', from: '', to: '', policy: '' });
const loadSeasons = () => act(async () => (seasons.value = (await esp03.seasons(m.value?.disciplines[0]?.gameId)).items), '');
// EVT-008: affiliation claim with private evidence; a platform reviewer decides
const aff = reactive<{ kind: string; body: string; file: File | null }>({ kind: 'publisher_licensed', body: '', file: null });
const claimAffiliation = () => act(async () => {
  const f = await esp03.uploadFile(aff.file!, { visibility: 'private', scopeType: 'event', scopeId: id.value, retentionClass: 'dispute_evidence' });
  await esp03.claimAffiliation(id.value, { kind: aff.kind, body: aff.body, evidenceFileId: f.id });
}, t('evm.affClaimed'));
// EVT-001: poster is a public, scanned image; only presentation fields stay editable after publication
async function uploadPoster(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !ev.value) return;
  await act(async () => {
    const f = await esp03.uploadFile(file, { visibility: 'public', scopeType: 'organization', scopeId: ev.value!.organizerOrgId, retentionClass: 'media_public' });
    await esp03.updateEvent(id.value, { posterFileId: f.id, expectedVersion: ev.value!.version });
  });
}
const FORMATS = ['single_elim', 'double_elim', 'round_robin', 'groups', 'swiss', 'ladder', 'multi_lobby', 'record', 'mixed'];

// ---- registrations per discipline
const regs = reactive<Record<string, Registration[]>>({});
const reason = reactive<Record<string, string>>({});
const loadRegs = (dId: string) => act(async () => (regs[dId] = (await esp03.registrations(dId)).items), '');
const decide = (dId: string, r: Registration, action: string) => act(async () => {
  await esp03.decide(r.id, action, reason[r.id] || null, r.version);
  regs[dId] = (await esp03.registrations(dId)).items;
});
const codes = reactive<Record<string, string[]>>({});
const genCodes = (dId: string) => act(async () => (codes[dId] = (await esp03.entryCodes(dId, 'invite', 5)).items.map((x) => x._id)));
const importResult = ref<string>('');
async function importCsv(dId: string, e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  await act(async () => {
    const r = await esp03.importInvites(dId, file);
    importResult.value = t('evm.imported', { n: num(r.created.length), e: num(r.errors.length) }) + (r.errors.length ? ' — ' + r.errors.map((x) => `#${x.row}: ${x.error}`).join('؛ ') : '');
    codes[dId] = r.created.map((x) => `${x.holderKey} → ${x.code}`);
  });
}

// ---- roster lock and check-in (event level)
const checkins = ref<Obj[]>([]);
const loadCheckins = () => act(async () => (checkins.value = (await esp03.checkins('event', id.value)).items), '');
const manual = reactive({ registrationId: '', outcome: 'checked_in', reason: '' });

// ---- finance: financials, prizes, tickets, sponsors
const fin = ref<Obj | null>(null);
const prizes = ref<Obj[]>([]);
const sponsors = ref<Obj[]>([]);
const loadFinance = () => act(async () => {
  [fin.value, prizes.value, sponsors.value] = await Promise.all([esp03.financials(id.value), esp03.prizes(id.value).then((x) => x.items), esp03.sponsors(id.value).then((x) => x.items)]);
}, '');
const tickets = reactive({ capacity: 100, priceRial: 0 });
const ticketCode = ref('');
const sp = reactive({ sponsorName: '', placement: 'event_header', label: 'sponsor', note: '' });
const rcp = reactive<Record<string, { kind: string; ref: string; payee: string }>>({});
const rcpForm = (pid: string) => (rcp[pid] ??= { kind: 'team', ref: '', payee: '' });
const csvUrl = esp03.exportUrl;
</script>

<template>
  <DataState :loading="loading && !m" :error="error" @retry="load">
    <template v-if="m && ev">
      <PageHeader :title="ev.name">
        <template #title><bdi>{{ ev.name }}</bdi></template>
        <template #actions><StatusBadge :state="ev.state" /> <RouterLink class="btn btn-sm" :to="`/events/${ev.id}${ev.config.linkToken ? `?t=${ev.config.linkToken}` : ''}`">{{ t('evm.publicPage') }}</RouterLink> <RouterLink class="btn btn-sm" :to="`/organizer/events/${ev.id}/operations`">{{ t('cops.title') }}</RouterLink> <RouterLink class="btn btn-sm" :to="`/organizer/events/${ev.id}/lan`">{{ t('cops.lan') }}</RouterLink> <RouterLink class="btn btn-sm" :to="`/organizer/events/${ev.id}/results`">{{ t('res.title') }}</RouterLink></template>
      </PageHeader>
      <ErrorNote :error="failure" />
      <p v-if="notice" role="status" class="notice">{{ notice }}</p>

      <!-- publication gate (EVT-004) and lifecycle -->
      <section class="card stack block">
        <h2>{{ t('evm.lifecycle') }}</h2>
        <template v-if="['draft', 'in_review'].includes(ev.state)">
          <p v-if="m.publishCheck.ok" class="ok">{{ t('evm.readyToPublish') }}</p>
          <ul v-else class="list warn" :aria-label="t('evm.problems')"><li v-for="p in m.publishCheck.problems" :key="p.code + (p.ref ?? '')" dir="auto">{{ p.message }}</li></ul>
          <div class="row">
            <button type="button" class="btn btn-primary" :disabled="!m.publishCheck.ok" @click="act(() => call.publish(id))">{{ t('evm.publish') }}</button>
            <FormField id="em-sched" :label="t('evm.scheduleAt')"><template #default="{ id: fid }"><input :id="fid" v-model="sched" type="datetime-local" class="input" /></template></FormField>
            <button type="button" class="btn" :disabled="!sched || !m.publishCheck.ok" @click="act(() => call.schedule(id, tz(sched)!, ev!.version))">{{ t('evm.schedule') }}</button>
          </div>
        </template>
        <div class="row">
          <button v-for="tr in transitionsFor[ev.state] ?? []" :key="tr" type="button" class="btn" @click="transition(tr)">{{ t(`evm.tr.${tr}` as never) }}</button>
        </div>
        <FormField id="em-poster" :label="t('evm.poster')" :hint="ev.config.posterFileId ? t('evm.posterSet') : t('evm.posterHint')">
          <template #default="{ id: fid, describedBy }"><input :id="fid" type="file" accept="image/png,image/jpeg,image/webp" class="input" :aria-describedby="describedBy" @change="uploadPoster" /></template>
        </FormField>
        <details>
          <summary>{{ t('evm.affiliation') }}<template v-if="ev.config.affiliation"> — <StatusBadge :state="ev.config.affiliation.state" /></template></summary>
          <p v-if="ev.config.affiliation?.note" class="muted" dir="auto">{{ ev.config.affiliation.note }}</p>
          <form class="row" novalidate @submit.prevent="claimAffiliation">
            <FormField id="af-k" :label="t('mgmt.kind')"><template #default="{ id: fid }"><select :id="fid" v-model="aff.kind" class="input"><option v-for="k in ['publisher_licensed', 'federation_sanctioned', 'official_partner']" :key="k" :value="k">{{ t(`evm.aff.${k}` as never) }}</option></select></template></FormField>
            <FormField id="af-b" :label="t('evm.affBody')"><template #default="{ id: fid }"><input :id="fid" v-model="aff.body" class="input" dir="auto" /></template></FormField>
            <FormField id="af-e" :label="t('evm.affEvidence')" :hint="t('reg.docPrivate')"><template #default="{ id: fid, describedBy }"><input :id="fid" type="file" accept="application/pdf,image/png,image/jpeg" class="input" :aria-describedby="describedBy" @change="aff.file = ($event.target as HTMLInputElement).files?.[0] ?? null" /></template></FormField>
            <button type="submit" class="btn btn-sm" :disabled="aff.body.length < 2 || !aff.file">{{ t('evm.affClaim') }}</button>
          </form>
          <p class="muted">{{ t('evm.affHint') }}</p>
        </details>
        <p v-if="ev.visibility === 'link_only' && ev.config.linkToken" class="muted">{{ t('evm.linkOnly') }} <bdi class="ltr">/events/{{ ev.id }}?t={{ ev.config.linkToken }}</bdi></p>
        <details>
          <summary>{{ t('evm.duplicate') }}</summary>
          <form class="row" novalidate @submit.prevent="duplicate">
            <FormField id="em-dn" :label="t('events.name')"><template #default="{ id: fid }"><input :id="fid" v-model="dup.name" class="input" dir="auto" /></template></FormField>
            <FormField id="em-ds" :label="t('adm.slug')"><template #default="{ id: fid }"><input :id="fid" v-model="dup.slug" class="input ltr" /></template></FormField>
            <label class="row"><input v-model="dup.asTemplate" type="checkbox" /> {{ t('evm.asTemplate') }}</label>
            <button type="submit" class="btn" :disabled="!dup.name || !dup.slug">{{ t('evm.duplicate') }}</button>
          </form>
        </details>
        <details v-if="!['cancelled', 'archived', 'closed', 'finished'].includes(ev.state)">
          <summary class="danger">{{ t('evm.cancel') }}</summary>
          <p class="muted">{{ t('evm.cancelHelp') }}</p>
          <form class="stack" novalidate @submit.prevent="act(() => call.cancelEvent(id, cancel.approvalId, cancel.reason))">
            <FormField id="em-cr" :label="t('evm.reason')"><template #default="{ id: fid }"><textarea :id="fid" v-model="cancel.reason" class="input" rows="2" dir="auto" /></template></FormField>
            <div class="row">
              <button type="button" class="btn" :disabled="cancel.reason.length < 5" @click="requestCancel">{{ t('evm.requestApproval') }}</button>
              <FormField id="em-ca" :label="t('evm.approvalId')"><template #default="{ id: fid }"><input :id="fid" v-model="cancel.approvalId" class="input ltr" /></template></FormField>
              <button type="submit" class="btn btn-danger" :disabled="!cancel.approvalId || cancel.reason.length < 5">{{ t('evm.cancelNow') }}</button>
            </div>
          </form>
        </details>
      </section>

      <!-- disciplines, stages, registrations -->
      <section v-for="d in m.disciplines" :key="d.id" class="card stack block">
        <h2><bdi>{{ d.name }}</bdi> <span class="muted"><bdi class="ltr">{{ d.platform }} / {{ d.mode }} / {{ d.gameVersion }}</bdi></span></h2>
        <p class="muted">{{ t('reg.kind') }}: {{ t(`reg.kind.${d.config.participantKind}` as never) }} · {{ t('reg.capacity') }}: {{ num(d.config.capacity) }} · {{ t('reg.fee') }}: <MoneyLabel :rial="d.config.feeRial" /> · {{ d.rulesFrozen ? t('evm.rulesFrozen') : t('evm.rulesNotFrozen') }}</p>
        <ul class="list">
          <li v-for="s in m.stages.filter((x) => x.disciplineId === d.id)" :key="s.id" class="stack">
            <span>{{ num(s.order) }}. <bdi>{{ s.name }}</bdi> — <bdi class="ltr">{{ s.format }}</bdi> — {{ t(`reg.presence.${s.presence}` as never) }} <StatusBadge :state="s.state" /> <button type="button" class="btn btn-sm" @click="checkStart(s.id)">{{ t('evm.canStart') }}</button></span>
            <span v-for="l in s.links" :key="l.kind + (l.fromStageId ?? '')" class="muted">← {{ t(`evm.link.${l.kind}` as never) }} × {{ num(l.slots) }} — {{ t(`evm.points.${l.points}` as never) }}<template v-if="l.factor !== null"> ×{{ num(l.factor) }}</template></span>
            <template v-if="startInfo[s.id]">
              <span :class="startInfo[s.id]!.ok ? 'ok' : 'warn'" role="status">{{ startInfo[s.id]!.ok ? t('evm.canStartYes') : startInfo[s.id]!.reasons.join('؛ ') }}</span>
              <form v-if="!startInfo[s.id]!.ok" class="row" novalidate @submit.prevent="act(() => call.startException(s.id, exc.approvalId, exc.reason))">
                <button type="button" class="btn btn-sm" :disabled="exc.reason.length < 5" @click="requestStageException(s.id)">{{ t('evm.requestApproval') }}</button>
                <FormField :id="`ex-a-${s.id}`" :label="t('evm.approvalId')"><template #default="{ id: fid }"><input :id="fid" v-model="exc.approvalId" class="input ltr" /></template></FormField>
                <FormField :id="`ex-r-${s.id}`" :label="t('evm.impact')"><template #default="{ id: fid }"><input :id="fid" v-model="exc.reason" class="input" dir="auto" /></template></FormField>
                <button type="submit" class="btn btn-sm" :disabled="!exc.approvalId || exc.reason.length < 5">{{ t('evm.startException') }}</button>
              </form>
            </template>
          </li>
        </ul>
        <details v-if="['draft', 'in_review'].includes(ev.state)">
          <summary>{{ t('evm.addStage') }}</summary>
          <form class="stack" novalidate @submit.prevent="act(() => call.addStage(d.id, stagePayload(d.id)))">
            <div class="grid">
              <FormField :id="`st-n-${d.id}`" :label="t('events.stage')"><template #default="{ id: fid }"><input :id="fid" v-model="stageForm(d.id).name" class="input" dir="auto" /></template></FormField>
              <FormField :id="`st-o-${d.id}`" label="#"><template #default="{ id: fid }"><input :id="fid" v-model.number="stageForm(d.id).order" type="number" min="1" class="input ltr" /></template></FormField>
              <FormField :id="`st-f-${d.id}`" :label="t('events.format')"><template #default="{ id: fid }"><select :id="fid" v-model="stageForm(d.id).format" class="input ltr"><option v-for="f in FORMATS" :key="f" :value="f">{{ f }}</option></select></template></FormField>
              <FormField :id="`st-p-${d.id}`" :label="t('reg.presence')"><template #default="{ id: fid }"><select :id="fid" v-model="stageForm(d.id).presence" class="input"><option v-for="v in ['online', 'offline', 'hybrid']" :key="v" :value="v">{{ t(`reg.presence.${v}` as never) }}</option></select></template></FormField>
              <FormField :id="`st-from-${d.id}`" :label="t('evm.fromStage')"><template #default="{ id: fid }"><select :id="fid" v-model="stageForm(d.id).from" class="input"><option value="">—</option><option v-for="s in m.stages.filter((x) => x.disciplineId === d.id)" :key="s.id" :value="s.id">{{ s.name }}</option></select></template></FormField>
              <FormField :id="`st-lk-${d.id}`" :label="t('evm.linkKind')"><template #default="{ id: fid }"><select :id="fid" v-model="stageForm(d.id).kind" class="input"><option v-for="k in ['qualifier', 'invite', 'seed', 'quota']" :key="k" :value="k">{{ t(`evm.link.${k}` as never) }}</option></select></template></FormField>
              <FormField :id="`st-sl-${d.id}`" :label="t('evm.slots')"><template #default="{ id: fid }"><input :id="fid" v-model.number="stageForm(d.id).slots" type="number" min="0" class="input ltr" /></template></FormField>
              <FormField :id="`st-pt-${d.id}`" :label="t('evm.pointsCarry')"><template #default="{ id: fid }"><select :id="fid" v-model="stageForm(d.id).points" class="input"><option v-for="k in ['carry', 'reset', 'factor']" :key="k" :value="k">{{ t(`evm.points.${k}` as never) }}</option></select></template></FormField>
              <FormField v-if="stageForm(d.id).points === 'factor'" :id="`st-fc-${d.id}`" :label="t('evm.factor')"><template #default="{ id: fid }"><input :id="fid" v-model.number="stageForm(d.id).factor" type="number" min="0" max="10" step="0.1" class="input ltr" /></template></FormField>
            </div>
            <p class="muted">{{ t('evm.linkHint') }}</p>
            <button type="submit" class="btn" :disabled="!stageForm(d.id).name">{{ t('evm.addStage') }}</button>
          </form>
        </details>

        <details @toggle="($event.target as HTMLDetailsElement).open && loadSlots(d.id)">
          <summary>{{ t('evm.qualSlots') }}</summary>
          <ul class="list"><li v-for="q in slotList[d.id] ?? []" :key="String(q._id)"><bdi class="ltr">{{ q.holderKey }}</bdi> — {{ t(`evm.src.${(q.source as Obj).kind}` as never) }} <bdi class="ltr">{{ (q.source as Obj).ref }}</bdi> — <StatusBadge :state="String(q.state)" /></li></ul>
          <form class="row" novalidate @submit.prevent="act(() => call.createSlot(d.id, slotPayload(d.id)).then(() => loadSlots(d.id)))">
            <FormField :id="`sl-k-${d.id}`" :label="t('evm.source')"><template #default="{ id: fid }"><select :id="fid" v-model="slotForm(d.id).kind" class="input"><option v-for="k in ['stage', 'event', 'invite', 'season']" :key="k" :value="k">{{ t(`evm.src.${k}` as never) }}</option></select></template></FormField>
            <FormField :id="`sl-r-${d.id}`" :label="t('evm.sourceRef')"><template #default="{ id: fid }"><input :id="fid" v-model="slotForm(d.id).ref" class="input ltr" /></template></FormField>
            <FormField :id="`sl-rk-${d.id}`" :label="t('evm.rank')"><template #default="{ id: fid }"><input :id="fid" v-model.number="slotForm(d.id).rank" type="number" min="1" class="input ltr" /></template></FormField>
            <FormField :id="`sl-h-${d.id}`" :label="t('evm.holderKey')" :hint="t('evm.holderKeyHint')"><template #default="{ id: fid, describedBy }"><input :id="fid" v-model="slotForm(d.id).holderKey" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
            <FormField :id="`sl-t-${d.id}`" :label="t('evm.targetStage')"><template #default="{ id: fid }"><select :id="fid" v-model="slotForm(d.id).target" class="input"><option value="">—</option><option v-for="s in m.stages.filter((x) => x.disciplineId === d.id)" :key="s.id" :value="s.id">{{ s.name }}</option></select></template></FormField>
            <FormField :id="`sl-w-${d.id}`" :label="t('evm.reason')"><template #default="{ id: fid }"><input :id="fid" v-model="slotForm(d.id).reason" class="input" dir="auto" /></template></FormField>
            <button type="submit" class="btn btn-sm" :disabled="!slotForm(d.id).ref || !slotForm(d.id).holderKey || slotForm(d.id).reason.length < 3">{{ t('evm.addSlot') }}</button>
          </form>
          <p class="muted">{{ t('evm.slotHint') }}</p>
        </details>

        <h3>{{ t('evm.registrations') }}</h3>
        <div class="row">
          <button type="button" class="btn btn-sm" @click="loadRegs(d.id)">{{ t('evm.loadRegs') }}</button>
          <a class="btn btn-sm" :href="csvUrl(d.id)" download>{{ t('evm.exportCsv') }}</a>
          <label class="btn btn-sm">{{ t('evm.importCsv') }} <input type="file" accept=".csv,text/csv" class="sr-only" @change="importCsv(d.id, $event)" /></label>
          <button type="button" class="btn btn-sm" @click="genCodes(d.id)">{{ t('evm.entryCodes') }}</button>
        </div>
        <p v-if="importResult" class="muted" role="status">{{ importResult }}</p>
        <ul v-if="codes[d.id]?.length" class="list"><li v-for="c in codes[d.id]" :key="c"><bdi class="ltr code">{{ c }}</bdi></li></ul>
        <div v-if="regs[d.id]" class="table-wrap">
          <table class="tbl">
            <caption class="sr-only">{{ t('evm.registrations') }}</caption>
            <thead><tr><th scope="col">{{ t('reg.tracking') }}</th><th scope="col">{{ t('events.name') }}</th><th scope="col">{{ t('events.state') }}</th><th scope="col">{{ t('evm.issues') }}</th><th scope="col">{{ t('evm.actions') }}</th></tr></thead>
            <tbody>
              <tr v-if="!regs[d.id]!.length"><td colspan="5" class="muted">—</td></tr>
              <tr v-for="r in regs[d.id]" :key="r.id">
                <td><bdi class="ltr">{{ r.trackingCode }}</bdi></td>
                <th scope="row"><bdi>{{ r.displayName }}</bdi></th>
                <td><StatusBadge :state="r.state" /><span v-if="r.waitlisted" class="muted"> #{{ num(r.waitlistSeq ?? 0) }}</span></td>
                <td><span v-for="i in r.eligibility.issues" :key="i.code + (i.clause ?? '')" dir="auto" class="issue">{{ i.message }}</span></td>
                <td>
                  <div class="row">
                    <input v-model="reason[r.id]" class="input input-sm" :aria-label="t('evm.reason')" :placeholder="t('evm.reason')" dir="auto" />
                    <button v-if="r.state === 'awaiting_review'" type="button" class="btn btn-sm" @click="decide(d.id, r, 'approve')">{{ t('evm.approve') }}</button>
                    <button v-if="r.state === 'awaiting_review'" type="button" class="btn btn-sm" @click="decide(d.id, r, 'mark_incomplete')">{{ t('evm.incomplete') }}</button>
                    <button v-if="['awaiting_review', 'awaiting_capacity'].includes(r.state)" type="button" class="btn btn-sm btn-danger" @click="decide(d.id, r, 'reject')">{{ t('evm.reject') }}</button>
                    <button v-if="r.state === 'confirmed'" type="button" class="btn btn-sm btn-danger" @click="decide(d.id, r, 'remove')">{{ t('evm.remove') }}</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <form v-if="['draft', 'in_review'].includes(ev.state)" class="card stack block" novalidate @submit.prevent="addDiscipline">
        <h2>{{ t('evm.addDiscipline') }}</h2>
        <div class="grid">
          <FormField id="dc-n" :label="t('events.name')" required><template #default="{ id: fid }"><input :id="fid" v-model="dsc.name" class="input" dir="auto" /></template></FormField>
          <FormField id="dc-g" :label="t('evm.gameId')" required><template #default="{ id: fid }"><input :id="fid" v-model="dsc.gameId" class="input ltr" /></template></FormField>
          <FormField id="dc-gv" :label="t('evm.gameVersion')" required><template #default="{ id: fid }"><input :id="fid" v-model="dsc.gameVersion" class="input ltr" /></template></FormField>
          <FormField id="dc-p" :label="t('evm.platform')"><template #default="{ id: fid }"><input :id="fid" v-model="dsc.platform" class="input ltr" /></template></FormField>
          <FormField id="dc-m" :label="t('evm.mode')" required><template #default="{ id: fid }"><input :id="fid" v-model="dsc.mode" class="input ltr" /></template></FormField>
          <FormField id="dc-r" :label="t('evm.rulesPackage')" :hint="t('evm.rulesPackageHint')"><template #default="{ id: fid, describedBy }"><input :id="fid" v-model="dsc.rulesPackageId" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
          <FormField id="dc-k" :label="t('reg.kind')"><template #default="{ id: fid }"><select :id="fid" v-model="dsc.participantKind" class="input"><option value="team">{{ t('reg.kind.team') }}</option><option value="player">{{ t('reg.kind.player') }}</option></select></template></FormField>
          <FormField id="dc-c" :label="t('reg.capacity')"><template #default="{ id: fid }"><input :id="fid" v-model.number="dsc.capacity" type="number" min="1" class="input ltr" /></template></FormField>
          <FormField id="dc-mn" :label="t('evm.minParticipants')"><template #default="{ id: fid }"><input :id="fid" v-model.number="dsc.minParticipants" type="number" min="0" class="input ltr" /></template></FormField>
          <FormField id="dc-f" :label="t('evm.feeRial')"><template #default="{ id: fid }"><input :id="fid" v-model.number="dsc.feeRial" type="number" min="0" step="10" class="input ltr" /></template></FormField>
          <FormField id="dc-o" :label="t('reg.opens')"><template #default="{ id: fid }"><input :id="fid" v-model="dsc.opens" type="datetime-local" class="input" /></template></FormField>
          <FormField id="dc-cl" :label="t('reg.closes')" required><template #default="{ id: fid }"><input :id="fid" v-model="dsc.closes" type="datetime-local" class="input" /></template></FormField>
          <FormField id="dc-w" :label="t('reg.withdrawBy')"><template #default="{ id: fid }"><input :id="fid" v-model="dsc.withdrawal" type="datetime-local" class="input" /></template></FormField>
          <FormField id="dc-cp" :label="t('evm.checkinPolicy')"><template #default="{ id: fid }"><select :id="fid" v-model="dsc.checkinPolicy" class="input"><option v-for="p in ['captain', 'all_members']" :key="p" :value="p">{{ t(`evm.ci.${p}` as never) }}</option></select></template></FormField>
          <FormField id="dc-co" :label="t('evm.checkinOpens')"><template #default="{ id: fid }"><input :id="fid" v-model.number="dsc.checkinOpens" type="number" min="0" class="input ltr" /></template></FormField>
          <FormField id="dc-cc" :label="t('evm.checkinCloses')"><template #default="{ id: fid }"><input :id="fid" v-model.number="dsc.checkinCloses" type="number" min="0" class="input ltr" /></template></FormField>
        </div>
        <label class="row"><input v-model="dsc.autoApprove" type="checkbox" /> {{ t('evm.autoApprove') }}</label>
        <button type="submit" class="btn btn-primary" :disabled="!dsc.name || !dsc.gameId || !dsc.gameVersion || !dsc.mode || !dsc.closes">{{ t('evm.addDiscipline') }}</button>
      </form>

      <!-- seasons and series (STG-005) -->
      <section class="card stack block">
        <h2>{{ t('evm.seasons') }}</h2>
        <button type="button" class="btn btn-sm" @click="loadSeasons">{{ t('evm.loadSeasons') }}</button>
        <ul class="list"><li v-for="s in seasons" :key="String(s._id)"><bdi>{{ s.name }}</bdi> — <bdi class="ltr">{{ s._id }}</bdi></li></ul>
        <form class="row" novalidate @submit.prevent="act(() => call.createSeason({ gameId: m!.disciplines[0]?.gameId ?? '', name: season.name, from: tz(season.from), to: tz(season.to), pointsPolicy: season.policy, nextEventQuotas: [] }).then(loadSeasons))">
          <FormField id="ss-n" :label="t('events.name')"><template #default="{ id: fid }"><input :id="fid" v-model="season.name" class="input" dir="auto" /></template></FormField>
          <FormField id="ss-f" :label="t('fin.from')"><template #default="{ id: fid }"><input :id="fid" v-model="season.from" type="datetime-local" class="input" /></template></FormField>
          <FormField id="ss-t" :label="t('fin.to')"><template #default="{ id: fid }"><input :id="fid" v-model="season.to" type="datetime-local" class="input" /></template></FormField>
          <FormField id="ss-p" :label="t('evm.pointsPolicy')"><template #default="{ id: fid }"><input :id="fid" v-model="season.policy" class="input" dir="auto" /></template></FormField>
          <button type="submit" class="btn btn-sm" :disabled="!m.disciplines.length || !season.name || !season.from || !season.to || !season.policy">{{ t('evm.addSeason') }}</button>
        </form>
      </section>

      <!-- roster lock and check-in (ROS-003, CHK-002..004) -->
      <section v-if="!['draft', 'in_review'].includes(ev.state)" class="card stack block">
        <h2>{{ t('evm.rosterCheckin') }}</h2>
        <div class="row">
          <button type="button" class="btn" @click="act(() => call.lockRoster('event', id), t('evm.locked'))">{{ t('evm.lockRoster') }}</button>
          <button type="button" class="btn" @click="loadCheckins">{{ t('evm.loadCheckins') }}</button>
          <button type="button" class="btn btn-danger" @click="act(() => call.finalizeCheckins('event', id).then(loadCheckins))">{{ t('evm.finalizeNoShows') }}</button>
        </div>
        <ul class="list"><li v-for="c in checkins" :key="String(c._id)"><bdi class="ltr">{{ c.registrationId }}</bdi> — <StatusBadge :state="String(c.state)" /></li></ul>
        <form class="row" novalidate @submit.prevent="act(() => call.manualCheckin({ level: 'event', ref: id, ...manual }).then(loadCheckins))">
          <FormField id="mc-r" :label="t('evm.registrationId')"><template #default="{ id: fid }"><input :id="fid" v-model="manual.registrationId" class="input ltr" /></template></FormField>
          <FormField id="mc-o" :label="t('events.state')"><template #default="{ id: fid }"><select :id="fid" v-model="manual.outcome" class="input"><option v-for="o in ['checked_in', 'late', 'no_show', 'excused']" :key="o" :value="o">{{ t(`evm.co.${o}` as never) }}</option></select></template></FormField>
          <FormField id="mc-why" :label="t('evm.reason')"><template #default="{ id: fid }"><input :id="fid" v-model="manual.reason" class="input" dir="auto" /></template></FormField>
          <button type="submit" class="btn" :disabled="!manual.registrationId || manual.reason.length < 3">{{ t('evm.manualCheckin') }}</button>
        </form>
      </section>

      <!-- money: financial report, prizes, tickets, sponsors -->
      <section class="card stack block">
        <h2>{{ t('evm.money') }}</h2>
        <button type="button" class="btn btn-sm" @click="loadFinance">{{ t('evm.loadFinance') }}</button>
        <dl v-if="fin" class="kv">
          <div><dt>{{ t('evm.entryGross') }}</dt><dd><MoneyLabel :rial="Number((fin.ordersByKind as Obj)?.entry ? ((fin.ordersByKind as Record<string, Obj>).entry!.grossRial) : 0)" /></dd></div>
          <div><dt>{{ t('evm.ticketGross') }}</dt><dd><MoneyLabel :rial="Number((fin.ordersByKind as Obj)?.ticket ? ((fin.ordersByKind as Record<string, Obj>).ticket!.grossRial) : 0)" /></dd></div>
          <div><dt>{{ t('pay.fee') }}</dt><dd><MoneyLabel :rial="Number(fin.feesRial)" /></dd></div>
          <div><dt>{{ t('pay.discount') }}</dt><dd><MoneyLabel :rial="Number(fin.discountsRial)" /></dd></div>
          <div><dt>{{ t('pay.refunded') }}</dt><dd><MoneyLabel :rial="Number(fin.refundedRial)" /></dd></div>
          <div><dt>{{ t('evm.openOrders') }}</dt><dd>{{ num(Number(fin.openOrders)) }}</dd></div>
          <div><dt>{{ t('evm.payable') }}</dt><dd><MoneyLabel :rial="Number(fin.organizerPayableRial)" /></dd></div>
        </dl>
        <template v-if="prizes.length">
          <h3>{{ t('reg.prizes') }}</h3>
          <p class="muted">{{ t('reg.prizesNotGuaranteed') }}</p>
          <div v-for="p in prizes" :key="String(p._id)" class="stack prize">
            <p><bdi>{{ p.title }}</bdi> — <MoneyLabel :rial="Number(p.amountRial)" /> <StatusBadge :state="String(p.state)" /></p>
            <form v-if="['defined', 'recipient_verified'].includes(String(p.state))" class="row" novalidate @submit.prevent="act(() => call.prizeRecipient(String(p._id), { kind: rcpForm(String(p._id)).kind, ref: rcpForm(String(p._id)).ref, payeePrincipalId: rcpForm(String(p._id)).payee, shares: [], expectedVersion: Number(p.version), approvalId: null }).then(loadFinance))">
              <FormField :id="`pr-k-${p._id}`" :label="t('reg.kind')"><template #default="{ id: fid }"><select :id="fid" v-model="rcpForm(String(p._id)).kind" class="input"><option value="team">{{ t('reg.kind.team') }}</option><option value="player">{{ t('reg.kind.player') }}</option></select></template></FormField>
              <FormField :id="`pr-r-${p._id}`" :label="t('evm.recipientRef')"><template #default="{ id: fid }"><input :id="fid" v-model="rcpForm(String(p._id)).ref" class="input ltr" /></template></FormField>
              <FormField :id="`pr-p-${p._id}`" :label="t('evm.payee')"><template #default="{ id: fid }"><input :id="fid" v-model="rcpForm(String(p._id)).payee" class="input ltr" /></template></FormField>
              <button type="submit" class="btn btn-sm">{{ t('evm.setRecipient') }}</button>
            </form>
          </div>
        </template>
        <h3>{{ t('reg.tickets') }}</h3>
        <form class="row" novalidate @submit.prevent="act(() => call.configureTickets(id, tickets.capacity, tickets.priceRial))">
          <FormField id="tc-c" :label="t('reg.capacity')"><template #default="{ id: fid }"><input :id="fid" v-model.number="tickets.capacity" type="number" min="1" class="input ltr" /></template></FormField>
          <FormField id="tc-p" :label="t('evm.amountRial')"><template #default="{ id: fid }"><input :id="fid" v-model.number="tickets.priceRial" type="number" min="0" step="10" class="input ltr" /></template></FormField>
          <button type="submit" class="btn btn-sm">{{ t('mgmt.save') }}</button>
        </form>
        <form class="row" novalidate @submit.prevent="act(() => call.useTicket(ticketCode.trim()), t('evm.ticketUsed')).then(() => (ticketCode = ''))">
          <FormField id="tu-c" :label="t('evm.ticketCode')"><template #default="{ id: fid }"><input :id="fid" v-model="ticketCode" class="input ltr" autocomplete="off" /></template></FormField>
          <button type="submit" class="btn btn-sm" :disabled="ticketCode.trim().length < 6">{{ t('evm.useTicket') }}</button>
        </form>
        <h3>{{ t('reg.sponsors') }}</h3>
        <ul class="list"><li v-for="s in sponsors" :key="String(s._id)"><bdi>{{ s.sponsorName }}</bdi> — {{ t(`reg.label.${s.label}` as never) }} — <StatusBadge :state="String(s.state)" /> <button v-if="s.state === 'draft'" type="button" class="btn btn-sm" @click="act(() => call.approveSponsor(String(s._id), sp.note).then(loadFinance))">{{ t('evm.approve') }}</button></li></ul>
        <form class="row" novalidate @submit.prevent="act(() => call.addSponsor(id, { sponsorName: sp.sponsorName, placement: sp.placement, label: sp.label, publisherRestrictionNote: sp.note || null }).then(loadFinance))">
          <FormField id="sp-n" :label="t('evm.sponsorName')"><template #default="{ id: fid }"><input :id="fid" v-model="sp.sponsorName" class="input" dir="auto" /></template></FormField>
          <FormField id="sp-p" :label="t('evm.placement')"><template #default="{ id: fid }"><select :id="fid" v-model="sp.placement" class="input ltr"><option v-for="p in ['event_header', 'live_center', 'stream_overlay', 'news_sidebar']" :key="p" :value="p">{{ p }}</option></select></template></FormField>
          <FormField id="sp-l" :label="t('evm.label')"><template #default="{ id: fid }"><select :id="fid" v-model="sp.label" class="input"><option value="sponsor">{{ t('reg.label.sponsor') }}</option><option value="advertisement">{{ t('reg.label.advertisement') }}</option></select></template></FormField>
          <FormField id="sp-x" :label="t('evm.publisherNote')"><template #default="{ id: fid }"><input :id="fid" v-model="sp.note" class="input" dir="auto" /></template></FormField>
          <button type="submit" class="btn btn-sm" :disabled="!sp.sponsorName">{{ t('evm.addSponsor') }}</button>
        </form>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.block { margin-block-end: var(--sp-4); }
.row { flex-wrap: wrap; gap: var(--sp-2); align-items: flex-end; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--sp-3); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: var(--sp-2); margin: 0; }
dt { color: var(--text-muted); font-size: var(--fs-sm); }
dd { margin: 0; font-weight: 600; }
.ok { color: var(--ok); font-weight: 700; }
.warn { color: var(--warn); }
.danger { color: var(--danger); }
.notice { color: var(--ok); }
.table-wrap { overflow-x: auto; }
.tbl { inline-size: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
.tbl th, .tbl td { padding: var(--sp-1) var(--sp-2); border-block-end: 1px solid var(--border); text-align: start; vertical-align: top; }
.issue { display: block; color: var(--warn); }
.input-sm { max-inline-size: 10rem; }
.code { font-family: monospace; }
.prize { border-block-start: 1px solid var(--border); padding-block-start: var(--sp-2); }
h2, h3, p { margin: 0; }
</style>
