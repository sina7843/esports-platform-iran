<script setup lang="ts">
import { ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp05 as esp05Api, type CaseView } from '../api/esp05';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useLoad } from '../useLoad';

/** REF-001..006 referee desk: my assigned/party cases, an event's case queue and the integrity report queue. */
const esp05: typeof esp05Api = esp05Api;
const { data: mine, loading, error, load } = useLoad(async () => (await esp05.myCases()).items);
const eventId = ref('');
const queue = ref<CaseView[] | null>(null);
const reports = ref<Array<Record<string, unknown>> | null>(null);
const failure = ref<ApiClientError | null>(null);
const note = ref<Record<string, string>>({});
async function loadEvent() {
  failure.value = null;
  try {
    queue.value = (await esp05.eventCases(eventId.value.trim())).items;
    reports.value = (await esp05.integrityQueue(eventId.value.trim()).catch(() => ({ items: [] }))).items;
  } catch (e) {
    failure.value = toClientError(e);
    queue.value = null;
  }
}
async function step(id: string, action: string) {
  failure.value = null;
  try {
    await esp05.integrityStep(id, { action, note: note.value[id] ?? action });
    await loadEvent();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
</script>

<template>
  <PageHeader :title="t('nav.referee')" :lead="t('ref.lead')" />
  <ErrorNote :error="failure" />
  <section class="card stack" aria-labelledby="mine-h">
    <h2 id="mine-h">{{ t('ref.myCases') }}</h2>
    <DataState :loading="loading" :error="error" :empty="!!mine && !mine.length" @retry="load">
      <ul v-if="mine" class="cards">
        <li v-for="c in mine" :key="c._id" class="row between item">
          <RouterLink :to="`/cases/${c._id}`">{{ t(`case.cat.${c.category}` as never) }} — <span dir="auto">{{ c.claim.slice(0, 80) }}</span></RouterLink>
          <span class="row"><span class="muted small">{{ c.role === 'official' ? t('case.roleOfficial') : t('case.roleParty') }}</span><StatusBadge :state="c.state" /></span>
        </li>
      </ul>
    </DataState>
  </section>

  <section class="card stack block" aria-labelledby="q-h">
    <h2 id="q-h">{{ t('ref.eventQueue') }}</h2>
    <form class="row" novalidate @submit.prevent="loadEvent">
      <label for="ref-ev">{{ t('ref.eventId') }}</label>
      <input id="ref-ev" v-model="eventId" class="input ltr" />
      <button type="submit" class="btn btn-sm" :disabled="!eventId.trim()">{{ t('ref.load') }}</button>
    </form>
    <p v-if="queue && !queue.length" class="muted">{{ t('ref.noCases') }}</p>
    <table v-if="queue && queue.length" class="table">
      <caption class="sr-only">{{ t('ref.eventQueue') }}</caption>
      <thead><tr><th scope="col">{{ t('case.category') }}</th><th scope="col">{{ t('case.assignee') }}</th><th scope="col">{{ t('case.state') }}</th><th scope="col">{{ t('case.filed') }}</th></tr></thead>
      <tbody>
        <tr v-for="c in queue" :key="c._id">
          <th scope="row"><RouterLink :to="`/cases/${c._id}`">{{ t(`case.cat.${c.category}` as never) }}</RouterLink></th>
          <td><bdi class="ltr">{{ c.assignee ?? '—' }}</bdi></td>
          <td><StatusBadge :state="c.state" /></td>
          <td><JalaliDate :iso="(c as unknown as { createdAt: string }).createdAt" /></td>
        </tr>
      </tbody>
    </table>
    <template v-if="reports && reports.length">
      <h3>{{ t('ref.integrity') }}</h3>
      <ul class="cards">
        <li v-for="r in reports" :key="String(r['_id'])" class="stack item">
          <div class="row between"><strong>{{ t(`intg.cat.${String(r['category'])}` as never) }}</strong><StatusBadge :state="String(r['state'])" /></div>
          <p dir="auto">{{ r['description'] }}</p>
          <div class="row">
            <label class="sr-only" :for="`n-${String(r['_id'])}`">{{ t('ref.note') }}</label>
            <input :id="`n-${String(r['_id'])}`" v-model="note[String(r['_id'])]" class="input grow" dir="auto" :placeholder="t('ref.note')" />
            <button v-for="a in ['triage', 'investigate', 'close']" :key="a" type="button" class="btn btn-sm" @click="step(String(r['_id']), a)">{{ t(`intg.step.${a}` as never) }}</button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.cards { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--sp-2); }
.item { padding: var(--sp-2); border-block-end: 1px solid var(--border); }
.between { justify-content: space-between; flex-wrap: wrap; gap: var(--sp-2); }
.row { flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.block { margin-block-start: var(--sp-4); }
.grow { flex: 1 1 12rem; }
.small { font-size: var(--fs-xs); }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { text-align: start; padding: var(--sp-2); border-block-end: 1px solid var(--border); }
h2, h3, p { margin: 0; }
</style>
