<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { TeamRoles } from '@esp/contracts';
import {
  QAlert, QButton, QCard, QConfirmDialog, QContainer, QDataState, QIcon, QProfileHeader, QRosterList, QSection, QSelect, QStatTile, QTextField, fa, formatJalali, useToast,
} from '@esp/ui';
import { request, type ApiClientError } from '../api/client';
import { esp02, type TeamPage } from '../api/esp02';
import { esp05, type Honor } from '../api/esp05';
import TeamManagePanel from '../components/TeamManagePanel.vue';
import { toClientError } from '../errors';
import { honorLabel, t, type MessageKey } from '../i18n';
import { session } from '../session';
import { useDataState } from '../useDataState';

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
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 4000 }); });
watch(actionError, (e) => { if (e) push({ tone: 'danger', message: e.message }); });
const ds = useDataState({ loading: computed(() => loading.value && !team.value), error });
type Career = { played: number; wins: number; losses: number; draws: number };
const career = ref<Career | null>(null);
const honors = ref<Honor[]>([]);
watch(() => team.value?.id, async (id) => {
  if (!id) return;
  career.value = await request<Career>('GET', `/careers/teams/${encodeURIComponent(id)}`).catch(() => null);
  honors.value = (await esp05.teamHonors(id).catch(() => ({ verified: [] as Honor[] })))?.verified ?? [];
});
const following = ref(false);
async function onFollow(v: boolean) {
  if (!team.value) return;
  try {
    if (v) await esp02.follow('team', team.value.id); else await esp02.unfollow('team', team.value.id);
    following.value = v;
  } catch (e) {
    actionError.value = toClientError(e);
  }
}
const kicking = ref<string | null>(null);
const leaving = ref(false);
const roster = computed(() => (team.value?.currentMembers ?? []).map((m) => ({ id: m.principalId, name: m.nickname, roles: [m.role as never] })));
const roleOptions = (rs: readonly string[]) => rs.map((r) => ({ value: r, label: t(`role.${r}` as MessageKey) }));
const kickable = (id: string | number | undefined) => {
  const m = team.value?.currentMembers.find((x) => x.principalId === id);
  return !!m && canManage.value && m.role !== 'owner' && m.principalId !== me.value;
};
</script>

<template>
  <QContainer>
    <QDataState v-if="ds.state.value !== 'content' || !team" v-bind="ds.props.value" @retry="load" />
    <div v-else class="k-stack p-team">
      <QProfileHeader
        kind="team" :name="team.name" :handle="team.tag" :initial="Array.from(team.name)[0]" :cover-text="team.gameId" :heading-level="1"
        :badges="team.city ? [{ label: team.city, tone: 'neutral', icon: 'map-pin' }] : []" hide-career
        :following="session.me && !myRow ? following : undefined" :on-follow-change="session.me && !myRow ? onFollow : false"
      >
        <template v-if="myRow && myRow.role !== 'owner'" #actions><QButton variant="secondary" icon="logout" @click="leaving = true">{{ t('teams.leave') }}</QButton></template>
      </QProfileHeader>
      <p v-if="team.description" class="p-team-desc" dir="auto">{{ team.description }}</p>

      <div class="p-team-grid">
        <div class="p-team-main">
          <QSection id="members" small :title="t('teams.members')">
            <QRosterList :title="false" :members="roster">
              <template #row-actions="{ member }">
                <QButton v-if="kickable(member.id)" variant="danger" size="sm" @click="kicking = String(member.id)">{{ t('teams.kick') }}</QButton>
              </template>
            </QRosterList>
          </QSection>

          <QSection id="record" small :title="t('tm.record')" :description="t('tm.recordDesc')">
            <div class="p-team-stats">
              <QStatTile :label="t('tm.played')" :value="fa(career?.played ?? 0)" icon="swords" />
              <QStatTile :label="t('tm.wins')" :value="fa(career?.wins ?? 0)" icon="trophy" />
              <QStatTile :label="t('tm.losses')" :value="fa(career?.losses ?? 0)" />
              <QStatTile :label="t('tm.draws')" :value="fa(career?.draws ?? 0)" />
            </div>
            <p v-if="!career?.played && !honors.length" class="p-team-desc">{{ t('teams.noResults') }}</p>
            <ul v-if="honors.length" class="p-team-list">
              <li v-for="h in honors" :key="h.id"><QIcon name="award" :size="18" /><span>{{ honorLabel(h.label) }} · <bdi>{{ h.eventName }}</bdi></span><QButton variant="ghost" size="sm" icon="shield" :href="`/verify/${h.verifyCode}`">{{ t('tm.verify') }}</QButton></li>
            </ul>
          </QSection>

          <QSection v-if="canManage" id="invite" small :title="t('teams.invite')">
            <QCard>
              <form class="p-team-form" novalidate @submit.prevent="invite">
                <QTextField id="inv-p" v-model="invitee" :label="t('teams.invitePrincipal')" ltr />
                <QSelect id="inv-r" v-model="role" :label="t('teams.role')" :options="roleOptions(inviteRoles)" />
                <QButton type="submit" variant="primary" icon="send" :disabled="!invitee.trim()">{{ t('teams.invite') }}</QButton>
              </form>
            </QCard>
          </QSection>
          <!-- LEGACY region: advanced team management (ads, transfers, applications) still uses the old panel -->
          <div v-if="canManage && myRow && me" class="legacy-view"><TeamManagePanel :team="team" :my-role="myRow.role" :me="me" @changed="load" /></div>
        </div>

        <aside class="p-team-side">
          <QCard v-if="session.me && !myRow">
            <form class="k-stack" novalidate @submit.prevent="requestJoin">
              <h2 class="h4 p-team-h">{{ t('mgmt.requestJoin') }}</h2>
              <QSelect id="join-role" v-model="joinRole" :label="t('teams.role')" :options="roleOptions(['player', 'substitute', 'captain', 'coach', 'analyst'])" />
              <div><QButton type="submit" variant="green" icon="send">{{ t('mgmt.requestJoin') }}</QButton></div>
            </form>
          </QCard>
          <QCard v-if="team.pastMembers.length">
            <div class="k-stack">
              <h2 class="h4 p-team-h">{{ t('teams.pastMembers') }}</h2>
              <ul class="p-team-plain"><li v-for="m in team.pastMembers" :key="m.principalId"><bdi>{{ m.nickname }}</bdi> — {{ t(`role.${m.role}` as MessageKey) }}</li></ul>
            </div>
          </QCard>
          <QCard v-if="team.nameHistory.length > 1">
            <div class="k-stack">
              <h2 class="h4 p-team-h">{{ t('teams.nameHistory') }}</h2>
              <ul class="p-team-plain"><li v-for="h in team.nameHistory" :key="h.from"><bdi>{{ h.name }}</bdi> <bdi class="q-ltr">[{{ h.tag }}]</bdi> — {{ formatJalali(h.from, 'date') }}</li></ul>
            </div>
          </QCard>
        </aside>
      </div>
    </div>
    <QConfirmDialog
      :open="!!kicking" require-reason :reason-optional="true" :reason-label="t('teams.kickReason')" :title="t('teams.kick')" :message="t('tm.kickBody')"
      :confirm-label="t('teams.kick')" :cancel-label="t('tm.cancel')" @close="kicking = null"
      @confirm="(r) => { kickReason = r; const id = kicking; kicking = null; if (id) kick(id); }"
    />
    <QConfirmDialog :require-reason="false" :open="leaving" :title="t('teams.leave')" :message="t('tm.leaveBody')" :confirm-label="t('teams.leave')" :cancel-label="t('tm.cancel')" @close="leaving = false" @confirm="leaving = false; leave()" />
  </QContainer>
</template>

<style scoped>
.p-team { gap: var(--space-6); }
.p-team-h { margin: 0; }
.p-team-desc { margin: 0; color: var(--ink-muted); font-size: 15px; line-height: 28px; white-space: pre-line; }
.p-team-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: var(--space-6); align-items: start; }
.p-team-main, .p-team-side { display: flex; flex-direction: column; gap: var(--space-7); min-width: 0; }
.p-team-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
.p-team-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); }
.p-team-list li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-sunken); }
.p-team-list li span { flex: 1; }
.p-team-list .q-icon { color: var(--rank-gold); }
.p-team-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: var(--space-3); align-items: end; }
.p-team-plain { margin: 0; padding-inline-start: var(--space-5); display: flex; flex-direction: column; gap: var(--space-1); font-size: 14px; }
@media (max-width: 960px) { .p-team-grid { grid-template-columns: minmax(0, 1fr); } .p-team-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } .p-team-form { grid-template-columns: minmax(0, 1fr); } }
</style>
