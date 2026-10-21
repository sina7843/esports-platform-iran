<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { esp06 as esp06Api } from '../api/esp06';
import DataState from '../components/DataState.vue';
import JalaliDate from '../components/JalaliDate.vue';
import StatusBadge from '../components/StatusBadge.vue';
import Icon from '../components/Icon.vue';
import { num, t, type MessageKey } from '../i18n';
import { session } from '../session';
import { useLoad } from '../useLoad';

/** UX-002 home: personal (games, city, follows, own calendar, followed news) when signed in; public overview otherwise. */
const esp06: typeof esp06Api = esp06Api;
const router = useRouter();
const { data, loading, error, load } = useLoad(() => esp06.home());
const q = ref('');
const shortcuts = [
  { to: '/events', icon: 'trophy', title: 'nav.events', hint: 'home.eventsHint' },
  { to: '/rankings', icon: 'chart', title: 'nav.rankings', hint: 'home.rankHint' },
  { to: '/recruitment', icon: 'users', title: 'nav.recruitment', hint: 'home.teamHint' },
  { to: '/games', icon: 'game', title: 'nav.games', hint: 'home.catalogHint' },
] as const;
const stats = computed<Array<{ label: MessageKey; value: number }>>(() => data.value ? [
  { label: 'home.eventCount', value: data.value.events.length },
  { label: 'home.newsCount', value: data.value.news.length },
  ...(data.value.personal ? [{ label: 'home.matchCount' as const, value: data.value.calendar.length }] : []),
] as const : []);

</script>

<template>
  <section class="arena-hero" aria-labelledby="home-title">
    <div class="hero-copy">
      <p class="eyebrow"><span class="accent-line" />{{ t('home.eyebrow') }}</p>
      <h1 id="home-title">{{ t('home.headline') }}</h1>
      <p class="hero-description">{{ t('home.description') }}</p>
      <div class="row hero-actions"><RouterLink to="/events" class="btn btn-primary">{{ t('home.start') }}<Icon name="forward" :size="18" /></RouterLink><RouterLink to="/recruitment" class="btn">{{ t('home.community') }}</RouterLink></div>
    </div>
    <div class="hero-emblem" aria-hidden="true"><div class="orbit orbit-one" /><div class="orbit orbit-two" /><div class="trophy-plinth"><Icon name="trophy" :size="112" /></div><span class="emblem-caption">{{ t('app.arena') }}</span></div>
  </section>

  <form class="home-search" role="search" @submit.prevent="router.push({ path: '/search', query: { q } })">
    <Icon name="search" /><label class="sr-only" for="home-q">{{ t('nav.search') }}</label>
    <input id="home-q" v-model="q" type="search" dir="auto" :placeholder="t('srch.placeholder')" />
    <button type="submit" class="btn">{{ t('news.find') }}<Icon name="forward" :size="16" /></button>
  </form>

  <section class="discovery" aria-labelledby="discover-title"><h2 id="discover-title">{{ t('home.discover') }}</h2>
    <div class="shortcut-grid"><RouterLink v-for="link in shortcuts" :key="link.to" :to="link.to" class="shortcut"><span class="shortcut-icon"><Icon :name="link.icon" :size="24" /></span><h3>{{ t(link.title) }}</h3><p>{{ t(link.hint) }}</p><Icon name="arrow" class="shortcut-arrow" :size="18" /></RouterLink></div>
  </section>

  <div class="section-heading"><div><h2>{{ t('home.feed') }}</h2><p class="muted">{{ t('home.feedHint') }}</p></div><RouterLink to="/events" class="text-link">{{ t('home.browseEvents') }}<Icon name="forward" :size="16" /></RouterLink></div>
  <DataState :loading="loading" :error="error" @retry="load">
    <div v-if="data" class="feed-stats"><div v-for="stat in stats" :key="stat.label"><strong class="num">{{ num(stat.value) }}</strong><span>{{ t(stat.label) }}</span></div></div>
    <div v-if="data" class="grid">
      <section v-if="data.personal" class="card stack" aria-labelledby="h-cal">
        <h2 id="h-cal">{{ t('home.myMatches') }}</h2>
        <p v-if="!data.calendar.length" class="muted">{{ t('home.noMatches') }}</p>
        <ul class="feed-list"><li v-for="m in data.calendar" :key="m.matchId"><RouterLink :to="`/matches/${m.matchId}`"><bdi>{{ m.sides.join(' — ') }}</bdi></RouterLink> <span class="small muted"><JalaliDate :iso="m.scheduledAt" /></span></li></ul>
        <RouterLink to="/account/calendar" class="small">{{ t('cal.title') }}</RouterLink>
      </section>
      <section class="card stack" aria-labelledby="h-ev">
        <h2 id="h-ev">{{ data.personal ? t('home.forYou') : t('home.upcoming') }}</h2>
        <p v-if="data.personal && !data.games.length" class="muted small">{{ t('home.pickGames') }} <RouterLink to="/account/profile">{{ t('nav.profile') }}</RouterLink></p>
        <p v-if="!data.events.length" class="muted">{{ t('home.noEvents') }}</p>
        <ul class="feed-list"><li v-for="e in data.events" :key="e.id"><RouterLink :to="`/events/${e.id}`"><bdi>{{ e.name }}</bdi></RouterLink> <StatusBadge :state="e.state" />
          <span v-if="e.inMyCity" class="small ok"> · {{ t('home.inMyCity') }}</span>
          <RouterLink v-if="['active', 'paused'].includes(e.state)" :to="`/events/${e.id}/live`" class="small"> · {{ t('home.live') }}</RouterLink></li></ul>
      </section>
      <section class="card stack" aria-labelledby="h-nw">
        <h2 id="h-nw">{{ t('nav.news') }}</h2>
        <p v-if="!data.news.length" class="muted">{{ t('home.noNews') }}</p>
        <ul class="feed-list"><li v-for="p in data.news" :key="p.id"><RouterLink :to="`/news/${encodeURIComponent(p.slug)}`" dir="auto">{{ p.title }}</RouterLink> <span class="small muted"><JalaliDate :iso="p.publishedAt" format="date" /></span></li></ul>
        <RouterLink to="/news" class="small">{{ t('home.allNews') }}</RouterLink>
      </section>
    </div>
    <p v-if="!session.me" class="muted block"><RouterLink to="/login?redirect=/">{{ t('home.loginForPersonal') }}</RouterLink></p>
  </DataState>
  <section class="join-banner"><span class="shortcut-icon"><Icon name="swords" :size="28" /></span><div><h2>{{ t('home.corner') }}</h2><p>{{ t('home.cornerHint') }}</p></div><RouterLink to="/rules" class="btn">{{ t('nav.rules') }}<Icon name="forward" :size="16" /></RouterLink></section>
</template>

<style scoped>
.arena-hero { display: grid; grid-template-columns: 1.5fr 1fr; min-block-size: 24rem; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); position: relative; }
.hero-copy { padding: var(--sp-7); position: relative; z-index: 1; }
.eyebrow { color: var(--accent); font-size: var(--fs-sm); display: flex; align-items: center; gap: var(--sp-2); margin-block-end: var(--sp-5); }
.accent-line { inline-size: 24px; block-size: 2px; background: currentColor; }
h1 { font-size: clamp(2rem, 3.5vw, 3.5rem); line-height: 1.4; max-inline-size: 15ch; margin-block-end: var(--sp-4); }
.hero-description { color: var(--text-muted); max-inline-size: 48ch; margin: 0; }
.hero-actions { margin-block-start: var(--sp-5); }
.hero-emblem { position: relative; display: grid; place-content: center; justify-items: center; background: radial-gradient(ellipse at center, var(--accent-soft), transparent 70%); }
.trophy-plinth { display: grid; place-items: center; inline-size: 13rem; block-size: 13rem; color: var(--accent); border: 1px solid var(--border); border-radius: var(--radius-lg); transform: rotate(-8deg); background: var(--surface); box-shadow: var(--shadow); }
.trophy-plinth svg { transform: rotate(8deg); }
.orbit { position: absolute; inset: 15%; border: 1px solid var(--border); border-radius: 50%; transform: rotate(-30deg); }
.orbit-two { inset: 5% 20%; transform: rotate(25deg); }
.emblem-caption { position: relative; margin-block-start: var(--sp-5); font-size: var(--fs-sm); color: var(--text-muted); }
.home-search { display: flex; align-items: center; gap: var(--sp-3); margin-block: var(--sp-5) var(--sp-7); padding: var(--sp-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); }
.home-search > svg { margin-inline-start: var(--sp-2); color: var(--text-muted); }
.home-search input { inline-size: 100%; min-inline-size: 0; border: 0; background: transparent; min-block-size: 44px; }
.discovery { margin-block-end: var(--sp-7); }
.discovery h2 { margin-block-end: var(--sp-5); }
.shortcut-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--sp-4); }
.shortcut { position: relative; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--sp-5); text-decoration: none; color: var(--text); background: var(--surface); transition: border-color 200ms, transform 200ms; }
.shortcut:hover { border-color: var(--accent); transform: translateY(-4px); color: var(--text); }
.shortcut-icon { display: inline-flex; align-items: center; justify-content: center; inline-size: 48px; block-size: 48px; background: var(--accent-soft); color: var(--accent); border-radius: var(--radius-md); margin-block-end: var(--sp-4); flex: none; }
.shortcut h3 { margin-block-end: var(--sp-2); }
.shortcut p { color: var(--text-muted); font-size: var(--fs-sm); margin: 0; }
.shortcut-arrow { position: absolute; inset-inline-end: var(--sp-5); inset-block-start: var(--sp-5); color: var(--text-muted); }
.section-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--sp-4); margin-block-end: var(--sp-5); }
.section-heading h2 { margin-block-end: var(--sp-1); }
.section-heading p { font-size: var(--fs-sm); margin: 0; }
.text-link { display: inline-flex; gap: var(--sp-2); align-items: center; font-size: var(--fs-sm); text-decoration: none; }
.feed-stats { display: flex; flex-wrap: wrap; gap: var(--sp-5); margin-block-end: var(--sp-5); }
.feed-stats > div { display: flex; align-items: center; gap: var(--sp-3); padding-inline-end: var(--sp-5); border-inline-end: 1px solid var(--border); }
.feed-stats strong { font-size: var(--fs-2xl); }
.feed-stats span { font-size: var(--fs-xs); color: var(--text-muted); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); gap: var(--sp-4); }
.feed-list { list-style: none; padding: 0; margin: 0; }
.feed-list li { padding-block: var(--sp-3); border-block-end: 1px solid var(--border); display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); }
.feed-list a { text-decoration: none; color: var(--text); }
.join-banner { display: flex; align-items: center; gap: var(--sp-5); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--sp-6); margin-block-start: var(--sp-7); background: var(--surface); }
.join-banner .shortcut-icon { margin: 0; }
.join-banner p { color: var(--text-muted); margin: 0; font-size: var(--fs-sm); }
.join-banner .btn { margin-inline-start: auto; flex: none; }
.small { font-size: var(--fs-xs); }.ok { color: var(--ok); }.block { margin-block-start: var(--sp-4); }
@media (max-width: 1200px) { .shortcut-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .hero-copy { padding: var(--sp-6); } }
@media (max-width: 640px) { .arena-hero { grid-template-columns: 1fr; min-block-size: auto; } .hero-emblem { display: none; } .hero-copy { padding: var(--sp-5); } h1 { font-size: var(--fs-2xl); max-inline-size: 18ch; } .shortcut-grid { gap: var(--sp-3); } .shortcut { padding: var(--sp-4); } .shortcut-arrow { display: none; } .join-banner { flex-wrap: wrap; padding: var(--sp-5); } .join-banner .btn { margin-inline-start: 0; } .home-search { gap: var(--sp-2); } }
</style>
