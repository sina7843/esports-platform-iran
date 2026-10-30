<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { QAlert, QButton, QCard, QContainer, QDataState, QEmptyState, QPageHeader, QSection, QStatusBadge, QTeamCard, QTextField, formatJalali } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp02 } from '../api/esp02';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { useDataState } from '../useDataState';
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
const ds = useDataState({ loading: computed(() => teams.loading.value && !teams.data.value), error: teams.error });
const pendingInvites = computed(() => (invites.data.value?.items ?? []).filter((i) => i.state === 'pending'));
const pendingTransfers = computed(() => (transfers.data.value?.items ?? []).filter((x) => x.state === 'pending'));
const req = (v: string) => (touched.value && !v.trim() ? t('common.required') : undefined);
</script>

<template>
  <QContainer>
    <div class="k-stack p-myteams">
      <QPageHeader compact :title="t('teams.title')" :description="t('mt.desc')">
        <template #actions><QButton variant="secondary" icon="plus" href="#new">{{ t('teams.create') }}</QButton></template>
      </QPageHeader>
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>

      <QSection v-if="pendingInvites.length" id="invites" small :title="t('teams.invitations')">
        <QCard>
          <ul class="p-myteams-rows">
            <li v-for="i in pendingInvites" :key="i.id">
              <span><RouterLink :to="`/teams/${i.teamId}`"><bdi class="q-ltr">{{ i.teamId }}</bdi></RouterLink> · {{ t(`role.${i.role}` as MessageKey) }}</span>
              <span class="p-myteams-muted">{{ formatJalali(i.expiresAt) }}</span>
              <span class="k-row">
                <QButton size="sm" variant="primary" @click="decide(i.id, 'accept')">{{ t('teams.accept') }}</QButton>
                <QButton size="sm" variant="secondary" @click="decide(i.id, 'decline')">{{ t('teams.decline') }}</QButton>
              </span>
            </li>
          </ul>
        </QCard>
      </QSection>

      <QSection id="mine" small :title="t('teams.title')">
        <QDataState v-if="ds.state.value !== 'content'" v-bind="ds.props.value" skeleton="cards" @retry="teams.load" />
        <QEmptyState v-else-if="!teams.data.value?.items.length" compact icon="users" :title="t('mt.none')">
          <template #action><QButton variant="secondary" href="/recruitment">{{ t('mt.find') }}</QButton></template>
        </QEmptyState>
        <div v-else class="k-grid">
          <QTeamCard
            v-for="tm in teams.data.value.items" :key="tm.teamId" :name="tm.name" :tag="tm.tag" :initial="Array.from(tm.name)[0]"
            :games="tm.gameId ? [tm.gameId] : undefined" :href="`/teams/${tm.teamId}`" :footer="t(`role.${tm.role}` as MessageKey)" :on-follow-change="false"
          />
        </div>
      </QSection>

      <div class="p-myteams-two">
        <QSection id="transfers" small :title="t('mgmt.transfers')">
          <QCard>
            <p v-if="!pendingTransfers.length" class="p-myteams-muted">—</p>
            <ul v-else class="p-myteams-rows">
              <li v-for="tr in pendingTransfers" :key="tr.id">
                <RouterLink :to="`/teams/${tr.targetId}`"><bdi class="q-ltr">{{ tr.targetId }}</bdi></RouterLink>
                <span class="p-myteams-muted">{{ t('mgmt.responsibilities', { r: tr.responsibilities.activeRegistrations, o: tr.responsibilities.openObligations }) }}</span>
                <span v-if="session.me && tr.toPrincipalId === session.me.principal.id" class="k-row">
                  <QButton size="sm" variant="primary" @click="transferAct(tr.id, 'accept')">{{ t('mgmt.acceptTransfer') }}</QButton>
                  <QButton size="sm" variant="secondary" @click="transferAct(tr.id, 'decline')">{{ t('teams.decline') }}</QButton>
                </span>
              </li>
            </ul>
          </QCard>
        </QSection>
        <QSection id="applications" small :title="t('mgmt.myApplications')">
          <QCard>
            <p v-if="!applications.data.value?.items.length" class="p-myteams-muted">—</p>
            <ul v-else class="p-myteams-rows">
              <li v-for="a in applications.data.value.items" :key="a.id">
                <bdi class="q-ltr">{{ a.adId }}</bdi><QStatusBadge :state="a.state" />
                <QButton v-if="!['accepted', 'rejected', 'withdrawn'].includes(a.state)" size="sm" variant="secondary" @click="withdraw(a.id)">{{ t('mgmt.withdraw') }}</QButton>
              </li>
            </ul>
          </QCard>
        </QSection>
      </div>

      <QSection id="new" small :title="t('teams.create')">
        <QCard>
          <form class="p-myteams-form" novalidate @submit.prevent="create">
            <QTextField id="t-name" v-model="form.name" :label="t('teams.name')" required :error="req(form.name)" />
            <QTextField id="t-tag" v-model="form.tag" :label="t('teams.tag')" required ltr :max-length="6" :error="req(form.tag)" />
            <QTextField id="t-game" v-model="form.gameId" :label="t('teams.gameId')" required ltr :error="req(form.gameId)" />
            <QTextField id="t-org" v-model="form.organizationId" :label="t('teams.orgId')" ltr />
            <QTextField id="t-city" v-model="form.city" :label="t('profile.city')" />
            <div class="p-myteams-span"><QButton type="submit" variant="primary" icon="plus" :loading="busy">{{ t('teams.create') }}</QButton></div>
          </form>
        </QCard>
      </QSection>
    </div>
  </QContainer>
</template>

<style scoped>
.p-myteams { gap: var(--space-7); }
.p-myteams-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-myteams-rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.p-myteams-rows li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); padding-block: var(--space-3); border-block-end: 1px solid var(--line); font-size: 14px; }
.p-myteams-rows li:last-child { border-block-end: 0; }
.p-myteams-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-6); align-items: start; }
.p-myteams-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: var(--space-4); }
.p-myteams-span { grid-column: 1 / -1; }
@media (max-width: 900px) { .p-myteams-two { grid-template-columns: minmax(0, 1fr); } }
</style>
