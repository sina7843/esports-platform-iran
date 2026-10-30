<script setup lang="ts">
import { computed, ref } from 'vue';
import { QBadge, QButton, QCard, QConfirmDialog, QContainer, QDataState, QDataTable, QDateField, QDialog, QEmptyState, QPageHeader, QSearchField, QSelect, QSwitch, QTextField, fa, formatJalali, useToast, type QDataTableColumn } from '@esp/ui';
import { Roles, roleScopeTypes, ScopeTypes, type Grant, type Role, type ScopeType } from '@esp/contracts';
import { api, type ApiClientError } from '../api/client';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { session } from '../session';

/**
 * ACL grants for one scope: list (filter by person/role, show revoked), create with optional expiry, revoke with a reason.
 * OPEN-QUESTION: spec wants scopes picked by name (`GET /me/acl-scopes`) and people by name (`GET /people?q=`);
 * neither endpoint exists, so the scope ID and principal ID are still typed.
 */
const { push } = useToast();
const myId = computed(() => session.me?.principal.id ?? '');
const isAdmin = computed(() => (session.me?.grants ?? []).some((g) => !g.revokedAt && g.scope.type === 'site'));
const scopeTypes = computed(() => ScopeTypes.filter((s) => isAdmin.value || s !== 'site').map((s) => ({ value: s, label: t(`oa.scope.${s}`) })));

const scopeType = ref<ScopeType>('organization');
const scopeId = ref('');
const loaded = ref<{ type: ScopeType; id: string } | null>(null);
const grants = ref<Grant[]>([]);
const loading = ref(false);
const listError = ref<ApiClientError | null>(null);

async function loadGrants() {
  if (!scopeId.value.trim()) return;
  loading.value = true;
  listError.value = null;
  try {
    const scope = { type: scopeType.value, id: scopeId.value.trim() };
    grants.value = (await api.grants(scope.type, scope.id)).items;
    if (loaded.value?.type !== scope.type || loaded.value.id !== scope.id) roleFilter.value = '';
    loaded.value = scope;
  } catch (e) {
    listError.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}

// ---- filters
const q = ref('');
const roleFilter = ref('');
const showRevoked = ref(false);
const roleOptions = computed(() => Roles.filter((r) => roleScopeTypes[r].includes(loaded.value?.type ?? scopeType.value)));
const visible = computed(() =>
  grants.value.filter((g) => (showRevoked.value || !g.revokedAt) && (!roleFilter.value || g.role === roleFilter.value) && (!q.value.trim() || g.principalId.includes(q.value.trim()))),
);
const isOwnTop = (g: Grant) => g.principalId === myId.value && (g.role === 'organizer' || g.role === 'platform_admin');
const roleTone = (r: string) => (r === 'organizer' || r === 'platform_admin' ? 'green' : 'neutral');

// ---- create
const createOpen = ref(false);
const principalId = ref('');
const role = ref<Role | ''>('');
const expiresAt = ref<string | null>(null);
const reason = ref('');
const busy = ref(false);
const submitted = ref(false);
function openCreate() {
  principalId.value = ''; role.value = ''; expiresAt.value = null; reason.value = ''; submitted.value = false;
  createOpen.value = true;
}
async function create() {
  submitted.value = true;
  if (!loaded.value || !principalId.value.trim() || !role.value) return;
  if (grants.value.some((g) => !g.revokedAt && g.principalId === principalId.value.trim() && g.role === role.value)) {
    push({ tone: 'danger', message: t('oa.duplicate') });
    return;
  }
  busy.value = true;
  try {
    await api.createGrant({
      principalId: principalId.value.trim(),
      role: role.value,
      scope: loaded.value,
      expiresAt: expiresAt.value ? new Date(expiresAt.value).toISOString() : null,
      reason: reason.value.trim() || null,
    });
    push({ tone: 'success', message: t('org.access.created') });
    createOpen.value = false;
    await loadGrants();
  } catch (e) {
    push({ tone: 'danger', message: toClientError(e).message });
  } finally {
    busy.value = false;
  }
}

// ---- revoke
const revoking = ref<Grant | null>(null);
async function confirmRevoke(r: string) {
  const g = revoking.value;
  if (!g) return;
  busy.value = true;
  try {
    await api.revokeGrant(g.id, r.trim());
    push({ tone: 'success', message: t('org.access.revoked') });
    revoking.value = null;
    await loadGrants();
  } catch (e) {
    push({ tone: 'danger', message: toClientError(e).message });
  } finally {
    busy.value = false;
  }
}

const cols = computed<QDataTableColumn<Grant>[]>(() => [
  { key: 'principalId', header: t('oa.person') },
  { key: 'role', header: t('org.access.role') },
  { key: 'grantedBy', header: t('org.access.by') },
  { key: 'grantedAt', header: t('oa.date') },
  { key: 'expiresAt', header: t('account.expiresAt') },
]);
</script>

<template>
  <QContainer>
    <div class="k-stack p-oa">
      <QPageHeader compact :title="t('oa.title')" :description="t('oa.lead')" :breadcrumb="[{ label: t('oa.crumb'), href: '/organizer' }, { label: t('org.access.title') }]">
        <template #actions><QButton size="sm" icon="plus" :disabled="!loaded || !!listError" @click="openCreate">{{ t('oa.add') }}</QButton></template>
      </QPageHeader>

      <QCard>
        <form class="p-oa-scope" novalidate @submit.prevent="loadGrants">
          <QSelect id="a-type" v-model="scopeType" :label="t('org.access.scopeType')" :options="scopeTypes" />
          <QTextField id="a-scope" v-model="scopeId" :label="t('org.access.scopeId')" required ltr />
          <QButton type="submit" variant="secondary" :loading="loading" :disabled="!scopeId.trim()">{{ t('org.access.load') }}</QButton>
        </form>
      </QCard>

      <QEmptyState v-if="!loaded && !loading && !listError" compact icon="lock" :title="t('org.access.pickScope')" />
      <QDataState v-else-if="loading && !loaded" state="loading" skeleton="rows" />
      <QDataState v-else-if="listError" state="error" :error="listError" @retry="loadGrants" />
      <template v-else-if="loaded">
        <div class="p-oa-filters">
          <QSearchField id="a-q" v-model="q" :label="t('oa.search')" :placeholder="t('oa.search')" />
          <QSelect id="a-role" v-model="roleFilter" hide-label :label="t('org.access.role')" :options="[{ value: '', label: t('oa.allRoles') }, ...roleOptions.map((r) => ({ value: r, label: r }))]" />
          <QSwitch id="a-rev" v-model="showRevoked" :label="t('oa.showRevoked')" />
        </div>
        <QEmptyState v-if="!grants.filter((g) => !g.revokedAt).length && !showRevoked" icon="lock" :title="t('oa.empty')" :description="t('oa.emptyBody')">
          <template #action><QButton variant="green" icon="plus" @click="openCreate">{{ t('oa.add') }}</QButton></template>
        </QEmptyState>
        <QEmptyState v-else-if="!visible.length" compact icon="search" :title="t('oa.filteredEmpty')" />
        <QDataTable v-else :caption="`${loaded.type}:${loaded.id}`" row-key="id" row-header="principalId" :columns="cols" :rows="visible">
          <template #toolbar>{{ t('oa.count', { n: fa(visible.length) }) }}</template>
          <template #cell-principalId="{ row }">
            <span><code class="q-mono q-ltr">{{ row.principalId }}</code><span v-if="row.principalId === myId" class="p-oa-muted"> {{ t('oa.you') }}</span></span>
          </template>
          <template #cell-role="{ row }"><QBadge :tone="roleTone(row.role)"><bdi class="q-ltr">{{ row.role }}</bdi></QBadge></template>
          <template #cell-grantedBy="{ row }"><code class="q-mono q-ltr">{{ row.grantedBy }}</code></template>
          <template #cell-grantedAt="{ row }">{{ row.grantedAt ? formatJalali(row.grantedAt, 'date') : '—' }}</template>
          <template #cell-expiresAt="{ row }">
            <QBadge v-if="row.revokedAt" tone="danger">{{ t('oa.revokedTag') }}</QBadge>
            <span v-else-if="row.expiresAt">{{ formatJalali(row.expiresAt) }}</span>
            <span v-else class="p-oa-muted">{{ t('account.never') }}</span>
          </template>
          <template #row-actions="{ row }">
            <QButton v-if="!row.revokedAt" size="sm" variant="danger" :disabled="isOwnTop(row)" :title="isOwnTop(row) ? t('oa.selfLock') : undefined" @click="revoking = row">{{ t('org.access.revoke') }}</QButton>
          </template>
        </QDataTable>
      </template>
    </div>

    <QDialog :open="createOpen" size="md" :title="t('org.access.create')" @close="createOpen = false">
      <form id="oa-create" class="k-stack" novalidate @submit.prevent="create">
        <QTextField id="c-pid" v-model="principalId" :label="t('org.access.principalId')" required ltr :error="submitted && !principalId.trim() ? t('common.required') : ''" />
        <QSelect id="c-role" v-model="role" :label="t('org.access.role')" required :placeholder="'—'" :options="roleOptions.map((r) => ({ value: r, label: r }))" :error="submitted && !role ? t('common.required') : ''" />
        <QDateField id="c-exp" v-model="expiresAt" :label="t('org.access.expiresAt')" with-time disable-past />
        <QTextField id="c-reason" v-model="reason" :label="t('org.access.reason')" :max-length="500" />
      </form>
      <template #footer>
        <QButton variant="secondary" @click="createOpen = false">{{ t('common.cancel') }}</QButton>
        <QButton type="submit" form="oa-create" :loading="busy">{{ t('org.access.submit') }}</QButton>
      </template>
    </QDialog>

    <QConfirmDialog
      :open="!!revoking" require-reason :min-reason-length="5" :reason-label="t('org.access.revokeReason')" :loading="busy"
      :title="t('oa.revokeTitle', { name: revoking?.principalId ?? '' })" :message="revoking ? `${revoking.role} · ${revoking.scope.type}:${revoking.scope.id}` : ''"
      :confirm-label="t('org.access.revoke')" :cancel-label="t('common.cancel')"
      @close="revoking = null" @confirm="confirmRevoke"
    />
  </QContainer>
</template>

<style scoped>
.p-oa-scope { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: var(--space-4); align-items: end; }
.p-oa-filters { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
.p-oa-filters > :first-child { flex: 1 1 240px; }
.p-oa-muted { color: var(--ink-muted); font-size: 13px; }
</style>
