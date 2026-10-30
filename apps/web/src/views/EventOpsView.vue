<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  QAlert, QButton, QCard, QConfirmDialog, QContainer, QDataState, QDataTable, QOpsAlert, QPageHeader, QSection, QSelect, QStatTile, QStatusBadge, QTextField,
  formatJalali, num, useToast, type QDataTableColumn,
} from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api, type BulkItem, type BulkJob } from '../api/esp07';
import { toClientError } from '../errors';
import { t } from '../i18n';
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
const { push } = useToast();
watch(failure, (e) => { if (e) push({ tone: 'danger', message: e.message }); });
const minutes = computed({ get: () => String(f.minutes), set: (v: string) => { f.minutes = Number(v) || 0; } });
const confirming = ref(false);
const KINDS = ['registration.approve', 'registration.reject', 'match.shift', 'notify'];
const bulkCols = computed<QDataTableColumn<BulkItem>[]>(() => [
  { key: 'label', header: t('a7.bulk.item') }, { key: 'preview', header: t('a7.bulk.effect') }, { key: 'status', header: t('a7.users.status') },
]);
</script>

<template>
  <QContainer>
    <div class="k-stack p-eops">
      <QPageHeader compact :title="t('a7.ops.title')" :description="t('a7.ops.lead')" :breadcrumb="[{ label: t('shell.organizer'), href: '/organizer' }, { label: t('shell.events'), href: `/organizer/events/${eventId}` }, { label: t('a7.ops.title') }]">
        <template #actions>
          <QButton variant="secondary" size="sm" icon="refresh" :loading="loading" @click="load">{{ t('a7.refresh') }}</QButton>
          <QButton variant="ghost" size="sm" icon="list" :href="`/admin/tasks?event=${encodeURIComponent(eventId)}`">{{ t('a7.ops.tasks') }}</QButton>
          <QButton variant="ghost" size="sm" icon="download" :href="esp07.sponsorCsvUrl(eventId)" download>{{ t('a7.ops.sponsor') }}</QButton>
        </template>
      </QPageHeader>
      <p v-if="data" class="p-eops-muted">{{ t('a7.updated') }}: {{ formatJalali(data.at, 'time') }}</p>
      <QDataState v-if="!data" :state="error ? (error.code === 'FORBIDDEN' ? 'forbidden' : 'error') : 'loading'" skeleton="cards" @retry="load" />
      <template v-else>
        <div class="k-stack">
          <QOpsAlert v-for="a in data.alerts" :key="a.kind" :severity="a.level === 'critical' ? 'critical' : 'warning'" :title="a.level === 'critical' ? t('a7.ops.critical') : t('a7.ops.warn')" :detail="a.detail" />
          <QAlert v-if="!data.alerts.length" tone="success" icon="check-circle">{{ t('a7.ops.noAlerts') }}</QAlert>
        </div>
        <div class="p-eops-stats">
          <QStatTile :label="t('a7.ops.openCases')" :value="num(data.cases)" icon="gavel" />
          <QStatTile :label="t('a7.ops.incidents')" :value="num(data.incidents)" icon="alert" />
          <QStatTile :label="t('a7.ops.tickets')" :value="num(data.tickets)" icon="inbox" />
          <QStatTile :label="t('a7.ops.live')" :value="num(data.live.length)" icon="broadcast" />
        </div>
        <div class="p-eops-grid">
          <QCard v-for="[title, map] in [[t('a7.ops.registrations'), data.registrations], [t('a7.ops.checkins'), data.checkins], [t('a7.ops.matches'), data.matches]] as Array<[string, Record<string, number>]>" :key="title">
            <div class="k-stack">
              <h2 class="h4 p-eops-h">{{ title }}</h2>
              <ul v-if="tally(map).length" class="p-eops-rows"><li v-for="[k, n] in tally(map)" :key="k"><QStatusBadge :state="k" /><strong>{{ num(n) }}</strong></li></ul>
              <p v-else class="p-eops-muted">—</p>
            </div>
          </QCard>
          <QCard>
            <div class="k-stack">
              <h2 class="h4 p-eops-h">{{ t('a7.ops.resources') }}</h2>
              <ul class="p-eops-rows">
                <li v-for="[k, n] in tally(data.resources.stations)" :key="k"><span>{{ t('a7.ops.stations') }} <QStatusBadge :state="k" /></span><strong>{{ num(n) }}</strong></li>
                <li v-for="s in data.resources.servers" :key="s.name"><span><bdi>{{ s.name }}</bdi> <QStatusBadge :state="s.health" /></span><span>{{ t('a7.ops.free') }}: {{ num(s.free) }}</span></li>
              </ul>
              <p v-if="!data.resources.servers.length" class="p-eops-muted">{{ t('a7.ops.noServers') }}</p>
            </div>
          </QCard>
        </div>
        <QSection id="live" small :title="t('a7.ops.live')">
          <QCard>
            <p v-if="!data.live.length" class="p-eops-muted">{{ t('a7.ops.noLive') }}</p>
            <ul class="p-eops-rows">
              <li v-for="m in data.live" :key="m.id"><span><bdi class="q-ltr">{{ m.slot ?? m.id }}</bdi> — <bdi>{{ m.sides.join(' / ') }}</bdi></span><QStatusBadge :state="m.state" machine="match" /></li>
            </ul>
            <template v-if="data.delayed.length">
              <h3 class="h4 p-eops-h p-eops-gap">{{ t('a7.ops.delayed') }}</h3>
              <ul class="p-eops-rows">
                <li v-for="m in data.delayed" :key="m.id" class="p-eops-late"><span><bdi class="q-ltr">{{ m.slot ?? m.id }}</bdi> — {{ formatJalali(m.scheduledAt) }}</span><QStatusBadge :state="m.state" machine="match" /></li>
              </ul>
            </template>
          </QCard>
        </QSection>
      </template>

      <QSection id="bulk" small :title="t('a7.bulk.title')" :description="t('a7.bulk.lead')">
        <QCard>
          <div class="k-stack">
            <form class="k-stack" novalidate @submit.prevent="preview">
              <div class="p-eops-form">
                <QSelect id="bk-k" v-model="f.kind" :label="t('a7.bulk.kind')" :options="KINDS.map((k) => ({ value: k, label: t(`a7.bulk.k.${k}` as never) }))" />
                <QTextField v-if="f.kind === 'match.shift'" id="bk-m" v-model="minutes" :label="t('a7.bulk.minutes')" :hint="t('a7.bulk.minutesHint')" type="number" ltr />
                <QTextField v-if="f.kind === 'notify'" id="bk-nt" v-model="f.title" :label="t('a7.bulk.notifTitle')" />
                <QTextField v-if="f.kind === 'registration.reject' || f.kind === 'match.shift'" id="bk-r" v-model="f.reason" :label="t('a7.reason')" />
              </div>
              <QTextField v-if="f.kind === 'notify'" id="bk-nb" v-model="f.body" :label="t('a7.bulk.notifBody')" multiline :rows="2" />
              <QTextField id="bk-refs" v-model="f.refs" :label="t('a7.bulk.refs')" :hint="t('a7.bulk.refsHint')" multiline :rows="3" ltr />
              <div><QButton type="submit" variant="secondary" icon="eye" :loading="busy" :disabled="!f.refs.trim()">{{ t('a7.bulk.preview') }}</QButton></div>
            </form>
            <div v-if="job" class="k-stack" aria-live="polite">
              <h3 class="h4 p-eops-h">{{ job.state === 'done' ? t('a7.bulk.result') : t('a7.bulk.previewTitle') }}</h3>
              <p v-if="counts" class="p-eops-muted">{{ t('a7.bulk.counts', { ok: num(counts.ok), failed: num(counts.failed), skipped: num(counts.skipped), pending: num(counts.pending) }) }}</p>
              <QDataTable :caption="t('a7.bulk.title')" caption-hidden row-key="ref" row-header="label" :columns="bulkCols" :rows="job.items">
                <template #cell-label="{ row }"><bdi>{{ row.label }}</bdi></template>
                <template #cell-preview="{ row }"><bdi>{{ row.preview }}</bdi><span v-if="row.error" class="p-eops-err"> — {{ row.error }}</span></template>
                <template #cell-status="{ row }"><QStatusBadge :state="row.status" /></template>
              </QDataTable>
              <div v-if="job.state === 'previewed' && counts?.pending"><QButton variant="primary" :loading="busy" @click="confirming = true">{{ t('a7.bulk.execute', { n: num(counts.pending) }) }}</QButton></div>
            </div>
          </div>
        </QCard>
      </QSection>
    </div>
    <QConfirmDialog :require-reason="false"
      :open="confirming" :title="t('a7.bulk.title')" :message="counts ? t('a7.bulk.execute', { n: num(counts.pending) }) : ''" :confirm-label="t('eo.run')" :cancel-label="t('eo.cancel')"
      @close="confirming = false" @confirm="confirming = false; run()"
    />
  </QContainer>
</template>

<style scoped>
.p-eops { gap: var(--space-6); }
.p-eops-h { margin: 0; }
.p-eops-gap { margin-block-start: var(--space-4); }
.p-eops-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-eops-err { color: var(--danger-text); }
.p-eops-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
.p-eops-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); }
.p-eops-rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.p-eops-rows li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); padding-block: var(--space-2); border-block-end: 1px solid var(--line); font-size: 14px; }
.p-eops-late { color: var(--warning-text); }
.p-eops-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: var(--space-4); }
@media (max-width: 900px) { .p-eops-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
