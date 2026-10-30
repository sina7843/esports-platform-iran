<script setup lang="ts">
import { computed } from 'vue';
import { fa, tr } from '../locale';
import { initialOf, lead, scoreLabel, shortOf, type BroadcastTeam } from '../maps/broadcast';
import QIcon from './QIcon.vue';
import QLiveDot from './QLiveDot.vue';

/** A team as broadcast graphics show it. A plain string is accepted wherever a team is expected. */
export type QScoreBugTeam = BroadcastTeam;
/** Compact OBS score bug: two team tags, score, map/round, optional timer and live tag. transparent drops the backdrop for alpha capture. */
export interface QScoreBugProps {
  home: QScoreBugTeam | string;
  away: QScoreBugTeam | string;
  /** [home, away]; omit before the first result («–»). */
  score?: [number, number];
  live?: boolean;
  liveLabel?: string;
  /** Round or map number, e.g. «نقشه ۲». */
  round?: string;
  /** Map name in Latin (isolated LTR). */
  map?: string;
  timer?: string;
  provisional?: boolean;
  provisionalLabel?: string;
  transparent?: boolean;
  /** Accessible prefix for the group label. Default «امتیاز». */
  label?: string;
}
const p = defineProps<QScoreBugProps>();

const side = (t: QScoreBugTeam | string, i: 0 | 1) => {
  const st = lead(p.score, i);
  return { initial: initialOf(t), name: shortOf(t), cls: ['q-score-bug__score', st ? `q-score-bug__score--${st}` : null], score: p.score ? fa(p.score[i]) : '–' };
};
const a = computed(() => side(p.home, 0));
const b = computed(() => side(p.away, 1));
const hasMeta = computed(() => !!(p.live || p.round || p.map || p.timer || p.provisional));
const groupLabel = computed(() => `${p.label || tr('امتیاز', 'Score')}: ${scoreLabel(p.home, p.away, p.score)}`);
</script>

<template>
  <div :class="['q-score-bug', { 'q-score-bug--transparent': transparent }]" role="group" :aria-label="groupLabel">
    <div class="q-score-bug__plate q-chamfer-md">
      <span class="q-score-bug__team">
        <span class="q-score-bug__crest q-chamfer-sm" aria-hidden="true">{{ a.initial }}</span>
        <bdi class="q-score-bug__name">{{ a.name }}</bdi>
      </span>
      <strong :class="a.cls">{{ a.score }}</strong>
      <span class="q-score-bug__sep" aria-hidden="true">:</span>
      <strong :class="b.cls">{{ b.score }}</strong>
      <span class="q-score-bug__team q-score-bug__team--away">
        <span class="q-score-bug__crest q-chamfer-sm" aria-hidden="true">{{ b.initial }}</span>
        <bdi class="q-score-bug__name">{{ b.name }}</bdi>
      </span>
    </div>
    <div v-if="hasMeta" class="q-score-bug__meta">
      <span v-if="live" class="q-score-bug__live"><QLiveDot />{{ liveLabel || tr('زنده', 'Live') }}</span>
      <span v-if="round" class="q-score-bug__round">{{ round }}</span>
      <span v-if="map" class="q-score-bug__map"><bdi dir="ltr">{{ map }}</bdi></span>
      <time v-if="timer" class="q-score-bug__timer"><QIcon name="clock" :size="14" />{{ timer }}</time>
      <span v-if="provisional" class="q-score-bug__prov">{{ provisionalLabel || tr('نتیجه موقت', 'Provisional result') }}</span>
    </div>
  </div>
</template>
