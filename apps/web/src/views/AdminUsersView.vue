<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api } from '../api/esp07';
import DataTable from '../components/DataTable.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';

/** ADM-001 users panel: search, then suspend or restore with a recorded reason (sessions end at suspension). */
const esp07: typeof esp07Api = esp07Api;
const q = ref('');
const rows = ref<Awaited<ReturnType<typeof esp07.users>>['items']>([]);
const searched = ref(false);
const busy = ref(false);
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const reason = reactive<Record<string, string>>({});
async function search() {
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
async function setStatus(id: string, status: 'active' | 'suspended') {
  failure.value = null;
  notice.value = '';
  try {
    await esp07.setUserStatus(id, status, reason[id] ?? '');
    notice.value = t('a7.users.done');
    reason[id] = '';
    await search();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const cols = () => [
  { key: 'displayName', label: t('a7.users.name') },
  { key: 'status', label: t('a7.users.status') },
  { key: 'createdAt', label: t('a7.users.created') },
  { key: 'act', label: t('a7.users.action') },
];
</script>

<template>
  <PageHeader :title="t('a7.users.title')" :lead="t('a7.users.lead')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>
  <form class="card row" role="search" @submit.prevent="search">
    <FormField id="u-q" :label="t('a7.users.query')" :hint="t('a7.users.queryHint')">
      <template #default="{ id: fid, describedBy }"><input :id="fid" v-model="q" class="input" dir="auto" minlength="2" :aria-describedby="describedBy" /></template>
    </FormField>
    <button type="submit" class="btn btn-primary" :disabled="busy || q.trim().length < 2">{{ t('a7.search') }}</button>
  </form>
  <p v-if="searched && !rows.length" class="muted" role="status">{{ t('a7.empty') }}</p>
  <DataTable v-if="rows.length" :caption="t('a7.users.title')" :columns="cols()" :rows="rows" row-key="id" row-header="displayName">
    <template #cell-displayName="{ row }"><bdi>{{ (row as (typeof rows)[number]).displayName }}</bdi> <span class="muted small ltr">{{ (row as (typeof rows)[number]).id }}</span></template>
    <template #cell-status="{ row }"><StatusBadge :state="(row as (typeof rows)[number]).status" /></template>
    <template #cell-createdAt="{ row }"><JalaliDate :iso="(row as (typeof rows)[number]).createdAt" format="date" /></template>
    <template #cell-act="{ row }">
      <div v-if="(row as (typeof rows)[number]).status !== 'deleted'" class="row">
        <input v-model="reason[(row as (typeof rows)[number]).id]" class="input" dir="auto" :placeholder="t('a7.reason')" :aria-label="t('a7.reason')" />
        <button v-if="(row as (typeof rows)[number]).status === 'active'" type="button" class="btn btn-sm" :disabled="(reason[(row as (typeof rows)[number]).id] ?? '').length < 5" @click="setStatus((row as (typeof rows)[number]).id, 'suspended')">{{ t('a7.users.suspend') }}</button>
        <button v-else type="button" class="btn btn-sm" :disabled="(reason[(row as (typeof rows)[number]).id] ?? '').length < 5" @click="setStatus((row as (typeof rows)[number]).id, 'active')">{{ t('a7.users.restore') }}</button>
      </div>
    </template>
  </DataTable>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: end; }
.small { font-size: var(--fs-xs); }
.ok { color: var(--ok); }
</style>
