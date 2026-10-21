<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { zonedWallTimeToUtc } from '@esp/contracts';
import type { ApiClientError } from '../api/client';
import { esp03, type ManageView } from '../api/esp03';
import { esp04 as esp04Api, type DrawDoc, type Proposal, type PublicMatch } from '../api/esp04';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';

/**
 * Competition operations for one event (FMT, DRAW, SCH, RUN-005, SRV): stage settings, draw lifecycle, structure,
 * rounds/phases, withdrawals and transfers; schedule configuration, automatic/bulk/delay proposals, manual times with
 * conflict display and reasoned override, reschedule decisions; incidents, review queue, referee calls and servers.
 * The server re-checks every action.
 */
type Obj = Record<string, unknown>;
/** template alias (vue-tsc mis-types direct use of this import inside template arrow functions) */
const esp04: typeof esp04Api = esp04Api;
const route = useRoute();
const eventId = computed(() => String(route.params.id));
const manage = ref<ManageView | null>(null);
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const stageId = ref('');
const tz = (s: string) => zonedWallTimeToUtc(s);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    manage.value = await esp03.manage(eventId.value);
    if (!stageId.value) stageId.value = manage.value.stages[0]?.id ?? '';
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
watch(eventId, () => void load(), { immediate: true });
async function act<T>(fn: () => Promise<T>, msg = '✓'): Promise<T | undefined> {
  failure.value = null;
  notice.value = '';
  try {
    const r = await fn();
    notice.value = msg;
    return r;
  } catch (e) {
    failure.value = toClientError(e);
    return undefined;
  }
}
const stage = computed(() => manage.value?.stages.find((s) => s.id === stageId.value) ?? null);

// ---- stage rules and settings
const rules = ref<{ values: Obj; hash: string; settings: Obj } | null>(null);
const settingsText = ref('{}');
async function loadRules() {
  const r = await act(() => esp04.stageRules(stageId.value), '');
  if (r) {
    rules.value = r;
    settingsText.value = JSON.stringify(r.settings ?? {}, null, 2);
  }
}
async function saveSettings() {
  let settings: Obj;
  try {
    settings = JSON.parse(settingsText.value) as Obj;
  } catch {
    notice.value = '';
    failure.value = toClientError(new Error(t('adm.invalidJson')));
    return;
  }
  const st = (await esp03.manage(eventId.value)).stages.find((s) => s.id === stageId.value) as unknown as { version: number } | undefined;
  await act(() => esp04.stageSettings(stageId.value, { settings, expectedVersion: st?.version ?? 0 }));
  if (failure.value) return;
  await loadRules();
}

// ---- draw
const draws = ref<DrawDoc[]>([]);
const method = ref<'manual' | 'random' | 'ranking' | 'qualifier'>('random');
const attrs = reactive<Record<string, { seed?: number | null; rank?: number | null; qualifierRank?: number | null; region?: string | null }>>({});
const redrawReason = ref('');
async function loadDraws() {
  const r = await act(() => esp04.draws(stageId.value), '');
  if (r) {
    draws.value = r.items;
    for (const e of r.items[0]?.input ?? []) attrs[e.participationId] ??= { seed: e.seed, rank: e.rank, qualifierRank: e.qualifierRank, region: e.region };
  }
}
const latest = computed(() => draws.value.find((d) => d.state !== 'superseded') ?? null);
const nameOf = (pid: string) => latest.value?.input.find((x) => x.participationId === pid)?.displayName ?? pid;
const cleanAttrs = () => Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined && x !== ''))]));
async function preview() {
  await act(() => esp04.drawPreview(stageId.value, { method: method.value, attributes: cleanAttrs() }));
  if (failure.value) return;
  await loadDraws();
}
async function step(s: 'confirm' | 'lock' | 'publish') {
  if (!latest.value) return;
  await act(() => esp04.drawStep(latest.value!._id, s));
  if (failure.value) return;
  await loadDraws();
  await load();
}
async function redraw() {
  const r = await act(() => esp04.redraw(stageId.value, { method: method.value, attributes: cleanAttrs(), reason: redrawReason.value }), t('cops.redrawDone'));
  if (r) notice.value = t('cops.discarded', { n: num(r.discardedMatches) });
  if (failure.value) return;
  await loadDraws();
  await load();
}
const withdrawal = reactive({ participationId: '', reason: '' });
const transferFrom = ref('');

// ---- schedule
const cfg = reactive({ from: '', to: '', duration: 45, buffer: 10, rest: 15 });
const proposals = ref<Proposal[]>([]);
const matches = ref<PublicMatch[]>([]);
const times = reactive<Record<string, { at: string; confirmed: boolean; reason: string; override: boolean; broadcast: boolean }>>({});
const conflicts = ref<Proposal['conflicts']>([]);
const delay = reactive({ matchId: '', minutes: 30, reason: '' });
const requests = ref<Obj[]>([]);
async function loadSchedule() {
  const [p, s, rq] = await Promise.all([esp04.proposals(eventId.value), esp04.schedule(eventId.value, { stageId: stageId.value || undefined, limit: 200 }), esp04.rescheduleRequests(eventId.value)].map((x) => x.catch(() => null)));
  proposals.value = (p as { items: Proposal[] } | null)?.items ?? [];
  matches.value = (s as { items: PublicMatch[] } | null)?.items ?? [];
  requests.value = (rq as { items: Obj[] } | null)?.items ?? [];
  for (const m of matches.value) times[m.id] ??= { at: '', confirmed: true, reason: '', override: false, broadcast: false };
}
async function saveConfig() {
  await act(() => esp04.setScheduleConfig(eventId.value, { windows: cfg.from && cfg.to ? [{ from: tz(cfg.from), to: tz(cfg.to) }] : [], defaultDurationMinutes: cfg.duration, bufferMinutes: cfg.buffer, minRestMinutes: cfg.rest, broadcastWindows: [], unavailable: [] }));
}
async function auto() {
  await act(() => esp04.autoSchedule(eventId.value, { ...(stageId.value ? { stageId: stageId.value } : {}), from: cfg.from ? tz(cfg.from) : new Date().toISOString(), reason: 'automatic plan' }));
  await loadSchedule();
}
async function setTime(m: PublicMatch) {
  const x = times[m.id]!;
  conflicts.value = [];
  failure.value = null;
  try {
    const r = await esp04.setTime(m.id, { at: tz(x.at), confirmed: x.confirmed, broadcast: x.broadcast, reason: x.reason || 'manual', ...(x.override ? { override: true } : {}) });
    conflicts.value = r.conflicts;
    notice.value = '✓';
  } catch (e) {
    const err = toClientError(e);
    failure.value = err;
    conflicts.value = ((err.details as { conflicts?: Proposal['conflicts'] } | undefined)?.conflicts) ?? [];
  }
  await loadSchedule();
}
const matchLabel = (id: string) => {
  const m = matches.value.find((x) => x.id === id);
  return m ? `${m.slot?.key ?? ''} ${m.sides.map((s) => s.displayName).join(' — ')}` : id;
};

// ---- incidents, review, calls, servers
const incident = reactive({ kind: 'internet_outage', notice: '', delay: 30, newVersion: '' });
const incidents = ref<Obj[]>([]);
const reviews = ref<Array<{ _id: string; kind: string; state: string; detail: Obj; resolution: string | null }>>([]);
const calls = ref<Array<{ _id: string; matchId: string; reason: string; state: string; createdAt: string }>>([]);
const resolution = reactive<Record<string, string>>({});
const servers = ref<Array<Obj & { _id: string; name: string; region: string; capacity: number; inUse: number; health: string; enabled: boolean }>>([]);
const srv = reactive({ gameId: '', name: '', region: 'tehran', host: '', port: 0, capacity: 1, matchId: '' });
async function loadOps() {
  const [i, r, c, s] = await Promise.all([esp04.incidents(eventId.value), esp04.reviewItems(eventId.value), esp04.refereeCalls(eventId.value), esp04.servers(eventId.value)].map((x) => x.catch(() => null)));
  incidents.value = (i as { items: Obj[] } | null)?.items ?? [];
  reviews.value = ((r as { items: typeof reviews.value } | null)?.items ?? []);
  calls.value = ((c as { items: typeof calls.value } | null)?.items ?? []);
  servers.value = ((s as { items: typeof servers.value } | null)?.items ?? []);
  srv.gameId ||= manage.value?.disciplines[0]?.gameId ?? '';
}
watch(stageId, () => {
  rules.value = null;
  draws.value = [];
});
</script>

<template>
  <DataState :loading="loading && !manage" :error="error" @retry="load">
    <template v-if="manage">
      <PageHeader :title="t('cops.title')" :lead="manage.event.name">
        <template #actions>
          <RouterLink class="btn btn-sm" :to="`/organizer/events/${eventId}`">{{ t('cops.back') }}</RouterLink>
          <RouterLink class="btn btn-sm" :to="`/organizer/events/${eventId}/lan`">{{ t('cops.lan') }}</RouterLink>
        </template>
      </PageHeader>
      <ErrorNote :error="failure" />
      <p v-if="failure?.code === 'PRECONDITION_FAILED'" class="muted" role="status">{{ failure.message }}</p>
      <p v-if="notice" role="status" class="ok">{{ notice }}</p>

      <FormField id="ops-stage" :label="t('cops.stage')">
        <template #default="{ id }"><select :id="id" v-model="stageId" class="input"><option v-for="s in manage.stages" :key="s.id" :value="s.id">{{ num(s.order) }}. {{ s.name }} — {{ t(`fmt.${s.format}` as never) }} ({{ s.state }})</option></select></template>
      </FormField>

      <section v-if="stage" class="card stack block">
        <div class="row between"><h2>{{ t('cops.stageTools') }}</h2><RouterLink :to="`/stages/${stage.id}`" class="btn btn-sm">{{ t('cops.publicStage') }}</RouterLink></div>
        <details @toggle="($event.target as HTMLDetailsElement).open && !rules && loadRules()">
          <summary>{{ t('cops.rules') }}</summary>
          <pre v-if="rules" class="code ltr">{{ JSON.stringify(rules.values, null, 1) }}</pre>
          <FormField id="ops-settings" :label="t('cops.settings')" :hint="t('cops.settingsHint')"><template #default="{ id, describedBy }"><textarea :id="id" v-model="settingsText" class="input ltr code" rows="5" :aria-describedby="describedBy" /></template></FormField>
          <button type="button" class="btn btn-sm" :disabled="stage.state !== 'planned'" @click="saveSettings">{{ t('mgmt.save') }}</button>
        </details>

        <h3>{{ t('cops.draw') }}</h3>
        <div class="row">
          <FormField id="ops-method" :label="t('stg.method')"><template #default="{ id }"><select :id="id" v-model="method" class="input"><option v-for="mm in ['random', 'manual', 'ranking', 'qualifier']" :key="mm" :value="mm">{{ t(`drw.${mm}` as never) }}</option></select></template></FormField>
          <button type="button" class="btn btn-sm" @click="loadDraws">{{ t('cops.loadDraws') }}</button>
          <button v-if="stage.state === 'planned'" type="button" class="btn btn-primary btn-sm" @click="preview">{{ t('cops.preview') }}</button>
        </div>
        <div v-if="latest" class="stack">
          <p>{{ t('stg.drawNo', { n: num(latest.number) }) }} — <StatusBadge :state="latest.state" /> · <bdi class="ltr code">{{ latest.seedString }}</bdi></p>
          <div class="table-wrap">
            <table class="tbl">
              <caption class="sr-only">{{ t('cops.entrants') }}</caption>
              <thead><tr><th scope="col">#</th><th scope="col">{{ t('st.participant') }}</th><th scope="col">{{ t('cops.seed') }}</th><th scope="col">{{ t('cops.rank') }}</th><th scope="col">{{ t('cops.qualifierRank') }}</th><th scope="col">{{ t('cops.region') }}</th></tr></thead>
              <tbody>
                <tr v-for="(pid, i) in latest.outcome.order" :key="pid">
                  <td>{{ num(i + 1) }}</td><th scope="row"><bdi>{{ nameOf(pid) }}</bdi></th>
                  <td><input v-model.number="attrs[pid]!.seed" type="number" min="1" class="input input-xs ltr" :aria-label="t('cops.seed')" /></td>
                  <td><input v-model.number="attrs[pid]!.rank" type="number" min="1" class="input input-xs ltr" :aria-label="t('cops.rank')" /></td>
                  <td><input v-model.number="attrs[pid]!.qualifierRank" type="number" min="1" class="input input-xs ltr" :aria-label="t('cops.qualifierRank')" /></td>
                  <td><input v-model="attrs[pid]!.region" class="input input-xs" dir="auto" :aria-label="t('cops.region')" /></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="latest.outcome.groups" class="groups"><div v-for="(ids, g) in latest.outcome.groups" :key="g" class="card"><strong>{{ t('br.group', { g: String(g) }) }}</strong><ul class="list"><li v-for="pid in ids" :key="pid"><bdi>{{ nameOf(pid) }}</bdi></li></ul></div></div>
          <ul v-if="latest.outcome.explanations.length" class="list muted"><li v-for="(x, i) in latest.outcome.explanations" :key="i" dir="auto">{{ x }}</li></ul>
          <div class="row">
            <button v-if="latest.state === 'preview'" type="button" class="btn btn-sm" @click="step('confirm')">{{ t('cops.confirm') }}</button>
            <button v-if="latest.state === 'confirmed'" type="button" class="btn btn-sm" @click="step('lock')">{{ t('cops.lock') }}</button>
            <button v-if="latest.state === 'locked'" type="button" class="btn btn-primary btn-sm" @click="step('publish')">{{ t('cops.publish') }}</button>
          </div>
          <form v-if="latest.state === 'published'" class="row" novalidate @submit.prevent="redraw">
            <FormField id="ops-redraw" :label="t('cops.redrawReason')"><template #default="{ id }"><input :id="id" v-model="redrawReason" class="input" dir="auto" /></template></FormField>
            <button type="submit" class="btn btn-danger btn-sm" :disabled="redrawReason.trim().length < 5">{{ t('cops.redraw') }}</button>
          </form>
        </div>

        <h3>{{ t('cops.structure') }}</h3>
        <div class="row">
          <button v-if="stage.state === 'drawn'" type="button" class="btn btn-primary btn-sm" @click="act(() => esp04.generate(stage!.id)).then(load)">{{ t('cops.generate') }}</button>
          <button v-if="['swiss', 'multi_lobby'].includes(stage.format)" type="button" class="btn btn-sm" @click="act(() => esp04.nextRound(stage!.id))">{{ t('cops.nextRound') }}</button>
          <button v-if="stage.format === 'mixed'" type="button" class="btn btn-sm" @click="act(() => esp04.nextPhase(stage!.id))">{{ t('cops.nextPhase') }}</button>
        </div>
        <form class="row" novalidate @submit.prevent="act(() => esp04.withdraw(stage!.id, withdrawal.participationId, withdrawal.reason), t('cops.withdrawn'))">
          <FormField id="ops-wd" :label="t('cops.withdrawal')"><template #default="{ id }"><select :id="id" v-model="withdrawal.participationId" class="input"><option value="" disabled>—</option><option v-for="pid in latest?.outcome.order ?? []" :key="pid" :value="pid">{{ nameOf(pid) }}</option></select></template></FormField>
          <FormField id="ops-wdr" :label="t('evm.reason')"><template #default="{ id }"><input :id="id" v-model="withdrawal.reason" class="input" dir="auto" /></template></FormField>
          <button type="submit" class="btn btn-danger btn-sm" :disabled="!withdrawal.participationId || withdrawal.reason.length < 5">{{ t('cops.recordWithdrawal') }}</button>
        </form>
        <form v-if="manage.stages.some((s) => s.id !== stage!.id && s.order < stage!.order)" class="row" novalidate @submit.prevent="act(async () => { const r = await esp04.transfer(stage!.id, transferFrom); notice = t('cops.transferred', { c: num(r.created), e: num(r.existing) }); })">
          <FormField id="ops-tf" :label="t('cops.transferFrom')"><template #default="{ id }"><select :id="id" v-model="transferFrom" class="input"><option v-for="s in manage.stages.filter((x) => x.order < stage!.order)" :key="s.id" :value="s.id">{{ s.name }}</option></select></template></FormField>
          <button type="submit" class="btn btn-sm" :disabled="!transferFrom">{{ t('cops.transfer') }}</button>
        </form>
      </section>

      <section class="card stack block">
        <div class="row between"><h2>{{ t('cops.schedule') }}</h2><button type="button" class="btn btn-sm" @click="loadSchedule">{{ t('cops.loadSchedule') }}</button></div>
        <form class="grid" novalidate @submit.prevent="saveConfig">
          <FormField id="sc-from" :label="t('cops.windowFrom')"><template #default="{ id }"><input :id="id" v-model="cfg.from" type="datetime-local" class="input" /></template></FormField>
          <FormField id="sc-to" :label="t('cops.windowTo')"><template #default="{ id }"><input :id="id" v-model="cfg.to" type="datetime-local" class="input" /></template></FormField>
          <FormField id="sc-dur" :label="t('cops.duration')"><template #default="{ id }"><input :id="id" v-model.number="cfg.duration" type="number" min="1" class="input ltr" /></template></FormField>
          <FormField id="sc-buf" :label="t('cops.buffer')"><template #default="{ id }"><input :id="id" v-model.number="cfg.buffer" type="number" min="0" class="input ltr" /></template></FormField>
          <FormField id="sc-rest" :label="t('cops.rest')"><template #default="{ id }"><input :id="id" v-model.number="cfg.rest" type="number" min="0" class="input ltr" /></template></FormField>
          <div class="row"><button type="submit" class="btn btn-sm">{{ t('cops.saveConfig') }}</button><button type="button" class="btn btn-primary btn-sm" @click="auto">{{ t('cops.auto') }}</button></div>
        </form>
        <article v-for="p in proposals.filter((x) => x.state === 'draft')" :key="p._id" class="card stack proposal">
          <h3>{{ t(`cops.pk.${p.kind}` as never) }} — <span dir="auto">{{ p.reason }}</span></h3>
          <ul class="list"><li v-for="c in p.changes" :key="c.matchId"><bdi>{{ matchLabel(c.matchId) }}</bdi>: <JalaliDate :iso="c.from" /> → <JalaliDate :iso="c.to" /></li></ul>
          <ul v-if="p.conflicts.length" class="list"><li v-for="(c, i) in p.conflicts" :key="i" :class="c.hard ? 'bad' : 'warn'">{{ c.hard ? t('cops.hard') : t('cops.soft') }} — {{ t(`cops.ck.${c.kind}` as never) }}: <span dir="auto">{{ c.detail }}</span></li></ul>
          <div class="row">
            <button type="button" class="btn btn-primary btn-sm" @click="act(() => esp04.applyProposal(p._id, { confirm: true })).then(loadSchedule)">{{ t('cops.apply') }}</button>
            <button type="button" class="btn btn-sm" @click="act(() => esp04.rejectProposal(p._id)).then(loadSchedule)">{{ t('evm.reject') }}</button>
          </div>
        </article>
        <ul v-if="conflicts.length" class="list" role="alert"><li v-for="(c, i) in conflicts" :key="i" :class="c.hard ? 'bad' : 'warn'">{{ c.hard ? t('cops.hard') : t('cops.soft') }} — {{ t(`cops.ck.${c.kind}` as never) }}: <span dir="auto">{{ c.detail }}</span></li></ul>
        <div v-if="matches.length" class="table-wrap">
          <table class="tbl">
            <caption class="sr-only">{{ t('cops.matches') }}</caption>
            <thead><tr><th scope="col">{{ t('room.round') }}</th><th scope="col">{{ t('match.sides') }}</th><th scope="col">{{ t('match.scheduledAt') }}</th><th scope="col">{{ t('cops.newTime') }}</th><th scope="col">{{ t('evm.actions') }}</th></tr></thead>
            <tbody>
              <tr v-for="m in matches" :key="m.id">
                <td><bdi class="ltr">{{ m.slot?.key }}</bdi></td>
                <th scope="row"><RouterLink :to="`/matches/${m.id}`"><bdi>{{ m.sides.map((s) => s.displayName).join(' — ') || t('br.tbd') }}</bdi></RouterLink></th>
                <td><JalaliDate :iso="m.scheduledAt" /><span v-if="m.estimated && m.scheduledAt" class="muted"> ~</span></td>
                <td class="stack">
                  <input v-model="times[m.id]!.at" type="datetime-local" class="input input-sm" :aria-label="t('cops.newTime')" />
                  <input v-model="times[m.id]!.reason" class="input input-sm" dir="auto" :placeholder="t('evm.reason')" :aria-label="t('evm.reason')" />
                  <label class="row small"><input v-model="times[m.id]!.override" type="checkbox" /> {{ t('cops.override') }}</label>
                  <label class="row small"><input v-model="times[m.id]!.broadcast" type="checkbox" /> {{ t('cops.broadcast') }}</label>
                </td>
                <td><div class="row"><button type="button" class="btn btn-sm" :disabled="!times[m.id]!.at" @click="setTime(m)">{{ t('cops.setTime') }}</button><button type="button" class="btn btn-sm" @click="delay.matchId = m.id">{{ t('cops.delay') }}</button></div></td>
              </tr>
            </tbody>
          </table>
        </div>
        <form v-if="delay.matchId" class="row" novalidate @submit.prevent="act(() => esp04.delay(delay.matchId, delay.minutes, delay.reason)).then(loadSchedule)">
          <span><bdi>{{ matchLabel(delay.matchId) }}</bdi></span>
          <FormField id="dl-m" :label="t('cops.delayMinutes')"><template #default="{ id }"><input :id="id" v-model.number="delay.minutes" type="number" min="1" class="input ltr" /></template></FormField>
          <FormField id="dl-r" :label="t('evm.reason')"><template #default="{ id }"><input :id="id" v-model="delay.reason" class="input" dir="auto" /></template></FormField>
          <button type="submit" class="btn btn-sm" :disabled="delay.reason.length < 2">{{ t('cops.proposeDelay') }}</button>
        </form>
        <h3 v-if="requests.length">{{ t('cops.requests') }}</h3>
        <ul class="list"><li v-for="r in requests" :key="String(r._id)"><bdi>{{ matchLabel(String(r.matchId)) }}</bdi> → <JalaliDate :iso="String(r.proposedAt)" /> — <span dir="auto">{{ r.reason }}</span> <StatusBadge :state="String(r.state)" />
          <template v-if="r.state === 'agreed'"><button type="button" class="btn btn-sm" @click="act(() => esp04.decideReschedule(String(r._id), true, 'approved')).then(loadSchedule)">{{ t('evm.approve') }}</button><button type="button" class="btn btn-sm" @click="act(() => esp04.decideReschedule(String(r._id), false, 'rejected')).then(loadSchedule)">{{ t('evm.reject') }}</button></template></li></ul>
      </section>

      <section class="card stack block">
        <div class="row between"><h2>{{ t('cops.control') }}</h2><button type="button" class="btn btn-sm" @click="loadOps">{{ t('cops.refresh') }}</button></div>
        <form class="grid" novalidate @submit.prevent="act(() => esp04.openIncident(eventId, { kind: incident.kind, publicNotice: incident.notice, delayMinutes: incident.delay, newGameVersion: incident.newVersion || null })).then(loadOps)">
          <FormField id="in-k" :label="t('cops.incidentKind')"><template #default="{ id }"><select :id="id" v-model="incident.kind" class="input"><option v-for="k in ['internet_outage', 'game_update', 'infrastructure', 'venue']" :key="k" :value="k">{{ t(`cops.ik.${k}` as never) }}</option></select></template></FormField>
          <FormField id="in-n" :label="t('cops.publicNotice')"><template #default="{ id }"><input :id="id" v-model="incident.notice" class="input" dir="auto" /></template></FormField>
          <FormField id="in-d" :label="t('cops.delayMinutes')"><template #default="{ id }"><input :id="id" v-model.number="incident.delay" type="number" min="0" class="input ltr" /></template></FormField>
          <FormField v-if="incident.kind === 'game_update'" id="in-v" :label="t('cops.newVersion')"><template #default="{ id }"><input :id="id" v-model="incident.newVersion" class="input ltr" /></template></FormField>
          <button type="submit" class="btn btn-danger btn-sm" :disabled="incident.notice.length < 5">{{ t('cops.openIncident') }}</button>
        </form>
        <ul class="list"><li v-for="i in incidents" :key="String(i._id ?? i.id)"><span dir="auto">{{ i.publicNotice }}</span> <StatusBadge :state="String(i.state)" /><button v-if="i.state === 'active'" type="button" class="btn btn-sm" @click="act(() => esp04.resolveIncident(String(i._id ?? i.id), true, resolution[String(i._id ?? i.id)] ?? '')).then(loadOps)">{{ t('cops.resolveResume') }}</button><input v-if="i.state === 'active'" v-model="resolution[String(i._id ?? i.id)]" class="input input-sm" dir="auto" :placeholder="t('cops.compatNote')" :aria-label="t('cops.compatNote')" /></li></ul>
        <h3>{{ t('cops.review') }} ({{ num(reviews.filter((r) => r.state === 'open').length) }})</h3>
        <ul class="list"><li v-for="r in reviews" :key="r._id"><strong>{{ t(`cops.rk.${r.kind}` as never) }}</strong> — <span dir="auto">{{ (r.detail.message ?? r.detail.conflict ?? '') as string }}</span> <StatusBadge :state="r.state" />
          <template v-if="r.state === 'open'"><input v-model="resolution[r._id]" class="input input-sm" dir="auto" :placeholder="t('cops.resolution')" :aria-label="t('cops.resolution')" /><button type="button" class="btn btn-sm" :disabled="(resolution[r._id] ?? '').length < 5" @click="act(() => esp04.resolveReview(r._id, resolution[r._id]!)).then(loadOps)">{{ t('cops.resolve') }}</button></template></li></ul>
        <h3>{{ t('cops.calls') }}</h3>
        <ul class="list"><li v-for="c in calls" :key="c._id"><RouterLink :to="`/matches/${c.matchId}`">{{ c.matchId }}</RouterLink> — <span dir="auto">{{ c.reason }}</span> <StatusBadge :state="c.state" /></li></ul>
        <h3>{{ t('cops.servers') }}</h3>
        <ul class="list"><li v-for="s in servers" :key="s._id"><bdi>{{ s.name }}</bdi> · {{ s.region }} · {{ num(s.inUse) }}/{{ num(s.capacity) }} <StatusBadge :state="s.health" />
          <button type="button" class="btn btn-sm" @click="act(() => esp04.serverHealth(s._id, 'healthy', true)).then(loadOps)">{{ t('cops.markHealthy') }}</button><button type="button" class="btn btn-sm" @click="act(() => esp04.serverHealth(s._id, 'down', false)).then(loadOps)">{{ t('cops.markDown') }}</button></li></ul>
        <form class="grid" novalidate @submit.prevent="act(() => esp04.createServer(eventId, { gameId: srv.gameId, name: srv.name, region: srv.region, kind: 'dedicated', connection: { host: srv.host, port: srv.port || null }, capacity: srv.capacity })).then(loadOps)">
          <FormField id="sv-n" :label="t('events.name')"><template #default="{ id }"><input :id="id" v-model="srv.name" class="input ltr" /></template></FormField>
          <FormField id="sv-r" :label="t('cops.region')"><template #default="{ id }"><input :id="id" v-model="srv.region" class="input ltr" /></template></FormField>
          <FormField id="sv-h" :label="t('match.lobbyHost')"><template #default="{ id }"><input :id="id" v-model="srv.host" class="input ltr" /></template></FormField>
          <FormField id="sv-p" :label="t('cops.port')"><template #default="{ id }"><input :id="id" v-model.number="srv.port" type="number" min="0" class="input ltr" /></template></FormField>
          <FormField id="sv-c" :label="t('reg.capacity')"><template #default="{ id }"><input :id="id" v-model.number="srv.capacity" type="number" min="1" class="input ltr" /></template></FormField>
          <button type="submit" class="btn btn-sm" :disabled="!srv.name || !srv.host">{{ t('cops.addServer') }}</button>
        </form>
        <form class="row" novalidate @submit.prevent="act(() => esp04.allocate(srv.matchId, null, 'auto allocation'))">
          <FormField id="sv-m" :label="t('cops.allocateFor')"><template #default="{ id }"><select :id="id" v-model="srv.matchId" class="input"><option v-for="m in matches" :key="m.id" :value="m.id">{{ matchLabel(m.id) }}</option></select></template></FormField>
          <button type="submit" class="btn btn-sm" :disabled="!srv.matchId">{{ t('cops.allocate') }}</button>
        </form>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.block { margin-block-start: var(--sp-4); }
.between { justify-content: space-between; }
.row { flex-wrap: wrap; gap: var(--sp-2); align-items: flex-end; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: var(--sp-3); align-items: end; }
.groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: var(--sp-2); }
.list { margin: 0; padding-inline-start: var(--sp-5); display: grid; gap: var(--sp-1); }
.table-wrap { overflow-x: auto; }
.tbl { inline-size: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
.tbl th, .tbl td { padding: var(--sp-1) var(--sp-2); border-block-end: 1px solid var(--border); text-align: start; vertical-align: top; }
.input-xs { max-inline-size: 5rem; }
.input-sm { max-inline-size: 12rem; }
.code { font-family: monospace; font-size: var(--fs-xs); max-block-size: 14rem; overflow: auto; white-space: pre-wrap; }
.ok { color: var(--ok); }
.warn { color: var(--warn); }
.bad { color: var(--danger); font-weight: 600; }
.small { font-size: var(--fs-xs); }
.proposal { border-inline-start: 4px solid var(--accent); }
h2, h3, p { margin: 0; }
</style>
