<script setup lang="ts">
import { computed } from 'vue';
import { fa, tr } from '../locale';
import { FORM, MEDAL, MEDAL_NAME, initialOf, isEn, sep, signed } from '../maps/competition';
import QBadge from './QBadge.vue';
import QIcon from './QIcon.vue';

export interface QStandingsTableRow {
  id?: string;
  rank?: number;
  name: string;
  initial?: string;
  logo?: string;
  href?: string;
  played: number;
  wins: number;
  draws?: number;
  losses: number;
  diff: number;
  points: number;
  /** Oldest → newest; newest ends at inline-end. */
  form?: Array<'W' | 'D' | 'L'>;
  /** Places moved since the last round (+ up, − down). */
  change?: number;
  /** The viewer's team. */
  mine?: boolean;
  /** Unresolved complete tie («=»). */
  tie?: boolean;
}
/** Group/league standings: medals for 1–3, change arrows, W/D/L, signed diff, bold points, last-5 form; highlights the viewer's team. */
export interface QStandingsTableProps {
  rows: QStandingsTableRow[];
  /** default «جدول رتبه‌بندی» */
  caption?: (string) | undefined;
  /** Visible heading; the caption then becomes screen-reader only. */
  title?: (string) | undefined;
  participantLabel?: (string) | undefined;
  provisional?: (boolean) | undefined;
  showDraws?: (boolean) | undefined;
  showForm?: (boolean) | undefined;
  showChange?: (boolean) | undefined;
  footnote?: (string) | undefined;
}
const p = withDefaults(defineProps<QStandingsTableProps>(), { showDraws: true, showForm: true, showChange: true });

const cap = computed(() => p.caption || tr('جدول رتبه‌بندی', 'Standings'));
/** Column header: full word in fa; in en a short head (W / D / L) in <abbr> with the full word. */
const heads = computed(() => ({
  w: { en: isEn(), text: tr('برد', 'W'), full: 'Wins' },
  d: { en: isEn(), text: tr('مساوی', 'D'), full: 'Draws' },
  l: { en: isEn(), text: tr('باخت', 'L'), full: 'Losses' },
  diff: { en: isEn(), text: tr('تفاضل', 'Diff'), full: 'Difference' },
}));
const list = computed(() => p.rows.map((r, i) => {
  const rank = r.rank != null ? r.rank : i + 1;
  const mi = rank >= 1 && rank <= 3 ? rank - 1 : -1;
  const med = mi >= 0 ? MEDAL[mi] : undefined;
  const medName = mi >= 0 ? MEDAL_NAME[mi] : undefined;
  const ch = r.change || 0;
  const form = (r.form ?? []).map((f) => FORM[f] ?? FORM.D);
  return {
    r, key: r.id || i, rank, med, ch,
    medLabel: medName ? tr(medName[0], medName[1]) : '',
    chText: ch > 0 ? tr(`${fa(ch)} پله صعود`, `up ${ch} ${ch === 1 ? 'place' : 'places'}`)
      : ch < 0 ? tr(`${fa(-ch)} پله نزول`, `down ${-ch} ${ch === -1 ? 'place' : 'places'}`)
        : tr('بدون تغییر', 'no change'),
    form: form.map((d) => ({ cls: `q-standings-table__dot--${d[4]}`, letter: tr(d[0], d[1]), word: tr(d[2], d[3]) })),
    formAria: tr('نتایج اخیر: ', 'Recent results: ') + form.map((d) => tr(d[2], d[3])).join(sep()),
  };
}));
</script>

<template>
  <div class="q-standings-table">
    <div v-if="provisional || title" class="q-standings-table__bar">
      <h3 v-if="title" class="h4 q-standings-table__title">{{ title }}</h3>
      <QBadge v-if="provisional" tone="warning" icon="clock">{{ tr('موقت — تا نهایی‌شدن نتایج تغییر می‌کند', 'Provisional — changes until results are final') }}</QBadge>
    </div>
    <div class="q-standings-table__scroll" role="region" tabindex="0" :aria-label="cap">
      <table class="q-standings-table__table body-sm">
        <caption :class="title ? 'q-sr' : 'q-standings-table__caption caption'">{{ cap }}</caption>
        <thead>
          <tr>
            <th scope="col" class="q-standings-table__rank">{{ tr('رتبه', 'Rank') }}</th>
            <th scope="col" class="q-standings-table__team">{{ participantLabel || tr('تیم', 'Team') }}</th>
            <th scope="col" class="q-standings-table__n"><abbr :title="tr('بازی', 'Played')">{{ tr('بازی', 'Played') }}</abbr></th>
            <th scope="col" class="q-standings-table__n"><abbr v-if="heads.w.en" :title="heads.w.full">{{ heads.w.text }}</abbr><template v-else>{{ heads.w.text }}</template></th>
            <th v-if="showDraws" scope="col" class="q-standings-table__n"><abbr v-if="heads.d.en" :title="heads.d.full">{{ heads.d.text }}</abbr><template v-else>{{ heads.d.text }}</template></th>
            <th scope="col" class="q-standings-table__n"><abbr v-if="heads.l.en" :title="heads.l.full">{{ heads.l.text }}</abbr><template v-else>{{ heads.l.text }}</template></th>
            <th scope="col" class="q-standings-table__n"><abbr v-if="heads.diff.en" :title="heads.diff.full">{{ heads.diff.text }}</abbr><template v-else>{{ heads.diff.text }}</template></th>
            <th scope="col" class="q-standings-table__n">{{ tr('امتیاز', 'Points') }}</th>
            <th v-if="showForm" scope="col" class="q-standings-table__form-h">{{ tr(`${fa(5)} بازی اخیر`, 'Last 5') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in list" :key="x.key" :class="[{ 'q-standings-table__row--mine': x.r.mine }, x.med ? `q-standings-table__row--${x.med}` : null]" :aria-current="x.r.mine ? 'true' : undefined">
            <td class="q-standings-table__rank">
              <span class="q-standings-table__rk">
                <QIcon v-if="x.med" name="award" :size="16" :label="x.medLabel" />
                <span class="q-num">{{ fa(x.rank) }}</span>
                <span v-if="x.r.tie" class="q-standings-table__tie" :title="tr('تساوی کامل؛ طبق قوانین (مسابقه اضافی یا تصمیم مسئول) تعیین می‌شود', 'Complete tie; decided by the rules (extra match or official)')">=</span>
                <span v-if="showChange" :class="['q-standings-table__chg', x.ch > 0 ? 'q-standings-table__chg--up' : x.ch < 0 ? 'q-standings-table__chg--down' : null]">
                  <QIcon :name="x.ch > 0 ? 'chevron-up' : x.ch < 0 ? 'chevron-down' : 'minus'" :size="14" :stroke-width="2.6" />
                  <span class="q-sr">{{ x.chText }}</span>
                </span>
              </span>
            </td>
            <th scope="row" class="q-standings-table__team">
              <span class="q-standings-table__who">
                <span class="q-standings-table__crest q-chamfer-xs" aria-hidden="true"><img v-if="x.r.logo" :src="x.r.logo" alt="" /><template v-else>{{ initialOf(x.r) }}</template></span>
                <a v-if="x.r.href" :href="x.r.href" class="q-standings-table__name"><bdi>{{ x.r.name }}</bdi></a>
                <bdi v-else class="q-standings-table__name">{{ x.r.name }}</bdi>
                <span v-if="x.r.mine" class="q-standings-table__you micro">{{ tr('تیم شما', 'Your team') }}</span>
              </span>
            </th>
            <td class="q-standings-table__n">{{ fa(x.r.played) }}</td>
            <td class="q-standings-table__n">{{ fa(x.r.wins) }}</td>
            <td v-if="showDraws" class="q-standings-table__n">{{ fa(x.r.draws || 0) }}</td>
            <td class="q-standings-table__n">{{ fa(x.r.losses) }}</td>
            <td class="q-standings-table__n"><bdi :class="['q-ltr', { 'q-standings-table__pos': x.r.diff > 0, 'q-standings-table__neg': x.r.diff < 0 }]">{{ signed(x.r.diff || 0) }}</bdi></td>
            <td class="q-standings-table__n q-standings-table__pts">{{ fa(x.r.points) }}</td>
            <td v-if="showForm" class="q-standings-table__form-c">
              <span class="q-standings-table__form" role="img" :aria-label="x.formAria">
                <span v-for="(d, j) in x.form" :key="j" :class="['q-standings-table__dot', d.cls]" :title="d.word" aria-hidden="true">{{ d.letter }}</span>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="footnote" class="caption q-standings-table__foot">{{ footnote }}</p>
  </div>
</template>
