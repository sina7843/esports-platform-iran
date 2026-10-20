<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp03 } from '../api/esp03';
import { esp04 as esp04Api } from '../api/esp04';
import { esp05 as esp05Api, type Impact } from '../api/esp05';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import MoneyLabel from '../components/MoneyLabel.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useLoad } from '../useLoad';

/**
 * Organizer / head referee results desk: officials (REF-001), correction impact tool (RES-006..008), sanctions
 * (REF-004), special awards (END-005) and the finish/close/archive gates (END-001..007).
 */
const esp04: typeof esp04Api = esp04Api;
const esp05: typeof esp05Api = esp05Api;
const route = useRoute();
const eventId = computed(() => String(route.params['id']));
const { data, loading, error, load } = useLoad(async () => {
  const [ev, officials, matches, corrections, blockers] = await Promise.all([
    esp03.manage(eventId.value),
    esp05.officials(eventId.value).catch(() => ({ items: [] })),
    esp04.schedule(eventId.value, { limit: 200 }),
    esp05.corrections(eventId.value).catch(() => ({ items: [] })),
    esp05.blockers(eventId.value),
  ]);
  cls.version = ev.event.version;
  return { ev, officials: officials.items, matches: matches.items, corrections: corrections.items, blockers };
});
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
async function act(fn: () => Promise<unknown>, ok = t('case.saved')) {
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = ok;
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const ofc = reactive({ principalId: '', role: 'referee', matchId: '', override: '' });
const cor = reactive({ matchId: '', winnerSide: 1 as 0 | 1, reason: '', approvalId: '', impact: null as Impact | null });
const snc = reactive({ subjectKind: 'participation', subjectRef: '', displayName: '', type: 'warning', points: 1, stageId: '', until: '', clauseKey: '', reason: '' });
const cls = reactive({ version: 0, approvalId: '' });
const report = ref<Record<string, unknown> | null>(null);
const finals = computed(() => (data.value?.matches ?? []).filter((m) => m.state === 'final'));
const outcome = () => ({ kind: 'win' as const, winnerSide: cor.winnerSide, scores: null, maps: null });
async function preview() {
  failure.value = null;
  try {
    cor.impact = await esp05.preview(cor.matchId, outcome());
  } catch (e) {
    failure.value = toClientError(e);
  }
}
async function requestApproval(action: 'match.result.correct' | 'event.close') {
  failure.value = null;
  try {
    const a = await esp05.requestApproval(action, action === 'event.close' ? { type: 'event', id: eventId.value } : { type: 'match', id: cor.matchId }, action === 'event.close' ? 'close the event' : cor.reason || 'result correction');
    if (action === 'event.close') cls.approvalId = a.id;
    else cor.approvalId = a.id;
    notice.value = t('res.approvalRequested', { id: a.id });
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const sanctionBody = () => ({
  subject: { kind: snc.subjectKind, ref: snc.subjectRef.trim(), displayName: snc.displayName.trim() || snc.subjectRef.trim() },
  scope: { kind: 'event', id: eventId.value }, type: snc.type, points: snc.type === 'point_penalty' ? snc.points : null, stageId: snc.type === 'point_penalty' ? snc.stageId.trim() : null,
  until: snc.type === 'suspension_temporary' && snc.until ? new Date(snc.until).toISOString() : null, reason: snc.reason, clauseKey: snc.clauseKey.trim(), caseId: null,
});
</script>

<template>
  <PageHeader :title="t('res.title')" :lead="t('res.lead')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>
  <DataState :loading="loading" :error="error" @retry="load">
    <template v-if="data">
      <!-- officials -->
      <section class="card stack" aria-labelledby="ofc-h">
        <h2 id="ofc-h">{{ t('res.officials') }}</h2>
        <ul class="list"><li v-for="o in data.officials" :key="o._id"><bdi class="ltr">{{ o.principalId }}</bdi> — {{ t(`res.role.${o.role}` as never) }}<span v-if="o.matchId"> ({{ t('case.match') }} <bdi class="ltr">{{ o.matchId }}</bdi>)</span>
          <button type="button" class="btn btn-sm" @click="act(() => esp05.unassignOfficial(o._id))">{{ t('res.remove') }}</button></li></ul>
        <form class="row" novalidate @submit.prevent="act(() => esp05.assignOfficial(eventId, { principalId: ofc.principalId.trim(), role: ofc.role, matchId: ofc.matchId || null, overrideReason: ofc.override || null }))">
          <label class="sr-only" for="ofc-p">{{ t('res.principal') }}</label>
          <input id="ofc-p" v-model="ofc.principalId" class="input ltr" :placeholder="t('res.principal')" />
          <label class="sr-only" for="ofc-r">{{ t('res.roleLabel') }}</label>
          <select id="ofc-r" v-model="ofc.role" class="input"><option v-for="r in ['referee', 'head_referee', 'appeal_authority']" :key="r" :value="r">{{ t(`res.role.${r}` as never) }}</option></select>
          <label class="sr-only" for="ofc-m">{{ t('case.match') }}</label>
          <select id="ofc-m" v-model="ofc.matchId" class="input"><option value="">{{ t('res.wholeEvent') }}</option><option v-for="m in data.matches" :key="m.id" :value="m.id">{{ m.slot?.key ?? m.id }} — {{ m.sides.map((s) => s.displayName).join(' / ') }}</option></select>
          <label class="sr-only" for="ofc-o">{{ t('res.override') }}</label>
          <input id="ofc-o" v-model="ofc.override" class="input" dir="auto" :placeholder="t('res.override')" />
          <button type="submit" class="btn btn-sm" :disabled="!ofc.principalId.trim()">{{ t('res.appoint') }}</button>
        </form>
        <p class="muted small">{{ t('res.officialsHint') }}</p>
      </section>

      <!-- correction impact tool -->
      <section class="card stack block" aria-labelledby="cor-h">
        <h2 id="cor-h">{{ t('res.correction') }}</h2>
        <div class="row">
          <label for="cor-m">{{ t('case.match') }}</label>
          <select id="cor-m" v-model="cor.matchId" class="input" @change="cor.impact = null"><option value="" disabled>—</option><option v-for="m in finals" :key="m.id" :value="m.id">{{ m.slot?.key ?? m.id }} — {{ m.sides.map((s) => s.displayName).join(' / ') }}</option></select>
          <label for="cor-w">{{ t('case.winnerSide') }}</label>
          <select id="cor-w" v-model.number="cor.winnerSide" class="input" @change="cor.impact = null"><option :value="0">{{ t('case.side', { n: 1 }) }}</option><option :value="1">{{ t('case.side', { n: 2 }) }}</option></select>
          <button type="button" class="btn btn-sm" :disabled="!cor.matchId" @click="preview">{{ t('res.preview') }}</button>
        </div>
        <div v-if="cor.impact" class="stack impact">
          <p v-if="cor.impact.startedDependents.length" class="danger" role="alert">{{ t('res.blocked', { n: cor.impact.startedDependents.length }) }}</p>
          <dl class="facts">
            <div><dt>{{ t('res.slots') }}</dt><dd>{{ cor.impact.slots.length }}</dd></div>
            <div><dt>{{ t('res.reset') }}</dt><dd>{{ cor.impact.resetMatches.length }}</dd></div>
            <div><dt>{{ t('res.standings') }}</dt><dd>{{ cor.impact.standings.length }}</dd></div>
            <div><dt>{{ t('res.ratings') }}</dt><dd>{{ cor.impact.ratingEvents }}</dd></div>
            <div><dt>{{ t('res.honors') }}</dt><dd>{{ cor.impact.honors.length }}</dd></div>
            <div><dt>{{ t('res.prizes') }}</dt><dd>{{ cor.impact.prizes.length }}</dd></div>
            <div><dt>{{ t('res.quotas') }}</dt><dd>{{ cor.impact.quotas.length }}</dd></div>
          </dl>
          <ul v-if="cor.impact.standings.length" class="list"><li v-for="s in cor.impact.standings" :key="s.id"><bdi class="ltr">{{ s.id }}</bdi>: {{ s.rankBefore ?? '—' }} → {{ s.rankAfter ?? '—' }}</li></ul>
          <ul v-if="cor.impact.prizes.length" class="list"><li v-for="p in cor.impact.prizes" :key="p.id">{{ p.title }} — <MoneyLabel :rial="p.amountRial" /> <StatusBadge :state="p.state" /></li></ul>
          <FormField id="cor-r" :label="t('evm.reason')"><template #default="{ id: fid }"><input :id="fid" v-model="cor.reason" class="input" dir="auto" /></template></FormField>
          <div class="row">
            <button type="button" class="btn btn-sm" :disabled="cor.reason.length < 5" @click="requestApproval('match.result.correct')">{{ t('res.requestApproval') }}</button>
            <label class="sr-only" for="cor-a">{{ t('res.approvalId') }}</label>
            <input id="cor-a" v-model="cor.approvalId" class="input ltr" :placeholder="t('res.approvalId')" />
            <button type="button" class="btn btn-primary" :disabled="!cor.approvalId || cor.reason.length < 5" @click="act(() => esp05.correct(cor.matchId, { outcome: outcome(), reason: cor.reason, approvalId: cor.approvalId, caseId: null }))">{{ t('res.apply') }}</button>
            <button type="button" class="btn" :disabled="!cor.approvalId || cor.reason.length < 5" @click="act(() => esp05.reopen(cor.matchId, cor.reason, cor.approvalId))">{{ t('res.reopen') }}</button>
          </div>
          <p class="muted small">{{ t('res.correctionHint') }}</p>
        </div>
        <ul v-if="data.corrections.length" class="list">
          <li v-for="c in data.corrections" :key="c._id"><bdi class="ltr">{{ c._id }}</bdi> — <StatusBadge :state="c.state" /> <span class="muted small">{{ c.steps.join(' → ') }}</span>
            <span v-if="c.error" class="danger small" dir="auto"> {{ c.error }}</span>
            <RouterLink v-if="c.caseId" :to="`/cases/${c.caseId}`"> {{ t('res.case') }}</RouterLink>
            <button v-if="c.state === 'failed'" type="button" class="btn btn-sm" @click="act(() => esp05.resume(c._id))">{{ t('res.resume') }}</button></li>
        </ul>
      </section>

      <!-- sanctions -->
      <section class="card stack block" aria-labelledby="snc-h">
        <h2 id="snc-h">{{ t('res.sanctions') }}</h2>
        <form class="grid" novalidate @submit.prevent="act(() => esp05.issueSanction(sanctionBody()))">
          <FormField id="snc-k" :label="t('res.subjectKind')"><template #default="{ id: fid }"><select :id="fid" v-model="snc.subjectKind" class="input"><option value="participation">{{ t('res.participation') }}</option><option value="principal">{{ t('res.person') }}</option><option value="team">{{ t('res.team') }}</option></select></template></FormField>
          <FormField id="snc-r" :label="t('res.subjectRef')"><template #default="{ id: fid }"><input :id="fid" v-model="snc.subjectRef" class="input ltr" /></template></FormField>
          <FormField id="snc-n" :label="t('res.displayName')"><template #default="{ id: fid }"><input :id="fid" v-model="snc.displayName" class="input" dir="auto" /></template></FormField>
          <FormField id="snc-t" :label="t('res.sanctionType')"><template #default="{ id: fid }"><select :id="fid" v-model="snc.type" class="input"><option v-for="x in ['warning', 'point_penalty', 'disqualification', 'suspension_temporary', 'suspension_permanent']" :key="x" :value="x">{{ t(`snc.type.${x}` as never) }}</option></select></template></FormField>
          <FormField v-if="snc.type === 'point_penalty'" id="snc-p" :label="t('res.points')"><template #default="{ id: fid }"><input :id="fid" v-model.number="snc.points" type="number" min="1" class="input ltr" /></template></FormField>
          <FormField v-if="snc.type === 'point_penalty'" id="snc-s" :label="t('res.stageId')"><template #default="{ id: fid }"><input :id="fid" v-model="snc.stageId" class="input ltr" /></template></FormField>
          <FormField v-if="snc.type === 'suspension_temporary'" id="snc-u" :label="t('res.until')"><template #default="{ id: fid }"><input :id="fid" v-model="snc.until" type="datetime-local" class="input" /></template></FormField>
          <FormField id="snc-c" :label="t('case.clauseKey')" :hint="t('case.clauseHint')"><template #default="{ id: fid, describedBy }"><input :id="fid" v-model="snc.clauseKey" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
          <FormField id="snc-re" :label="t('evm.reason')"><template #default="{ id: fid }"><input :id="fid" v-model="snc.reason" class="input" dir="auto" /></template></FormField>
          <button type="submit" class="btn" :disabled="!snc.subjectRef || !snc.clauseKey || snc.reason.length < 5">{{ t('res.issue') }}</button>
        </form>
        <p class="muted small">{{ t('res.sanctionHint') }}</p>
      </section>

      <!-- finish / close / archive -->
      <section class="card stack block" aria-labelledby="cl-h">
        <h2 id="cl-h">{{ t('res.close') }}</h2>
        <ul class="list">
          <li v-if="data.blockers.unfinishedStages.length">{{ t('res.unfinishedStages', { n: data.blockers.unfinishedStages.length }) }}</li>
          <li v-if="data.blockers.openMatches.length">{{ t('res.openMatches', { n: data.blockers.openMatches.length }) }}</li>
          <li v-for="c in data.blockers.openCases" :key="c.id"><RouterLink :to="`/cases/${c.id}`">{{ t('res.openCase') }} — {{ t(`case.cat.${c.category}` as never) }}</RouterLink></li>
          <li v-for="c in data.blockers.corrections" :key="c.id">{{ t('res.openCorrection') }} <bdi class="ltr">{{ c.id }}</bdi> <StatusBadge :state="c.state" /></li>
          <li>{{ t('res.obligations') }}: <MoneyLabel :rial="data.blockers.openObligationsRial" /></li>
        </ul>
        <div class="row">
          <label for="cl-v">{{ t('res.version') }}</label>
          <input id="cl-v" v-model.number="cls.version" type="number" min="0" class="input ltr narrow" />
          <button type="button" class="btn" :disabled="!data.blockers.canFinish" @click="act(() => esp05.finish(eventId, cls.version))">{{ t('res.finish') }}</button>
          <button type="button" class="btn btn-sm" @click="requestApproval('event.close')">{{ t('res.requestCloseApproval') }}</button>
          <label class="sr-only" for="cl-a">{{ t('res.approvalId') }}</label>
          <input id="cl-a" v-model="cls.approvalId" class="input ltr" :placeholder="t('res.approvalId')" />
          <button type="button" class="btn btn-primary" :disabled="!data.blockers.canClose" @click="act(() => esp05.close(eventId, cls.version, cls.approvalId || null), t('res.closed'))">{{ t('res.closeEvent') }}</button>
          <button type="button" class="btn" @click="act(() => esp05.archive(eventId, cls.version))">{{ t('res.archive') }}</button>
          <button type="button" class="btn btn-sm" @click="act(async () => { report = await esp05.eventReport(eventId); }, '')">{{ t('res.report') }}</button>
        </div>
        <p class="muted small">{{ t('res.closeHint') }}</p>
        <pre v-if="report" class="report ltr">{{ JSON.stringify(report, null, 2) }}</pre>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.row { flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: var(--sp-3); align-items: end; }
.block { margin-block-start: var(--sp-4); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: var(--sp-2); margin: 0; }
.facts dt { color: var(--muted); font-size: var(--fs-sm); }
.facts dd { margin: 0; font-weight: 600; }
.impact { border: 1px dashed var(--border); padding: var(--sp-3); border-radius: var(--radius, 6px); }
.narrow { inline-size: 6rem; }
.report { max-block-size: 20rem; overflow: auto; background: var(--surface-2); padding: var(--sp-3); font-size: var(--fs-xs); }
.ok { color: var(--ok); }
.danger { color: var(--danger); }
.small { font-size: var(--fs-xs); }
h2, p { margin: 0; }
</style>
