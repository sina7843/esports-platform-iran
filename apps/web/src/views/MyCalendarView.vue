<script setup lang="ts">
import { reactive, ref } from 'vue';
import { zonedWallTimeToUtc } from '@esp/contracts';
import type { ApiClientError } from '../api/client';
import { esp04 as esp04Api } from '../api/esp04';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useLoad } from '../useLoad';

/** SCH-004/005: my matches with confirmed vs estimated times, calendar export, and reschedule requests/agreements. */
/** template alias (vue-tsc mis-types direct use of this import inside template arrow functions) */
const esp04: typeof esp04Api = esp04Api;
const { data, loading, error, load } = useLoad(async () => ({ cal: (await esp04.calendar()).items, reqs: (await esp04.myRescheduleRequests()).items }));
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const req = reactive<Record<string, { at: string; reason: string }>>({});
async function act(fn: () => Promise<unknown>) {
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = '✓';
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const form = (id: string) => (req[id] ??= { at: '', reason: '' });
</script>

<template>
  <PageHeader :title="t('cal.title')" :lead="t('cal.lead')">
    <template #actions><a class="btn btn-sm" :href="esp04.calendarIcsUrl()" download>{{ t('cal.ics') }}</a></template>
  </PageHeader>
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>
  <DataState :loading="loading" :error="error" :empty="!!data && !data.cal.length" @retry="load">
    <ul v-if="data" class="cards">
      <li v-for="m in data.cal" :key="m.matchId" class="card stack">
        <div class="row between">
          <RouterLink :to="`/matches/${m.matchId}`"><bdi>{{ m.sides.join(' — ') }}</bdi></RouterLink>
          <StatusBadge :state="m.state" />
        </div>
        <p><JalaliDate :iso="m.scheduledAt" /> <span :class="m.estimated ? 'warn' : 'ok'">{{ m.estimated ? t('cal.estimated') : t('cal.confirmed') }}</span></p>
        <details v-if="['scheduled', 'awaiting_sides', 'awaiting_readiness'].includes(m.state)">
          <summary>{{ t('cal.requestChange') }}</summary>
          <form class="row" novalidate @submit.prevent="act(() => esp04.reschedule(m.matchId, zonedWallTimeToUtc(form(m.matchId).at), form(m.matchId).reason))">
            <label class="sr-only" :for="`rq-at-${m.matchId}`">{{ t('cal.newTime') }}</label>
            <input :id="`rq-at-${m.matchId}`" v-model="form(m.matchId).at" type="datetime-local" class="input" />
            <label class="sr-only" :for="`rq-r-${m.matchId}`">{{ t('evm.reason') }}</label>
            <input :id="`rq-r-${m.matchId}`" v-model="form(m.matchId).reason" class="input" dir="auto" :placeholder="t('evm.reason')" />
            <button type="submit" class="btn btn-sm" :disabled="!form(m.matchId).at || form(m.matchId).reason.length < 5">{{ t('cal.send') }}</button>
          </form>
        </details>
      </li>
    </ul>
    <section v-if="data && data.reqs.length" class="card stack block">
      <h2>{{ t('cal.requests') }}</h2>
      <ul class="list"><li v-for="r in data.reqs" :key="String(r._id)"><JalaliDate :iso="String(r.proposedAt)" /> — <span dir="auto">{{ r.reason }}</span> <StatusBadge :state="String(r.state)" />
        <button v-if="r.state === 'open'" type="button" class="btn btn-sm" @click="act(() => esp04.agreeReschedule(String(r._id)))">{{ t('cal.agree') }}</button></li></ul>
      <p class="muted small">{{ t('cal.agreeHint') }}</p>
    </section>
  </DataState>
</template>

<style scoped>
.cards { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--sp-3); }
.between { justify-content: space-between; flex-wrap: wrap; gap: var(--sp-2); }
.row { flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.block { margin-block-start: var(--sp-4); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.ok { color: var(--ok); }
.warn { color: var(--warn); }
.small { font-size: var(--fs-xs); }
h2, p { margin: 0; }
</style>
