<script setup lang="ts">
import { ref } from 'vue';
import type { OutboxRecord, ProviderHealth } from '@esp/contracts';
import { api, type ApiClientError } from '../api/client';
import DataState from '../components/DataState.vue';
import DataTable from '../components/DataTable.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t, type MessageKey } from '../i18n';
import { useLoad } from '../useLoad';

const providers = useLoad(() => api.providers());
const outbox = useLoad(() => api.outbox());
const audit = useLoad(() => api.auditVerify(), false);

const busyId = ref<string | null>(null);
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
async function replay(id: string) {
  busyId.value = id;
  failure.value = null;
  notice.value = '';
  try {
    await api.replay(id);
    notice.value = t('ops.replayed');
    await outbox.load();
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    busyId.value = null;
  }
}

const provCols = () => [
  { key: 'kind', label: t('ops.kind') },
  { key: 'adapter', label: t('ops.adapter') },
  { key: 'mode', label: t('ops.mode') },
  { key: 'status', label: t('ops.status') },
  { key: 'checkedAt', label: t('ops.checkedAt') },
];
const dlCols = () => [
  { key: 'type', label: t('ops.deadLetters') },
  { key: 'attempts', label: t('ops.attempts') },
  { key: 'lastError', label: t('ops.lastError') },
  { key: 'actions', label: '' },
];
</script>

<template>
  <PageHeader :title="t('ops.title')" />

  <section class="block" aria-labelledby="p-h">
    <h2 id="p-h">{{ t('ops.providers') }}</h2>
    <DataState :loading="providers.loading.value" :error="providers.error.value" :empty="!!providers.data.value && providers.data.value.items.length === 0" @retry="providers.load">
      <DataTable v-if="providers.data.value" :caption="t('ops.providers')" :columns="provCols()" :rows="providers.data.value.items" row-key="kind" row-header="kind">
        <template #cell-kind="{ row }"><bdi class="ltr">{{ (row as ProviderHealth).kind }}</bdi></template>
        <template #cell-adapter="{ row }"><bdi class="ltr">{{ (row as ProviderHealth).adapter }}</bdi></template>
        <template #cell-mode="{ row }">{{ t(`ops.mode.${(row as ProviderHealth).mode}` as MessageKey) }}</template>
        <template #cell-status="{ row }">
          <StatusBadge :state="(row as ProviderHealth).status" />
          <span v-if="(row as ProviderHealth).detail" class="muted"> <bdi>{{ (row as ProviderHealth).detail }}</bdi></span>
        </template>
        <template #cell-checkedAt="{ row }"><JalaliDate :iso="(row as ProviderHealth).checkedAt" /></template>
      </DataTable>
    </DataState>
  </section>

  <section class="block" aria-labelledby="o-h">
    <h2 id="o-h">{{ t('ops.outbox') }}</h2>
    <p v-if="notice" class="ok" role="status">{{ notice }}</p>
    <ErrorNote :error="failure" />
    <DataState :loading="outbox.loading.value" :error="outbox.error.value" @retry="outbox.load">
      <template v-if="outbox.data.value">
        <ul class="stats">
          <li v-for="(n, k) in outbox.data.value.stats" :key="k" class="card"><bdi class="ltr muted">{{ k }}</bdi><strong class="num">{{ num(n) }}</strong></li>
        </ul>
        <DataState :empty="outbox.data.value.deadLetters.length === 0">
          <template #empty><p>{{ t('ops.noDeadLetters') }}</p></template>
          <DataTable :caption="t('ops.deadLetters')" :columns="dlCols()" :rows="outbox.data.value.deadLetters" row-key="id" row-header="type">
            <template #cell-type="{ row }"><bdi class="ltr">{{ (row as OutboxRecord).type }}</bdi></template>
            <template #cell-attempts="{ row }">{{ num((row as OutboxRecord).attempts) }} / {{ num((row as OutboxRecord).maxAttempts) }}</template>
            <template #cell-lastError="{ row }"><bdi>{{ (row as OutboxRecord).lastError ?? '—' }}</bdi></template>
            <template #cell-actions="{ row }">
              <button type="button" class="btn btn-sm" :disabled="busyId === (row as OutboxRecord).id" @click="replay((row as OutboxRecord).id)">{{ t('ops.replay') }}</button>
            </template>
          </DataTable>
        </DataState>
      </template>
    </DataState>
  </section>

  <section class="block" aria-labelledby="a-h">
    <h2 id="a-h">{{ t('ops.audit') }}</h2>
    <button type="button" class="btn" :disabled="audit.loading.value" @click="audit.load">{{ t('ops.auditVerify') }}</button>
    <div class="result">
      <DataState :loading="audit.loading.value" :error="audit.error.value" @retry="audit.load">
        <p v-if="audit.data.value" role="status" :class="audit.data.value.ok ? 'ok' : 'bad'">
          {{ audit.data.value.ok ? t('ops.auditOk', { n: num(audit.data.value.checked) }) : t('ops.auditBroken', { n: num(audit.data.value.checked), seq: num(audit.data.value.brokenAtSeq ?? 0) }) }}
        </p>
      </DataState>
    </div>
  </section>
</template>

<style scoped>
.block { margin-block-end: var(--sp-6); }
.stats { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: var(--sp-3); }
.stats .card { display: grid; padding: var(--sp-3) var(--sp-4); }
.stats strong { font-size: var(--fs-xl); }
.result { margin-block-start: var(--sp-3); }
.ok { color: var(--ok); font-weight: 600; }
.bad { color: var(--danger); font-weight: 600; }
</style>
