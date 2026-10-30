<script setup lang="ts">
import { computed } from 'vue';
import { fa, tr } from '../locale';
import { MEDAL, initialOf, signed } from '../maps/competition';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';

/** One row of a rating leaderboard: rank, avatar, name + LTR handle, game, rating and the latest delta with a trend icon. */
export interface QLeaderboardRowProps {
  rank: number | null;
  name: string;
  handle?: (string) | undefined;
  avatar?: (string) | undefined;
  initial?: (string) | undefined;
  kind?: ('player' | 'team') | undefined;
  game?: (string) | undefined;
  rating: number;
  /** Rating deviation, shown as ±. */
  rd?: (number) | undefined;
  delta?: (number) | undefined;
  mine?: (boolean) | undefined;
  inactive?: (boolean) | undefined;
  href?: (string) | undefined;
  as?: (string) | undefined;
}
const p = defineProps<QLeaderboardRowProps>();

const d = computed(() => p.delta || 0);
const med = computed(() => (p.rank != null && p.rank >= 1 && p.rank <= 3 ? MEDAL[p.rank - 1] : undefined));
const tag = computed(() => (p.href ? QLink : (p.as || 'div')));
const rootAttrs = computed(() => (p.href ? { href: p.href } : {}));
const trend = computed(() => (d.value > 0 ? ['22 7 13.5 15.5 8.5 10.5 2 17', '16 7 22 7 22 13'] : d.value < 0 ? ['22 17 13.5 8.5 8.5 13.5 2 7', '16 17 22 17 22 11'] : null));
</script>

<template>
  <component
    :is="tag"
    v-bind="rootAttrs"
    :class="['q-leaderboard-row', { 'q-leaderboard-row--mine': mine, 'q-leaderboard-row--inactive': inactive, 'q-leaderboard-row--link': !!href }]"
    :aria-current="mine ? 'true' : undefined"
  >
    <span class="q-leaderboard-row__in">
      <span :class="['q-leaderboard-row__rank', med ? `q-leaderboard-row__rank--${med}` : null]">
        <span class="q-sr">{{ tr('رتبه ', 'Rank ') }}</span>
        <QIcon v-if="med" name="award" :size="16" />
        <span class="q-num">{{ rank == null ? '—' : fa(rank) }}</span>
      </span>
      <span class="q-leaderboard-row__who">
        <span :class="['q-leaderboard-row__avatar', { 'q-leaderboard-row__avatar--team q-chamfer-xs': kind === 'team' }]" aria-hidden="true">
          <img v-if="avatar" :src="avatar" alt="" /><template v-else>{{ initialOf(p) }}</template>
        </span>
        <span class="q-leaderboard-row__names">
          <span class="q-leaderboard-row__nm">
            <bdi class="label q-leaderboard-row__name">{{ name }}</bdi>
            <span v-if="mine" class="micro q-leaderboard-row__you">{{ tr('شما', 'You') }}</span>
          </span>
          <bdi v-if="handle" class="q-ltr caption q-leaderboard-row__handle">{{ handle }}</bdi>
        </span>
      </span>
      <span v-if="game" class="q-leaderboard-row__game q-ltr">{{ game }}</span>
      <span class="q-leaderboard-row__rating">
        <span class="q-sr">{{ tr('امتیاز ', 'Rating ') }}</span>
        <bdi class="numeral q-ltr">{{ fa(rating) }}</bdi>
        <span v-if="rd != null" class="caption q-leaderboard-row__rd q-ltr">±{{ fa(rd) }}</span>
      </span>
      <span :class="['q-leaderboard-row__delta', d > 0 ? 'q-leaderboard-row__delta--up' : d < 0 ? 'q-leaderboard-row__delta--down' : null]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="q-icon">
          <template v-if="trend"><polyline v-for="(pt, i) in trend" :key="i" :points="pt" /></template>
          <path v-else d="M5 12h14" />
        </svg>
        <bdi class="q-ltr">{{ signed(d) }}</bdi>
        <span class="q-sr">{{ d > 0 ? tr(' افزایش', ' up') : d < 0 ? tr(' کاهش', ' down') : tr(' بدون تغییر', ' no change') }}</span>
      </span>
    </span>
  </component>
</template>
