<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp05 as esp05Api } from '../api/esp05';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import { useLoad } from '../useLoad';

/**
 * RANK-001/002/005/006 rating systems: draft → publish (starts a resumable build) → owner approval by someone other
 * than the author. Also the review queue for declared achievements (AWD-004).
 */
const esp05: typeof esp05Api = esp05Api;
const { data, loading, error, load } = useLoad(async () => ({
  systems: (await esp05.systems({ drafts: true })).items,
  queue: (await esp05.declaredQueue().catch(() => ({ items: [] }))).items,
}));
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
const f = reactive({ gameId: '', mode: '', platform: '', subject: 'player', model: 'glicko2', initialRating: 1500, initialRd: 350, vol: 0.06, tau: 0.5, periodDays: 7, placement: '', kill: 1, source: '', inactivityDays: 180, regionBasis: '', eligibility: '', weight: 1 });
const approveRef = reactive<Record<string, string>>({});
const builds = ref<Record<string, Array<Record<string, unknown>>>>({});
const body = () => ({
  gameId: f.gameId.trim(), mode: f.mode.trim(), platform: f.platform.trim() || null, subject: f.subject, model: f.model,
  params: f.model === 'glicko2' ? { initialRating: f.initialRating, initialRd: f.initialRd, initialVolatility: f.vol, tau: f.tau, periodDays: f.periodDays } : { placementPoints: f.placement.split(/[,،\s]+/).filter(Boolean).map(Number), killPoints: f.kill, source: f.source.trim() },
  seasonId: null, carry: { kind: 'reset', factor: null }, inactivityDays: f.inactivityDays, tiebreak: ['games'], regionBasis: f.regionBasis.trim(), eventWeights: { standard: f.weight }, eligibility: f.eligibility.trim(),
});
async function showBuilds(id: string) {
  try {
    builds.value[id] = (await esp05.builds(id)).items;
  } catch (e) {
    failure.value = toClientError(e);
  }
}
</script>

<template>
  <PageHeader :title="t('rsys.title')" :lead="t('rsys.lead')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>
  <DataState :loading="loading" :error="error" @retry="load">
    <template v-if="data">
      <section class="card stack" aria-labelledby="rs-h">
        <h2 id="rs-h">{{ t('rsys.systems') }}</h2>
        <p v-if="!data.systems.length" class="muted">{{ t('rsys.none') }}</p>
        <ul class="cards">
          <li v-for="s in data.systems" :key="s.id" class="stack item">
            <div class="row between"><strong>{{ s.gameId }} · {{ s.mode }} · {{ t(`rank.subject.${s.subject}` as never) }} · {{ s.model }} (v{{ num(s.version) }})</strong><StatusBadge :state="s.state" /></div>
            <p class="small">{{ s.label.official ? t('rank.official') : t('rank.unapproved') }}<span v-if="s.approval"> — <span dir="auto">{{ s.approval.reference }}</span></span></p>
            <div class="row">
              <button v-if="s.state === 'draft'" type="button" class="btn btn-sm" @click="act(() => esp05.publishSystem(s.id))">{{ t('rsys.publish') }}</button>
              <template v-if="s.state === 'published' && !s.approval">
                <label class="sr-only" :for="`ap-${s.id}`">{{ t('rsys.reference') }}</label>
                <input :id="`ap-${s.id}`" v-model="approveRef[s.id]" class="input" dir="auto" :placeholder="t('rsys.reference')" />
                <button type="button" class="btn btn-sm" :disabled="(approveRef[s.id] ?? '').length < 5" @click="act(() => esp05.approveSystem(s.id, approveRef[s.id] ?? ''))">{{ t('rsys.approve') }}</button>
              </template>
              <button type="button" class="btn btn-sm" @click="showBuilds(s.id)">{{ t('rsys.builds') }}</button>
            </div>
            <ul v-if="builds[s.id]" class="list small"><li v-for="b in builds[s.id]" :key="String(b['_id'])"><bdi class="ltr">{{ b['_id'] }}</bdi> — <StatusBadge :state="String(b['state'])" /> {{ num(Number(b['processed'])) }}<span v-if="b['error']" class="danger" dir="auto"> {{ b['error'] }}</span></li></ul>
          </li>
        </ul>
      </section>

      <section class="card stack block" aria-labelledby="new-h">
        <h2 id="new-h">{{ t('rsys.create') }}</h2>
        <p class="muted small">{{ t('rsys.createHint') }}</p>
        <form class="grid" novalidate @submit.prevent="act(() => esp05.createSystem(body()))">
          <FormField id="rs-g" :label="t('rsys.game')"><template #default="{ id: fid }"><input :id="fid" v-model="f.gameId" class="input ltr" /></template></FormField>
          <FormField id="rs-m" :label="t('rsys.mode')"><template #default="{ id: fid }"><input :id="fid" v-model="f.mode" class="input ltr" /></template></FormField>
          <FormField id="rs-p" :label="t('rsys.platform')"><template #default="{ id: fid }"><input :id="fid" v-model="f.platform" class="input ltr" /></template></FormField>
          <FormField id="rs-s" :label="t('rsys.subject')"><template #default="{ id: fid }"><select :id="fid" v-model="f.subject" class="input"><option value="player">{{ t('rank.subject.player') }}</option><option value="team">{{ t('rank.subject.team') }}</option></select></template></FormField>
          <FormField id="rs-mo" :label="t('rsys.model')"><template #default="{ id: fid }"><select :id="fid" v-model="f.model" class="input"><option value="glicko2">Glicko-2</option><option value="lobby_points">{{ t('rsys.lobbyPoints') }}</option></select></template></FormField>
          <template v-if="f.model === 'glicko2'">
            <FormField id="rs-r" :label="t('rsys.initialRating')"><template #default="{ id: fid }"><input :id="fid" v-model.number="f.initialRating" type="number" class="input ltr" /></template></FormField>
            <FormField id="rs-rd" label="RD"><template #default="{ id: fid }"><input :id="fid" v-model.number="f.initialRd" type="number" class="input ltr" /></template></FormField>
            <FormField id="rs-v" :label="t('rsys.volatility')"><template #default="{ id: fid }"><input :id="fid" v-model.number="f.vol" type="number" step="0.01" class="input ltr" /></template></FormField>
            <FormField id="rs-t" label="τ"><template #default="{ id: fid }"><input :id="fid" v-model.number="f.tau" type="number" step="0.1" class="input ltr" /></template></FormField>
            <FormField id="rs-pd" :label="t('rsys.periodDays')"><template #default="{ id: fid }"><input :id="fid" v-model.number="f.periodDays" type="number" min="1" class="input ltr" /></template></FormField>
          </template>
          <template v-else>
            <FormField id="rs-pp" :label="t('rsys.placementPoints')" :hint="t('rsys.placementHint')"><template #default="{ id: fid, describedBy }"><input :id="fid" v-model="f.placement" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
            <FormField id="rs-k" :label="t('rsys.killPoints')"><template #default="{ id: fid }"><input :id="fid" v-model.number="f.kill" type="number" min="0" class="input ltr" /></template></FormField>
            <FormField id="rs-src" :label="t('rsys.source')"><template #default="{ id: fid }"><input :id="fid" v-model="f.source" class="input" dir="auto" /></template></FormField>
          </template>
          <FormField id="rs-in" :label="t('rsys.inactivity')"><template #default="{ id: fid }"><input :id="fid" v-model.number="f.inactivityDays" type="number" min="1" class="input ltr" /></template></FormField>
          <FormField id="rs-w" :label="t('rsys.weight')"><template #default="{ id: fid }"><input :id="fid" v-model.number="f.weight" type="number" step="0.1" min="0.1" max="3" class="input ltr" /></template></FormField>
          <FormField id="rs-rb" :label="t('rsys.regionBasis')"><template #default="{ id: fid }"><input :id="fid" v-model="f.regionBasis" class="input" dir="auto" /></template></FormField>
          <FormField id="rs-el" :label="t('rank.eligibility')"><template #default="{ id: fid }"><input :id="fid" v-model="f.eligibility" class="input" dir="auto" /></template></FormField>
          <button type="submit" class="btn btn-primary" :disabled="!f.gameId || !f.mode || f.regionBasis.length < 3 || f.eligibility.length < 3">{{ t('rsys.save') }}</button>
        </form>
      </section>

      <section class="card stack block" aria-labelledby="dq-h">
        <h2 id="dq-h">{{ t('rsys.declaredQueue') }}</h2>
        <p v-if="!data.queue.length" class="muted">{{ t('rsys.queueEmpty') }}</p>
        <ul class="list"><li v-for="d in data.queue" :key="d._id"><bdi>{{ d.title }}</bdi> — <bdi>{{ d.eventName }}</bdi> (<bdi class="ltr">{{ d.owner.ref }}</bdi>)
          <button type="button" class="btn btn-sm" @click="act(() => esp05.reviewDeclared(d._id, 'verified', null))">{{ t('rsys.verify') }}</button>
          <button type="button" class="btn btn-sm" @click="act(() => esp05.reviewDeclared(d._id, 'rejected', null))">{{ t('rsys.reject') }}</button></li></ul>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.cards { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--sp-2); }
.item { padding: var(--sp-2); border-block-end: 1px solid var(--border); }
.between { justify-content: space-between; flex-wrap: wrap; gap: var(--sp-2); }
.row { flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: var(--sp-3); align-items: end; }
.block { margin-block-start: var(--sp-4); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.ok { color: var(--ok); }
.danger { color: var(--danger); }
.small { font-size: var(--fs-xs); }
h2, p { margin: 0; }
</style>
