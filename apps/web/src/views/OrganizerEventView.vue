<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { QAlert, QBadge, QButton, QCard, QCheckbox, QCode, QContainer, QDataState, QDataTable, QDateField, QFacts, QFileUpload, QIcon, QMoney, QPageHeader, QSelect, QStatusBadge, QTabs, QTextField, fa, toman, useToast, type QDataTableColumn } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp03, type ManageView, type Registration } from '../api/esp03';
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
/** QDateField gives Tehran wall time with its offset; the API takes UTC. */
const tz = (s: string | null) => (s ? new Date(s).toISOString() : null);

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
const sched = ref<string | null>(null);
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
async function uploadPoster(fs: File[]) {
  const file = fs[0];
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
async function importCsv(dId: string, fs: File[]) {
  const file = fs[0];
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
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n === '✓' ? t('rv.done') : n, duration: 3000 }); });
watch(failure, (f) => { if (f) push({ tone: 'danger', message: f.message }); });
/** v-bind helper: a numeric field edited through a string QTextField. */
const n = (o: object, k: string) => ({
  modelValue: String((o as Record<string, unknown>)[k] ?? ''),
  'onUpdate:modelValue': (v?: string) => { (o as Record<string, unknown>)[k] = v === '' || v == null ? null : Number(v); },
});
/** v-bind helper: a boolean field edited through QCheckbox. */
const b = (o: object, k: string) => ({
  modelValue: !!(o as Record<string, unknown>)[k],
  'onUpdate:modelValue': (v: boolean | null) => { (o as Record<string, unknown>)[k] = !!v; },
});
const opts = (keys: string[], label: (k: string) => string) => keys.map((k) => ({ value: k, label: label(k) }));
const tab = ref('overview');
const tabs = computed(() => [
  { key: 'overview', label: t('evm.lifecycle'), icon: 'flag' as const },
  { key: 'disciplines', label: t('evm.disciplines'), icon: 'gamepad' as const, count: m.value?.disciplines.length ?? 0 },
  { key: 'seasons', label: t('evm.seasons'), icon: 'calendar' as const },
  { key: 'checkin', label: t('evm.rosterCheckin'), icon: 'check-circle' as const },
  { key: 'money', label: t('evm.money'), icon: 'wallet' as const },
]);
watch(tab, (k) => { if (k === 'money' && !fin.value) void loadFinance(); if (k === 'checkin' && !checkins.value.length) void loadCheckins(); if (k === 'seasons' && !seasons.value.length) void loadSeasons(); });
const stagesOf = (dId: string) => (m.value?.stages ?? []).filter((x) => x.disciplineId === dId);
const stageOpts = (dId: string) => [{ value: '', label: '—' }, ...stagesOf(dId).map((s) => ({ value: s.id, label: s.name }))];
const regCols = computed<QDataTableColumn<Registration>[]>(() => [
  { key: 'trackingCode', header: t('reg.tracking') }, { key: 'displayName', header: t('events.name') },
  { key: 'state', header: t('events.state') }, { key: 'issues', header: t('evm.issues') },
]);
const finFacts = computed(() => {
  const f = fin.value as Record<string, unknown> | null;
  if (!f) return [];
  const by = (f.ordersByKind ?? {}) as Record<string, { grossRial?: number } | undefined>;
  return [
    { label: t('evm.entryGross'), value: toman(Number(by.entry?.grossRial ?? 0)) },
    { label: t('evm.ticketGross'), value: toman(Number(by.ticket?.grossRial ?? 0)) },
    { label: t('pay.fee'), value: toman(Number(f.feesRial)) },
    { label: t('pay.discount'), value: toman(Number(f.discountsRial)) },
    { label: t('pay.refunded'), value: toman(Number(f.refundedRial)) },
    { label: t('evm.openOrders'), value: fa(Number(f.openOrders)) },
    { label: t('evm.payable'), value: toman(Number(f.organizerPayableRial)) },
  ];
});
const toolLinks = computed(() => (ev.value ? [
  { href: `/organizer/events/${ev.value.id}/operations`, label: t('cops.title'), icon: 'swords' as const },
  { href: `/organizer/events/${ev.value.id}/lan`, label: t('cops.lan'), icon: 'map-pin' as const },
  { href: `/organizer/events/${ev.value.id}/results`, label: t('res.title'), icon: 'gavel' as const },
  { href: `/organizer/events/${ev.value.id}/broadcast`, label: t('bc.title'), icon: 'broadcast' as const },
] : []));
</script>

<template>
  <QContainer>
    <QDataState v-if="!m || !ev" :state="error ? 'error' : 'loading'" :error="error" skeleton="rows" @retry="load" />
    <div v-else class="k-stack p-oe">
      <QPageHeader compact :breadcrumb="[{ label: t('oa.crumb'), href: '/organizer' }, { label: ev.name }]">
        <template #title><bdi>{{ ev.name }}</bdi></template>
        <template #badge><QStatusBadge :state="ev.state" /></template>
        <template #actions><QButton variant="secondary" size="sm" icon="external" :href="`/events/${ev.id}${ev.config.linkToken ? `?t=${ev.config.linkToken}` : ''}`">{{ t('evm.publicPage') }}</QButton></template>
      </QPageHeader>
      <nav class="p-oe-tools" :aria-label="t('oe.tools')">
        <RouterLink v-for="l in toolLinks" :key="l.href" :to="l.href" class="p-oe-tool"><QIcon :name="l.icon" :size="16" /> {{ l.label }}</RouterLink>
      </nav>

      <QTabs v-model="tab" variant="line" overflow="scroll" :items="tabs" :aria-label="ev.name">
        <template #panel="{ item }">
          <!-- publication gate (EVT-004) and lifecycle -->
          <div v-if="item.key === 'overview'" class="k-stack">
            <QCard v-if="['draft', 'in_review'].includes(ev.state)">
              <div class="k-stack">
                <h2 class="h4 p-oe-p">{{ t('oe.publishGate') }}</h2>
                <QAlert v-if="m.publishCheck.ok" tone="success" icon="check-circle">{{ t('evm.readyToPublish') }}</QAlert>
                <ul v-else class="p-oe-checks" :aria-label="t('evm.problems')">
                  <li v-for="p in m.publishCheck.problems" :key="p.code + (p.ref ?? '')"><QIcon name="x-circle" :size="18" class="p-oe-bad" /> <bdi>{{ p.message }}</bdi></li>
                </ul>
                <div class="p-oe-bar">
                  <QButton :disabled="!m.publishCheck.ok" @click="act(() => call.publish(id))">{{ t('evm.publish') }}</QButton>
                  <QDateField id="em-sched" v-model="sched" :label="t('evm.scheduleAt')" with-time disable-past />
                  <QButton variant="secondary" icon="clock" :disabled="!sched || !m.publishCheck.ok" @click="act(() => call.schedule(id, tz(sched)!, ev!.version))">{{ t('evm.schedule') }}</QButton>
                </div>
              </div>
            </QCard>
            <QCard v-if="(transitionsFor[ev.state] ?? []).length">
              <div class="k-stack">
                <h2 class="h4 p-oe-p">{{ t('evm.lifecycle') }}</h2>
                <div class="k-row"><QButton v-for="tr in transitionsFor[ev.state] ?? []" :key="tr" variant="secondary" @click="transition(tr)">{{ t(`evm.tr.${tr}` as never) }}</QButton></div>
              </div>
            </QCard>
            <QCard>
              <div class="k-stack">
                <QFileUpload id="em-poster" :label="t('evm.poster')" :hint="ev.config.posterFileId ? t('evm.posterSet') : t('evm.posterHint')" accept="image/png,image/jpeg,image/webp" :multiple="false" @files="uploadPoster" />
                <QAlert v-if="ev.visibility === 'link_only' && ev.config.linkToken" tone="info">{{ t('evm.linkOnly') }} <bdi class="q-ltr">/events/{{ ev.id }}?t={{ ev.config.linkToken }}</bdi></QAlert>
              </div>
            </QCard>
            <QCard>
              <details class="p-oe-more">
                <summary>{{ t('evm.affiliation') }} <QStatusBadge v-if="ev.config.affiliation" :state="ev.config.affiliation.state" /></summary>
                <div class="k-stack">
                  <p v-if="ev.config.affiliation?.note" class="p-oe-muted"><bdi>{{ ev.config.affiliation.note }}</bdi></p>
                  <form class="k-stack" novalidate @submit.prevent="claimAffiliation">
                    <div class="p-oe-grid">
                      <QSelect id="af-k" v-model="aff.kind" :label="t('mgmt.kind')" :options="opts(['publisher_licensed', 'federation_sanctioned', 'official_partner'], (k) => t(`evm.aff.${k}` as never))" />
                      <QTextField id="af-b" v-model="aff.body" :label="t('evm.affBody')" />
                    </div>
                    <QFileUpload id="af-e" :label="t('evm.affEvidence')" :hint="t('reg.docPrivate')" accept="application/pdf,image/png,image/jpeg" :multiple="false" :files="aff.file ? [{ name: aff.file.name, size: aff.file.size, scanState: 'pending' }] : []" @files="(fs) => (aff.file = fs[0] ?? null)" />
                    <div><QButton type="submit" size="sm" variant="secondary" :disabled="aff.body.length < 2 || !aff.file">{{ t('evm.affClaim') }}</QButton></div>
                  </form>
                  <p class="p-oe-muted">{{ t('evm.affHint') }}</p>
                </div>
              </details>
            </QCard>
            <QCard>
              <details class="p-oe-more">
                <summary>{{ t('evm.duplicate') }}</summary>
                <form class="p-oe-grid" novalidate @submit.prevent="duplicate">
                  <QTextField id="em-dn" v-model="dup.name" :label="t('events.name')" />
                  <QTextField id="em-ds" v-model="dup.slug" :label="t('adm.slug')" ltr />
                  <QCheckbox v-bind="b(dup, 'asTemplate')" :label="t('evm.asTemplate')" />
                  <div><QButton type="submit" variant="secondary" icon="copy" :disabled="!dup.name || !dup.slug">{{ t('evm.duplicate') }}</QButton></div>
                </form>
              </details>
            </QCard>
            <QCard v-if="!['cancelled', 'archived', 'closed', 'finished'].includes(ev.state)">
              <details class="p-oe-more">
                <summary class="p-oe-bad">{{ t('evm.cancel') }}</summary>
                <form class="k-stack" novalidate @submit.prevent="act(() => call.cancelEvent(id, cancel.approvalId, cancel.reason))">
                  <QAlert tone="danger">{{ t('evm.cancelHelp') }}</QAlert>
                  <QTextField id="em-cr" v-model="cancel.reason" :label="t('evm.reason')" multiline :rows="2" />
                  <div class="p-oe-bar">
                    <QButton variant="secondary" :disabled="cancel.reason.length < 5" @click="requestCancel">{{ t('evm.requestApproval') }}</QButton>
                    <QTextField id="em-ca" v-model="cancel.approvalId" :label="t('evm.approvalId')" ltr />
                    <QButton type="submit" variant="danger" :disabled="!cancel.approvalId || cancel.reason.length < 5">{{ t('evm.cancelNow') }}</QButton>
                  </div>
                </form>
              </details>
            </QCard>
          </div>

          <!-- disciplines, stages, registrations -->
          <div v-else-if="item.key === 'disciplines'" class="k-stack">
            <QCard v-for="d in m.disciplines" :key="d.id">
              <div class="k-stack">
                <div class="p-oe-head">
                  <h2 class="h4 p-oe-p"><bdi>{{ d.name }}</bdi></h2>
                  <code class="q-mono q-ltr p-oe-muted">{{ d.platform }} / {{ d.mode }} / {{ d.gameVersion }}</code>
                </div>
                <p class="p-oe-muted">{{ t('reg.kind') }}: {{ t(`reg.kind.${d.config.participantKind}` as never) }} · {{ t('reg.capacity') }}: {{ fa(d.config.capacity) }} · {{ t('reg.fee') }}: <QMoney :rial="d.config.feeRial" kind="fee" size="sm" /> · <QBadge :tone="d.rulesFrozen ? 'green' : 'neutral'">{{ d.rulesFrozen ? t('evm.rulesFrozen') : t('evm.rulesNotFrozen') }}</QBadge></p>

                <ul class="p-oe-rows">
                  <li v-for="s in stagesOf(d.id)" :key="s.id">
                    <div class="p-oe-head">
                      <span>{{ fa(s.order) }}. <strong><bdi>{{ s.name }}</bdi></strong> — <code class="q-mono q-ltr">{{ s.format }}</code> — {{ t(`reg.presence.${s.presence}` as never) }} <QStatusBadge :state="s.state" /></span>
                      <QButton size="sm" variant="ghost" @click="checkStart(s.id)">{{ t('evm.canStart') }}</QButton>
                    </div>
                    <span v-for="l in s.links" :key="l.kind + (l.fromStageId ?? '')" class="p-oe-muted">→ {{ t(`evm.link.${l.kind}` as never) }} × {{ fa(l.slots) }} — {{ t(`evm.points.${l.points}` as never) }}<template v-if="l.factor !== null"> ×{{ fa(l.factor) }}</template></span>
                    <template v-if="startInfo[s.id]">
                      <QAlert :tone="startInfo[s.id]!.ok ? 'success' : 'warning'">{{ startInfo[s.id]!.ok ? t('evm.canStartYes') : startInfo[s.id]!.reasons.join('؛ ') }}</QAlert>
                      <form v-if="!startInfo[s.id]!.ok" class="p-oe-bar" novalidate @submit.prevent="act(() => call.startException(s.id, exc.approvalId, exc.reason))">
                        <QTextField :id="`ex-r-${s.id}`" v-model="exc.reason" :label="t('evm.impact')" />
                        <QButton size="sm" variant="secondary" :disabled="exc.reason.length < 5" @click="requestStageException(s.id)">{{ t('evm.requestApproval') }}</QButton>
                        <QTextField :id="`ex-a-${s.id}`" v-model="exc.approvalId" :label="t('evm.approvalId')" ltr />
                        <QButton type="submit" size="sm" :disabled="!exc.approvalId || exc.reason.length < 5">{{ t('evm.startException') }}</QButton>
                      </form>
                    </template>
                  </li>
                </ul>

                <details v-if="['draft', 'in_review'].includes(ev.state)" class="p-oe-more">
                  <summary>{{ t('evm.addStage') }}</summary>
                  <form class="k-stack" novalidate @submit.prevent="act(() => call.addStage(d.id, stagePayload(d.id)))">
                    <div class="p-oe-grid">
                      <QTextField :id="`st-n-${d.id}`" v-model="stageForm(d.id).name" :label="t('events.stage')" />
                      <QTextField :id="`st-o-${d.id}`" v-bind="n(stageForm(d.id), 'order')" label="#" type="number" ltr />
                      <QSelect :id="`st-f-${d.id}`" v-model="stageForm(d.id).format" :label="t('events.format')" :options="opts(FORMATS, (f) => f)" />
                      <QSelect :id="`st-p-${d.id}`" v-model="stageForm(d.id).presence" :label="t('reg.presence')" :options="opts(['online', 'offline', 'hybrid'], (v) => t(`reg.presence.${v}` as never))" />
                      <QSelect :id="`st-from-${d.id}`" v-model="stageForm(d.id).from" :label="t('evm.fromStage')" :options="stageOpts(d.id)" />
                      <QSelect :id="`st-lk-${d.id}`" v-model="stageForm(d.id).kind" :label="t('evm.linkKind')" :options="opts(['qualifier', 'invite', 'seed', 'quota'], (k) => t(`evm.link.${k}` as never))" />
                      <QTextField :id="`st-sl-${d.id}`" v-bind="n(stageForm(d.id), 'slots')" :label="t('evm.slots')" type="number" ltr />
                      <QSelect :id="`st-pt-${d.id}`" v-model="stageForm(d.id).points" :label="t('evm.pointsCarry')" :options="opts(['carry', 'reset', 'factor'], (k) => t(`evm.points.${k}` as never))" />
                      <QTextField v-if="stageForm(d.id).points === 'factor'" :id="`st-fc-${d.id}`" v-bind="n(stageForm(d.id), 'factor')" :label="t('evm.factor')" input-mode="decimal" ltr />
                    </div>
                    <p class="p-oe-muted">{{ t('evm.linkHint') }}</p>
                    <div><QButton type="submit" variant="green" icon="plus" :disabled="!stageForm(d.id).name">{{ t('evm.addStage') }}</QButton></div>
                  </form>
                </details>

                <details class="p-oe-more" @toggle="($event.target as HTMLDetailsElement).open && loadSlots(d.id)">
                  <summary>{{ t('evm.qualSlots') }}</summary>
                  <div class="k-stack">
                    <ul class="p-oe-list"><li v-for="q in slotList[d.id] ?? []" :key="String(q._id)"><code class="q-mono q-ltr">{{ q.holderKey }}</code> — {{ t(`evm.src.${(q.source as Obj).kind}` as never) }} <code class="q-mono q-ltr">{{ (q.source as Obj).ref }}</code> — <QStatusBadge :state="String(q.state)" /></li></ul>
                    <form class="k-stack" novalidate @submit.prevent="act(() => call.createSlot(d.id, slotPayload(d.id)).then(() => loadSlots(d.id)))">
                      <div class="p-oe-grid">
                        <QSelect :id="`sl-k-${d.id}`" v-model="slotForm(d.id).kind" :label="t('evm.source')" :options="opts(['stage', 'event', 'invite', 'season'], (k) => t(`evm.src.${k}` as never))" />
                        <QTextField :id="`sl-r-${d.id}`" v-model="slotForm(d.id).ref" :label="t('evm.sourceRef')" ltr />
                        <QTextField :id="`sl-rk-${d.id}`" v-bind="n(slotForm(d.id), 'rank')" :label="t('evm.rank')" type="number" ltr />
                        <QTextField :id="`sl-h-${d.id}`" v-model="slotForm(d.id).holderKey" :label="t('evm.holderKey')" :hint="t('evm.holderKeyHint')" ltr />
                        <QSelect :id="`sl-t-${d.id}`" v-model="slotForm(d.id).target" :label="t('evm.targetStage')" :options="stageOpts(d.id)" />
                        <QTextField :id="`sl-w-${d.id}`" v-model="slotForm(d.id).reason" :label="t('evm.reason')" />
                      </div>
                      <div><QButton type="submit" size="sm" variant="secondary" :disabled="!slotForm(d.id).ref || !slotForm(d.id).holderKey || slotForm(d.id).reason.length < 3">{{ t('evm.addSlot') }}</QButton></div>
                    </form>
                    <p class="p-oe-muted">{{ t('evm.slotHint') }}</p>
                  </div>
                </details>

                <h3 class="p-oe-h3">{{ t('evm.registrations') }}</h3>
                <div class="k-row">
                  <QButton size="sm" variant="secondary" icon="refresh" @click="loadRegs(d.id)">{{ t('evm.loadRegs') }}</QButton>
                  <QButton size="sm" variant="ghost" icon="download" :href="csvUrl(d.id)" download>{{ t('evm.exportCsv') }}</QButton>
                  <QButton size="sm" variant="ghost" icon="ticket" @click="genCodes(d.id)">{{ t('evm.entryCodes') }}</QButton>
                </div>
                <QFileUpload :id="`imp-${d.id}`" :label="t('evm.importCsv')" accept=".csv,text/csv" :multiple="false" @files="(fs) => importCsv(d.id, fs)" />
                <p v-if="importResult" class="p-oe-muted" role="status">{{ importResult }}</p>
                <div v-if="codes[d.id]?.length" class="k-stack"><QCode v-for="c in codes[d.id]" :key="c" copy>{{ c }}</QCode></div>
                <QDataTable v-if="regs[d.id]" :caption="t('evm.registrations')" caption-hidden row-key="id" row-header="displayName" :columns="regCols" :rows="regs[d.id]!" :empty-text="'—'">
                  <template #cell-trackingCode="{ row }"><code class="q-mono q-ltr">{{ row.trackingCode }}</code></template>
                  <template #cell-displayName="{ row }"><bdi>{{ row.displayName }}</bdi></template>
                  <template #cell-state="{ row }"><QStatusBadge :state="row.state" /><span v-if="row.waitlisted" class="p-oe-muted"> #{{ fa(row.waitlistSeq ?? 0) }}</span></template>
                  <template #cell-issues="{ row }"><span v-for="i in row.eligibility.issues" :key="i.code + (i.clause ?? '')" class="p-oe-issue"><bdi>{{ i.message }}</bdi></span></template>
                  <template #row-actions="{ row }">
                    <QTextField :id="`rr-${row.id}`" v-model="reason[row.id]" :label="t('evm.reason')" hide-label :placeholder="t('evm.reason')" class="p-oe-sm" />
                    <QButton v-if="row.state === 'awaiting_review'" size="sm" variant="green" @click="decide(d.id, row, 'approve')">{{ t('evm.approve') }}</QButton>
                    <QButton v-if="row.state === 'awaiting_review'" size="sm" variant="secondary" @click="decide(d.id, row, 'mark_incomplete')">{{ t('evm.incomplete') }}</QButton>
                    <QButton v-if="['awaiting_review', 'awaiting_capacity'].includes(row.state)" size="sm" variant="danger" @click="decide(d.id, row, 'reject')">{{ t('evm.reject') }}</QButton>
                    <QButton v-if="row.state === 'confirmed'" size="sm" variant="danger" @click="decide(d.id, row, 'remove')">{{ t('evm.remove') }}</QButton>
                  </template>
                </QDataTable>
              </div>
            </QCard>

            <QCard v-if="['draft', 'in_review'].includes(ev.state)">
              <form class="k-stack" novalidate @submit.prevent="addDiscipline">
                <h2 class="h4 p-oe-p">{{ t('evm.addDiscipline') }}</h2>
                <div class="p-oe-grid">
                  <QTextField id="dc-n" v-model="dsc.name" :label="t('events.name')" required />
                  <QTextField id="dc-g" v-model="dsc.gameId" :label="t('evm.gameId')" required ltr />
                  <QTextField id="dc-gv" v-model="dsc.gameVersion" :label="t('evm.gameVersion')" required ltr />
                  <QTextField id="dc-p" v-model="dsc.platform" :label="t('evm.platform')" ltr />
                  <QTextField id="dc-m" v-model="dsc.mode" :label="t('evm.mode')" required ltr />
                  <QTextField id="dc-r" v-model="dsc.rulesPackageId" :label="t('evm.rulesPackage')" :hint="t('evm.rulesPackageHint')" ltr />
                  <QSelect id="dc-k" v-model="dsc.participantKind" :label="t('reg.kind')" :options="opts(['team', 'player'], (k) => t(`reg.kind.${k}` as never))" />
                  <QTextField id="dc-c" v-bind="n(dsc, 'capacity')" :label="t('reg.capacity')" type="number" ltr />
                  <QTextField id="dc-mn" v-bind="n(dsc, 'minParticipants')" :label="t('evm.minParticipants')" type="number" ltr />
                  <QTextField id="dc-f" v-bind="n(dsc, 'feeRial')" :label="t('evm.feeRial')" type="number" ltr :hint="dsc.feeRial ? toman(dsc.feeRial) : undefined" />
                  <QDateField id="dc-o" v-model="dsc.opens" :label="t('reg.opens')" with-time />
                  <QDateField id="dc-cl" v-model="dsc.closes" :label="t('reg.closes')" with-time required />
                  <QDateField id="dc-w" v-model="dsc.withdrawal" :label="t('reg.withdrawBy')" with-time />
                  <QSelect id="dc-cp" v-model="dsc.checkinPolicy" :label="t('evm.checkinPolicy')" :options="opts(['captain', 'all_members'], (p) => t(`evm.ci.${p}` as never))" />
                  <QTextField id="dc-co" v-bind="n(dsc, 'checkinOpens')" :label="t('evm.checkinOpens')" type="number" ltr />
                  <QTextField id="dc-cc" v-bind="n(dsc, 'checkinCloses')" :label="t('evm.checkinCloses')" type="number" ltr />
                </div>
                <QCheckbox v-bind="b(dsc, 'autoApprove')" :label="t('evm.autoApprove')" />
                <div><QButton type="submit" variant="green" icon="plus" :disabled="!dsc.name || !dsc.gameId || !dsc.gameVersion || !dsc.mode || !dsc.closes">{{ t('evm.addDiscipline') }}</QButton></div>
              </form>
            </QCard>
          </div>

          <!-- seasons and series (STG-005) -->
          <QCard v-else-if="item.key === 'seasons'">
            <div class="k-stack">
              <ul class="p-oe-list"><li v-for="s in seasons" :key="String(s._id)"><bdi>{{ s.name }}</bdi> — <code class="q-mono q-ltr">{{ s._id }}</code></li><li v-if="!seasons.length" class="p-oe-muted">—</li></ul>
              <form class="p-oe-grid" novalidate @submit.prevent="act(() => call.createSeason({ gameId: m!.disciplines[0]?.gameId ?? '', name: season.name, from: tz(season.from), to: tz(season.to), pointsPolicy: season.policy, nextEventQuotas: [] }).then(loadSeasons))">
                <QTextField id="ss-n" v-model="season.name" :label="t('events.name')" />
                <QDateField id="ss-f" v-model="season.from" :label="t('fin.from')" with-time />
                <QDateField id="ss-t" v-model="season.to" :label="t('fin.to')" with-time />
                <QTextField id="ss-p" v-model="season.policy" :label="t('evm.pointsPolicy')" />
                <div><QButton type="submit" size="sm" variant="green" icon="plus" :disabled="!m.disciplines.length || !season.name || !season.from || !season.to || !season.policy">{{ t('evm.addSeason') }}</QButton></div>
              </form>
            </div>
          </QCard>

          <!-- roster lock and check-in (ROS-003, CHK-002..004) -->
          <div v-else-if="item.key === 'checkin'" class="k-stack">
            <QAlert v-if="['draft', 'in_review'].includes(ev.state)" tone="info">{{ t('oe.checkinLater') }}</QAlert>
            <template v-else>
              <div class="k-row">
                <QButton variant="secondary" icon="lock" @click="act(() => call.lockRoster('event', id), t('evm.locked'))">{{ t('evm.lockRoster') }}</QButton>
                <QButton variant="ghost" icon="refresh" @click="loadCheckins">{{ t('evm.loadCheckins') }}</QButton>
                <QButton variant="danger" @click="act(() => call.finalizeCheckins('event', id).then(loadCheckins))">{{ t('evm.finalizeNoShows') }}</QButton>
              </div>
              <QCard padding="none">
                <ul class="p-oe-rows p-oe-pad"><li v-for="c in checkins" :key="String(c._id)"><span><code class="q-mono q-ltr">{{ c.registrationId }}</code> <QStatusBadge :state="String(c.state)" /></span></li><li v-if="!checkins.length" class="p-oe-muted">—</li></ul>
              </QCard>
              <QCard>
                <form class="p-oe-grid" novalidate @submit.prevent="act(() => call.manualCheckin({ level: 'event', ref: id, ...manual }).then(loadCheckins))">
                  <QTextField id="mc-r" v-model="manual.registrationId" :label="t('evm.registrationId')" ltr />
                  <QSelect id="mc-o" v-model="manual.outcome" :label="t('events.state')" :options="opts(['checked_in', 'late', 'no_show', 'excused'], (o) => t(`evm.co.${o}` as never))" />
                  <QTextField id="mc-why" v-model="manual.reason" :label="t('evm.reason')" />
                  <div><QButton type="submit" variant="secondary" :disabled="!manual.registrationId || manual.reason.length < 3">{{ t('evm.manualCheckin') }}</QButton></div>
                </form>
              </QCard>
            </template>
          </div>

          <!-- money: financial report, prizes, tickets, sponsors -->
          <div v-else class="k-stack">
            <div><QButton size="sm" variant="ghost" icon="refresh" @click="loadFinance">{{ t('evm.loadFinance') }}</QButton></div>
            <QCard v-if="fin"><QFacts :items="finFacts" :columns="4" dense /></QCard>
            <QCard v-if="prizes.length">
              <div class="k-stack">
                <h3 class="p-oe-h3">{{ t('reg.prizes') }}</h3>
                <p class="p-oe-muted">{{ t('reg.prizesNotGuaranteed') }}</p>
                <div v-for="p in prizes" :key="String(p._id)" class="k-stack p-oe-prize">
                  <p class="p-oe-p"><bdi>{{ p.title }}</bdi> — <QMoney :rial="Number(p.amountRial)" kind="prize" size="sm" /> <QStatusBadge :state="String(p.state)" /></p>
                  <form v-if="['defined', 'recipient_verified'].includes(String(p.state))" class="p-oe-grid" novalidate @submit.prevent="act(() => call.prizeRecipient(String(p._id), { kind: rcpForm(String(p._id)).kind, ref: rcpForm(String(p._id)).ref, payeePrincipalId: rcpForm(String(p._id)).payee, shares: [], expectedVersion: Number(p.version), approvalId: null }).then(loadFinance))">
                    <QSelect :id="`pr-k-${p._id}`" v-model="rcpForm(String(p._id)).kind" :label="t('reg.kind')" :options="opts(['team', 'player'], (k) => t(`reg.kind.${k}` as never))" />
                    <QTextField :id="`pr-r-${p._id}`" v-model="rcpForm(String(p._id)).ref" :label="t('evm.recipientRef')" ltr />
                    <QTextField :id="`pr-p-${p._id}`" v-model="rcpForm(String(p._id)).payee" :label="t('evm.payee')" ltr />
                    <div><QButton type="submit" size="sm" variant="secondary">{{ t('evm.setRecipient') }}</QButton></div>
                  </form>
                </div>
              </div>
            </QCard>
            <QCard>
              <div class="k-stack">
                <h3 class="p-oe-h3">{{ t('reg.tickets') }}</h3>
                <form class="p-oe-grid" novalidate @submit.prevent="act(() => call.configureTickets(id, tickets.capacity, tickets.priceRial))">
                  <QTextField id="tc-c" v-bind="n(tickets, 'capacity')" :label="t('reg.capacity')" type="number" ltr />
                  <QTextField id="tc-p" v-bind="n(tickets, 'priceRial')" :label="t('evm.amountRial')" type="number" ltr :hint="tickets.priceRial ? toman(tickets.priceRial) : undefined" />
                  <div><QButton type="submit" size="sm" variant="secondary">{{ t('mgmt.save') }}</QButton></div>
                </form>
                <form class="p-oe-grid" novalidate @submit.prevent="act(() => call.useTicket(ticketCode.trim()), t('evm.ticketUsed')).then(() => (ticketCode = ''))">
                  <QTextField id="tu-c" v-model="ticketCode" :label="t('evm.ticketCode')" ltr auto-complete="off" />
                  <div><QButton type="submit" size="sm" icon="check" :disabled="ticketCode.trim().length < 6">{{ t('evm.useTicket') }}</QButton></div>
                </form>
              </div>
            </QCard>
            <QCard>
              <div class="k-stack">
                <h3 class="p-oe-h3">{{ t('reg.sponsors') }}</h3>
                <ul class="p-oe-rows">
                  <li v-for="s in sponsors" :key="String(s._id)">
                    <span><bdi>{{ s.sponsorName }}</bdi> — {{ t(`reg.label.${s.label}` as never) }} — <QStatusBadge :state="String(s.state)" /></span>
                    <QButton v-if="s.state === 'draft'" size="sm" variant="green" @click="act(() => call.approveSponsor(String(s._id), sp.note).then(loadFinance))">{{ t('evm.approve') }}</QButton>
                  </li>
                </ul>
                <form class="p-oe-grid" novalidate @submit.prevent="act(() => call.addSponsor(id, { sponsorName: sp.sponsorName, placement: sp.placement, label: sp.label, publisherRestrictionNote: sp.note || null }).then(loadFinance))">
                  <QTextField id="sp-n" v-model="sp.sponsorName" :label="t('evm.sponsorName')" />
                  <QSelect id="sp-p" v-model="sp.placement" :label="t('evm.placement')" :options="opts(['event_header', 'live_center', 'stream_overlay', 'news_sidebar'], (p) => p)" />
                  <QSelect id="sp-l" v-model="sp.label" :label="t('evm.label')" :options="opts(['sponsor', 'advertisement'], (k) => t(`reg.label.${k}` as never))" />
                  <QTextField id="sp-x" v-model="sp.note" :label="t('evm.publisherNote')" />
                  <div><QButton type="submit" size="sm" variant="green" icon="plus" :disabled="!sp.sponsorName">{{ t('evm.addSponsor') }}</QButton></div>
                </form>
              </div>
            </QCard>
          </div>
        </template>
      </QTabs>
    </div>
  </QContainer>
</template>

<style scoped>
.p-oe-p { margin: 0; }
.p-oe-h3 { margin: 0; font-size: 15px; font-weight: 800; }
.p-oe-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-oe-bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: end; }
.p-oe-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr)); gap: var(--space-3); align-items: end; }
.p-oe-list { margin: 0; padding-inline-start: var(--space-5); display: grid; gap: var(--space-1); }
.p-oe-rows { margin: 0; padding: 0; list-style: none; }
.p-oe-rows > li { display: flex; flex-direction: column; gap: var(--space-2); padding-block: var(--space-3); border-block-end: 1px solid var(--line); }
.p-oe-pad > li { padding-inline: var(--space-4); }
.p-oe-checks { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-2); }
.p-oe-checks li { display: flex; align-items: center; gap: var(--space-2); }
.p-oe-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-oe-bad { color: var(--danger-text); }
.p-oe-issue { display: block; color: var(--warning-text); font-size: 13px; }
.p-oe-sm { max-inline-size: 10rem; }
.p-oe-prize { padding-block-start: var(--space-3); border-block-start: 1px solid var(--line); }
.p-oe-more > summary { cursor: pointer; font-weight: 800; }
.p-oe-more[open] > summary { margin-block-end: var(--space-3); }
.p-oe-tools { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.p-oe-tool { display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-pill); color: var(--ink); font-size: 13px; font-weight: 700; text-decoration: none; }
.p-oe-tool:hover { background: var(--surface-sunken); }
.p-oe-tool:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 2px; }
</style>
