<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api, type BulkJob } from '../api/esp07';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import { useLoad } from '../useLoad';

/**
 * ADM-005 event operations dashboard (registration, check-in, live and delayed matches, cases, resources, alerts)
 * refreshed every 30 s, ADM-006 bulk actions with a preview and a per-item result, and the sponsor export (ADM-011).
 */
const esp07: typeof esp07Api = esp07Api;
const route = useRoute();
const eventId = computed(() => String(route.params['id']));
const { data, loading, error, load } = useLoad(() => esp07.eventOps(eventId.value));
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => void load(), 30_000);
});
onBeforeUnmount(() => clearInterval(timer));

const failure = ref<ApiClientError | null>(null);
const job = ref<BulkJob | null>(null);
const f = reactive({ kind: 'registration.approve', refs: '', minutes: 15, title: '', body: '', reason: '' });
const busy = ref(false);
async function preview() {
  busy.value = true;
  failure.value = null;
  job.value = null;
  try {
    const refs = f.refs.split(/[\s,;]+/).filter(Boolean);
    const params = f.kind === 'match.shift' ? { minutes: f.minutes, reason: f.reason || 'bulk shift' } : f.kind === 'notify' ? { title: f.title, body: f.body } : f.kind === 'registration.reject' ? { reason: f.reason } : {};
    job.value = await esp07.bulkPreview({ kind: f.kind, eventId: eventId.value, refs, params });
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}
async function run() {
  if (!job.value) return;
  busy.value = true;
  failure.value = null;
  try {
    job.value = await esp07.bulkExecute(job.value._id);
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}
const tally = (m: Record<string, number>) => Object.entries(m);
const counts = computed(() => (job.value ? { ok: job.value.items.filter((i) => i.status === 'ok').length, failed: job.value.items.filter((i) => i.status === 'failed').length, skipped: job.value.items.filter((i) => i.status === 'skipped').length, pending: job.value.items.filter((i) => i.status === 'pending').length } : null));
</script>

<template>
  <PageHeader :title="t('a7.ops.title')" :lead="t('a7.ops.lead')" />
  <ErrorNote :error="failure" />
  <div class="row">
    <button type="button" class="btn btn-sm" @click="load">{{ t('a7.refresh') }}</button>
    <RouterLink class="btn btn-sm" :to="{ name: 'admin-tasks', query: { event: eventId } }">{{ t('a7.ops.tasks') }}</RouterLink>
    <a class="btn btn-sm" :href="esp07.sponsorCsvUrl(eventId)" download>{{ t('a7.ops.sponsor') }}</a>
    <span v-if="data" class="small muted">{{ t('a7.updated') }}: <JalaliDate :iso="data.at" format="time" /></span>
  </div>
  <DataState :loading="loading && !data" :error="error" @retry="load">
    <template v-if="data">
      <section v-if="data.alerts.length" class="card stack block" role="alert" aria-labelledby="al-h">
        <h2 id="al-h">{{ t('a7.ops.alerts') }}</h2>
        <ul class="plain"><li v-for="a in data.alerts" :key="a.kind" :class="a.level"><strong>{{ a.level === 'critical' ? t('a7.ops.critical') : t('a7.ops.warn') }}</strong> — {{ a.detail }}</li></ul>
      </section>
      <p v-else class="ok block" role="status">{{ t('a7.ops.noAlerts') }}</p>

      <div class="grid block">
        <section class="card stack" aria-labelledby="rg-h"><h2 id="rg-h">{{ t('a7.ops.registrations') }}</h2><ul class="plain"><li v-for="[k, n] in tally(data.registrations)" :key="k"><StatusBadge :state="k" /> {{ num(n) }}</li><li v-if="!tally(data.registrations).length" class="muted">—</li></ul></section>
        <section class="card stack" aria-labelledby="ck-h"><h2 id="ck-h">{{ t('a7.ops.checkins') }}</h2><ul class="plain"><li v-for="[k, n] in tally(data.checkins)" :key="k"><StatusBadge :state="k" /> {{ num(n) }}</li><li v-if="!tally(data.checkins).length" class="muted">—</li></ul></section>
        <section class="card stack" aria-labelledby="mt-h"><h2 id="mt-h">{{ t('a7.ops.matches') }}</h2><ul class="plain"><li v-for="[k, n] in tally(data.matches)" :key="k"><StatusBadge :state="k" /> {{ num(n) }}</li><li v-if="!tally(data.matches).length" class="muted">—</li></ul></section>
        <section class="card stack" aria-labelledby="cs-h"><h2 id="cs-h">{{ t('a7.ops.cases') }}</h2><p>{{ t('a7.ops.openCases') }}: <strong>{{ num(data.cases) }}</strong></p><p>{{ t('a7.ops.incidents') }}: <strong>{{ num(data.incidents) }}</strong></p><p>{{ t('a7.ops.tickets') }}: <strong>{{ num(data.tickets) }}</strong></p></section>
      </div>

      <section class="card stack block" aria-labelledby="lv-h">
        <h2 id="lv-h">{{ t('a7.ops.live') }}</h2>
        <p v-if="!data.live.length" class="muted">{{ t('a7.ops.noLive') }}</p>
        <ul class="plain"><li v-for="m in data.live" :key="m.id"><StatusBadge :state="m.state" /> <bdi>{{ m.slot ?? m.id }}</bdi> — <bdi>{{ m.sides.join(' / ') }}</bdi></li></ul>
        <h3 v-if="data.delayed.length">{{ t('a7.ops.delayed') }}</h3>
        <ul class="plain"><li v-for="m in data.delayed" :key="m.id" class="warn"><bdi>{{ m.slot ?? m.id }}</bdi> — <JalaliDate :iso="m.scheduledAt" /> · <StatusBadge :state="m.state" /></li></ul>
      </section>

      <section class="card stack block" aria-labelledby="rs-h">
        <h2 id="rs-h">{{ t('a7.ops.resources') }}</h2>
        <ul class="plain"><li v-for="[k, n] in tally(data.resources.stations)" :key="k">{{ t('a7.ops.stations') }}: <StatusBadge :state="k" /> {{ num(n) }}</li></ul>
        <ul class="plain"><li v-for="s in data.resources.servers" :key="s.name"><bdi>{{ s.name }}</bdi> <StatusBadge :state="s.health" /> — {{ t('a7.ops.free') }}: {{ num(s.free) }}</li><li v-if="!data.resources.servers.length" class="muted">{{ t('a7.ops.noServers') }}</li></ul>
      </section>
    </template>
  </DataState>

  <section class="card stack block" aria-labelledby="bk-h">
    <h2 id="bk-h">{{ t('a7.bulk.title') }}</h2>
    <p class="muted small">{{ t('a7.bulk.lead') }}</p>
    <form class="stack" @submit.prevent="preview">
      <div class="grid">
        <FormField id="bk-k" :label="t('a7.bulk.kind')"><template #default="{ id: fid }"><select :id="fid" v-model="f.kind" class="input"><option v-for="k in ['registration.approve', 'registration.reject', 'match.shift', 'notify']" :key="k" :value="k">{{ t(`a7.bulk.k.${k}` as never) }}</option></select></template></FormField>
        <FormField v-if="f.kind === 'match.shift'" id="bk-m" :label="t('a7.bulk.minutes')" :hint="t('a7.bulk.minutesHint')"><template #default="{ id: fid, describedBy }"><input :id="fid" v-model.number="f.minutes" type="number" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
        <FormField v-if="f.kind === 'notify'" id="bk-nt" :label="t('a7.bulk.notifTitle')"><template #default="{ id: fid }"><input :id="fid" v-model="f.title" class="input" dir="auto" /></template></FormField>
        <FormField v-if="f.kind === 'registration.reject' || f.kind === 'match.shift'" id="bk-r" :label="t('a7.reason')"><template #default="{ id: fid }"><input :id="fid" v-model="f.reason" class="input" dir="auto" /></template></FormField>
      </div>
      <FormField v-if="f.kind === 'notify'" id="bk-nb" :label="t('a7.bulk.notifBody')"><template #default="{ id: fid }"><textarea :id="fid" v-model="f.body" class="input" rows="2" dir="auto" /></template></FormField>
      <FormField id="bk-refs" :label="t('a7.bulk.refs')" :hint="t('a7.bulk.refsHint')"><template #default="{ id: fid, describedBy }"><textarea :id="fid" v-model="f.refs" class="input ltr" rows="3" :aria-describedby="describedBy" /></template></FormField>
      <button type="submit" class="btn" :disabled="busy || !f.refs.trim()">{{ t('a7.bulk.preview') }}</button>
    </form>
    <div v-if="job" class="stack" aria-live="polite">
      <h3>{{ job.state === 'done' ? t('a7.bulk.result') : t('a7.bulk.previewTitle') }}</h3>
      <p v-if="counts" class="small">{{ t('a7.bulk.counts', { ok: num(counts.ok), failed: num(counts.failed), skipped: num(counts.skipped), pending: num(counts.pending) }) }}</p>
      <table class="tbl">
        <caption class="sr-only">{{ t('a7.bulk.title') }}</caption>
        <thead><tr><th scope="col">{{ t('a7.bulk.item') }}</th><th scope="col">{{ t('a7.bulk.effect') }}</th><th scope="col">{{ t('a7.users.status') }}</th></tr></thead>
        <tbody><tr v-for="i in job.items" :key="i.ref"><th scope="row"><bdi>{{ i.label }}</bdi></th><td><bdi>{{ i.preview }}</bdi><span v-if="i.error" class="bad"> — {{ i.error }}</span></td><td><StatusBadge :state="i.status" /></td></tr></tbody>
      </table>
      <button v-if="job.state === 'previewed' && counts?.pending" type="button" class="btn btn-primary" :disabled="busy" @click="run">{{ t('a7.bulk.execute', { n: num(counts.pending) }) }}</button>
    </div>
  </section>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: var(--sp-3); align-items: start; }
.plain { list-style: none; margin: 0; padding: 0; }
.block { margin-block-start: var(--sp-4); }
.tbl { border-collapse: collapse; inline-size: 100%; }
.tbl th, .tbl td { text-align: start; padding: var(--sp-1) var(--sp-2); border-block-end: 1px solid var(--border); }
.critical { color: var(--danger, #b00020); }
.warn { color: var(--warn); }
.bad { color: var(--danger, #b00020); }
.ok { color: var(--ok); }
.small { font-size: var(--fs-xs); }
.sr-only { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip: rect(0 0 0 0); }
h2, h3, p { margin: 0; }
</style>
