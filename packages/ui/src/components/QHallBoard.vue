<script setup lang="ts">
import { computed } from 'vue';
import { fa, tr } from '../locale';
import { HALL_CALLUP, initialOf, lead, nameOf, scoreLabel, tx } from '../maps/broadcast';
import QIcon from './QIcon.vue';
import QLiveDot from './QLiveDot.vue';
import QLogo from './QLogo.vue';
import QTricolor from './QTricolor.vue';

export interface QHallBoardMatch {
  id?: string;
  home: string;
  away: string;
  /** [home, away]; live tiles and results. */
  score?: [number, number];
  /** Station label; on a call-up, null shows «ایستگاه اعلام می‌شود». */
  station?: string | null;
  stage?: string;
  time?: string;
  estimated?: boolean;
  callup?: 'called' | 'at_station' | 'ready';
  winner?: 0 | 1;
}
type LabelKey = 'title' | 'live' | 'called' | 'upcoming' | 'results' | 'noStation' | 'empty' | 'liveTag' | 'clock' | 'approx';
/** Venue TV display (16:9, display sizes): live matches with stations, call-ups, upcoming, final results. Scales to its container. */
export interface QHallBoardProps {
  eventName: string;
  /** Formatted server time, e.g. «۱۸:۴۲». */
  clock?: (string) | undefined;
  /** Active public incident notice (danger strip, role="alert"). */
  notice?: (string) | undefined;
  live?: (QHallBoardMatch[]) | undefined;
  called?: (QHallBoardMatch[]) | undefined;
  upcoming?: (QHallBoardMatch[]) | undefined;
  results?: (QHallBoardMatch[]) | undefined;
  maxLive?: (number) | undefined;
  maxCalled?: (number) | undefined;
  maxUpcoming?: (number) | undefined;
  maxResults?: (number) | undefined;
  labels?: (Partial<Record<LabelKey, string>>) | undefined;
  callupLabels?: (Partial<Record<'called' | 'at_station' | 'ready', string>>) | undefined;
  logoVariant?: ('auto' | 'color' | 'white' | 'black') | undefined;
}
const p = withDefaults(defineProps<QHallBoardProps>(), { maxLive: 4, maxCalled: 3, maxUpcoming: 6, maxResults: 5, logoVariant: 'auto' });

const L = computed<Record<LabelKey, string>>(() => ({
  title: tr('نمایشگر سالن', 'Hall display'), live: tr('در حال برگزاری', 'Live now'), called: tr('فراخوان', 'Called up'),
  upcoming: tr('بازی‌های بعدی', 'Upcoming'), results: tr('نتایج نهایی', 'Final results'), approx: tr('زمان تقریبی', 'Estimated time'),
  noStation: tr('ایستگاه اعلام می‌شود', 'Station to be announced'), empty: '—', liveTag: tr('زنده', 'Live'), clock: tr('ساعت سالن', 'Hall clock'),
  ...p.labels,
}));
const liveList = computed(() => (p.live ?? []).slice(0, p.maxLive || 4));
const calledList = computed(() => (p.called ?? []).slice(0, p.maxCalled || 3));
const upcomingList = computed(() => (p.upcoming ?? []).slice(0, p.maxUpcoming || 6));
const resultList = computed(() => (p.results ?? []).slice(0, p.maxResults || 5));
const callupText = (cu: 'called' | 'at_station' | 'ready') => p.callupLabels?.[cu] || tx(HALL_CALLUP[cu]) || cu;
const sides = (m: QHallBoardMatch) => ([0, 1] as const).map((side) => {
  const st = lead(m.score, side);
  const t = side === 0 ? m.home : m.away;
  return { side, t, cls: ['q-hall-board__team', st ? `q-hall-board__team--${st}` : null], score: m.score ? fa(m.score[side]) : '–' };
});
const frameLabel = computed(() => L.value.title + (p.eventName ? ` — ${p.eventName}` : ''));
</script>

<template>
  <div class="q-hall-board">
    <div class="q-hall-board__frame" role="region" :aria-label="frameLabel">
      <header class="q-hall-board__head">
        <div class="q-hall-board__logo"><QLogo :size="72" :variant="logoVariant" /></div>
        <div class="q-hall-board__titles">
          <span class="q-hall-board__kicker"><QTricolor class="q-hall-board__tri" />{{ L.title }}</span>
          <h1 class="q-hall-board__event">{{ eventName }}</h1>
        </div>
        <div v-if="clock" class="q-hall-board__clock">
          <span class="q-hall-board__clock-label">{{ L.clock }}</span>
          <time class="q-hall-board__clock-value">{{ clock }}</time>
        </div>
      </header>
      <p v-if="notice" class="q-hall-board__notice" role="alert"><QIcon name="alert" :size="24" class="q-hall-board__notice-icon" /><bdi>{{ notice }}</bdi></p>
      <div class="q-hall-board__grid">
        <div class="q-hall-board__col">
          <section class="q-hall-board__zone q-hall-board__zone--live" :aria-label="L.live">
            <h2 class="q-hall-board__zone-title"><QLiveDot /><span>{{ L.live }}</span></h2>
            <ul v-if="liveList.length" class="q-hall-board__tiles">
              <li v-for="(m, i) in liveList" :key="m.id || i" class="q-hall-board__tile q-hall-board__chamfer-m q-chamfer-ring" :aria-label="scoreLabel(m.home, m.away, m.score)">
                <div class="q-hall-board__tile-head">
                  <span class="q-hall-board__live-tag"><QLiveDot />{{ L.liveTag }}</span>
                  <span v-if="m.stage" class="q-hall-board__stage">{{ m.stage }}</span>
                  <span v-if="m.station" class="q-hall-board__station">{{ m.station }}</span>
                </div>
                <div v-for="s in sides(m)" :key="s.side" :class="s.cls">
                  <span class="q-hall-board__crest q-hall-board__chamfer-s q-chamfer-ring" aria-hidden="true">{{ initialOf(s.t) }}</span>
                  <bdi class="q-hall-board__team-name">{{ nameOf(s.t) }}</bdi>
                  <strong class="q-hall-board__team-score">{{ s.score }}</strong>
                </div>
              </li>
            </ul>
            <p v-else class="q-hall-board__empty">{{ L.empty }}</p>
          </section>
          <section class="q-hall-board__zone q-hall-board__zone--called" :aria-label="L.called">
            <h2 class="q-hall-board__zone-title"><span class="q-hall-board__marker q-hall-board__marker--called" aria-hidden="true" /><span>{{ L.called }}</span></h2>
            <ul v-if="calledList.length" class="q-hall-board__calls">
              <li v-for="(m, i) in calledList" :key="m.id || i" :class="['q-hall-board__call', `q-hall-board__call--${m.callup || 'called'}`]">
                <span class="q-hall-board__call-mark" aria-hidden="true" />
                <span class="q-hall-board__call-teams"><bdi>{{ nameOf(m.home) }}</bdi><span class="q-hall-board__dash"> — </span><bdi>{{ nameOf(m.away) }}</bdi></span>
                <span :class="['q-hall-board__call-station', { 'q-hall-board__call-station--tbd': !m.station }]">{{ m.station || L.noStation }}</span>
                <span class="q-hall-board__call-state">{{ callupText(m.callup || 'called') }}</span>
              </li>
            </ul>
            <p v-else class="q-hall-board__empty">{{ L.empty }}</p>
          </section>
        </div>
        <div class="q-hall-board__col">
          <section class="q-hall-board__zone q-hall-board__zone--upcoming" :aria-label="L.upcoming">
            <h2 class="q-hall-board__zone-title"><span class="q-hall-board__marker q-hall-board__marker--next" aria-hidden="true" /><span>{{ L.upcoming }}</span></h2>
            <ul v-if="upcomingList.length" class="q-hall-board__rows">
              <li v-for="(m, i) in upcomingList" :key="m.id || i" class="q-hall-board__row">
                <span class="q-hall-board__time"><span v-if="m.estimated" class="q-hall-board__approx" :title="L.approx">~</span>{{ m.time }}<span v-if="m.estimated" class="q-sr">{{ ' ' + L.approx }}</span></span>
                <span class="q-hall-board__row-teams"><bdi>{{ nameOf(m.home) }}</bdi><span class="q-hall-board__dash"> — </span><bdi>{{ nameOf(m.away) }}</bdi></span>
                <span class="q-hall-board__row-meta">{{ m.station || '' }}</span>
              </li>
            </ul>
            <p v-else class="q-hall-board__empty">{{ L.empty }}</p>
          </section>
          <section class="q-hall-board__zone q-hall-board__zone--results" :aria-label="L.results">
            <h2 class="q-hall-board__zone-title"><span class="q-hall-board__marker q-hall-board__marker--done" aria-hidden="true" /><span>{{ L.results }}</span></h2>
            <ul v-if="resultList.length" class="q-hall-board__rows">
              <li v-for="(m, i) in resultList" :key="m.id || i" class="q-hall-board__row q-hall-board__row--result" :aria-label="scoreLabel(m.home, m.away, m.score)">
                <bdi :class="['q-hall-board__res-team', { 'q-hall-board__res-team--win': m.winner === 0 }]">{{ nameOf(m.home) }}</bdi>
                <span class="q-hall-board__res-score">
                  <span :class="m.winner === 0 ? 'q-hall-board__res-win' : undefined">{{ m.score ? fa(m.score[0]) : '' }}</span>
                  <span class="q-hall-board__res-sep">–</span>
                  <span :class="m.winner === 1 ? 'q-hall-board__res-win' : undefined">{{ m.score ? fa(m.score[1]) : '' }}</span>
                </span>
                <bdi :class="['q-hall-board__res-team q-hall-board__res-team--end', { 'q-hall-board__res-team--win': m.winner === 1 }]">{{ nameOf(m.away) }}</bdi>
              </li>
            </ul>
            <p v-else class="q-hall-board__empty">{{ L.empty }}</p>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
