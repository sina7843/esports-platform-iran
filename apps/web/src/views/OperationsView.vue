<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { QAlert, QButton, QCard, QCheckbox, QCode, QContainer, QDataState, QDataTable, QDateField, QEmptyState, QPageHeader, QSelect, QStatusBadge, QTabs, QTextField, fa, formatJalali, num, useToast, type QDataTableColumn } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp03, type ManageView } from '../api/esp03';
import { esp04 as esp04Api, type DrawDoc, type Proposal, type PublicMatch } from '../api/esp04';
import { toClientError } from '../errors';
import { t } from '../i18n';
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
/** QDateField gives Tehran wall time with its offset; the API takes UTC. */
const tz = (s: string) => new Date(s).toISOString();

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
const cfg = reactive({ from: null as string | null, to: null as string | null, duration: '45', buffer: '10', rest: '15' });
const proposals = ref<Proposal[]>([]);
const matches = ref<PublicMatch[]>([]);
const times = reactive<Record<string, { at: string | null; confirmed: boolean; reason: string; override: boolean; broadcast: boolean }>>({});
const conflicts = ref<Proposal['conflicts']>([]);
const delay = reactive({ matchId: '', minutes: '30', reason: '' });
const requests = ref<Obj[]>([]);
async function loadSchedule() {
  const [p, s, rq] = await Promise.all([esp04.proposals(eventId.value), esp04.schedule(eventId.value, { stageId: stageId.value || undefined, limit: 200 }), esp04.rescheduleRequests(eventId.value)].map((x) => x.catch(() => null)));
  proposals.value = (p as { items: Proposal[] } | null)?.items ?? [];
  matches.value = (s as { items: PublicMatch[] } | null)?.items ?? [];
  requests.value = (rq as { items: Obj[] } | null)?.items ?? [];
  for (const m of matches.value) times[m.id] ??= { at: null, confirmed: true, reason: '', override: false, broadcast: false };
}
async function saveConfig() {
  await act(() => esp04.setScheduleConfig(eventId.value, { windows: cfg.from && cfg.to ? [{ from: tz(cfg.from), to: tz(cfg.to) }] : [], defaultDurationMinutes: Number(cfg.duration), bufferMinutes: Number(cfg.buffer), minRestMinutes: Number(cfg.rest), broadcastWindows: [], unavailable: [] }));
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
    const r = await esp04.setTime(m.id, { at: tz(x.at!), confirmed: x.confirmed, broadcast: x.broadcast, reason: x.reason || 'manual', ...(x.override ? { override: true } : {}) });
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
const incident = reactive({ kind: 'internet_outage', notice: '', delay: '30', newVersion: '' });
const incidents = ref<Obj[]>([]);
const reviews = ref<Array<{ _id: string; kind: string; state: string; detail: Obj; resolution: string | null }>>([]);
const calls = ref<Array<{ _id: string; matchId: string; reason: string; state: string; createdAt: string }>>([]);
const resolution = reactive<Record<string, string>>({});
const servers = ref<Array<Obj & { _id: string; name: string; region: string; capacity: number; inUse: number; health: string; enabled: boolean }>>([]);
const srv = reactive({ gameId: '', name: '', region: 'tehran', host: '', port: '', capacity: '1', matchId: '' });
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
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n === '✓' ? t('rv.done') : n, duration: 3000 }); });
watch(failure, (f) => { if (f && f.code !== 'PRECONDITION_FAILED') push({ tone: 'danger', message: f.message }); });
const tab = ref('stage');
const tabs = computed(() => [
  { key: 'stage', label: t('cops.stageTools'), icon: 'swords' as const },
  { key: 'schedule', label: t('cops.schedule'), icon: 'calendar' as const, count: proposals.value.filter((x) => x.state === 'draft').length },
  { key: 'control', label: t('cops.control'), icon: 'activity' as const, count: reviews.value.filter((r) => r.state === 'open').length },
]);
watch(tab, (k) => { if (k === 'schedule' && !matches.value.length) void loadSchedule(); if (k === 'control') void loadOps(); });
const stageOpts = computed(() => (manage.value?.stages ?? []).map((s) => ({ value: s.id, label: `${num(s.order)}. ${s.name} — ${t(`fmt.${s.format}` as never)} (${s.state})` })));
const METHODS = computed(() => ['random', 'manual', 'ranking', 'qualifier'].map((m) => ({ value: m, label: t(`drw.${m}` as never) })));
const methodModel = computed({ get: () => method.value as string, set: (v: string) => { method.value = v as typeof method.value; } });
type AttrKey = 'seed' | 'rank' | 'qualifierRank';
const numAttr = (pid: string, k: AttrKey) => String(attrs[pid]?.[k] ?? '');
const setNumAttr = (pid: string, k: AttrKey, v: string) => { (attrs[pid] ??= {})[k] = v ? Number(v) : null; };
type DrawRow = { pid: string; i: number };
const drawRows = computed<DrawRow[]>(() => (latest.value?.outcome.order ?? []).map((pid, i) => ({ pid, i })));
const drawCols = computed<QDataTableColumn<DrawRow>[]>(() => [
  { key: 'i', header: '#' }, { key: 'pid', header: t('st.participant') }, { key: 'seed', header: t('cops.seed') },
  { key: 'rank', header: t('cops.rank') }, { key: 'qualifierRank', header: t('cops.qualifierRank') }, { key: 'region', header: t('cops.region') },
]);
const matchCols = computed<QDataTableColumn<PublicMatch>[]>(() => [
  { key: 'slot', header: t('room.round') }, { key: 'sides', header: t('match.sides') }, { key: 'scheduledAt', header: t('match.scheduledAt') }, { key: 'newTime', header: t('cops.newTime') },
]);
const wdOpts = computed(() => (latest.value?.outcome.order ?? []).map((pid) => ({ value: pid, label: nameOf(pid) })));
const transferOpts = computed(() => (manage.value?.stages ?? []).filter((x) => stage.value && x.order < stage.value.order).map((s) => ({ value: s.id, label: s.name })));
const INCIDENTS = computed(() => ['internet_outage', 'game_update', 'infrastructure', 'venue'].map((k) => ({ value: k, label: t(`cops.ik.${k}` as never) })));
const allocOpts = computed(() => matches.value.map((m) => ({ value: m.id, label: matchLabel(m.id) })));
const flag = (id: string, k: 'override' | 'broadcast', v: boolean | null) => { times[id]![k] = !!v; };
const iid = (i: Obj) => String(i._id ?? i.id);
</script>

<template>
  <QContainer>
    <QDataState v-if="!manage" :state="error ? 'error' : 'loading'" :error="error" skeleton="rows" @retry="load" />
    <div v-else class="k-stack p-ops">
      <QPageHeader compact :title="t('cops.title')" :description="manage.event.name" :breadcrumb="[{ label: t('oa.crumb'), href: '/organizer' }, { label: manage.event.name, href: `/organizer/events/${eventId}` }, { label: t('cops.title') }]">
        <template #actions>
          <QButton variant="secondary" size="sm" icon="arrow-right" :href="`/organizer/events/${eventId}`">{{ t('cops.back') }}</QButton>
          <QButton variant="secondary" size="sm" icon="map-pin" :href="`/organizer/events/${eventId}/lan`">{{ t('cops.lan') }}</QButton>
        </template>
      </QPageHeader>
      <QAlert v-if="failure?.code === 'PRECONDITION_FAILED'" tone="warning">{{ failure.message }}</QAlert>

      <QTabs v-model="tab" variant="line" :items="tabs" :aria-label="t('cops.title')">
        <template #panel="{ item }">
          <!-- stage tools: settings, draw, structure -->
          <div v-if="item.key === 'stage'" class="k-stack">
            <div class="p-ops-bar">
              <QSelect id="ops-stage" v-model="stageId" :label="t('cops.stage')" :options="stageOpts" />
              <QButton v-if="stage" variant="ghost" size="sm" icon="external" :href="`/stages/${stage.id}`">{{ t('cops.publicStage') }}</QButton>
            </div>
            <QEmptyState v-if="!stage" compact icon="swords" :title="t('cops.noStage')" />
            <template v-else>
              <QCard>
                <details class="p-ops-more" @toggle="($event.target as HTMLDetailsElement).open && !rules && loadRules()">
                  <summary>{{ t('cops.rules') }}</summary>
                  <div class="k-stack">
                    <QCode v-if="rules" block>{{ JSON.stringify(rules.values, null, 1) }}</QCode>
                    <QTextField id="ops-settings" v-model="settingsText" :label="t('cops.settings')" :hint="t('cops.settingsHint')" multiline :rows="5" ltr />
                    <div><QButton size="sm" variant="secondary" :disabled="stage.state !== 'planned'" @click="saveSettings">{{ t('mgmt.save') }}</QButton></div>
                  </div>
                </details>
              </QCard>

              <QCard>
                <div class="k-stack">
                  <h2 class="h4 p-ops-p">{{ t('cops.draw') }}</h2>
                  <div class="p-ops-bar">
                    <QSelect id="ops-method" v-model="methodModel" :label="t('stg.method')" :options="METHODS" />
                    <QButton size="sm" variant="secondary" icon="refresh" @click="loadDraws">{{ t('cops.loadDraws') }}</QButton>
                    <QButton v-if="stage.state === 'planned'" size="sm" @click="preview">{{ t('cops.preview') }}</QButton>
                  </div>
                  <div v-if="latest" class="k-stack">
                    <p class="p-ops-p">{{ t('stg.drawNo', { n: fa(latest.number) }) }} — <QStatusBadge :state="latest.state" /> · <code class="q-mono q-ltr">{{ latest.seedString }}</code></p>
                    <QDataTable :caption="t('cops.entrants')" caption-hidden row-key="pid" row-header="pid" :columns="drawCols" :rows="drawRows">
                      <template #cell-i="{ row }">{{ fa(row.i + 1) }}</template>
                      <template #cell-pid="{ row }"><bdi>{{ nameOf(row.pid) }}</bdi></template>
                      <template v-for="k in (['seed', 'rank', 'qualifierRank'] as const)" :key="k" #[`cell-${k}`]="{ row }">
                        <QTextField :id="`at-${k}-${row.pid}`" :model-value="numAttr(row.pid, k)" :label="t(`cops.${k}` as never)" hide-label type="number" ltr class="p-ops-xs" @update:model-value="(v?: string) => setNumAttr(row.pid, k, v ?? '')" />
                      </template>
                      <template #cell-region="{ row }">
                        <QTextField :id="`at-rg-${row.pid}`" :model-value="attrs[row.pid]?.region ?? ''" :label="t('cops.region')" hide-label class="p-ops-sm" @update:model-value="(v?: string) => ((attrs[row.pid] ??= {}).region = v || null)" />
                      </template>
                    </QDataTable>
                    <div v-if="latest.outcome.groups" class="p-ops-groups">
                      <QCard v-for="(ids, g) in latest.outcome.groups" :key="g"><strong>{{ t('br.group', { g: String(g) }) }}</strong><ul class="p-ops-list"><li v-for="pid in ids" :key="pid"><bdi>{{ nameOf(pid) }}</bdi></li></ul></QCard>
                    </div>
                    <ul v-if="latest.outcome.explanations.length" class="p-ops-list p-ops-muted"><li v-for="(x, i) in latest.outcome.explanations" :key="i"><bdi>{{ x }}</bdi></li></ul>
                    <div class="k-row">
                      <QButton v-if="latest.state === 'preview'" size="sm" variant="secondary" @click="step('confirm')">{{ t('cops.confirm') }}</QButton>
                      <QButton v-if="latest.state === 'confirmed'" size="sm" variant="secondary" icon="lock" @click="step('lock')">{{ t('cops.lock') }}</QButton>
                      <QButton v-if="latest.state === 'locked'" size="sm" variant="green" @click="step('publish')">{{ t('cops.publish') }}</QButton>
                    </div>
                    <form v-if="latest.state === 'published'" class="p-ops-bar" novalidate @submit.prevent="redraw">
                      <QTextField id="ops-redraw" v-model="redrawReason" :label="t('cops.redrawReason')" />
                      <QButton type="submit" size="sm" variant="danger" :disabled="redrawReason.trim().length < 5">{{ t('cops.redraw') }}</QButton>
                    </form>
                  </div>
                </div>
              </QCard>

              <QCard>
                <div class="k-stack">
                  <h2 class="h4 p-ops-p">{{ t('cops.structure') }}</h2>
                  <div class="k-row">
                    <QButton v-if="stage.state === 'drawn'" size="sm" @click="act(() => esp04.generate(stage!.id)).then(load)">{{ t('cops.generate') }}</QButton>
                    <QButton v-if="['swiss', 'multi_lobby'].includes(stage.format)" size="sm" variant="secondary" @click="act(() => esp04.nextRound(stage!.id))">{{ t('cops.nextRound') }}</QButton>
                    <QButton v-if="stage.format === 'mixed'" size="sm" variant="secondary" @click="act(() => esp04.nextPhase(stage!.id))">{{ t('cops.nextPhase') }}</QButton>
                  </div>
                  <form class="p-ops-grid" novalidate @submit.prevent="act(() => esp04.withdraw(stage!.id, withdrawal.participationId, withdrawal.reason), t('cops.withdrawn'))">
                    <QSelect id="ops-wd" v-model="withdrawal.participationId" :label="t('cops.withdrawal')" :placeholder="'—'" :options="wdOpts" />
                    <QTextField id="ops-wdr" v-model="withdrawal.reason" :label="t('evm.reason')" />
                    <div><QButton type="submit" size="sm" variant="danger" :disabled="!withdrawal.participationId || withdrawal.reason.length < 5">{{ t('cops.recordWithdrawal') }}</QButton></div>
                  </form>
                  <form v-if="transferOpts.length" class="p-ops-grid" novalidate @submit.prevent="act(async () => { const r = await esp04.transfer(stage!.id, transferFrom); notice = t('cops.transferred', { c: fa(r.created), e: fa(r.existing) }); })">
                    <QSelect id="ops-tf" v-model="transferFrom" :label="t('cops.transferFrom')" :placeholder="'—'" :options="transferOpts" />
                    <div><QButton type="submit" size="sm" variant="secondary" :disabled="!transferFrom">{{ t('cops.transfer') }}</QButton></div>
                  </form>
                </div>
              </QCard>
            </template>
          </div>

          <!-- schedule -->
          <div v-else-if="item.key === 'schedule'" class="k-stack">
            <QCard>
              <form class="k-stack" novalidate @submit.prevent="saveConfig">
                <div class="p-ops-grid">
                  <QDateField id="sc-from" v-model="cfg.from" :label="t('cops.windowFrom')" with-time />
                  <QDateField id="sc-to" v-model="cfg.to" :label="t('cops.windowTo')" with-time />
                  <QTextField id="sc-dur" v-model="cfg.duration" :label="t('cops.duration')" type="number" ltr />
                  <QTextField id="sc-buf" v-model="cfg.buffer" :label="t('cops.buffer')" type="number" ltr />
                  <QTextField id="sc-rest" v-model="cfg.rest" :label="t('cops.rest')" type="number" ltr />
                </div>
                <div class="k-row">
                  <QButton type="submit" size="sm" variant="secondary">{{ t('cops.saveConfig') }}</QButton>
                  <QButton size="sm" icon="calendar" @click="auto">{{ t('cops.auto') }}</QButton>
                  <QButton size="sm" variant="ghost" icon="refresh" @click="loadSchedule">{{ t('cops.loadSchedule') }}</QButton>
                </div>
              </form>
            </QCard>
            <QCard v-for="p in proposals.filter((x) => x.state === 'draft')" :key="p._id" class="p-ops-proposal">
              <div class="k-stack">
                <h3 class="p-ops-h3">{{ t(`cops.pk.${p.kind}` as never) }} — <bdi>{{ p.reason }}</bdi></h3>
                <ul class="p-ops-list"><li v-for="c in p.changes" :key="c.matchId"><bdi>{{ matchLabel(c.matchId) }}</bdi>: {{ formatJalali(c.from) }} ← {{ formatJalali(c.to) }}</li></ul>
                <ul v-if="p.conflicts.length" class="p-ops-list"><li v-for="(c, i) in p.conflicts" :key="i" :class="c.hard ? 'p-ops-bad' : 'p-ops-warn'">{{ c.hard ? t('cops.hard') : t('cops.soft') }} — {{ t(`cops.ck.${c.kind}` as never) }}: <bdi>{{ c.detail }}</bdi></li></ul>
                <div class="k-row">
                  <QButton size="sm" variant="green" @click="act(() => esp04.applyProposal(p._id, { confirm: true })).then(loadSchedule)">{{ t('cops.apply') }}</QButton>
                  <QButton size="sm" variant="ghost" @click="act(() => esp04.rejectProposal(p._id)).then(loadSchedule)">{{ t('evm.reject') }}</QButton>
                </div>
              </div>
            </QCard>
            <QAlert v-if="conflicts.length" tone="danger">
              <ul class="p-ops-list"><li v-for="(c, i) in conflicts" :key="i">{{ c.hard ? t('cops.hard') : t('cops.soft') }} — {{ t(`cops.ck.${c.kind}` as never) }}: <bdi>{{ c.detail }}</bdi></li></ul>
            </QAlert>
            <QDataTable v-if="matches.length" :caption="t('cops.matches')" caption-hidden row-key="id" row-header="sides" :columns="matchCols" :rows="matches">
              <template #cell-slot="{ row }"><code class="q-mono q-ltr">{{ row.slot?.key }}</code></template>
              <template #cell-sides="{ row }"><RouterLink :to="`/matches/${row.id}`"><bdi>{{ row.sides.map((s) => s.displayName).join(' — ') || t('br.tbd') }}</bdi></RouterLink></template>
              <template #cell-scheduledAt="{ row }">{{ row.scheduledAt ? formatJalali(row.scheduledAt) : '—' }}<span v-if="row.estimated && row.scheduledAt" class="p-ops-muted"> ~</span></template>
              <template #cell-newTime="{ row }">
                <div class="k-stack p-ops-time">
                  <QDateField :id="`tm-${row.id}`" v-model="times[row.id]!.at" :label="t('cops.newTime')" with-time :hint="null" />
                  <QTextField :id="`tr-${row.id}`" v-model="times[row.id]!.reason" :label="t('evm.reason')" hide-label :placeholder="t('evm.reason')" />
                  <QCheckbox :model-value="times[row.id]!.override" :label="t('cops.override')" @update:model-value="(v) => flag(row.id, 'override', v)" />
                  <QCheckbox :model-value="times[row.id]!.broadcast" :label="t('cops.broadcast')" @update:model-value="(v) => flag(row.id, 'broadcast', v)" />
                </div>
              </template>
              <template #row-actions="{ row }">
                <QButton size="sm" variant="secondary" :disabled="!times[row.id]!.at" @click="setTime(row)">{{ t('cops.setTime') }}</QButton>
                <QButton size="sm" variant="ghost" icon="clock" @click="delay.matchId = row.id">{{ t('cops.delay') }}</QButton>
              </template>
            </QDataTable>
            <QCard v-if="delay.matchId">
              <form class="p-ops-grid" novalidate @submit.prevent="act(() => esp04.delay(delay.matchId, Number(delay.minutes), delay.reason)).then(loadSchedule)">
                <p class="p-ops-p"><bdi>{{ matchLabel(delay.matchId) }}</bdi></p>
                <QTextField id="dl-m" v-model="delay.minutes" :label="t('cops.delayMinutes')" type="number" ltr />
                <QTextField id="dl-r" v-model="delay.reason" :label="t('evm.reason')" />
                <div><QButton type="submit" size="sm" variant="secondary" :disabled="delay.reason.length < 2">{{ t('cops.proposeDelay') }}</QButton></div>
              </form>
            </QCard>
            <template v-if="requests.length">
              <h3 class="p-ops-h3">{{ t('cops.requests') }}</h3>
              <QCard padding="none">
                <ul class="p-ops-rows">
                  <li v-for="r in requests" :key="String(r._id)">
                    <span><bdi>{{ matchLabel(String(r.matchId)) }}</bdi> ← {{ formatJalali(String(r.proposedAt)) }} — <bdi>{{ r.reason }}</bdi> <QStatusBadge :state="String(r.state)" /></span>
                    <span v-if="r.state === 'agreed'" class="k-row">
                      <QButton size="sm" variant="green" @click="act(() => esp04.decideReschedule(String(r._id), true, 'approved')).then(loadSchedule)">{{ t('evm.approve') }}</QButton>
                      <QButton size="sm" variant="ghost" @click="act(() => esp04.decideReschedule(String(r._id), false, 'rejected')).then(loadSchedule)">{{ t('evm.reject') }}</QButton>
                    </span>
                  </li>
                </ul>
              </QCard>
            </template>
          </div>

          <!-- control: incidents, review, calls, servers -->
          <div v-else class="k-stack">
            <div><QButton size="sm" variant="ghost" icon="refresh" @click="loadOps">{{ t('cops.refresh') }}</QButton></div>
            <QCard>
              <form class="p-ops-grid" novalidate @submit.prevent="act(() => esp04.openIncident(eventId, { kind: incident.kind, publicNotice: incident.notice, delayMinutes: Number(incident.delay), newGameVersion: incident.newVersion || null })).then(loadOps)">
                <QSelect id="in-k" v-model="incident.kind" :label="t('cops.incidentKind')" :options="INCIDENTS" />
                <QTextField id="in-n" v-model="incident.notice" :label="t('cops.publicNotice')" />
                <QTextField id="in-d" v-model="incident.delay" :label="t('cops.delayMinutes')" type="number" ltr />
                <QTextField v-if="incident.kind === 'game_update'" id="in-v" v-model="incident.newVersion" :label="t('cops.newVersion')" ltr />
                <div><QButton type="submit" size="sm" variant="danger" icon="alert" :disabled="incident.notice.length < 5">{{ t('cops.openIncident') }}</QButton></div>
              </form>
            </QCard>
            <QCard v-if="incidents.length" padding="none">
              <ul class="p-ops-rows">
                <li v-for="i in incidents" :key="iid(i)">
                  <span><bdi>{{ i.publicNotice }}</bdi> <QStatusBadge :state="String(i.state)" /></span>
                  <span v-if="i.state === 'active'" class="p-ops-bar">
                    <QTextField :id="`ic-${iid(i)}`" v-model="resolution[iid(i)]" :label="t('cops.compatNote')" hide-label :placeholder="t('cops.compatNote')" />
                    <QButton size="sm" variant="green" @click="act(() => esp04.resolveIncident(iid(i), true, resolution[iid(i)] ?? '')).then(loadOps)">{{ t('cops.resolveResume') }}</QButton>
                  </span>
                </li>
              </ul>
            </QCard>
            <h3 class="p-ops-h3">{{ t('cops.review') }} ({{ fa(reviews.filter((r) => r.state === 'open').length) }})</h3>
            <QCard padding="none">
              <ul class="p-ops-rows">
                <li v-for="r in reviews" :key="r._id">
                  <span><strong>{{ t(`cops.rk.${r.kind}` as never) }}</strong> — <bdi>{{ (r.detail.message ?? r.detail.conflict ?? '') as string }}</bdi> <QStatusBadge :state="r.state" /></span>
                  <span v-if="r.state === 'open'" class="p-ops-bar">
                    <QTextField :id="`rr-${r._id}`" v-model="resolution[r._id]" :label="t('cops.resolution')" hide-label :placeholder="t('cops.resolution')" />
                    <QButton size="sm" variant="secondary" :disabled="(resolution[r._id] ?? '').length < 5" @click="act(() => esp04.resolveReview(r._id, resolution[r._id]!)).then(loadOps)">{{ t('cops.resolve') }}</QButton>
                  </span>
                </li>
                <li v-if="!reviews.length" class="p-ops-muted">—</li>
              </ul>
            </QCard>
            <h3 class="p-ops-h3">{{ t('cops.calls') }}</h3>
            <QCard padding="none">
              <ul class="p-ops-rows">
                <li v-for="c in calls" :key="c._id"><span><RouterLink :to="`/matches/${c.matchId}`" class="q-ltr">{{ c.matchId }}</RouterLink> — <bdi>{{ c.reason }}</bdi></span><QStatusBadge :state="c.state" /></li>
                <li v-if="!calls.length" class="p-ops-muted">—</li>
              </ul>
            </QCard>
            <h3 class="p-ops-h3">{{ t('cops.servers') }}</h3>
            <QCard padding="none">
              <ul class="p-ops-rows">
                <li v-for="s in servers" :key="s._id">
                  <span><bdi>{{ s.name }}</bdi> · <span class="q-ltr">{{ s.region }}</span> · {{ fa(s.inUse) }}/{{ fa(s.capacity) }} <QStatusBadge :state="s.health" /></span>
                  <span class="k-row">
                    <QButton size="sm" variant="secondary" @click="act(() => esp04.serverHealth(s._id, 'healthy', true)).then(loadOps)">{{ t('cops.markHealthy') }}</QButton>
                    <QButton size="sm" variant="danger" @click="act(() => esp04.serverHealth(s._id, 'down', false)).then(loadOps)">{{ t('cops.markDown') }}</QButton>
                  </span>
                </li>
                <li v-if="!servers.length" class="p-ops-muted">—</li>
              </ul>
            </QCard>
            <QCard>
              <div class="k-stack">
                <form class="p-ops-grid" novalidate @submit.prevent="act(() => esp04.createServer(eventId, { gameId: srv.gameId, name: srv.name, region: srv.region, kind: 'dedicated', connection: { host: srv.host, port: Number(srv.port) || null }, capacity: Number(srv.capacity) })).then(loadOps)">
                  <QTextField id="sv-n" v-model="srv.name" :label="t('events.name')" ltr />
                  <QTextField id="sv-r" v-model="srv.region" :label="t('cops.region')" ltr />
                  <QTextField id="sv-h" v-model="srv.host" :label="t('match.lobbyHost')" ltr />
                  <QTextField id="sv-p" v-model="srv.port" :label="t('cops.port')" type="number" ltr />
                  <QTextField id="sv-c" v-model="srv.capacity" :label="t('reg.capacity')" type="number" ltr />
                  <div><QButton type="submit" size="sm" variant="green" icon="plus" :disabled="!srv.name || !srv.host">{{ t('cops.addServer') }}</QButton></div>
                </form>
                <form class="p-ops-grid" novalidate @submit.prevent="act(() => esp04.allocate(srv.matchId, null, 'auto allocation'))">
                  <QSelect id="sv-m" v-model="srv.matchId" :label="t('cops.allocateFor')" :placeholder="'—'" :options="allocOpts" />
                  <div><QButton type="submit" size="sm" variant="secondary" :disabled="!srv.matchId">{{ t('cops.allocate') }}</QButton></div>
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
.p-ops-p { margin: 0; }
.p-ops-h3 { margin: 0; font-size: 15px; font-weight: 800; }
.p-ops-bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: end; }
.p-ops-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr)); gap: var(--space-3); align-items: end; }
.p-ops-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--space-3); }
.p-ops-list { margin: 0; padding-inline-start: var(--space-5); display: grid; gap: var(--space-1); }
.p-ops-rows { margin: 0; padding: 0; list-style: none; }
.p-ops-rows > li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-block-end: 1px solid var(--line); }
.p-ops-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-ops-warn { color: var(--warning-text); }
.p-ops-bad { color: var(--danger-text); font-weight: 700; }
.p-ops-xs { max-inline-size: 6rem; }
.p-ops-sm { max-inline-size: 10rem; }
.p-ops-time { gap: var(--space-2); min-inline-size: 14rem; }
.p-ops-proposal { border-inline-start: 4px solid var(--green-500); }
.p-ops-more > summary { cursor: pointer; font-weight: 800; }
.p-ops-more[open] > summary { margin-block-end: var(--space-3); }
</style>
