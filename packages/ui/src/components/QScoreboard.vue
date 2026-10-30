<script setup lang="ts">
import { computed } from 'vue';
import { fa, tr } from '../locale';
import { MATCH_STATE, SCORED, initialOf, lead, sep, statusBadge, type MatchCardState } from '../maps/competition';
import QBadge from './QBadge.vue';
import QCard from './QCard.vue';
import QIcon from './QIcon.vue';
import QLiveDot from './QLiveDot.vue';

export interface QScoreboardTeam { name: string; initial?: string; logo?: string; /** «بذر ۱ · ۲ برد پیاپی» — parts split on « · ». */ line?: string; score?: number }
export interface QScoreboardMap { name: string; /** «13–7»; digits are localised (fa()). */ score?: string; status: 'done' | 'live' | 'upcoming' }
/** The big VS header: crests, team names, 72px score, map chips and a link to the match room. Live gets the red border and glow. */
export interface QScoreboardProps {
  home: QScoreboardTeam;
  away: QScoreboardTeam;
  state?: MatchCardState;
  /** Shortcut for state 'live'. */
  live?: boolean;
  stateLabel?: string;
  /** Shown instead of the score before the match starts. */
  time?: string;
  eventName?: string;
  /** «یک‌چهارم نهایی · نقشه ۲ از ۳» */
  context?: string;
  maps?: QScoreboardMap[];
  roomHref?: string;
  /** default «ورود به اتاق مسابقه» */
  roomLabel?: string;
}
const p = defineProps<QScoreboardProps>();

const st = computed<string>(() => p.state || (p.live ? 'live' : 'scheduled'));
const scored = computed(() => !!SCORED[st.value] && p.home.score != null && p.away.score != null);
const l = computed(() => (scored.value ? lead(p.home.score, p.away.score) : 0));
const won = computed(() => (st.value === 'final' && l.value ? (l.value > 0 ? 0 : 1) : -1));
const badge = computed(() => statusBadge(MATCH_STATE, st.value, p.stateLabel));
const ctx = computed(() => [p.eventName, p.context].filter(Boolean).join(' · '));
const teams = computed(() => [p.home, p.away].map((t, i) => ({ t, end: i === 1, won: won.value === i, parts: t.line ? String(t.line).split(' · ') : [] })));
const scoreAria = computed(() => `${tr('نتیجه: ', 'Result: ')}${p.home.name} ${fa(p.home.score)}${sep()}${p.away.name} ${fa(p.away.score)}`);
const mapList = computed(() => (p.maps ?? []).map((m) => ({ ...m, s: m.status || 'upcoming' })));
const mapStatus = (s: string) => (s === 'done' ? tr('پایان‌یافته', 'finished') : s === 'live' ? tr('زنده', 'live') : tr('در پیش', 'upcoming'));
</script>

<template>
  <QCard :live="st === 'live'" class="q-scoreboard">
    <div class="q-scoreboard__bar">
      <QBadge v-if="st === 'live'" tone="live">{{ tr('زنده', 'Live') }}</QBadge>
      <QBadge v-else v-bind="badge.props">{{ badge.label }}</QBadge>
      <span class="body-sm q-scoreboard__ctx">{{ ctx }}</span>
      <a v-if="roomHref" class="label q-scoreboard__room" :href="roomHref">{{ roomLabel || tr('ورود به اتاق مسابقه', 'Enter match room') }}<QIcon name="arrow-right" :size="16" flip /></a>
    </div>
    <div class="q-scoreboard__vsrow">
      <template v-for="(x, i) in teams" :key="i">
        <div v-if="i === 1 && scored" class="q-scoreboard__score" role="group" :aria-label="scoreAria">
          <strong :class="['score', l > 0 ? 'q-scoreboard__lead' : l < 0 ? 'q-scoreboard__trail' : null]" aria-hidden="true">{{ fa(home.score) }}</strong>
          <span class="q-scoreboard__colon" aria-hidden="true">:</span>
          <strong :class="['score', l < 0 ? 'q-scoreboard__lead' : l > 0 ? 'q-scoreboard__trail' : null]" aria-hidden="true">{{ fa(away.score) }}</strong>
        </div>
        <div v-else-if="i === 1" class="q-scoreboard__score q-scoreboard__score--time">
          <span class="micro q-scoreboard__vs">{{ st === 'cancelled' ? tr('لغوشده', 'Cancelled') : tr('شروع', 'Starts') }}</span>
          <strong class="q-scoreboard__time">{{ time || '—' }}</strong>
        </div>
        <div :class="['q-scoreboard__team', { 'q-scoreboard__team--end': x.end }]">
          <span class="q-scoreboard__crest q-chamfer-lg" aria-hidden="true"><img v-if="x.t.logo" :src="x.t.logo" alt="" /><template v-else>{{ initialOf(x.t) }}</template></span>
          <div class="q-scoreboard__who">
            <span class="q-scoreboard__nm">
              <bdi class="h3 q-scoreboard__name">{{ x.t.name }}</bdi>
              <QIcon v-if="x.won" name="check" :size="20" :stroke-width="2.8" class="q-scoreboard__check" :label="tr('برنده', 'Winner')" />
            </span>
            <span v-if="x.parts.length" class="caption q-scoreboard__line">
              <template v-for="(part, j) in x.parts" :key="j"><span v-if="j" class="q-scoreboard__sep" aria-hidden="true" /><span>{{ part }}</span></template>
            </span>
          </div>
        </div>
      </template>
    </div>
    <ol v-if="mapList.length" class="q-scoreboard__maps" :aria-label="tr('نقشه‌ها', 'Maps')">
      <li v-for="(m, i) in mapList" :key="i" :class="['q-scoreboard__map', `q-scoreboard__map--${m.s}`]">
        <QIcon v-if="m.s === 'done'" name="check" :size="14" :stroke-width="2.6" />
        <QLiveDot v-else-if="m.s === 'live'" />
        <span class="q-ltr">{{ m.name }} · {{ m.score != null && m.score !== '' ? fa(m.score) : '—' }}</span>
        <span class="q-sr">{{ sep() + mapStatus(m.s) }}</span>
      </li>
    </ol>
  </QCard>
</template>
