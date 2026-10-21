<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Grant, Session } from '@esp/contracts';
import { api, type ApiClientError } from '../api/client';
import Icon from '../components/Icon.vue';
import DataState from '../components/DataState.vue';
import DataTable from '../components/DataTable.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { resetSession, session } from '../session';
import { useLoad } from '../useLoad';

const router = useRouter();
const sessions = useLoad(() => api.sessions());
const actionError = ref<ApiClientError | null>(null);
const busyId = ref<string | null>(null);

async function revoke(id: string) {
  busyId.value = id;
  actionError.value = null;
  try {
    await api.revokeSession(id);
    await sessions.load();
  } catch (e) {
    actionError.value = toClientError(e);
  } finally {
    busyId.value = null;
  }
}
async function logout() {
  actionError.value = null;
  try {
    await api.logout();
    resetSession();
    await router.push('/');
  } catch (e) {
    actionError.value = toClientError(e);
  }
}

const grantCols = () => [
  { key: 'role', label: t('account.role') },
  { key: 'scope', label: t('account.scope') },
  { key: 'expiresAt', label: t('account.expiresAt') },
];
const sessionCols = () => [
  { key: 'createdAt', label: t('account.createdAt') },
  { key: 'lastSeenAt', label: t('account.lastSeen') },
  { key: 'userAgent', label: 'User-Agent' },
  { key: 'actions', label: '' },
];
</script>

<template>
  <PageHeader :title="t('account.title')">
    <template #actions><button type="button" class="btn" @click="logout">{{ t('account.logout') }}</button></template>
  </PageHeader>
  <ErrorNote :error="actionError" />

  <template v-if="session.me">
    <nav class="account-shortcuts" :aria-label="t('home.discover')"><RouterLink to="/account/registrations" class="card"><Icon name="trophy" :size="24" />{{ t('reg.mine') }}<Icon name="forward" :size="16" /></RouterLink><RouterLink to="/teams" class="card"><Icon name="users" :size="24" />{{ t('nav.myTeams') }}<Icon name="forward" :size="16" /></RouterLink><RouterLink to="/account/calendar" class="card"><Icon name="calendar" :size="24" />{{ t('cal.title') }}<Icon name="forward" :size="16" /></RouterLink></nav>
    <section class="card" aria-labelledby="who-h">
      <h2 id="who-h">{{ t('account.principal') }}</h2>
      <dl class="meta">
        <div><dt>{{ t('account.name') }}</dt><dd><bdi>{{ session.me.principal.displayName }}</bdi></dd></div>
        <div><dt>{{ t('account.id') }}</dt><dd><code>{{ session.me.principal.id }}</code></dd></div>
        <div><dt>{{ t('account.kind') }}</dt><dd><bdi class="ltr">{{ session.me.principal.kind }}</bdi></dd></div>
      </dl>
    </section>

    <section class="block" aria-labelledby="grants-h">
      <h2 id="grants-h">{{ t('account.grants') }}</h2>
      <DataState :empty="session.me.grants.length === 0">
        <template #empty><p>{{ t('account.noGrants') }}</p></template>
        <DataTable :caption="t('account.grants')" :columns="grantCols()" :rows="session.me.grants" row-key="id" row-header="role">
          <template #cell-role="{ row }"><bdi class="ltr">{{ (row as Grant).role }}</bdi></template>
          <template #cell-scope="{ row }"><bdi class="ltr">{{ (row as Grant).scope.type }}:{{ (row as Grant).scope.id }}</bdi></template>
          <template #cell-expiresAt="{ row }">
            <JalaliDate v-if="(row as Grant).expiresAt" :iso="(row as Grant).expiresAt" />
            <span v-else class="muted">{{ t('account.never') }}</span>
          </template>
        </DataTable>
      </DataState>
    </section>

    <section class="block" aria-labelledby="sess-h">
      <h2 id="sess-h">{{ t('account.sessions') }}</h2>
      <DataState :loading="sessions.loading.value" :error="sessions.error.value" :empty="!!sessions.data.value && sessions.data.value.items.length === 0" @retry="sessions.load">
        <DataTable v-if="sessions.data.value" :caption="t('account.sessions')" :columns="sessionCols()" :rows="sessions.data.value.items" row-key="id" row-header="createdAt">
          <template #cell-createdAt="{ row }">
            <JalaliDate :iso="(row as Session).createdAt" />
            <strong v-if="(row as Session).current" class="cur"> ({{ t('account.current') }})</strong>
          </template>
          <template #cell-lastSeenAt="{ row }"><JalaliDate :iso="(row as Session).lastSeenAt" /></template>
          <template #cell-userAgent="{ row }"><bdi class="ltr ua">{{ (row as Session).userAgent ?? '—' }}</bdi></template>
          <template #cell-actions="{ row }">
            <button type="button" class="btn btn-sm btn-danger" :disabled="busyId === (row as Session).id" @click="revoke((row as Session).id)">{{ t('account.revoke') }}</button>
          </template>
        </DataTable>
      </DataState>
    </section>
  </template>
</template>

<style scoped>
.account-shortcuts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: var(--sp-4); margin-block-end: var(--sp-5); }
.account-shortcuts a { display: flex; align-items: center; gap: var(--sp-3); text-decoration: none; color: var(--text); font-weight: 600; }
.account-shortcuts svg { color: var(--accent); }
.account-shortcuts svg:last-child { margin-inline-start: auto; }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--sp-4); margin: 0; }
dt { color: var(--text-muted); font-size: var(--fs-sm); }
dd { margin: 0; font-weight: 600; }
.block { margin-block-start: var(--sp-6); }
.cur { color: var(--accent-strong); }
.ua { max-inline-size: 22rem; overflow-wrap: anywhere; font-size: var(--fs-xs); }
</style>
