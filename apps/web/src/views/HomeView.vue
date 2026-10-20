<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { esp06 as esp06Api } from '../api/esp06';
import DataState from '../components/DataState.vue';
import JalaliDate from '../components/JalaliDate.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { t } from '../i18n';
import { session } from '../session';
import { useLoad } from '../useLoad';

/** UX-002 home: personal (games, city, follows, own calendar, followed news) when signed in; public overview otherwise. */
const esp06: typeof esp06Api = esp06Api;
const router = useRouter();
const { data, loading, error, load } = useLoad(() => esp06.home());
const q = ref('');
</script>

<template>
  <section class="hero">
    <h1>{{ t('home.title') }}</h1>
    <p class="lead">{{ t('home.lead') }}</p>
    <form class="row" role="search" @submit.prevent="router.push({ path: '/search', query: { q } })">
      <label class="sr-only" for="home-q">{{ t('nav.search') }}</label>
      <input id="home-q" v-model="q" type="search" class="input grow" dir="auto" :placeholder="t('srch.placeholder')" />
      <button type="submit" class="btn btn-primary">{{ t('news.find') }}</button>
      <RouterLink to="/events" class="btn">{{ t('home.browseEvents') }}</RouterLink>
    </form>
  </section>

  <DataState :loading="loading" :error="error" @retry="load">
    <div v-if="data" class="grid">
      <section v-if="data.personal" class="card stack" aria-labelledby="h-cal">
        <h2 id="h-cal">{{ t('home.myMatches') }}</h2>
        <p v-if="!data.calendar.length" class="muted">{{ t('home.noMatches') }}</p>
        <ul class="list"><li v-for="m in data.calendar" :key="m.matchId"><RouterLink :to="`/matches/${m.matchId}`"><bdi>{{ m.sides.join(' — ') }}</bdi></RouterLink> <span class="small muted"><JalaliDate :iso="m.scheduledAt" /></span></li></ul>
        <RouterLink to="/account/calendar" class="small">{{ t('cal.title') }}</RouterLink>
      </section>
      <section class="card stack" aria-labelledby="h-ev">
        <h2 id="h-ev">{{ data.personal ? t('home.forYou') : t('home.upcoming') }}</h2>
        <p v-if="data.personal && !data.games.length" class="muted small">{{ t('home.pickGames') }} <RouterLink to="/account/profile">{{ t('nav.profile') }}</RouterLink></p>
        <p v-if="!data.events.length" class="muted">{{ t('home.noEvents') }}</p>
        <ul class="list"><li v-for="e in data.events" :key="e.id"><RouterLink :to="`/events/${e.id}`"><bdi>{{ e.name }}</bdi></RouterLink> <StatusBadge :state="e.state" />
          <span v-if="e.inMyCity" class="small ok"> · {{ t('home.inMyCity') }}</span>
          <RouterLink v-if="['active', 'paused'].includes(e.state)" :to="`/events/${e.id}/live`" class="small"> · {{ t('home.live') }}</RouterLink></li></ul>
      </section>
      <section class="card stack" aria-labelledby="h-nw">
        <h2 id="h-nw">{{ t('nav.news') }}</h2>
        <p v-if="!data.news.length" class="muted">{{ t('home.noNews') }}</p>
        <ul class="list"><li v-for="p in data.news" :key="p.id"><RouterLink :to="`/news/${encodeURIComponent(p.slug)}`" dir="auto">{{ p.title }}</RouterLink> <span class="small muted"><JalaliDate :iso="p.publishedAt" format="date" /></span></li></ul>
        <RouterLink to="/news" class="small">{{ t('home.allNews') }}</RouterLink>
      </section>
    </div>
    <p v-if="!session.me" class="muted block"><RouterLink to="/login?redirect=/">{{ t('home.loginForPersonal') }}</RouterLink></p>
  </DataState>
</template>

<style scoped>
.hero { padding: var(--sp-6) 0 var(--sp-5); }
.hero h1 { font-size: var(--fs-2xl); margin-block-end: var(--sp-3); }
.lead { font-size: var(--fs-lg); color: var(--text-muted); max-inline-size: 40ch; }
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-block-start: var(--sp-3); }
.grow { flex: 1 1 14rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: var(--sp-3); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.block { margin-block-start: var(--sp-3); }
.small { font-size: var(--fs-xs); }
.ok { color: var(--ok); }
h2, p { margin: 0; }
</style>
