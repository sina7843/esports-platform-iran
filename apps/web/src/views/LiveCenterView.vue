<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  QAlert, QBadge, QButton, QCard, QContainer, QDataState, QDataTable, QEmptyState, QFacts, QIcon, QLiveDot, QLivePost, QMatchCard, QPageHeader,
  QSection, QSegmentedControl, QSelect, QSwitch, QTabs, QTextField, EVENT_STATUS, MATCH_STATE, fa, formatJalali, statusBadge, useToast,
  type QDataTableColumn,
} from '@esp/ui';
import { api, type ApiClientError } from '../api/client';
import { esp06 as esp06Api, type LiveFilters, type LiveSnapshot, type ProjectedMatch, type PublicPost } from '../api/esp06';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { appendOlder, applyEvents, createFeed, reveal, type FeedState } from '../liveFeed';
import { session } from '../session';
import { setLowData, settings } from '../settings';
import { useDataState } from '../useDataState';

/**
 * LIVE-001..006, CAST-002/005, AUD-002..004 live centre. The default view follows the broadcast (server-side delay);
 * the latest-result view is an explicit, labelled switch that uses separate endpoints — a synced page never calls them.
 * New posts never move a reader who is reading older ones; they are counted and revealed on request.
 */
const esp06: typeof esp06Api = esp06Api;
const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params['id']));
const token = computed(() => (typeof route.query['t'] === 'string' ? route.query['t'] : undefined));
const latest = computed(() => route.query['view'] === 'latest');
const streamId = computed(() => (typeof route.query['stream'] === 'string' ? route.query['stream'] : undefined));
const filters = reactive<LiveFilters>({});
const snap = ref<LiveSnapshot | null>(null);
const feed = ref<FeedState | null>(null);
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
const failure = ref<ApiClientError | null>(null);
const conn = reactive({ state: 'connecting' as 'connecting' | 'live' | 'retrying' | 'offline', lastUpdate: null as string | null, failures: 0 });
const tab = ref<'timeline' | 'schedule' | 'results' | 'bracket' | 'stats' | 'gallery' | 'video'>('timeline');
const tabData = ref<Record<string, unknown> | null>(null);
const timelineEl = ref<HTMLElement | null>(null);
const atTop = ref(true);
const olderCursor = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;

const opts = () => ({ latest: latest.value, streamId: streamId.value, t: token.value, filters: { ...filters } });
async function load() {
  loading.value = !snap.value;
  error.value = null;
  try {
    const s = await esp06.live(id.value, opts());
    snap.value = s;
    feed.value = createFeed(s.timeline.items, s.cursor);
    olderCursor.value = s.timeline.before;
    conn.lastUpdate = s.serverTime;
    if (tab.value !== 'timeline') await loadTab();
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
async function loadTab() {
  if (tab.value === 'timeline') return;
  try {
    tabData.value = await esp06.tab(id.value, tab.value, opts());
  } catch (e) {
    failure.value = toClientError(e);
  }
}
/** Polls the durable feed from the snapshot cursor (gap-free); an expired cursor reloads the snapshot (resync). */
async function tick() {
  if (stopped) return;
  if (snap.value && feed.value && (typeof document === 'undefined' || document.visibilityState !== 'hidden')) {
    try {
      const r = await api.realtimeEvents(feed.value.cursor, snap.value.view.channel);
      if (r.resync) await load();
      else {
        const out = applyEvents(feed.value, r.events, atTop.value);
        feed.value = out.state;
        if (out.refreshMatches) await refreshMatches();
      }
      conn.state = 'live';
      conn.failures = 0;
      conn.lastUpdate = r.serverTime;
    } catch {
      conn.failures++;
      conn.state = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'retrying';
    }
  }
  const base = settings.lowData ? 10_000 : 2_500;
  timer = setTimeout(() => void tick(), Math.min(30_000, base * 2 ** Math.min(conn.failures, 3)));
}
async function refreshMatches() {
  const s = await esp06.live(id.value, opts());
  if (snap.value) Object.assign(snap.value, { now: s.now, next: s.next, results: s.results, streams: s.streams, pinned: s.pinned });
  if (tab.value !== 'timeline') await loadTab();
}
function onScroll() {
  const top = timelineEl.value?.getBoundingClientRect().top ?? 0;
  atTop.value = top > -80;
}
async function showNew() {
  if (!feed.value) return;
  feed.value = reveal(feed.value);
  await nextTick();
  timelineEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  timelineEl.value?.focus();
}
async function older() {
  if (!feed.value || !olderCursor.value) return;
  try {
    const r = await esp06.tab<{ items: PublicPost[]; before: string | null }>(id.value, 'timeline', { ...opts(), before: olderCursor.value });
    feed.value = appendOlder(feed.value, r.items);
    olderCursor.value = r.before;
  } catch (e) {
    failure.value = toClientError(e);
  }
}
function setView(v: 'synced' | 'latest', stream?: string) {
  void router.replace({ query: { ...route.query, view: v === 'latest' ? 'latest' : undefined, stream: v === 'synced' ? (stream ?? streamId.value) : undefined } });
}
const sideNames = (m: ProjectedMatch) => m.sides.map((s) => s.displayName).join(' — ');
const score = (m: ProjectedMatch) => {
  const o = m.outcome;
  if (!o) return '';
  const sc = o.maps ?? o.scores;
  return sc ? `${fa(sc[0])}–${fa(sc[1])}` : o.kind === 'win' ? `${t('live.winner')}: ${m.sides[o.winnerSide ?? 0]?.displayName ?? ''}` : o.kind;
};
// chat (AUD-002)
const chat = reactive({ open: false, items: [] as Array<{ _id: string; nickname: string | null; text: string; removed: boolean; createdAt: string }>, text: '' });
async function loadChat() {
  chat.items = (await esp06.spectatorChat(id.value)).items;
}
async function sendChat() {
  failure.value = null;
  try {
    await esp06.spectatorSend(id.value, chat.text);
    chat.text = '';
    await loadChat();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
async function reportChat(mid: string) {
  try {
    await esp06.report('chat', mid, 'reported from live chat');
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const videoError = ref<Record<string, string>>({});

watch([latest, streamId, () => ({ ...filters })], () => void load(), { deep: true });
watch(tab, () => void loadTab());
onMounted(() => {
  void load().then(() => void tick());
  window.addEventListener('scroll', onScroll, { passive: true });
});
onBeforeUnmount(() => {
  stopped = true;
  clearTimeout(timer);
  window.removeEventListener('scroll', onScroll);
});
const tabs = ['timeline', 'schedule', 'results', 'bracket', 'stats', 'gallery', 'video'] as const;
const { push } = useToast();
watch(failure, (f) => { if (f) push({ tone: 'danger', message: f.message }); });
const ds = useDataState({ loading: computed(() => loading.value && !snap.value), error });
const tabItems = computed(() => tabs.map((k) => ({ key: k, label: t(`live.tab.${k}` as MessageKey) })));
const eventStatus = computed(() => {
  const b = statusBadge(EVENT_STATUS, snap.value?.event.state);
  return { label: b.label, ...b.props, ...(b.props.tone === 'live' ? { dot: true } : {}) };
});
const viewOptions = computed(() => [
  { value: 'synced', label: snap.value?.view.delaySeconds && !latest.value ? `${t('live.synced')} (${t('live.delay', { n: fa(snap.value.view.delaySeconds) })})` : t('live.synced') },
  { value: 'latest', label: t('live.latest') },
]);
const outcomeScore = (m: ProjectedMatch, i: number) => (m.outcome?.maps ?? m.outcome?.scores ?? undefined)?.[i];
const card = (m: ProjectedMatch) => ({
  state: m.state as never, home: { name: m.sides[0]?.displayName, score: outcomeScore(m, 0) }, away: { name: m.sides[1]?.displayName, score: outcomeScore(m, 1) },
  time: m.scheduledAt ? formatJalali(m.scheduledAt, 'time') : undefined, date: m.scheduledAt ? formatJalali(m.scheduledAt, 'dateShort') : undefined,
  href: `/matches/${encodeURIComponent(m.id)}`,
});
const postProps = (p: PublicPost) => ({
  kind: (p.format === 'result' ? 'result' : p.media.length ? 'media' : 'announcement') as 'result' | 'media' | 'announcement',
  time: p.occurredAt, source: p.source, title: p.title, body: p.body, pinned: p.pinned,
  edited: p.edited ? (p.edited.reason ?? t('live.edited')) : undefined, withdrawn: p.withdrawal ? p.withdrawal.reason : undefined,
  mediaCount: p.media.length || undefined, lowData: settings.lowData,
});
const filterSel = (k: keyof LiveFilters) => computed({
  get: () => (filters[k] as string | undefined) ?? '',
  set: (v: string) => { (filters as Record<string, string | undefined>)[k] = v || undefined; },
});
const fDiscipline = filterSel('disciplineId');
const fStage = filterSel('stageId');
const fDay = filterSel('day');
const fTeam = filterSel('teamId');
const all = () => ({ value: '', label: t('live.all') });
const matchCols = computed<QDataTableColumn<ProjectedMatch>[]>(() => [
  { key: 'slot', header: t('live.slot') }, { key: 'sides', header: t('live.sides') }, { key: 'state', header: t('live.state') },
  { key: 'scheduledAt', header: t('live.time') }, { key: 'score', header: t('live.score') },
]);
const stateLabel = (s: string) => statusBadge(MATCH_STATE, s);
const slotKey = (m: ProjectedMatch) => m.slot?.key ?? '—';

</script>

<template>
  <QContainer>
    <QDataState v-if="ds.state.value !== 'content' || !snap || !feed" v-bind="ds.props.value" @retry="load" />
    <div v-else class="k-stack p-live">
      <QPageHeader :title="snap.event.name" :status="eventStatus" :breadcrumb="[{ label: t('shell.events'), href: '/events' }, { label: snap.event.name, href: `/events/${encodeURIComponent(id)}` }, { label: t('live.title') }]" />

      <QCard padding="none">
        <div class="p-live-bar">
          <QSegmentedControl size="sm" :aria-label="t('live.viewLabel')" :model-value="latest ? 'latest' : 'synced'" :options="viewOptions" @update:model-value="(v) => setView(v === 'latest' ? 'latest' : 'synced')" />
          <p class="p-live-conn" role="status" aria-live="polite">
            <QLiveDot v-if="conn.state === 'live'" /><QIcon v-else :name="conn.state === 'offline' ? 'wifi-off' : 'refresh'" :size="16" />
            {{ t(`live.conn.${conn.state}` as MessageKey) }}<template v-if="conn.lastUpdate"> · {{ t('live.lastUpdate') }} {{ formatJalali(conn.lastUpdate, 'time') }}</template>
          </p>
          <QSwitch :label="t('live.lowData')" :model-value="settings.lowData" @update:model-value="(v) => setLowData(!!v)" />
        </div>
      </QCard>
      <QAlert v-if="latest" tone="warning">{{ t('live.latestWarning') }}</QAlert>

      <QAlert v-if="snap.mode === 'archive'" tone="info" icon="clock" :title="t('live.archive')">
        {{ t('live.archiveLead') }} {{ formatJalali(snap.archive?.closedAt ?? null, 'date') }}
        <RouterLink v-if="snap.finalReport" :to="`/news/${encodeURIComponent(snap.finalReport.slug)}`">{{ snap.finalReport.title }}</RouterLink>
      </QAlert>

      <QSection v-if="snap.streams.length" id="streams" small :title="t('live.streams')">
        <div class="p-live-streams">
          <QCard v-for="s in snap.streams" :key="s.id">
            <div class="k-stack">
              <div class="p-live-stream__head">
                <strong><bdi>{{ s.label }}</bdi></strong>
                <span class="p-live-sub"><QBadge :tone="s.status === 'live' ? 'live' : 'neutral'">{{ s.status === 'live' ? t('live.now') : s.status }}</QBadge> {{ s.language }} · {{ t(`live.role.${s.role}` as MessageKey) }}</span>
                <QButton v-if="!latest && streamId !== s.id" size="sm" variant="secondary" @click="setView('synced', s.id)">{{ t('live.syncTo') }}</QButton>
              </div>
              <p v-if="!s.provider.configured || !s.playbackUrl" class="p-live-sub">{{ t('live.noProvider') }}</p>
              <!-- CAST-002: never autoplay with sound; nothing loads until the viewer presses play -->
              <video v-else-if="!settings.lowData || videoError[s.id] === undefined" :src="s.playbackUrl" controls muted playsinline preload="none" class="p-live-player" @error="videoError[s.id] = t('live.playerError')" />
              <QAlert v-if="videoError[s.id]" tone="danger">{{ videoError[s.id] }}</QAlert>
              <p v-if="s.nextProgramme" class="p-live-sub">{{ t('live.next') }}: <bdi>{{ s.nextProgramme.title }}</bdi> — {{ formatJalali(s.nextProgramme.at) }}</p>
            </div>
          </QCard>
        </div>
      </QSection>

      <div class="p-live-boards">
        <QSection id="now" small :title="t('live.now')">
          <p v-if="!snap.now.length" class="p-live-sub">{{ t('live.none') }}</p>
          <div class="p-live-list"><QMatchCard v-for="m in snap.now" :key="m.id" v-bind="card(m)" /></div>
        </QSection>
        <QSection id="next" small :title="t('live.upNext')">
          <p v-if="!snap.next.length" class="p-live-sub">{{ t('live.none') }}</p>
          <div class="p-live-list"><QMatchCard v-for="m in snap.next" :key="m.id" v-bind="card(m)" /></div>
        </QSection>
        <QSection id="results" small :title="t('live.results')">
          <p v-if="!snap.results.length" class="p-live-sub">{{ t('live.none') }}</p>
          <div class="p-live-list"><QMatchCard v-for="m in snap.results" :key="m.id" v-bind="card(m)" /></div>
        </QSection>
      </div>

      <QLivePost v-for="p in snap.pinned" :key="p.id" v-bind="postProps(p)" :aria-label="t('live.pinned')" />

      <div class="p-live-filters">
        <QSelect v-model="fDiscipline" :label="t('live.f.discipline')" :options="[all(), ...snap.filters.disciplines.map((d) => ({ value: d.id, label: d.name }))]" />
        <QSelect v-model="fStage" :label="t('live.f.stage')" :options="[all(), ...snap.filters.stages.filter((x) => !filters.disciplineId || x.disciplineId === filters.disciplineId).map((x) => ({ value: x.id, label: x.name }))]" />
        <QSelect v-model="fDay" :label="t('live.f.day')" :options="[all(), ...snap.filters.days.map((d) => ({ value: d, label: formatJalali(`${d}T08:30:00Z`, 'date') }))]" />
        <QSelect v-model="fTeam" :label="t('live.f.team')" :options="[all(), ...snap.filters.teams.map((x) => ({ value: x.id, label: x.name }))]" />
      </div>

      <QTabs v-model="tab" :items="tabItems" :aria-label="t('live.tabs')" overflow="scroll" />

      <section v-show="tab === 'timeline'" ref="timelineEl" class="k-stack p-live-timeline" tabindex="-1" role="tabpanel" :aria-label="t('live.tab.timeline')">
        <QButton v-if="feed.pending.length" class="p-live-new" variant="primary" icon="chevron-up" @click="showNew">{{ t('live.newItems', { n: fa(feed.pending.length) }) }}</QButton>
        <QEmptyState v-if="!feed.posts.length" compact icon="news" :title="t('live.empty')" />
        <QLivePost v-for="(p, i) in feed.posts" :key="p.id" v-bind="postProps(p)" :newest="i === 0" />
        <QButton v-if="olderCursor" variant="secondary" icon="chevron-down" @click="older">{{ t('live.older') }}</QButton>
      </section>
      <section v-if="tab !== 'timeline' && tabData" class="k-stack" :aria-label="t(`live.tab.${tab}` as MessageKey)">
        <template v-if="['schedule', 'results', 'bracket'].includes(tab)">
          <QEmptyState v-if="!(tabData['items'] as ProjectedMatch[]).length" compact icon="calendar" :title="t('live.none')" />
          <QDataTable v-else :caption="t(`live.tab.${tab}` as MessageKey)" caption-hidden row-key="id" row-header="sides" :columns="matchCols" :rows="tabData['items'] as ProjectedMatch[]">
            <template #cell-slot="{ row }"><span class="q-ltr">{{ slotKey(row) }}</span></template>
            <template #cell-sides="{ row }"><RouterLink :to="`/matches/${encodeURIComponent(row.id)}`"><bdi>{{ sideNames(row) }}</bdi></RouterLink></template>
            <template #cell-state="{ row }"><QBadge v-bind="stateLabel(row.state).props">{{ stateLabel(row.state).label }}</QBadge></template>
            <template #cell-scheduledAt="{ row }">{{ formatJalali(row.scheduledAt) }}</template>
            <template #cell-score="{ row }"><bdi class="q-ltr">{{ score(row) }}</bdi></template>
          </QDataTable>
        </template>
        <template v-else-if="tab === 'stats'">
          <QFacts :columns="4" :items="Object.entries(tabData['totals'] as Record<string, number>).map(([k, v]) => ({ label: t(`live.stat.${k}` as MessageKey), value: fa(v) }))" />
          <ol class="p-live-leaders"><li v-for="l in tabData['leaders'] as Array<{ participationId: string; name: string; wins: number; played: number }>" :key="l.participationId"><bdi>{{ l.name }}</bdi> — {{ fa(l.wins) }}/{{ fa(l.played) }}</li></ol>
        </template>
        <template v-else-if="tab === 'gallery'">
          <QEmptyState v-if="!(tabData['items'] as unknown[]).length" compact icon="image" :title="t('live.none')" />
          <div class="p-live-gallery">
            <figure v-for="g in tabData['items'] as Array<{ postId: string; url: string | null; caption: string | null; credit: string }>" :key="g.postId + (g.url ?? '')">
              <img v-if="g.url && !settings.lowData" :src="g.url" :alt="g.caption ?? ''" loading="lazy" decoding="async" />
              <a v-else-if="g.url" :href="g.url">{{ t('live.openImage') }}</a>
              <figcaption class="p-live-sub" dir="auto">{{ g.caption }} · {{ g.credit }}</figcaption>
            </figure>
          </div>
        </template>
        <template v-else-if="tab === 'video'">
          <QEmptyState v-if="!(tabData['items'] as unknown[]).length" compact icon="play" :title="t('live.none')" />
          <ul class="p-live-leaders">
            <li v-for="v in tabData['items'] as Array<{ id: string; kind: string; title: string; url: string | null; matchId: string | null; occurredAt: string }>" :key="v.id">
              {{ t(`live.vid.${v.kind}` as MessageKey) }} — <a v-if="v.url" :href="v.url" rel="noopener noreferrer" target="_blank" dir="auto">{{ v.title }}</a><span v-else dir="auto">{{ v.title }}</span>
              <span class="p-live-sub"> {{ formatJalali(v.occurredAt) }}</span>
            </li>
          </ul>
        </template>
      </section>

      <!-- spectator chat, separate from the official timeline (AUD-002) -->
      <QCard>
        <details class="p-live-chat" @toggle="chat.open = ($event.target as HTMLDetailsElement).open; chat.open && loadChat()">
          <summary class="h4">{{ t('live.chat') }}</summary>
          <p class="p-live-sub">{{ t('live.chatNote') }}</p>
          <ul class="p-live-chatlist">
            <li v-for="m in chat.items" :key="m._id">
              <strong><bdi>{{ m.nickname ?? '—' }}</bdi></strong>: <span v-if="m.removed" class="p-live-sub">{{ t('live.removed') }}</span><span v-else dir="auto">{{ m.text }}</span>
              <QButton v-if="session.me && !m.removed" variant="ghost" size="sm" icon="flag" @click="reportChat(m._id)">{{ t('live.report') }}</QButton>
            </li>
          </ul>
          <form v-if="session.me" class="p-live-chatform" novalidate @submit.prevent="sendChat">
            <QTextField id="lc-chat" v-model="chat.text" :label="t('live.chat')" hide-label :max-length="1000" />
            <QButton type="submit" variant="green" icon="send" :disabled="!chat.text.trim()">{{ t('live.send') }}</QButton>
          </form>
          <p v-else class="p-live-sub"><RouterLink :to="`/login?redirect=${encodeURIComponent(route.fullPath)}`">{{ t('live.loginToChat') }}</RouterLink></p>
        </details>
      </QCard>
    </div>
  </QContainer>
</template>

<style scoped>
.p-live { gap: var(--space-6); }
.p-live-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3) var(--space-5); padding: var(--space-3) var(--space-4); }
.p-live-conn { display: inline-flex; align-items: center; gap: var(--space-2); margin: 0; font-size: 13px; color: var(--ink-muted); }
.p-live-sub { margin: 0; font-size: 13px; color: var(--ink-subtle); }
.p-live-streams { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); }
.p-live-stream__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-3); }
.p-live-player { inline-size: 100%; aspect-ratio: 16 / 9; background: var(--surface-sunken); border-radius: var(--radius-sm); }
.p-live-boards { display: grid; gap: var(--space-5); grid-template-columns: repeat(3, minmax(0, 1fr)); }
.p-live-list { display: flex; flex-direction: column; gap: var(--space-2); }
.p-live-filters { display: grid; gap: var(--space-4); grid-template-columns: repeat(4, minmax(0, 1fr)); }
.p-live-timeline:focus { outline: none; }
.p-live-new { position: sticky; inset-block-start: var(--space-3); z-index: 2; align-self: center; }
.p-live-leaders { margin: 0; padding-inline-start: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2); }
.p-live-gallery { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); }
.p-live-gallery figure { margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.p-live-gallery img { inline-size: 100%; border-radius: var(--radius-sm); }
.p-live-chat summary { cursor: pointer; min-block-size: 44px; display: flex; align-items: center; }
.p-live-chatlist { margin: var(--space-3) 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); }
.p-live-chatform { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); align-items: end; }
@media (max-width: 1100px) { .p-live-boards { grid-template-columns: minmax(0, 1fr); } .p-live-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .p-live-filters { grid-template-columns: minmax(0, 1fr); } }
</style>
