<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  QBreadcrumb, QButton, QCard, QConfirmDialog, QContainer, QDataState, QGameIdentity, QIcon, QMatchCard, QProfileHeader, QSection, QStatTile,
  fa, formatJalali, isRtl, useToast,
} from '@esp/ui';
import { request, type ApiClientError } from '../api/client';
import { esp02, type PublicPlayer } from '../api/esp02';
import { esp05, type Declared, type Honor } from '../api/esp05';
import { toClientError } from '../errors';
import { honorLabel, t, type MessageKey } from '../i18n';
import { session } from '../session';
import { useDataState } from '../useDataState';

/** Spec docs/redesign/03-specs/player.md — USR-003..008/011 public profile; the server already removed fields the viewer may not see. */
const route = useRoute();
const router = useRouter();
const { push } = useToast();
type Career = { played: number; wins: number; losses: number; draws: number; items: Array<{ matchId: string; eventName: string; opponent: string; result: string; forfeit: boolean; at: string }> };
const data = ref<PublicPlayer | null>(null);
const career = ref<Career | null>(null);
const honors = ref<{ verified: Honor[]; declared: Declared[] } | null>(null);
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
const following = ref(false);
const blocking = ref(false);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const p = await esp02.player(String(route.params['nickname']));
    data.value = p;
    const [c, h] = await Promise.all([
      request<Career>('GET', `/careers/players/${encodeURIComponent(p.id)}`).catch(() => null),
      esp05.playerHonors(p.id).catch(() => null),
    ]);
    career.value = c;
    honors.value = h;
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
watch(() => route.params['nickname'], () => void load(), { immediate: true });
const ds = useDataState({ loading: computed(() => loading.value && !data.value), error });

const canAct = computed(() => !!session.me && !!data.value && session.me.principal.id !== data.value.id);
async function onFollow(v: boolean) {
  if (!data.value) return;
  try {
    if (v) await esp02.follow('player', data.value.id); else await esp02.unfollow('player', data.value.id);
    following.value = v;
  } catch (e) {
    push({ tone: 'danger', message: toClientError(e).message });
  }
}
async function block() {
  if (!data.value) return;
  try {
    await esp02.block(data.value.id);
    await router.replace('/');
  } catch (e) {
    push({ tone: 'danger', message: toClientError(e).message });
  }
}

type TeamRef = { teamId: string; name: string; role: string };
const teams = computed(() => (data.value?.teams ?? {}) as { current?: TeamRef[]; past?: TeamRef[] });
const current = computed(() => teams.value.current?.[0] ?? null);
const badges = computed(() => {
  const p = data.value;
  if (!p) return [];
  const kinds = new Set(p.badges.map((b) => b.kind));
  return [
    ...(kinds.has('identity') ? [{ label: t('pl.bIdentity'), tone: 'success' as const, icon: 'shield' as const }] : []),
    ...(kinds.has('game_identity') ? [{ label: t('pl.bGameId'), tone: 'success' as const, icon: 'gamepad' as const }] : []),
    ...(kinds.has('org_position') ? [{ label: t('pl.bOrg'), tone: 'success' as const, icon: 'flag' as const }] : []),
    ...(p.lookingForTeam.active ? [{ label: t('pl.lft'), tone: 'green' as const, icon: 'users' as const }] : []),
  ];
});
const roleText = (r: string) => t(`role.${r}` as MessageKey);
const rank = (p: number | null) => (p === 1 || p === 2 || p === 3 ? p : undefined);
</script>

<template>
  <QContainer>
    <QDataState v-if="ds.state.value !== 'content' || !data" v-bind="ds.props.value" @retry="load" />
    <div v-else class="k-stack p-player">
      <QBreadcrumb :items="[{ label: t('pl.home'), href: '/' }, { label: t('pl.recruitment'), href: '/recruitment' }, { label: data.nickname }]" />
      <QProfileHeader
        kind="player" :name="data.nickname" :handle="`@${data.nickname}`" :initial="Array.from(data.nickname)[0]" :avatar-src="data.avatarUrl ?? undefined"
        :cover-text="data.games.map((g) => g.gameId).join(' · ') || undefined" :verified="data.badges.some((b) => b.kind === 'identity')" :verified-label="t('pl.verified')"
        :kind-label="t('pl.kind')" :badges="badges" hide-career :heading-level="1"
        :following="canAct ? following : undefined" :on-follow-change="canAct ? onFollow : false" :follow-label="t('pl.follow')" :following-label="t('pl.following')"
        :menu-items="canAct ? [{ label: t('pl.block'), icon: 'ban', danger: true, onSelect: () => (blocking = true) }] : undefined"
      />
      <div class="p-player-grid">
        <div class="p-player-main">
          <QSection v-if="data.gameIdentities.length" id="ids" small :title="t('pl.ids')">
            <div class="p-player-list">
              <QGameIdentity v-for="g in data.gameIdentities" :key="g.gameId + g.platform" :game="g.gameId" :platform="g.platform" :value="g.value" :state="g.verified ? 'verified' : 'unverified'" :on-edit="false" />
            </div>
          </QSection>
          <QSection v-if="data.games.length" id="games" small :title="t('pl.games')">
            <div class="p-player-games">
              <div v-for="g in data.games" :key="g.gameId" class="p-player-game">
                <span class="p-player-game__name q-ltr">{{ g.gameId }}</span>
                <dl>
                  <dt>{{ t('pl.roles') }}</dt><dd><bdi>{{ g.roles.join(isRtl() ? '، ' : ', ') || '—' }}</bdi></dd>
                  <dt>{{ t('pl.declared') }}</dt><dd><bdi class="q-ltr">{{ g.declaredLevel ?? '—' }}</bdi></dd>
                  <dt>{{ t('pl.verifiedLevel') }}</dt><dd><bdi class="q-ltr">{{ g.verifiedLevel ? `${g.verifiedLevel.value}${g.verifiedLevel.issuer ? ` · ${g.verifiedLevel.issuer}` : ''}` : '—' }}</bdi></dd>
                </dl>
              </div>
            </div>
          </QSection>
          <QSection id="record" small :title="t('pl.record')" :description="t('pl.recordDesc')">
            <div class="p-player-stats">
              <QStatTile :label="t('pl.played')" :value="fa(career?.played ?? 0)" icon="swords" />
              <QStatTile :label="t('pl.wins')" :value="fa(career?.wins ?? 0)" icon="trophy" />
              <QStatTile :label="t('pl.losses')" :value="fa(career?.losses ?? 0)" />
              <QStatTile :label="t('pl.draws')" :value="fa(career?.draws ?? 0)" />
            </div>
            <h3 class="p-player-h3">{{ t('pl.recent') }}</h3>
            <div v-if="career?.items.length" class="p-player-list">
              <QMatchCard
                v-for="m in career.items.slice(0, 5)" :key="m.matchId" state="final" :home="{ name: data.nickname }" :away="{ name: m.opponent, forfeit: m.forfeit }"
                :winner="m.result === 'W' ? 'home' : m.result === 'L' ? 'away' : undefined" :stage="m.eventName" :date="formatJalali(m.at, 'date')" :href="`/matches/${encodeURIComponent(m.matchId)}`"
              />
            </div>
            <p v-else class="p-player-muted">{{ t('pl.noGames') }}</p>
            <template v-if="honors?.verified.length">
              <h3 class="p-player-h3">{{ t('pl.honours') }}</h3>
              <ul class="p-player-list">
                <li v-for="h in honors.verified" :key="h.id" class="p-player-honour">
                  <span :class="['p-player-honour__icon', rank(h.place) ? `p-player-honour__icon--${h.place}` : '']"><QIcon :name="h.place === 1 ? 'trophy' : 'award'" :size="20" /></span>
                  <span><p class="p-player-honour__title">{{ honorLabel(h.label) }} · <bdi>{{ h.eventName }}</bdi></p><p class="p-player-honour__meta">{{ formatJalali(h.issuedAt, 'date') }}</p></span>
                  <QButton variant="ghost" size="sm" icon="shield" :href="`/verify/${h.verifyCode}`">{{ t('pl.verify') }}</QButton>
                </li>
              </ul>
            </template>
            <div v-if="honors?.declared.length" class="p-player-declared">
              <span class="p-player-subtle">{{ t('pl.declaredAch') }}</span>
              <span v-for="d in honors.declared" :key="d.id"><bdi>{{ d.title }}</bdi> · <bdi>{{ d.eventName }}</bdi>{{ d.year ? ` · ${fa(d.year)}` : '' }}</span>
            </div>
          </QSection>
        </div>
        <aside class="p-player-side">
          <QSection id="team" small :title="t('pl.team')">
            <QCard v-if="current">
              <div class="k-stack">
                <RouterLink :to="`/teams/${encodeURIComponent(current.teamId)}`" class="p-player-teamname"><bdi>{{ current.name }}</bdi></RouterLink>
                <span class="p-player-teamrole">{{ t('pl.role', { role: roleText(current.role) }) }}</span>
              </div>
            </QCard>
            <QCard v-else>
              <div class="k-stack">
                <p class="p-player-muted">{{ data.lookingForTeam.active ? t('pl.noTeamLft') : t('pl.noTeam') }}</p>
                <div><QButton variant="green" icon="flag" href="/recruitment">{{ t('pl.ads') }}</QButton></div>
              </div>
            </QCard>
          </QSection>
          <QCard v-if="data.bio || data.links.length || data.realName || data.city">
            <div class="k-stack">
              <h2 class="h4 p-player-h">{{ t('pl.about') }}</h2>
              <p v-if="data.realName" class="p-player-muted"><bdi>{{ data.realName }}</bdi></p>
              <p v-if="data.city || data.province" class="p-player-subtle"><bdi>{{ [data.city, data.province].filter(Boolean).join(isRtl() ? '، ' : ', ') }}</bdi></p>
              <p v-if="data.bio" class="p-player-muted" dir="auto">{{ data.bio }}</p>
              <div v-if="data.links.length" class="p-player-links">
                <a v-for="l in data.links" :key="l.url" class="p-player-link" :href="l.url" rel="noopener noreferrer nofollow" target="_blank"><bdi class="q-ltr">{{ l.label }}</bdi><QIcon name="external" :size="14" /></a>
              </div>
              <span class="p-player-privacy"><QIcon name="lock" :size="16" />{{ t('pl.privacy') }}</span>
            </div>
          </QCard>
          <QCard v-if="teams.past?.length">
            <div class="k-stack">
              <h2 class="h4 p-player-h">{{ t('pl.past') }}</h2>
              <div v-for="p in teams.past" :key="p.teamId" class="p-player-past"><span><bdi>{{ p.name }}</bdi> · {{ roleText(p.role) }}</span></div>
            </div>
          </QCard>
        </aside>
      </div>
    </div>
    <QConfirmDialog :require-reason="false"
      :open="blocking" icon="ban" :title="t('pl.blockTitle', { name: data?.nickname ?? '' })" :message="t('pl.blockBody')"
      :confirm-label="t('pl.blockConfirm')" :cancel-label="t('pl.cancel')" @close="blocking = false" @confirm="block"
    />
  </QContainer>
</template>

<style scoped>
.p-player { gap: var(--space-6); }
.p-player-h { margin: 0; }
.p-player-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: var(--space-6); align-items: start; }
.p-player-main, .p-player-side { display: flex; flex-direction: column; gap: var(--space-8); min-width: 0; }
.p-player-list { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.p-player-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
.p-player-muted { margin: 0; color: var(--ink-muted); font-size: 14px; line-height: 24px; }
.p-player-subtle { color: var(--ink-subtle); font-size: 13px; margin: 0; }
.p-player-h3 { margin: 0; font-size: 16px; line-height: 26px; font-weight: 800; }
.p-player-privacy { display: inline-flex; align-items: center; gap: var(--space-2); font-size: 13px; color: var(--ink-subtle); }
.p-player-privacy .q-icon { color: var(--green-text); }
.p-player-games { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.p-player-game { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-sunken); min-width: 0; }
.p-player-game__name { font-weight: 900; font-size: 15px; }
.p-player-game dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--space-1) var(--space-3); margin: 0; font-size: 13px; }
.p-player-game dt { color: var(--ink-subtle); }
.p-player-game dd { margin: 0; font-weight: 700; }
.p-player-honour { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--space-3); align-items: center; padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-sunken); }
.p-player-honour__icon { display: grid; place-items: center; inline-size: 40px; block-size: 40px; border-radius: var(--radius-sm); background: var(--surface); border: 1px solid var(--line); }
.p-player-honour__icon--1 { color: var(--rank-gold); }
.p-player-honour__icon--2 { color: var(--rank-silver); }
.p-player-honour__icon--3 { color: var(--rank-bronze); }
.p-player-honour__title { margin: 0; font-weight: 800; font-size: 15px; }
.p-player-honour__meta { margin: 0; font-size: 13px; color: var(--ink-muted); }
.p-player-declared { display: flex; flex-direction: column; gap: var(--space-2); padding-block-start: var(--space-3); border-block-start: 1px dashed var(--line-strong); }
.p-player-links { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.p-player-link { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 32px; padding-inline: var(--space-3); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); color: var(--ink); text-decoration: none; font-size: 13px; font-weight: 700; }
.p-player-link:hover { color: var(--green-text); border-color: var(--green-line); }
.p-player-teamname { color: var(--ink); font-weight: 900; font-size: 18px; }
.p-player-teamrole { font-size: 13px; color: var(--ink-muted); }
.p-player-past { display: flex; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; font-size: 14px; }
@media (max-width: 1100px) { .p-player-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 960px) { .p-player-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 640px) {
  .p-player-games { grid-template-columns: minmax(0, 1fr); }
  .p-player-honour { grid-template-columns: auto minmax(0, 1fr); }
  .p-player-honour > :last-child { grid-column: 2; justify-self: start; }
}
</style>
