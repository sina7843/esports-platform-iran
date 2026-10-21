<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type ApiClientError } from '../api/client';
import { esp06 as esp06Api, type LiveFilters, type LiveSnapshot, type ProjectedMatch, type PublicPost } from '../api/esp06';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import LivePost from '../components/LivePost.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import { appendOlder, applyEvents, createFeed, reveal, type FeedState } from '../liveFeed';
import { session } from '../session';
import { setLowData, settings } from '../settings';

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
  return sc ? `${num(sc[0])}–${num(sc[1])}` : o.kind === 'win' ? `${t('live.winner')}: ${m.sides[o.winnerSide ?? 0]?.displayName ?? ''}` : o.kind;
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
</script>

<template>
  <DataState :loading="loading" :error="error" @retry="load">
    <template v-if="snap && feed">
      <PageHeader :title="snap.event.name">
        <template #title><bdi>{{ snap.event.name }}</bdi></template>
        <template #actions><StatusBadge :state="snap.event.state" /></template>
      </PageHeader>
      <ErrorNote :error="failure" />

      <!-- view and connection (CAST-005, LIVE-004) -->
      <section class="card row between" aria-label="view">
        <div class="row" role="group" :aria-label="t('live.viewLabel')">
          <button type="button" class="btn btn-sm" :aria-pressed="!latest" @click="setView('synced')">{{ t('live.synced') }}<span v-if="!latest && snap.view.delaySeconds"> ({{ t('live.delay', { n: num(snap.view.delaySeconds) }) }})</span></button>
          <button type="button" class="btn btn-sm" :aria-pressed="latest" @click="setView('latest')">{{ t('live.latest') }}</button>
        </div>
        <p class="muted small conn-status" role="status" aria-live="polite">
          <span class="dot" :data-state="conn.state" aria-hidden="true" /> {{ t(`live.conn.${conn.state}` as never) }} · {{ t('live.lastUpdate') }} <JalaliDate :iso="conn.lastUpdate" format="time" />
        </p>
        <label class="small"><input type="checkbox" :checked="settings.lowData" @change="setLowData(($event.target as HTMLInputElement).checked)" /> {{ t('live.lowData') }}</label>
      </section>
      <p v-if="latest" class="warn small block-sm">{{ t('live.latestWarning') }}</p>

      <section v-if="snap.mode === 'archive'" class="card stack block-sm">
        <h2>{{ t('live.archive') }}</h2>
        <p>{{ t('live.archiveLead') }} <JalaliDate :iso="snap.archive?.closedAt ?? null" format="date" /></p>
        <RouterLink v-if="snap.finalReport" :to="`/news/${encodeURIComponent(snap.finalReport.slug)}`">{{ snap.finalReport.title }}</RouterLink>
      </section>

      <!-- streams (CAST-001/002) -->
      <section v-if="snap.streams.length" class="card stack block-sm" aria-labelledby="st-h">
        <h2 id="st-h">{{ t('live.streams') }}</h2>
        <div v-for="s in snap.streams" :key="s.id" class="stream">
          <div class="row between">
            <strong><bdi>{{ s.label }}</bdi></strong>
            <span class="row small"><StatusBadge :state="s.status" /> {{ s.language }} · {{ t(`live.role.${s.role}` as never) }}
              <button v-if="!latest && streamId !== s.id" type="button" class="btn btn-sm" @click="setView('synced', s.id)">{{ t('live.syncTo') }}</button></span>
          </div>
          <p v-if="!s.provider.configured || !s.playbackUrl" class="muted small">{{ t('live.noProvider') }}</p>
          <!-- CAST-002: never autoplay with sound; nothing loads until the viewer presses play -->
          <video v-else-if="!settings.lowData || videoError[s.id] === undefined" :src="s.playbackUrl" controls muted playsinline preload="none" class="player" @error="videoError[s.id] = t('live.playerError')" />
          <p v-if="videoError[s.id]" class="danger small" role="alert">{{ videoError[s.id] }}</p>
          <p v-if="s.nextProgramme" class="small">{{ t('live.next') }}: <bdi>{{ s.nextProgramme.title }}</bdi> — <JalaliDate :iso="s.nextProgramme.at" /></p>
        </div>
      </section>

      <!-- now / next / results (LIVE-001) -->
      <section class="grid3 block-sm">
        <div class="card stack">
          <h2>{{ t('live.now') }}</h2>
          <p v-if="!snap.now.length" class="muted">{{ t('live.none') }}</p>
          <ul class="list"><li v-for="m in snap.now" :key="m.id"><RouterLink :to="`/matches/${m.id}`"><bdi>{{ sideNames(m) }}</bdi></RouterLink> <span v-if="m.provisional" class="warn small">{{ t('live.provisional') }}</span></li></ul>
        </div>
        <div class="card stack">
          <h2>{{ t('live.upNext') }}</h2>
          <p v-if="!snap.next.length" class="muted">{{ t('live.none') }}</p>
          <ul class="list"><li v-for="m in snap.next" :key="m.id"><bdi>{{ sideNames(m) }}</bdi> <span class="muted small"><JalaliDate :iso="m.scheduledAt" /></span></li></ul>
        </div>
        <div class="card stack">
          <h2>{{ t('live.results') }}</h2>
          <p v-if="!snap.results.length" class="muted">{{ t('live.none') }}</p>
          <ul class="list"><li v-for="m in snap.results" :key="m.id"><bdi>{{ sideNames(m) }}</bdi> <bdi class="ltr">{{ score(m) }}</bdi></li></ul>
        </div>
      </section>

      <section v-for="p in snap.pinned" :key="p.id" class="card block-sm" :aria-label="t('live.pinned')"><LivePost :post="p" /></section>

      <!-- filters (LIVE-003) -->
      <form class="row filters block-sm" @submit.prevent>
        <label>{{ t('live.f.discipline') }} <select v-model="filters.disciplineId" class="input"><option :value="undefined">{{ t('live.all') }}</option><option v-for="d in snap.filters.disciplines" :key="d.id" :value="d.id">{{ d.name }}</option></select></label>
        <label>{{ t('live.f.stage') }} <select v-model="filters.stageId" class="input"><option :value="undefined">{{ t('live.all') }}</option><option v-for="s in snap.filters.stages.filter((x) => !filters.disciplineId || x.disciplineId === filters.disciplineId)" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
        <label>{{ t('live.f.day') }} <select v-model="filters.day" class="input"><option :value="undefined">{{ t('live.all') }}</option><option v-for="d in snap.filters.days" :key="d" :value="d"><JalaliDate :iso="`${d}T08:30:00Z`" format="date" /></option></select></label>
        <label>{{ t('live.f.team') }} <select v-model="filters.teamId" class="input"><option :value="undefined">{{ t('live.all') }}</option><option v-for="tm in snap.filters.teams" :key="tm.id" :value="tm.id">{{ tm.name }}</option></select></label>
      </form>

      <!-- tabs (LIVE-002) -->
      <div class="tabs block-sm" role="tablist" :aria-label="t('live.tabs')">
        <button v-for="x in tabs" :key="x" type="button" role="tab" class="tab" :aria-selected="tab === x" :tabindex="tab === x ? 0 : -1" @click="tab = x">{{ t(`live.tab.${x}` as never) }}</button>
      </div>

      <section v-show="tab === 'timeline'" ref="timelineEl" class="card stack" tabindex="-1" role="tabpanel" :aria-label="t('live.tab.timeline')">
        <button v-if="feed.pending.length" type="button" class="btn btn-primary sticky" @click="showNew">{{ t('live.newItems', { n: num(feed.pending.length) }) }}</button>
        <p v-if="!feed.posts.length" class="muted">{{ t('live.empty') }}</p>
        <LivePost v-for="p in feed.posts" :key="p.id" :post="p" show-actions />
        <button v-if="olderCursor" type="button" class="btn" @click="older">{{ t('live.older') }}</button>
      </section>
      <section v-if="tab !== 'timeline' && tabData" class="card stack" role="tabpanel" :aria-label="t(`live.tab.${tab}` as never)">
        <template v-if="['schedule', 'results', 'bracket'].includes(tab)">
          <p v-if="!(tabData['items'] as ProjectedMatch[]).length" class="muted">{{ t('live.none') }}</p>
          <table v-else class="table">
            <caption class="sr-only">{{ t(`live.tab.${tab}` as never) }}</caption>
            <thead><tr><th scope="col">{{ t('live.slot') }}</th><th scope="col">{{ t('live.sides') }}</th><th scope="col">{{ t('live.state') }}</th><th scope="col">{{ t('live.time') }}</th><th scope="col">{{ t('live.score') }}</th></tr></thead>
            <tbody><tr v-for="m in tabData['items'] as ProjectedMatch[]" :key="m.id"><td class="ltr">{{ m.slot?.key }}</td><th scope="row"><bdi>{{ sideNames(m) }}</bdi></th><td><StatusBadge :state="m.state" /></td><td><JalaliDate :iso="m.scheduledAt" /></td><td><bdi class="ltr">{{ score(m) }}</bdi></td></tr></tbody>
          </table>
        </template>
        <template v-else-if="tab === 'stats'">
          <dl class="facts"><div v-for="(v, k) in tabData['totals'] as Record<string, number>" :key="k"><dt>{{ t(`live.stat.${k}` as never) }}</dt><dd>{{ num(v) }}</dd></div></dl>
          <ol class="list"><li v-for="l in tabData['leaders'] as Array<{ participationId: string; name: string; wins: number; played: number }>" :key="l.participationId"><bdi>{{ l.name }}</bdi> — {{ num(l.wins) }}/{{ num(l.played) }}</li></ol>
        </template>
        <template v-else-if="tab === 'gallery'">
          <p v-if="!(tabData['items'] as unknown[]).length" class="muted">{{ t('live.none') }}</p>
          <div class="gallery">
            <figure v-for="g in tabData['items'] as Array<{ postId: string; url: string | null; caption: string | null; credit: string }>" :key="g.postId + (g.url ?? '')">
              <img v-if="g.url && !settings.lowData" :src="g.url" :alt="g.caption ?? ''" loading="lazy" decoding="async" />
              <a v-else-if="g.url" :href="g.url">{{ t('live.openImage') }}</a>
              <figcaption class="small muted" dir="auto">{{ g.caption }} · {{ g.credit }}</figcaption>
            </figure>
          </div>
        </template>
        <template v-else-if="tab === 'video'">
          <p v-if="!(tabData['items'] as unknown[]).length" class="muted">{{ t('live.none') }}</p>
          <ul class="list"><li v-for="v in tabData['items'] as Array<{ id: string; kind: string; title: string; url: string | null; matchId: string | null; occurredAt: string }>" :key="v.id">{{ t(`live.vid.${v.kind}` as never) }} — <a v-if="v.url" :href="v.url" rel="noopener noreferrer" target="_blank" dir="auto">{{ v.title }}</a><span v-else dir="auto">{{ v.title }}</span> <span class="muted small"><JalaliDate :iso="v.occurredAt" /></span></li></ul>
        </template>
      </section>

      <!-- spectator chat, separate from the official timeline (AUD-002) -->
      <details class="card block-sm" @toggle="chat.open = ($event.target as HTMLDetailsElement).open; chat.open && loadChat()">
        <summary>{{ t('live.chat') }}</summary>
        <p class="muted small">{{ t('live.chatNote') }}</p>
        <ul class="list chat">
          <li v-for="m in chat.items" :key="m._id"><strong><bdi>{{ m.nickname ?? '—' }}</bdi></strong>: <span v-if="m.removed" class="muted">{{ t('live.removed') }}</span><span v-else dir="auto">{{ m.text }}</span>
            <button v-if="session.me && !m.removed" type="button" class="btn btn-sm link" @click="reportChat(m._id)">{{ t('live.report') }}</button></li>
        </ul>
        <form v-if="session.me" class="row" novalidate @submit.prevent="sendChat">
          <label class="sr-only" for="lc-chat">{{ t('live.chat') }}</label>
          <input id="lc-chat" v-model="chat.text" class="input grow" dir="auto" maxlength="1000" />
          <button type="submit" class="btn btn-sm" :disabled="!chat.text.trim()">{{ t('live.send') }}</button>
        </form>
        <p v-else class="small"><RouterLink :to="`/login?redirect=${encodeURIComponent(route.fullPath)}`">{{ t('live.loginToChat') }}</RouterLink></p>
      </details>
    </template>
  </DataState>
</template>

<style scoped>
/* reserve two lines: the connection text changes length (connecting → live → last update) and must not reflow the page (CLS) */
.conn-status { min-block-size: 2.8em; margin: 0; }
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.between { justify-content: space-between; }
.block-sm { margin-block-start: var(--sp-3); }
.grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--sp-3); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.tabs { display: flex; gap: var(--sp-1); overflow-x: auto; border-block-end: 1px solid var(--border); }
.tab { background: none; border: 0; padding: var(--sp-2) var(--sp-3); cursor: pointer; color: inherit; white-space: nowrap; }
.tab[aria-selected='true'] { border-block-end: 3px solid var(--accent, var(--info)); font-weight: 600; }
.sticky { position: sticky; inset-block-start: var(--sp-2); z-index: 2; justify-self: center; }
.table { inline-size: 100%; border-collapse: collapse; }
.table th, .table td { text-align: start; padding: var(--sp-2); border-block-end: 1px solid var(--border); }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: var(--sp-2); margin: 0; }
.facts dt { color: var(--text-muted); font-size: var(--fs-sm); }
.facts dd { margin: 0; font-weight: 600; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: var(--sp-2); }
.gallery img { inline-size: 100%; block-size: auto; border-radius: var(--radius, 6px); }
.gallery figure { margin: 0; }
.player { inline-size: 100%; max-block-size: 60vh; background: #000; border-radius: var(--radius, 6px); }
.stream { border-block-end: 1px solid var(--border); padding-block: var(--sp-2); }
.dot { display: inline-block; inline-size: 0.6rem; block-size: 0.6rem; border-radius: 50%; background: var(--text-muted); }
.dot[data-state='live'] { background: var(--ok); }
.dot[data-state='retrying'] { background: var(--warn); }
.dot[data-state='offline'] { background: var(--danger); }
.chat { max-block-size: 18rem; overflow-y: auto; }
.grow { flex: 1 1 12rem; }
.link { background: none; border: 0; text-decoration: underline; }
.small { font-size: var(--fs-xs); }
.warn { color: var(--warn); }
.danger { color: var(--danger); }
h2, p { margin: 0; }
</style>
