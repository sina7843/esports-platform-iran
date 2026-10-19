<script setup lang="ts">
import { computed, ref } from 'vue';
import { Roles, roleScopeTypes, ScopeTypes, type Grant, type Role, type ScopeType } from '@esp/contracts';
import { api, type ApiClientError } from '../api/client';
import DataState from '../components/DataState.vue';
import DataTable from '../components/DataTable.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { isUtcInstant } from '../validators';

const scopeType = ref<ScopeType>('organization');
const scopeId = ref('');
const loaded = ref<{ type: ScopeType; id: string } | null>(null);
const grants = ref<Grant[]>([]);
const loading = ref(false);
const listError = ref<ApiClientError | null>(null);
const actionError = ref<ApiClientError | null>(null);
const notice = ref('');

async function loadGrants() {
  if (!scopeId.value.trim()) return;
  loading.value = true;
  listError.value = null;
  notice.value = '';
  try {
    const scope = { type: scopeType.value, id: scopeId.value.trim() };
    grants.value = (await api.grants(scope.type, scope.id)).items;
    loaded.value = scope;
  } catch (e) {
    listError.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}

// ---- create
const principalId = ref('');
const role = ref<Role | ''>('');
const expiresAt = ref('');
const reason = ref('');
const busy = ref(false);
const submitted = ref(false);
const roleOptions = computed(() => Roles.filter((r) => roleScopeTypes[r].includes(loaded.value?.type ?? scopeType.value)));
const expiresError = computed(() => (expiresAt.value && !isUtcInstant(expiresAt.value.trim()) ? t('org.access.expiresInvalid') : ''));

async function create() {
  submitted.value = true;
  if (!loaded.value || !principalId.value.trim() || !role.value || expiresError.value) return;
  busy.value = true;
  actionError.value = null;
  notice.value = '';
  try {
    await api.createGrant({
      principalId: principalId.value.trim(),
      role: role.value,
      scope: loaded.value,
      expiresAt: expiresAt.value.trim() || null,
      reason: reason.value.trim() || null,
    });
    notice.value = t('org.access.created');
    principalId.value = '';
    reason.value = '';
    expiresAt.value = '';
    submitted.value = false;
    await loadGrants();
  } catch (e) {
    actionError.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}

// ---- revoke (inline reason)
const revoking = ref<string | null>(null);
const revokeReason = ref('');
async function confirmRevoke(id: string) {
  busy.value = true;
  actionError.value = null;
  notice.value = '';
  try {
    await api.revokeGrant(id, revokeReason.value.trim() || null);
    notice.value = t('org.access.revoked');
    revoking.value = null;
    revokeReason.value = '';
    await loadGrants();
  } catch (e) {
    actionError.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}

const cols = () => [
  { key: 'principalId', label: t('org.access.principalId') },
  { key: 'role', label: t('org.access.role') },
  { key: 'grantedBy', label: t('org.access.by') },
  { key: 'expiresAt', label: t('account.expiresAt') },
  { key: 'actions', label: '' },
];
const active = computed(() => grants.value.filter((g) => !g.revokedAt));
</script>

<template>
  <PageHeader :title="t('org.access.title')" />

  <form class="card row scope" novalidate @submit.prevent="loadGrants">
    <FormField id="a-type" :label="t('org.access.scopeType')">
      <template #default="{ id }">
        <select :id="id" v-model="scopeType" class="input">
          <option v-for="s in ScopeTypes" :key="s" :value="s">{{ s }}</option>
        </select>
      </template>
    </FormField>
    <FormField id="a-scope" :label="t('org.access.scopeId')" required>
      <template #default="{ id }"><input :id="id" v-model="scopeId" class="input" dir="ltr" /></template>
    </FormField>
    <button type="submit" class="btn btn-primary" :disabled="loading || !scopeId.trim()">{{ t('org.access.load') }}</button>
  </form>

  <p v-if="notice" class="ok" role="status">{{ notice }}</p>
  <ErrorNote :error="actionError" />

  <section class="block" aria-labelledby="g-h">
    <DataState :loading="loading" :error="listError" :empty="loaded !== null && active.length === 0" @retry="loadGrants">
      <p v-if="!loaded" class="muted">{{ t('org.access.pickScope') }}</p>
      <template v-else>
        <h2 id="g-h"><bdi class="ltr">{{ loaded.type }}:{{ loaded.id }}</bdi></h2>
        <DataTable :caption="t('org.access.title')" :columns="cols()" :rows="active" row-key="id" row-header="principalId">
          <template #cell-principalId="{ row }"><code>{{ (row as Grant).principalId }}</code></template>
          <template #cell-role="{ row }"><bdi class="ltr">{{ (row as Grant).role }}</bdi></template>
          <template #cell-grantedBy="{ row }"><code>{{ (row as Grant).grantedBy }}</code></template>
          <template #cell-expiresAt="{ row }">
            <JalaliDate v-if="(row as Grant).expiresAt" :iso="(row as Grant).expiresAt" />
            <span v-else class="muted">{{ t('account.never') }}</span>
          </template>
          <template #cell-actions="{ row }">
            <form v-if="revoking === (row as Grant).id" class="row" @submit.prevent="confirmRevoke((row as Grant).id)">
              <label class="sr-only" :for="`rr-${(row as Grant).id}`">{{ t('org.access.revokeReason') }}</label>
              <input :id="`rr-${(row as Grant).id}`" v-model="revokeReason" class="input rr" :placeholder="t('org.access.revokeReason')" />
              <button type="submit" class="btn btn-sm btn-danger" :disabled="busy">{{ t('org.access.revoke') }}</button>
              <button type="button" class="btn btn-sm" @click="revoking = null">{{ t('common.cancel') }}</button>
            </form>
            <button v-else type="button" class="btn btn-sm btn-danger" @click="revoking = (row as Grant).id">{{ t('org.access.revoke') }}</button>
          </template>
        </DataTable>
      </template>
    </DataState>
  </section>

  <form v-if="loaded" class="card stack create" novalidate @submit.prevent="create">
    <h2>{{ t('org.access.create') }}</h2>
    <FormField id="c-pid" :label="t('org.access.principalId')" :error="submitted && !principalId.trim() ? t('common.required') : ''" required>
      <template #default="{ id, describedBy, invalid }">
        <input :id="id" v-model="principalId" class="input" dir="ltr" :aria-describedby="describedBy" :aria-invalid="invalid ? 'true' : undefined" />
      </template>
    </FormField>
    <FormField id="c-role" :label="t('org.access.role')" :error="submitted && !role ? t('common.required') : ''" required>
      <template #default="{ id, describedBy, invalid }">
        <select :id="id" v-model="role" class="input" :aria-describedby="describedBy" :aria-invalid="invalid ? 'true' : undefined">
          <option value="" disabled>—</option>
          <option v-for="r in roleOptions" :key="r" :value="r">{{ r }}</option>
        </select>
      </template>
    </FormField>
    <FormField id="c-exp" :label="t('org.access.expiresAt')" :error="expiresError">
      <template #default="{ id, describedBy, invalid }">
        <input :id="id" v-model="expiresAt" class="input" dir="ltr" placeholder="2026-12-31T00:00:00Z" :aria-describedby="describedBy" :aria-invalid="invalid ? 'true' : undefined" />
      </template>
    </FormField>
    <FormField id="c-reason" :label="t('org.access.reason')">
      <template #default="{ id }"><input :id="id" v-model="reason" class="input" maxlength="500" /></template>
    </FormField>
    <button type="submit" class="btn btn-primary" :disabled="busy">{{ t('org.access.submit') }}</button>
  </form>
</template>

<style scoped>
.scope { align-items: flex-end; margin-block-end: var(--sp-4); }
.block { margin-block: var(--sp-5); }
.create { max-inline-size: 34rem; }
.ok { color: var(--ok); font-weight: 600; }
.rr { min-inline-size: 12rem; }
</style>
