<script setup lang="ts">
import CareerPanel from '../components/CareerPanel.vue';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { TeamRoles } from '@esp/contracts';
import type { ApiClientError } from '../api/client';
import { esp02, type TeamPage } from '../api/esp02';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import TeamManagePanel from '../components/TeamManagePanel.vue';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { session } from '../session';

/** TEAM-001/003/004/006/007: public team page; management actions are shown to members and enforced by the server. */
const route = useRoute();
const team = ref<TeamPage | null>(null);
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
const actionError = ref<ApiClientError | null>(null);
const notice = ref('');

async function load() {
  loading.value = true;
  error.value = null;
  try {
    team.value = await esp02.team(String(route.params['id']));
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
watch(() => route.params['id'], () => void load(), { immediate: true });

const me = computed(() => session.me?.principal.id ?? null);
const myRow = computed(() => team.value?.currentMembers.find((m) => m.principalId === me.value) ?? null);
const canManage = computed(() => !!myRow.value && ['owner', 'manager', 'captain'].includes(myRow.value.role));
const inviteRoles = TeamRoles.filter((r) => r !== 'owner');

const invitee = ref('');
const role = ref<string>('player');
async function act(fn: () => Promise<unknown>, ok = '') {
  actionError.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = ok;
    await load();
  } catch (e) {
    actionError.value = toClientError(e);
  }
}
const invite = () => act(() => esp02.invite(String(route.params['id']), invitee.value.trim(), role.value), t('teams.invited'));
const kickReason = ref('');
const kick = (pid: string) => act(() => esp02.kick(String(route.params['id']), pid, kickReason.value || ''));
const leave = () => act(() => esp02.leaveTeam(String(route.params['id'])));
const joinRole = ref('player');
const requestJoin = () => act(() => esp02.joinRequest(String(route.params['id']), joinRole.value, null), t('mgmt.requested'));
</script>

<template>
  <DataState :loading="loading" :error="error" @retry="load">
    <template v-if="team">
      <PageHeader :title="team.name">
        <template #title><bdi>{{ team.name }}</bdi> <bdi class="ltr tag">[{{ team.tag }}]</bdi></template>
        <template v-if="myRow && myRow.role !== 'owner'" #actions><button type="button" class="btn" @click="leave">{{ t('teams.leave') }}</button></template>
      </PageHeader>
      <ErrorNote :error="actionError" />
      <p v-if="notice" role="status" class="ok">{{ notice }}</p>
      <p class="muted"><bdi class="ltr">{{ team.gameId }}</bdi><span v-if="team.city"> · <bdi>{{ team.city }}</bdi></span></p>
      <p v-if="team.description" dir="auto">{{ team.description }}</p>

      <section class="card stack" aria-labelledby="m-h">
        <h2 id="m-h">{{ t('teams.members') }}</h2>
        <ul class="list">
          <li v-for="m in team.currentMembers" :key="m.principalId" class="row">
            <RouterLink :to="`/players/${encodeURIComponent(m.nickname)}`"><bdi>{{ m.nickname }}</bdi></RouterLink>
            <span>{{ t(`role.${m.role}` as MessageKey) }}</span>
            <span class="muted"><JalaliDate :iso="m.from" /></span>
            <button v-if="canManage && m.role !== 'owner' && m.principalId !== me" type="button" class="btn btn-sm btn-danger" @click="kick(m.principalId)">{{ t('teams.kick') }}</button>
          </li>
        </ul>
        <FormField v-if="canManage" id="kick-reason" :label="t('teams.kickReason')"><template #default="{ id }"><input :id="id" v-model="kickReason" class="input" dir="auto" /></template></FormField>
      </section>

      <section v-if="canManage" class="card block" aria-labelledby="i-h">
        <h2 id="i-h">{{ t('teams.invite') }}</h2>
        <form class="row" novalidate @submit.prevent="invite">
          <FormField id="inv-p" :label="t('teams.invitePrincipal')"><template #default="{ id }"><input :id="id" v-model="invitee" class="input ltr" /></template></FormField>
          <FormField id="inv-r" :label="t('teams.role')">
            <template #default="{ id }"><select :id="id" v-model="role" class="input"><option v-for="r in inviteRoles" :key="r" :value="r">{{ t(`role.${r}` as MessageKey) }}</option></select></template>
          </FormField>
          <button type="submit" class="btn btn-primary" :disabled="!invitee.trim()">{{ t('teams.invite') }}</button>
        </form>
      </section>

      <TeamManagePanel v-if="canManage && myRow && me" :team="team" :my-role="myRow.role" :me="me" @changed="load" />

      <section v-if="session.me && !myRow" class="card block">
        <form class="row" novalidate @submit.prevent="requestJoin">
          <FormField id="join-role" :label="t('teams.role')">
            <template #default="{ id }"><select :id="id" v-model="joinRole" class="input"><option v-for="r in ['player', 'substitute', 'captain', 'coach', 'analyst']" :key="r" :value="r">{{ t(`role.${r}` as MessageKey) }}</option></select></template>
          </FormField>
          <button type="submit" class="btn">{{ t('mgmt.requestJoin') }}</button>
        </form>
      </section>

      <CareerPanel class="block" kind="team" :id="team.id" />
      <section v-if="team.pastMembers.length" class="card stack block" aria-labelledby="p-h">
        <h2 id="p-h">{{ t('teams.pastMembers') }}</h2>
        <ul class="list"><li v-for="m in team.pastMembers" :key="m.principalId"><bdi>{{ m.nickname }}</bdi> — {{ t(`role.${m.role}` as MessageKey) }}</li></ul>
      </section>

      <section v-if="team.nameHistory.length > 1" class="card stack block" aria-labelledby="h-h">
        <h2 id="h-h">{{ t('teams.nameHistory') }}</h2>
        <ul class="list"><li v-for="h in team.nameHistory" :key="h.from"><bdi>{{ h.name }}</bdi> <bdi class="ltr">[{{ h.tag }}]</bdi> — <JalaliDate :iso="h.from" /></li></ul>
      </section>

      <section class="card block"><p class="muted">{{ t('teams.noResults') }}</p></section>
    </template>
  </DataState>
</template>

<style scoped>
.block { margin-block-start: var(--sp-6); }
.list { margin: 0; padding-inline-start: var(--sp-5); display: grid; gap: var(--sp-2); }
.row { flex-wrap: wrap; gap: var(--sp-3); align-items: center; }
form.row { align-items: flex-end; }
.tag { color: var(--text-muted); font-size: var(--fs-md); }
.ok { color: var(--accent-strong); }
</style>
