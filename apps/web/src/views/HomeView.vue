<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  QBadge, QButton, QCard, QContainer, QCtaBanner, QDataState, QDiscoveryCard, QEventCard, QIcon, QLeaderboardRow, QNewsCard, QSearchField, QSection,
  QTricolor, EVENT_STATUS, formatJalali, isRtl, statusBadge,
} from '@esp/ui';
import { esp05 } from '../api/esp05';
import { esp06, type PublicPost } from '../api/esp06';
import { isOn } from '../features';
import { t } from '../i18n';
import { session } from '../session';
import { settings } from '../settings';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/**
 * Spec docs/redesign/03-specs/home.md — the reference page. UX-002: personal when signed in, public overview otherwise.
 * The live board and the «today» ticker need backlog 0.1 / 2.7 and are gated (features.ts) until the API ships them.
 */
const router = useRouter();
const { data, loading, error, load } = useLoad(() => esp06.home());
const ds = useDataState({ loading: computed(() => loading.value && !data.value), error });
const board = useLoad(async () => {
  const sys = (await esp05.systems()).items[0];
  return sys ? await esp05.leaderboard(sys.id, { limit: 5 }) : null;
});
const q = ref('');
function search(v: string) {
  void router.push({ path: '/search', query: v.trim() ? { q: v.trim() } : {} });
}
const events = computed(() => (data.value?.events ?? []).filter((e) => e.state !== 'cancelled'));
const featured = computed(() => events.value[0] ?? null);
const featuredStatus = computed(() => statusBadge(EVENT_STATUS, featured.value?.state));
const upcoming = computed(() => events.value.slice(0, 3));
const news = computed(() => data.value?.news ?? []);
const next = computed(() => (data.value?.calendar ?? []).filter((m) => new Date(m.scheduledAt).getTime() > Date.now() - 3 * 3600_000)[0] ?? null);
const arrowEnd = computed(() => (isRtl() ? 'arrow-left' : 'arrow-right'));
const newsCard = (p: PublicPost) => ({
  title: p.title, excerpt: p.seo.description ?? p.body.slice(0, 160), publishedAt: p.publishedAt ?? p.occurredAt,
  state: (p.withdrawal ? 'retracted' : p.correction ? 'corrected' : 'published') as 'published' | 'corrected' | 'retracted',
  lowData: settings.lowData, href: `/news/${encodeURIComponent(p.slug)}`, headingLevel: 3 as const,
});
const mine = (id: string) => id === session.me?.principal.id;
</script>

<template>
  <div class="p-home">
    <section class="p-hero" aria-labelledby="hero-h">
      <QContainer>
        <div class="p-hero__inner">
          <div class="p-hero__copy">
            <span class="p-hero__eyebrow"><QTricolor />{{ t('hm.eyebrow') }}</span>
            <h1 id="hero-h" class="p-hero__title">{{ t('hm.title1') }}<em>{{ t('hm.title2') }}</em>{{ t('hm.title3') }}</h1>
            <p class="p-hero__body">{{ t('hm.body') }}</p>
            <div class="p-hero__ctas">
              <QButton variant="primary" size="xl" chamfer :icon-end="arrowEnd" href="/events">{{ t('hm.discover') }}</QButton>
              <QButton variant="green" size="xl" icon="users" href="/recruitment">{{ t('hm.team') }}</QButton>
            </div>
            <div class="p-hero__search">
              <QSearchField id="home-search" v-model="q" :label="t('hm.search')" :placeholder="t('hm.searchPh')" :submit-label="t('hm.searchBtn')" @submit="search" />
              <div v-if="data?.games.length" class="p-hero__chips">
                <span class="p-hero__chips-label">{{ t('hm.games') }}</span>
                <RouterLink v-for="g in data.games" :key="g" class="p-hero__chip" :to="`/games/${encodeURIComponent(g)}`">{{ g }}</RouterLink>
              </div>
            </div>
            <ul class="p-hero__trust">
              <li><QIcon name="shield" :size="16" />{{ t('hm.trust1') }}</li>
              <li><QIcon name="file" :size="16" />{{ t('hm.trust2') }}</li>
              <li><QIcon name="award" :size="16" />{{ t('hm.trust3') }}</li>
            </ul>
          </div>
          <div class="p-board">
            <QCard v-if="next" chamfer padding="lg">
              <div class="p-board__mine">
                <span class="p-hero__eyebrow"><QTricolor />{{ t('hm.myMatch') }}</span>
                <h2 class="p-board__title"><bdi>{{ next.sides.join(' — ') }}</bdi></h2>
                <span class="p-board__org"><QIcon name="clock" :size="16" />{{ formatJalali(next.scheduledAt) }}</span>
                <div><QButton variant="primary" :href="`/matches/${encodeURIComponent(next.matchId)}`" :icon-end="arrowEnd">{{ t('hm.matchRoom') }}</QButton></div>
              </div>
            </QCard>
            <QCard v-else-if="featured" chamfer padding="none">
              <div class="p-board__panel">
                <div class="p-board__cover q-stripes">
                  <span class="p-board__game" aria-hidden="true">QeSB</span>
                  <span class="p-board__tags">
                    <QBadge tone="red">{{ t('hm.featured') }}</QBadge>
                    <QBadge v-bind="featuredStatus.props">{{ featuredStatus.label }}</QBadge>
                  </span>
                </div>
                <div class="p-board__body">
                  <h2 class="p-board__title"><bdi>{{ featured.name }}</bdi></h2>
                  <dl class="p-board__facts">
                    <div><dt>{{ t('hm.start') }}</dt><dd>{{ formatJalali(featured.startsAt, 'date') }}</dd></div>
                    <div><dt>{{ t('hm.status') }}</dt><dd>{{ featuredStatus.label }}</dd></div>
                  </dl>
                  <div class="p-board__foot"><QButton variant="primary" :href="`/events/${encodeURIComponent(featured.id)}`" :icon-end="arrowEnd">{{ t('hm.details') }}</QButton></div>
                </div>
              </div>
            </QCard>
            <QCard v-else-if="data"><p class="p-muted">{{ t('hm.noEvent') }}</p></QCard>
          </div>
        </div>
      </QContainer>
    </section>

    <QContainer>
      <div class="p-home-sections">
        <QSection id="path" :title="t('hm.path')">
          <div class="k-grid--4 p-grid">
            <QDiscoveryCard icon="trophy" :title="t('hm.p1')" :description="t('hm.p1d')" href="/events" :heading-level="3" />
            <QDiscoveryCard icon="users" :title="t('hm.p2')" :description="t('hm.p2d')" href="/recruitment" :heading-level="3" />
            <QDiscoveryCard icon="chart" :title="t('hm.p3')" :description="t('hm.p3d')" href="/rankings" :heading-level="3" />
            <QDiscoveryCard icon="flag" :title="t('hm.p4')" :description="t('hm.p4d')" href="/organizers" :heading-level="3" />
          </div>
        </QSection>

        <!-- backlog 0.1 / 2.7: the live board needs a public "live now / today" feed; until then the spec's later state -->
        <QSection id="live" :eyebrow="t('hm.now')" :title="t('hm.liveToday')">
          <QDataState v-if="!isOn('2.7')" state="later" />
        </QSection>

        <QSection id="events" :title="t('hm.upcoming')">
          <template #action><QButton variant="ghost" href="/events" :icon-end="arrowEnd">{{ t('hm.allEvents') }}</QButton></template>
          <QDataState v-if="ds.state.value !== 'content'" v-bind="ds.props.value" skeleton="cards" @retry="load" />
          <p v-else-if="!upcoming.length" class="p-muted">{{ t('hm.noEvent') }}</p>
          <div v-else class="k-grid">
            <QEventCard
              v-for="e in upcoming" :key="e.id" :href="`/events/${encodeURIComponent(e.id)}`" :title="e.name" :status="(e.state === 'active' ? 'live' : e.state) as never"
              :date="e.startsAt ? formatJalali(e.startsAt, 'date') : undefined"
            />
          </div>
        </QSection>

        <div class="p-two">
          <QSection id="rank" :title="t('hm.rankings')" small>
            <template #action><QButton variant="ghost" size="sm" href="/rankings/formula">{{ t('hm.how') }}</QButton></template>
            <QCard v-if="board.data.value?.rows.length" padding="none">
              <ol class="p-rank-list">
                <QLeaderboardRow
                  v-for="r in board.data.value.rows" :key="r.subjectId" as="li" :rank="r.rank ?? 0" :name="r.displayName" :initial="Array.from(r.displayName)[0]"
                  :kind="r.subjectKind === 'team' ? 'team' : 'player'" :rating="Math.round(r.rating)" :mine="mine(r.subjectId)"
                  :href="r.subjectKind === 'team' ? `/teams/${encodeURIComponent(r.subjectId)}` : `/players/${encodeURIComponent(r.displayName)}`"
                />
              </ol>
            </QCard>
            <p v-else class="p-muted">{{ t('hm.noRank') }}</p>
          </QSection>
          <QSection id="news" :title="t('hm.news')" small>
            <template #action><QButton variant="ghost" size="sm" href="/news">{{ t('hm.allNews') }}</QButton></template>
            <div v-if="news.length" class="p-news">
              <QNewsCard variant="featured" v-bind="newsCard(news[0]!)" />
              <QNewsCard v-for="p in news.slice(1, 3)" :key="p.id" variant="compact" v-bind="newsCard(p)" />
            </div>
            <p v-else class="p-muted">{{ t('hm.noNews') }}</p>
          </QSection>
        </div>

        <div class="p-cta-row">
          <QCtaBanner icon="flag" :title="t('hm.ctaTitle')" :text="t('hm.ctaText')">
            <template #action><QButton variant="primary" href="/organizers">{{ t('hm.ctaBtn') }}</QButton></template>
          </QCtaBanner>
          <QCard>
            <div class="p-verify">
              <h2 class="h4 p-h">{{ t('hm.verifyTitle') }}</h2>
              <p>{{ t('hm.verifyBody') }}</p>
              <div><QButton variant="secondary" icon="shield" href="/verify">{{ t('hm.verifyBtn') }}</QButton></div>
            </div>
          </QCard>
        </div>
      </div>
    </QContainer>
  </div>
</template>

<style scoped>
:global(.k-shell--public .k-main:has(.p-home)) { padding-block-start: 0; }
.p-h { margin: 0; }
.p-muted { margin: 0; color: var(--ink-muted); font-size: 14px; }
.p-home { display: flex; flex-direction: column; gap: var(--space-10); }
.p-home-sections { display: flex; flex-direction: column; gap: var(--space-10); }
.p-hero { position: relative; overflow: hidden; border-block-end: 1px solid var(--line); background-color: var(--bg);
  background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px);
  background-size: 56px 56px; background-position: center top; }
.p-hero::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(to bottom, transparent 55%, var(--bg)); }
.p-hero__inner { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr); gap: var(--space-8); align-items: center; padding-block: var(--space-10); }
.p-hero__copy { display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; }
.p-hero__eyebrow { display: inline-flex; align-items: center; gap: var(--space-2); font-size: 14px; font-weight: 700; color: var(--green-text); }
.p-hero__title { margin: 0; font-size: 64px; line-height: 80px; font-weight: 900; text-wrap: balance; }
.p-hero__title em { font-style: normal; color: var(--green-text); }
.p-hero__body { margin: 0; font-size: 18px; line-height: 32px; color: var(--ink-muted); max-width: 52ch; }
.p-hero__ctas { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.p-hero__search { display: flex; flex-direction: column; gap: var(--space-3); max-width: 560px; }
.p-hero__chips { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
.p-hero__chips-label { font-size: 13px; color: var(--ink-subtle); }
.p-hero__chip { display: inline-flex; align-items: center; min-height: 32px; padding: 0 12px; font-size: 12px; font-weight: 800; color: var(--ink-muted); text-decoration: none; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); direction: ltr; }
.p-hero__chip:hover { color: var(--green-text); border-color: var(--green-line); }
.p-hero__trust { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); margin: 0; padding: 0; list-style: none; font-size: 13px; color: var(--ink-muted); }
.p-hero__trust li { display: inline-flex; align-items: center; gap: var(--space-2); }
.p-hero__trust .q-icon { color: var(--green-text); }
.p-board { position: relative; min-width: 0; }
.p-board__panel { display: flex; flex-direction: column; }
.p-board__cover { position: relative; height: 176px; display: grid; place-items: center; border-block-end: 1px solid var(--line); }
.p-board__game { font-size: 52px; line-height: 1; font-weight: 900; color: transparent; -webkit-text-stroke: 1.5px var(--control-border); white-space: nowrap; direction: ltr; }
.p-board__tags { position: absolute; inset-block-start: var(--space-4); inset-inline: var(--space-4); display: flex; justify-content: space-between; gap: var(--space-2); }
.p-board__body { padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-4); }
.p-board__title { margin: 0; font-size: 26px; line-height: 36px; font-weight: 900; }
.p-board__org { display: inline-flex; align-items: center; gap: var(--space-2); font-size: 13px; color: var(--ink-muted); }
.p-board__facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); margin: 0; }
.p-board__facts div { padding: var(--space-3); background: var(--surface-sunken); border: 1px solid var(--line); border-radius: var(--radius-md); min-width: 0; }
.p-board__facts dt { font-size: 12px; color: var(--ink-subtle); }
.p-board__facts dd { margin: 0; font-weight: 800; font-size: 15px; }
.p-board__foot { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.p-board__mine { display: flex; flex-direction: column; gap: var(--space-4); }
.p-grid { display: grid; gap: var(--space-4); }
.p-rank-list { margin: 0; padding: 0; list-style: none; }
.p-rank-list > li + li { border-block-start: 1px solid var(--line); }
.p-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-6); align-items: start; }
.p-news { display: flex; flex-direction: column; gap: var(--space-3); }
.p-cta-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: var(--space-5); align-items: stretch; }
.p-verify { display: flex; flex-direction: column; gap: var(--space-3); }
.p-verify p { margin: 0; color: var(--ink-muted); font-size: 14px; }
@media (max-width: 1100px) { .p-hero__title { font-size: 52px; line-height: 66px; } }
@media (max-width: 960px) {
  .p-hero__inner { grid-template-columns: minmax(0, 1fr); }
  .p-board { max-width: 560px; }
  .p-two, .p-cta-row { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 560px) {
  .p-hero__title { font-size: 38px; line-height: 52px; }
  .p-hero__ctas > * { flex: 1 1 100%; }
  .p-board__cover { height: 128px; }
}
</style>
