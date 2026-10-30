<script setup lang="ts">
import { computed } from 'vue';
import { fa, tr } from '../locale';
import { MATCH_STATE, SCORED, initialOf, lead, matchStateLabel, sep, statusBadge, tbd, type MatchCardState } from '../maps/competition';
import QBadge from './QBadge.vue';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';

export interface QMatchCardTeam { name?: string; initial?: string; logo?: string; score?: number; forfeit?: boolean }
/** Compact match row/card for lists, schedules and the hall: two crests, scores, the match state and a meta line. */
export interface QMatchCardProps {
  home: QMatchCardTeam;
  away: QMatchCardTeam;
  state: MatchCardState;
  stateLabel?: string;
  /** «۱۸:۳۰»; green while upcoming. */
  time?: string;
  date?: string;
  /** Overrides the derived winner (final). */
  winner?: 'home' | 'away';
  stage?: string;
  round?: string;
  station?: string;
  /** Latin game tag. */
  game?: string;
  href?: string;
  variant?: 'row' | 'card';
  /** Extra label at the end of the foot row (also the `extra` slot). Keep it non-interactive when href is set. */
  extra?: string;
}
const p = withDefaults(defineProps<QMatchCardProps>(), { state: 'scheduled' });
const slots = defineSlots<{ extra?: () => unknown }>();

const scored = computed(() => !!SCORED[p.state] && p.home.score != null && p.away.score != null);
const l = computed(() => (scored.value ? lead(p.home.score, p.away.score) : 0));
const win = computed(() => p.winner || (p.state === 'final' && l.value ? (l.value > 0 ? 'home' : 'away') : null));
const meta = computed(() => [p.stage, p.round, p.station].filter(Boolean).join(' · '));
const showBadge = computed(() => p.state !== 'scheduled' && p.state !== 'live');
const badge = computed(() => statusBadge(MATCH_STATE, p.state, p.stateLabel));
const sides = computed(() => ([[p.home, 'home', 1], [p.away, 'away', -1]] as const).map(([t, key, dir]) => {
  const isWin = win.value === key;
  return {
    t, key, isWin,
    cls: ['q-match-card__side', { 'q-match-card__side--win': isWin, 'q-match-card__side--lose': !!win.value && !isWin, 'q-match-card__side--tbd': !t.name }],
    crestText: t.name ? initialOf(t) : tr('؟', '?'),
    logo: t.name ? t.logo : undefined,
    scoreCls: ['q-match-card__score', { 'q-match-card__score--lead': scored.value && l.value === dir, 'q-match-card__score--trail': scored.value && l.value === -dir }],
  };
}));
const label = computed(() => (p.home.name || tbd())
  + (scored.value ? ` ${fa(p.home.score)} – ${fa(p.away.score)} ` : tr(' در برابر ', ' vs '))
  + (p.away.name || tbd())
  + sep() + (p.state === 'scheduled' && p.time ? tr('ساعت ', 'at ') + p.time : matchStateLabel(p.state))
  + (meta.value ? sep() + meta.value : ''));
const rootAttrs = computed(() => (p.href ? { href: p.href, 'aria-label': label.value } : {}));
</script>

<template>
  <component
    :is="href ? QLink : 'div'"
    v-bind="rootAttrs"
    :class="['q-match-card', { 'q-match-card--card': variant === 'card', 'q-match-card--live': variant === 'card' && state === 'live', 'q-match-card--cancelled': state === 'cancelled', 'q-match-card--link': !!href }]"
  >
    <span class="q-match-card__in">
      <span class="q-match-card__when">
        <QBadge v-if="state === 'live'" tone="live">{{ tr('زنده', 'Live') }}</QBadge>
        <span v-else-if="time" :class="['q-match-card__time', { 'q-match-card__time--past': scored || state === 'cancelled' }]">{{ time }}</span>
        <span v-else class="q-match-card__time q-match-card__time--past">—</span>
        <span v-if="date" class="q-match-card__date">{{ date }}</span>
      </span>
      <span class="q-match-card__sides">
        <span v-for="s in sides" :key="s.key" :class="s.cls">
          <span class="q-match-card__crest q-chamfer-sm" aria-hidden="true"><img v-if="s.logo" :src="s.logo" alt="" /><template v-else>{{ s.crestText }}</template></span>
          <bdi class="q-match-card__name">{{ s.t.name || tbd() }}</bdi>
          <QIcon v-if="s.isWin" name="check" :size="16" :stroke-width="2.6" class="q-match-card__check" :label="tr('برنده', 'Winner')" />
          <span v-if="s.t.forfeit" class="micro q-match-card__ff">{{ tr('باخت فنی', 'Forfeit') }}</span>
          <span v-if="scored" :class="s.scoreCls">{{ fa(s.t.score) }}</span>
        </span>
      </span>
      <span v-if="game" class="q-match-card__game q-ltr">{{ game }}</span>
      <span v-if="showBadge || meta || extra || slots.extra" class="q-match-card__foot">
        <QBadge v-if="showBadge" v-bind="badge.props">{{ badge.label }}</QBadge>
        <span v-if="meta" class="q-match-card__meta">{{ meta }}</span>
        <span v-if="extra || slots.extra" class="q-match-card__extra"><slot name="extra">{{ extra }}</slot></span>
      </span>
    </span>
  </component>
</template>
