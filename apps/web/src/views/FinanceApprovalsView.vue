<script setup lang="ts">
import { computed, ref } from 'vue';
import { SITE_SCOPE, type Approval } from '@esp/contracts';
import { QButton, QContainer, QDataState, QDataTable, QDecisionBox, QPageHeader, QStatusBadge, formatJalali, useToast, type QDataTableColumn } from '@esp/ui';
import { api, type ApiClientError } from '../api/client';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/** Spec docs/redesign/03-specs/finance-approvals.md — FIN separation of duties: a second person decides, always with a reason. */
const { push } = useToast();
const { data, loading, error, load } = useLoad(() => api.approvals(SITE_SCOPE.type, SITE_SCOPE.id));
const ds = useDataState({ loading: computed(() => loading.value && !data.value), error, empty: () => !!data.value && !data.value.items.length });
const selected = ref<Approval | null>(null);
const busy = ref(false);
const failure = ref<ApiClientError | null>(null);
async function decide(decision: 'approve' | 'reject', reason: string) {
  if (!selected.value || !reason.trim()) return;
  busy.value = true;
  failure.value = null;
  try {
    await api.decideApproval(selected.value.id, decision, reason.trim(), selected.value.version);
    push({ tone: 'success', message: t('fin.decided'), duration: 4000 });
    selected.value = null;
    await load();
  } catch (e) {
    failure.value = toClientError(e); // SEPARATION_OF_DUTIES / VERSION_CONFLICT are shown as localized text
  } finally {
    busy.value = false;
  }
}
const cols = computed<QDataTableColumn<Approval>[]>(() => [
  { key: 'action', header: t('fin.action') }, { key: 'state', header: t('fin.state') },
  { key: 'requestedBy', header: t('fin.requestedBy') }, { key: 'requestedAt', header: t('fin.requestedAt') },
]);
</script>

<template>
  <QContainer>
    <div class="k-stack p-appr">
      <QPageHeader compact :title="t('fin.approvals.title')" :description="t('fin.sodHint')" />
      <div class="p-appr-grid">
        <QDataState v-if="ds.state.value !== 'content' || !data" v-bind="ds.props.value" skeleton="rows" icon="check" @retry="load" />
        <QDataTable v-else :caption="t('fin.approvals.title')" caption-hidden row-key="id" row-header="action" :columns="cols" :rows="data.items">
          <template #cell-action="{ row }"><bdi class="q-ltr">{{ row.action }}</bdi></template>
          <template #cell-state="{ row }"><QStatusBadge machine="approval" :state="row.state" /></template>
          <template #cell-requestedBy="{ row }"><code class="q-mono q-ltr">{{ row.requestedBy }}</code></template>
          <template #cell-requestedAt="{ row }">{{ formatJalali(row.requestedAt) }}</template>
          <template #row-actions="{ row }"><QButton v-if="row.state === 'pending'" variant="secondary" size="sm" @click="selected = row">{{ t('fin.decide') }}</QButton></template>
        </QDataTable>
        <QDecisionBox
          v-if="selected" :title="t('fin.decide')" :action="selected.action" :requested-by="selected.requestedBy" :requested-at="formatJalali(selected.requestedAt)"
          state="pending" :note="failure?.message"
          @approve="(r) => decide('approve', r)" @reject="(r) => decide('reject', r)" @cancel="selected = null"
        />
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-appr { gap: var(--space-6); }
.p-appr-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: var(--space-6); align-items: start; }
@media (max-width: 1100px) { .p-appr-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
