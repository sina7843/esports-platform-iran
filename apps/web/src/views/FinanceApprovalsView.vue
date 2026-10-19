<script setup lang="ts">
import { ref } from 'vue';
import { SITE_SCOPE, type Approval } from '@esp/contracts';
import { api, type ApiClientError } from '../api/client';
import DataState from '../components/DataState.vue';
import DataTable from '../components/DataTable.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useLoad } from '../useLoad';

const { data, loading, error, load } = useLoad(() => api.approvals(SITE_SCOPE.type, SITE_SCOPE.id));

const selected = ref<Approval | null>(null);
const decision = ref<'approve' | 'reject'>('approve');
const reason = ref('');
const submitted = ref(false);
const busy = ref(false);
const failure = ref<ApiClientError | null>(null);
const notice = ref('');

function pick(a: Approval) {
  selected.value = a;
  decision.value = 'approve';
  reason.value = '';
  submitted.value = false;
  failure.value = null;
  notice.value = '';
}

async function decide() {
  submitted.value = true;
  if (!selected.value || !reason.value.trim()) return;
  busy.value = true;
  failure.value = null;
  try {
    await api.decideApproval(selected.value.id, decision.value, reason.value.trim(), selected.value.version);
    notice.value = t('fin.decided');
    selected.value = null;
    await load();
  } catch (e) {
    failure.value = toClientError(e); // SEPARATION_OF_DUTIES / VERSION_CONFLICT etc. are shown as localized text
  } finally {
    busy.value = false;
  }
}

const cols = () => [
  { key: 'action', label: t('fin.action') },
  { key: 'state', label: t('fin.state') },
  { key: 'requestedBy', label: t('fin.requestedBy') },
  { key: 'requestedAt', label: t('fin.requestedAt') },
  { key: 'decide', label: '' },
];
</script>

<template>
  <PageHeader :title="t('fin.approvals.title')" :lead="t('fin.sodHint')" />
  <p v-if="notice" class="ok" role="status">{{ notice }}</p>

  <DataState :loading="loading" :error="error" :empty="!!data && data.items.length === 0" @retry="load">
    <DataTable v-if="data" :caption="t('fin.approvals.title')" :columns="cols()" :rows="data.items" row-key="id" row-header="action">
      <template #cell-action="{ row }"><bdi class="ltr">{{ (row as Approval).action }}</bdi></template>
      <template #cell-state="{ row }"><StatusBadge kind="approval" :state="(row as Approval).state" /></template>
      <template #cell-requestedBy="{ row }"><code>{{ (row as Approval).requestedBy }}</code></template>
      <template #cell-requestedAt="{ row }"><JalaliDate :iso="(row as Approval).requestedAt" /></template>
      <template #cell-decide="{ row }">
        <button v-if="(row as Approval).state === 'pending'" type="button" class="btn btn-sm" @click="pick(row as Approval)">{{ t('fin.decide') }}</button>
      </template>
    </DataTable>
  </DataState>

  <form v-if="selected" class="card stack decide" novalidate aria-labelledby="dec-h" @submit.prevent="decide">
    <h2 id="dec-h">{{ t('fin.decide') }}: <bdi class="ltr">{{ selected.action }}</bdi></h2>
    <FormField id="f-decision" :label="t('fin.decide')">
      <template #default="{ id }">
        <select :id="id" v-model="decision" class="input">
          <option value="approve">{{ t('fin.approve') }}</option>
          <option value="reject">{{ t('fin.reject') }}</option>
        </select>
      </template>
    </FormField>
    <FormField id="f-reason" :label="t('fin.reason')" :error="submitted && !reason.trim() ? t('common.required') : ''" required>
      <template #default="{ id, describedBy, invalid }">
        <textarea :id="id" v-model="reason" class="input" rows="3" maxlength="1000" :aria-describedby="describedBy" :aria-invalid="invalid ? 'true' : undefined" />
      </template>
    </FormField>
    <ErrorNote :error="failure" />
    <div class="row">
      <button type="submit" class="btn btn-primary" :disabled="busy">{{ t('fin.submit') }}</button>
      <button type="button" class="btn" @click="selected = null">{{ t('common.cancel') }}</button>
    </div>
  </form>
</template>

<style scoped>
.decide { max-inline-size: 34rem; margin-block-start: var(--sp-5); }
.ok { color: var(--ok); font-weight: 600; }
</style>
