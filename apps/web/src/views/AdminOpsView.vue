<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { OutboxRecord } from '@esp/contracts';
import { QAlert, QButton, QContainer, QDataState, QEmptyState, QPageHeader, QSection, QServiceHealth, QStatTile, fa, formatJalali, num, useToast } from '@esp/ui';
import { api, type ApiClientError } from '../api/client';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { useLoad } from '../useLoad';
import { QDataTable, type QDataTableColumn } from '@esp/ui';

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

const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 4000 }); });
watch(failure, (f) => { if (f) push({ tone: 'danger', message: f.message }); });
const health = (s: string) => (['healthy', 'ok', 'up'].includes(s) ? 'ok' : ['degraded', 'slow'].includes(s) ? 'degraded' : ['down', 'failed', 'unhealthy'].includes(s) ? 'down' : 'unconfigured') as 'ok' | 'degraded' | 'down' | 'unconfigured';
const dlCols = computed<QDataTableColumn<OutboxRecord>[]>(() => [
  { key: 'type', header: t('ops.deadLetters') }, { key: 'attempts', header: t('ops.attempts') }, { key: 'lastError', header: t('ops.lastError') },
]);
</script>

<template>
  <QContainer>
    <div class="k-stack p-ops">
      <QPageHeader compact :title="t('ops.title')" :breadcrumb="[{ label: t('shell.platform_admin'), href: '/admin' }, { label: t('ops.title') }]" />

      <QSection id="providers" small :title="t('ops.providers')">
        <QDataState v-if="!providers.data.value || !providers.data.value.items.length" :state="providers.error.value ? 'error' : providers.loading.value ? 'loading' : 'empty'" skeleton="cards" @retry="providers.load" />
        <div v-else class="p-ops-grid">
          <QServiceHealth
            v-for="p in providers.data.value.items" :key="p.kind" :name="p.kind" :kind="p.adapter" :status="health(p.status)"
            :detail="[t(`ops.mode.${p.mode}` as MessageKey), p.detail].filter(Boolean).join(' · ')" :checked-at="p.checkedAt ? formatJalali(p.checkedAt, 'time') : undefined"
          />
        </div>
      </QSection>

      <QSection id="outbox" small :title="t('ops.outbox')">
        <QDataState v-if="!outbox.data.value" :state="outbox.error.value ? 'error' : 'loading'" skeleton="rows" @retry="outbox.load" />
        <div v-else class="k-stack">
          <div class="p-ops-stats">
            <QStatTile v-for="(n, k) in outbox.data.value.stats" :key="k" :label="String(k)" :value="num(n)" />
          </div>
          <QEmptyState v-if="!outbox.data.value.deadLetters.length" compact icon="check-circle" :title="t('ops.noDeadLetters')" />
          <QDataTable v-else :caption="t('ops.deadLetters')" row-key="id" row-header="type" :columns="dlCols" :rows="outbox.data.value.deadLetters">
            <template #cell-type="{ row }"><bdi class="q-ltr">{{ row.type }}</bdi></template>
            <template #cell-attempts="{ row }">{{ fa(row.attempts) }} / {{ fa(row.maxAttempts) }}</template>
            <template #cell-lastError="{ row }"><bdi>{{ row.lastError ?? '—' }}</bdi></template>
            <template #row-actions="{ row }"><QButton size="sm" variant="secondary" icon="refresh" :loading="busyId === row.id" @click="replay(row.id)">{{ t('ops.replay') }}</QButton></template>
          </QDataTable>
        </div>
      </QSection>

      <QSection id="audit" small :title="t('ops.audit')">
        <div class="k-stack">
          <div><QButton variant="secondary" icon="shield" :loading="audit.loading.value" @click="audit.load">{{ t('ops.auditVerify') }}</QButton></div>
          <QDataState v-if="audit.error.value" state="error" @retry="audit.load" />
          <QAlert v-else-if="audit.data.value" :tone="audit.data.value.ok ? 'success' : 'danger'">
            {{ audit.data.value.ok ? t('ops.auditOk', { n: num(audit.data.value.checked) }) : t('ops.auditBroken', { n: num(audit.data.value.checked), seq: num(audit.data.value.brokenAtSeq ?? 0) }) }}
          </QAlert>
        </div>
      </QSection>
    </div>
  </QContainer>
</template>

<style scoped>
.p-ops { gap: var(--space-7); }
.p-ops-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }
.p-ops-stats { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr)); }
</style>
