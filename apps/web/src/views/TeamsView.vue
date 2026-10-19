<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp02 } from '../api/esp02';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { useLoad } from '../useLoad';
import { session } from '../session';

/** TEAM-001/002/003: my teams, team creation and pending invitations (membership starts only on acceptance). */
const router = useRouter();
const teams = useLoad(() => esp02.myTeams());
const invites = useLoad(() => esp02.myInvitations());
const transfers = useLoad(() => esp02.myTransfers());
const applications = useLoad(() => esp02.myApplications());
async function transferAct(id: string, action: 'accept' | 'decline') {
  failure.value = null;
  try {
    if (action === 'accept') await esp02.acceptTransfer(id); // TEAM-005: explicit acceptance of responsibilities
    else await esp02.transferAction(id, 'decline');
    await Promise.all([transfers.load(), teams.load()]);
  } catch (e) {
    failure.value = toClientError(e);
  }
}
async function withdraw(id: string) {
  failure.value = null;
  try {
    await esp02.withdrawApplication(id);
    await applications.load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const failure = ref<ApiClientError | null>(null);
const busy = ref(false);
const form = ref({ name: '', tag: '', gameId: '', organizationId: '', city: '' });
const touched = ref(false);

async function create() {
  touched.value = true;
  const f = form.value;
  if (!f.name.trim() || !f.tag.trim() || !f.gameId.trim()) return;
  busy.value = true;
  failure.value = null;
  try {
    const team = await esp02.createTeam({ name: f.name.trim(), tag: f.tag.trim(), gameId: f.gameId.trim(), organizationId: f.organizationId.trim() || null, city: f.city.trim() || null });
    await router.push(`/teams/${team.id}`);
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}

async function decide(id: string, action: 'accept' | 'decline') {
  failure.value = null;
  try {
    await esp02.invitationAction(id, action);
    await Promise.all([invites.load(), teams.load()]);
  } catch (e) {
    failure.value = toClientError(e);
  }
}
</script>

<template>
  <PageHeader :title="t('teams.title')" />
  <ErrorNote :error="failure" />

  <section class="card stack" aria-labelledby="my-h">
    <h2 id="my-h">{{ t('teams.title') }}</h2>
    <DataState :loading="teams.loading.value" :error="teams.error.value" :empty="!!teams.data.value && teams.data.value.items.length === 0" @retry="teams.load">
      <ul v-if="teams.data.value" class="list">
        <li v-for="tm in teams.data.value.items" :key="tm.teamId">
          <RouterLink :to="`/teams/${tm.teamId}`"><bdi>{{ tm.name }}</bdi> <bdi class="ltr">[{{ tm.tag }}]</bdi></RouterLink>
          — {{ t(`role.${tm.role}` as MessageKey) }}
        </li>
      </ul>
    </DataState>
  </section>

  <section class="card stack block" aria-labelledby="inv-h">
    <h2 id="inv-h">{{ t('teams.invitations') }}</h2>
    <DataState :loading="invites.loading.value" :error="invites.error.value" :empty="!!invites.data.value && invites.data.value.items.filter((i) => i.state === 'pending').length === 0" @retry="invites.load">
      <ul v-if="invites.data.value" class="list">
        <li v-for="i in invites.data.value.items.filter((x) => x.state === 'pending')" :key="i.id" class="row">
          <RouterLink :to="`/teams/${i.teamId}`"><bdi class="ltr">{{ i.teamId }}</bdi></RouterLink>
          <span>{{ t(`role.${i.role}` as MessageKey) }}</span>
          <span class="muted"><JalaliDate :iso="i.expiresAt" /></span>
          <button type="button" class="btn btn-sm btn-primary" @click="decide(i.id, 'accept')">{{ t('teams.accept') }}</button>
          <button type="button" class="btn btn-sm" @click="decide(i.id, 'decline')">{{ t('teams.decline') }}</button>
        </li>
      </ul>
    </DataState>
  </section>

  <section class="card stack block" aria-labelledby="tr-h">
    <h2 id="tr-h">{{ t('mgmt.transfers') }}</h2>
    <DataState :loading="transfers.loading.value" :error="transfers.error.value" :empty="!!transfers.data.value && transfers.data.value.items.filter((x) => x.state === 'pending').length === 0" @retry="transfers.load">
      <ul v-if="transfers.data.value" class="list">
        <li v-for="tr in transfers.data.value.items.filter((x) => x.state === 'pending')" :key="tr.id" class="row">
          <RouterLink :to="`/teams/${tr.targetId}`"><bdi class="ltr">{{ tr.targetId }}</bdi></RouterLink>
          <span class="muted">{{ t('mgmt.responsibilities', { r: tr.responsibilities.activeRegistrations, o: tr.responsibilities.openObligations }) }}</span>
          <template v-if="session.me && tr.toPrincipalId === session.me.principal.id">
            <button type="button" class="btn btn-sm btn-primary" @click="transferAct(tr.id, 'accept')">{{ t('mgmt.acceptTransfer') }}</button>
            <button type="button" class="btn btn-sm" @click="transferAct(tr.id, 'decline')">{{ t('teams.decline') }}</button>
          </template>
        </li>
      </ul>
    </DataState>
  </section>

  <section class="card stack block" aria-labelledby="ap-h">
    <h2 id="ap-h">{{ t('mgmt.myApplications') }}</h2>
    <DataState :loading="applications.loading.value" :error="applications.error.value" :empty="!!applications.data.value && applications.data.value.items.length === 0" @retry="applications.load">
      <ul v-if="applications.data.value" class="list">
        <li v-for="a in applications.data.value.items" :key="a.id" class="row">
          <bdi class="ltr">{{ a.adId }}</bdi> · {{ a.state }}
          <button v-if="!['accepted', 'rejected', 'withdrawn'].includes(a.state)" type="button" class="btn btn-sm" @click="withdraw(a.id)">{{ t('mgmt.withdraw') }}</button>
        </li>
      </ul>
    </DataState>
  </section>

  <form class="card stack block form" novalidate aria-labelledby="new-h" @submit.prevent="create">
    <h2 id="new-h">{{ t('teams.create') }}</h2>
    <FormField id="t-name" :label="t('teams.name')" :error="touched && !form.name.trim() ? t('common.required') : ''" required>
      <template #default="{ id, describedBy }"><input :id="id" v-model="form.name" class="input" dir="auto" :aria-describedby="describedBy" /></template>
    </FormField>
    <FormField id="t-tag" :label="t('teams.tag')" :error="touched && !form.tag.trim() ? t('common.required') : ''" required>
      <template #default="{ id, describedBy }"><input :id="id" v-model="form.tag" class="input ltr" maxlength="6" :aria-describedby="describedBy" /></template>
    </FormField>
    <FormField id="t-game" :label="t('teams.gameId')" :error="touched && !form.gameId.trim() ? t('common.required') : ''" required>
      <template #default="{ id, describedBy }"><input :id="id" v-model="form.gameId" class="input ltr" :aria-describedby="describedBy" /></template>
    </FormField>
    <FormField id="t-org" :label="t('teams.orgId')"><template #default="{ id }"><input :id="id" v-model="form.organizationId" class="input ltr" /></template></FormField>
    <FormField id="t-city" :label="t('profile.city')"><template #default="{ id }"><input :id="id" v-model="form.city" class="input" dir="auto" /></template></FormField>
    <button type="submit" class="btn btn-primary" :disabled="busy">{{ t('teams.create') }}</button>
  </form>
</template>

<style scoped>
.block { margin-block-start: var(--sp-6); }
.list { margin: 0; padding-inline-start: var(--sp-5); display: grid; gap: var(--sp-2); }
.row { flex-wrap: wrap; gap: var(--sp-3); align-items: center; }
.form { max-inline-size: 32rem; }
</style>
