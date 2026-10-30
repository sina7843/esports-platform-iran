<script setup lang="ts">
import { computed, ref } from 'vue';
import { QButton, QCard, QConfirmDialog, QContainer, QDataState, QDataTable, QEmptyState, QPageHeader, QSearchField, QStatusBadge, formatJalali, useToast, type QDataTableColumn } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp07 } from '../api/esp07';
import { toClientError } from '../errors';
import { t } from '../i18n';

/** Spec docs/redesign/03-specs/admin-users.md — ADM-001: search, then suspend or restore with a recorded reason (sessions end at suspension). */
const { push } = useToast();
type Row = Awaited<ReturnType<typeof esp07.users>>['items'][number];
const q = ref('');
const rows = ref<Row[]>([]);
const searched = ref(false);
const busy = ref(false);
const failure = ref<ApiClientError | null>(null);
async function search() {
  if (q.value.trim().length < 2) return;
  busy.value = true;
  failure.value = null;
  try {
    rows.value = (await esp07.users(q.value)).items;
    searched.value = true;
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}
const target = ref<{ row: Row; status: 'active' | 'suspended' } | null>(null);
async function setStatus(reason: string) {
  const x = target.value;
  if (!x) return;
  try {
    await esp07.setUserStatus(x.row.id, x.status, reason);
    push({ tone: 'success', message: t('a7.users.done'), duration: 4000 });
    target.value = null;
    await search();
  } catch (e) {
    push({ tone: 'danger', message: toClientError(e).message });
  }
}
const cols = computed<QDataTableColumn<Row>[]>(() => [
  { key: 'displayName', header: t('a7.users.name') }, { key: 'status', header: t('a7.users.status') }, { key: 'createdAt', header: t('a7.users.created') },
]);
</script>

<template>
  <QContainer>
    <div class="k-stack p-users">
      <QPageHeader compact :title="t('a7.users.title')" :description="t('a7.users.lead')" :breadcrumb="[{ label: t('shell.platform_admin'), href: '/admin' }, { label: t('a7.users.title') }]" />
      <QCard>
        <QSearchField id="u-q" v-model="q" :label="t('a7.users.query')" :placeholder="t('a7.users.queryHint')" :submit-label="t('a7.search')" @submit="search" />
      </QCard>
      <QDataState v-if="failure" :state="failure.code === 'FORBIDDEN' ? 'forbidden' : 'error'" :request-id="failure.requestId ?? undefined" @retry="search" />
      <QDataState v-else-if="busy && !rows.length" state="loading" skeleton="rows" />
      <QEmptyState v-else-if="searched && !rows.length" compact icon="search" :title="t('a7.empty')" />
      <QDataTable v-else-if="rows.length" :caption="t('a7.users.title')" caption-hidden row-key="id" row-header="displayName" :columns="cols" :rows="rows">
        <template #cell-displayName="{ row }"><span class="p-users-name"><bdi>{{ row.displayName }}</bdi><code class="q-mono q-ltr">{{ row.id }}</code></span></template>
        <template #cell-status="{ row }"><QStatusBadge :state="row.status" /></template>
        <template #cell-createdAt="{ row }">{{ formatJalali(row.createdAt, 'date') }}</template>
        <template #row-actions="{ row }">
          <template v-if="row.status !== 'deleted'">
            <QButton v-if="row.status === 'active'" variant="danger" size="sm" @click="target = { row, status: 'suspended' }">{{ t('a7.users.suspend') }}</QButton>
            <QButton v-else variant="green" size="sm" @click="target = { row, status: 'active' }">{{ t('a7.users.restore') }}</QButton>
          </template>
        </template>
      </QDataTable>
    </div>
    <QConfirmDialog
      :open="!!target" require-reason :min-reason-length="5" :reason-label="t('a7.reason')"
      :title="target?.status === 'suspended' ? t('a7.users.suspend') : t('a7.users.restore')" :message="target ? target.row.displayName : ''"
      :confirm-label="target?.status === 'suspended' ? t('a7.users.suspend') : t('a7.users.restore')" :cancel-label="t('au.cancel')"
      @close="target = null" @confirm="setStatus"
    />
  </QContainer>
</template>

<style scoped>
.p-users { gap: var(--space-6); }
.p-users-name { display: flex; flex-direction: column; gap: 2px; }
.p-users-name code { font-size: 12px; color: var(--ink-subtle); }
</style>
