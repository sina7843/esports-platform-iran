<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  QAvatar, QBadge, QButton, QCard, QContainer, QDataState, QDateField, QDialog, QEmptyState, QFilterBar, QIcon, QPageHeader, QRecruitmentCard, QSelect,
  QTabs, QTextField, dateTag, formatJalali, isRtl, useToast,
} from '@esp/ui';
import { esp02, type RecruitmentAd, type Scrim } from '../api/esp02';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { session } from '../session';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/** Spec docs/redesign/03-specs/recruitment.md — REC-001..005 ads, looking-for-team players and scrim requests (friendly, never ranked). */
const { push } = useToast();
const values = ref<Record<string, string>>({ gameId: '', city: '', level: '' });
const query = ref('');
const tab = ref('ads');
const q = () => ({ gameId: values.value.gameId || undefined, city: values.value.city || undefined, level: values.value.level || undefined });
const ads = useLoad(() => esp02.ads(q()));
const players = useLoad(() => esp02.lftPlayers(q()));
const scrims = useLoad(() => esp02.scrims({ gameId: values.value.gameId || undefined, level: values.value.level || undefined }));
watch(values, () => void Promise.all([ads.load(), players.load(), scrims.load()]), { deep: true });
const myTeams = useLoad(() => (session.me ? esp02.myTeams() : Promise.resolve({ items: [] })));

const match = (...s: (string | null | undefined)[]) => {
  const k = query.value.trim().toLowerCase();
  return !k || s.some((x) => (x ?? '').toLowerCase().includes(k));
};
const adList = computed(() => (ads.data.value?.items ?? []).filter((a) => match(a.team.name, a.role, a.kind, a.description)));
const playerList = computed(() => (players.data.value?.items ?? []).filter((p) => match(p.nickname, p.resume)));
const scrimList = computed(() => (scrims.data.value?.items ?? []).filter((s) => match(s.requester.name, s.conditions)));
const seen = computed(() => [...(ads.data.value?.items ?? []), ...(players.data.value?.items ?? [])]);
const games = computed(() => [...new Set([...(ads.data.value?.items ?? []).map((a) => a.gameId), ...(scrims.data.value?.items ?? []).map((s) => s.gameId)])]);
const cities = computed(() => [...new Set(seen.value.map((x) => x.city).filter((c): c is string => !!c))]);
const filters = computed(() => [
  { key: 'gameId', label: t('rec.filterGame'), allLabel: t('rc.allGames'), options: [...new Set([...games.value, values.value.gameId ?? ''])].filter(Boolean).map((g) => ({ value: g, label: g })) },
  { key: 'city', label: t('rec.filterCity'), allLabel: t('rc.allCities'), options: [...new Set([...cities.value, values.value.city ?? ''])].filter(Boolean).map((c) => ({ value: c, label: c })) },
  { key: 'level', label: t('rec.filterLevel'), allLabel: t('rc.allLevels'), options: [{ value: 'amateur', label: t('rc.amateur') }, { value: 'semi_pro', label: t('rc.semi') }, { value: 'pro', label: t('rc.pro') }] },
]);
function clear() {
  values.value = { gameId: '', city: '', level: '' };
  query.value = '';
}
const tabs = computed(() => [
  { key: 'ads', label: t('rec.ads'), icon: 'flag' as const, count: adList.value.length },
  { key: 'players', label: t('rec.players'), icon: 'users' as const, count: playerList.value.length },
  { key: 'scrims', label: t('rec.scrims'), icon: 'swords' as const, count: scrimList.value.length },
]);
const active = computed(() => (tab.value === 'players' ? players : tab.value === 'scrims' ? scrims : ads));
const ds = useDataState({ loading: computed(() => active.value.loading.value && !active.value.data.value), error: computed(() => active.value.error.value) });

const myTeamIds = computed(() => new Set((myTeams.data.value?.items ?? []).map((x) => x.teamId)));
const applied = ref(new Set<string>());
const applying = ref<RecruitmentAd | null>(null);
const message = ref('');
async function sendApply() {
  const ad = applying.value;
  if (!ad) return;
  try {
    await esp02.apply(ad.id, message.value.trim() || null);
    applied.value = new Set([...applied.value, ad.id]);
    push({ tone: 'success', message: t('rc.sent'), duration: 4000 });
    applying.value = null;
    message.value = '';
  } catch (e) {
    push({ tone: 'danger', message: toClientError(e).message });
  }
}
function startApply(ad: RecruitmentAd) {
  if (!session.me) { push({ tone: 'info', message: t('rc.signIn'), duration: 4000 }); return; }
  applying.value = ad;
}

const proposed = ref(new Set<string>());
const proposing = ref<Scrim | null>(null);
const proposeTeam = ref('');
const proposeAt = ref<string | null>(null);
async function sendPropose() {
  const s = proposing.value;
  if (!s || !proposeTeam.value || !proposeAt.value) return;
  try {
    await esp02.proposeScrim(s.id, proposeTeam.value, new Date(proposeAt.value).toISOString()); // REC-004: inside the window (server-checked)
    proposed.value = new Set([...proposed.value, s.id]);
    push({ tone: 'success', message: t('rc.proposedOk'), duration: 4000 });
    proposing.value = null;
  } catch (e) {
    push({ tone: 'danger', message: toClientError(e).message });
  }
}
function startPropose(s: Scrim) {
  if (!session.me) { push({ tone: 'info', message: t('rc.signIn'), duration: 4000 }); return; }
  proposeTeam.value = myTeams.data.value?.items[0]?.teamId ?? '';
  proposeAt.value = null;
  proposing.value = s;
}
const weekday = (iso: string) => new Intl.DateTimeFormat(dateTag(), { timeZone: 'Asia/Tehran', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
const windowText = (s: Scrim) => `${weekday(s.windowStart)} · ${formatJalali(s.windowStart, 'time')}–${formatJalali(s.windowEnd, 'time')}`;
const scrimState = (s: Scrim) => (proposed.value.has(s.id) ? { tone: 'success' as const, label: t('rc.mine') } : s.proposal ? { tone: 'info' as const, label: t('rc.proposed') } : { tone: 'success' as const, label: t('rc.open') });
</script>

<template>
  <QContainer>
    <div class="k-stack p-recruitment">
      <QPageHeader :eyebrow="t('rc.eyebrow')" :title="t('rec.title')" :breadcrumb="[{ label: t('rc.home'), href: '/' }, { label: t('rc.crumb') }]" :description="t('rc.desc')">
        <template v-if="session.me" #actions><QButton variant="secondary" icon="settings" href="/teams">{{ t('rc.manage') }}</QButton></template>
      </QPageHeader>
      <QFilterBar
        v-model:query="query" v-model:values="values" :aria-label="t('rc.filters')" :search-label="t('rc.search')" :search-placeholder="t('rc.searchPh')"
        :filters="filters" :clear-label="t('rc.clear')" @clear="clear"
      />
      <QTabs v-model="tab" :items="tabs" :aria-label="t('rc.tabs')" overflow="scroll" />
      <div class="p-recruitment-panel">
        <QDataState v-if="ds.state.value !== 'content'" v-bind="ds.props.value" skeleton="cards" @retry="active.load" />
        <template v-else-if="tab === 'ads'">
          <QEmptyState v-if="!adList.length" compact icon="flag" :title="t('rc.noAds')" />
          <div v-else class="p-recruitment-grid">
            <QRecruitmentCard
              v-for="a in adList" :key="a.id" :team="{ name: a.team.name, initial: Array.from(a.team.name)[0], logoSrc: a.team.logoUrl ?? undefined, href: `/teams/${encodeURIComponent(a.team.id)}` }"
              :game="a.gameId" :kind="a.kind as never" :role="a.role ?? undefined" :level="a.level ?? undefined" :city="a.city ?? undefined" :activity-hours="a.activityHours ?? undefined"
              :description="a.description" :state="a.state" :posted-at="a.createdAt" :applied="applied.has(a.id)" :apply-label="t('rec.apply')"
              @apply="startApply(a)"
            />
          </div>
        </template>
        <template v-else-if="tab === 'players'">
          <QEmptyState v-if="!playerList.length" compact icon="users" :title="t('rc.noPlayers')" />
          <div v-else class="p-recruitment-grid">
            <QCard v-for="p in playerList" :key="p.id" as="article">
              <div class="p-recruitment-lft">
                <div class="p-recruitment-lft__head">
                  <QAvatar :name="p.nickname" :size="40" />
                  <div class="k-stack p-recruitment-tight">
                    <RouterLink class="p-recruitment-lft__name q-ltr" :to="`/players/${encodeURIComponent(p.nickname)}`">{{ p.nickname }}</RouterLink>
                    <span v-if="p.city" class="p-recruitment-sub"><bdi>{{ p.city }}</bdi></span>
                  </div>
                </div>
                <div v-if="p.games.length" class="p-recruitment-chips">
                  <span v-for="g in p.games" :key="g.gameId" class="p-recruitment-chip q-ltr">{{ g.gameId }}<span v-if="g.declaredLevel">{{ g.declaredLevel }}</span></span>
                </div>
                <p class="p-recruitment-resume" dir="auto">{{ p.resume || t('rc.noResume') }}</p>
                <div><QButton variant="secondary" size="sm" :href="`/players/${encodeURIComponent(p.nickname)}`" :icon-end="isRtl() ? 'arrow-left' : 'arrow-right'">{{ t('rc.playerPage') }}</QButton></div>
              </div>
            </QCard>
          </div>
        </template>
        <template v-else>
          <p class="p-recruitment-note"><QIcon name="info" :size="18" />{{ t('rc.friendlyNote') }}</p>
          <QEmptyState v-if="!scrimList.length" compact icon="swords" :title="t('rc.noScrims')" />
          <ul v-else class="p-recruitment-scrims">
            <li v-for="s in scrimList" :key="s.id" class="p-recruitment-scrim">
              <div class="p-recruitment-scrim__team">
                <QAvatar :name="s.requester.name" :size="40" shape="chamfer" />
                <div class="k-stack p-recruitment-tight">
                  <RouterLink class="p-recruitment-lft__name" :to="`/teams/${encodeURIComponent(s.requester.id)}`"><bdi>{{ s.requester.name }}</bdi></RouterLink>
                  <span class="p-recruitment-sub q-ltr">{{ [s.gameId, s.level, s.server].filter(Boolean).join(' · ') }}</span>
                </div>
              </div>
              <div class="p-recruitment-scrim__when">
                <span class="p-recruitment-time">{{ windowText(s) }}</span>
                <p v-if="s.conditions" class="p-recruitment-cond" dir="auto">{{ s.conditions }}</p>
              </div>
              <div class="p-recruitment-scrim__acts">
                <QBadge :tone="scrimState(s).tone">{{ scrimState(s).label }}</QBadge>
                <QButton v-if="s.state === 'open' && !proposed.has(s.id) && !myTeamIds.has(s.requester.id)" variant="green" size="sm" icon="clock" @click="startPropose(s)">{{ t('rc.propose') }}</QButton>
              </div>
            </li>
          </ul>
        </template>
      </div>
    </div>
    <QDialog :open="!!applying" size="md" icon="send" tone="success" :title="applying ? t('rc.applyTitle', { team: applying.team.name }) : ''" :description="applying ? [applying.kind, applying.role, applying.gameId].filter(Boolean).join(' · ') : ''" @close="applying = null">
      <QTextField v-model="message" multiline :rows="5" :max-length="2000" :label="t('rc.message')" :hint="t('rc.messageHint')" />
      <template #footer>
        <QButton variant="secondary" @click="applying = null">{{ t('rc.cancel') }}</QButton>
        <QButton variant="primary" icon="send" @click="sendApply">{{ t('rc.send') }}</QButton>
      </template>
    </QDialog>
    <QDialog :open="!!proposing" size="md" icon="clock" tone="success" :title="proposing ? t('rc.proposeTitle', { team: proposing.requester.name }) : ''" :description="t('rec.friendly')" @close="proposing = null">
      <div v-if="proposing" class="k-stack">
        <div class="p-recruitment-window">{{ t('rc.windowBox', { when: windowText(proposing) }) }}</div>
        <QSelect v-model="proposeTeam" :label="t('rc.fromTeam')" required :hint="t('rc.fromTeamHint')" :options="(myTeams.data.value?.items ?? []).map((x) => ({ value: x.teamId, label: x.name }))" />
        <QDateField v-model="proposeAt" :label="t('rc.time')" with-time required :min="proposing.windowStart.slice(0, 10)" :max="proposing.windowEnd.slice(0, 10)" />
      </div>
      <template #footer>
        <QButton variant="secondary" @click="proposing = null">{{ t('rc.cancel') }}</QButton>
        <QButton variant="green" icon="clock" :disabled="!proposeTeam || !proposeAt" @click="sendPropose">{{ t('rc.proposeSend') }}</QButton>
      </template>
    </QDialog>
  </QContainer>
</template>

<style scoped>
.p-recruitment { gap: var(--space-6); }
.p-recruitment-tight { gap: 0; }
.p-recruitment-grid { display: grid; gap: var(--space-5); grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); align-items: stretch; }
.p-recruitment-panel { display: flex; flex-direction: column; gap: var(--space-5); }
.p-recruitment-note { display: inline-flex; align-items: center; gap: var(--space-2); margin: 0; font-size: 14px; color: var(--ink-muted); }
.p-recruitment-note .q-icon { color: var(--green-text); }
.p-recruitment-lft { display: flex; flex-direction: column; gap: var(--space-3); block-size: 100%; }
.p-recruitment-lft__head { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.p-recruitment-lft__name { font-weight: 900; font-size: 16px; color: var(--ink); text-decoration: none; }
.p-recruitment-lft__name:hover { color: var(--green-text); }
.p-recruitment-sub { color: var(--ink-subtle); font-size: 13px; }
.p-recruitment-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.p-recruitment-chip { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 28px; padding-inline: var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); font-size: 12px; font-weight: 800; }
.p-recruitment-chip span { color: var(--ink-muted); font-weight: 600; }
.p-recruitment-resume { margin: 0; color: var(--ink-muted); font-size: 14px; line-height: 24px; overflow-wrap: anywhere; flex: 1; }
.p-recruitment-scrims { display: flex; flex-direction: column; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
.p-recruitment-scrim { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1.4fr) auto; gap: var(--space-4); align-items: center; padding: var(--space-4) var(--space-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
.p-recruitment-scrim__team { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.p-recruitment-scrim__when { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; font-size: 14px; }
.p-recruitment-time { font-weight: 800; color: var(--green-text); }
.p-recruitment-scrim__acts { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; justify-content: flex-end; }
.p-recruitment-cond { margin: 0; font-size: 13px; color: var(--ink-muted); overflow-wrap: anywhere; }
.p-recruitment-window { padding: var(--space-3) var(--space-4); border: 1px solid var(--green-line); background: var(--green-soft); border-radius: var(--radius-md); font-size: 14px; }
@media (max-width: 900px) {
  .p-recruitment-scrim { grid-template-columns: minmax(0, 1fr); }
  .p-recruitment-scrim__acts { justify-content: flex-start; }
}
</style>
