<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, ref, useId } from 'vue';
import { fa, isRtl, tr } from '../locale';
import { MATCH_STATE, bracketHint, bracketSlotLabel, matchStateLabel, roundName, tbd, type MatchCardState } from '../maps/competition';
import { useWidth } from '../composables/useWidth';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';
import QLiveDot from './QLiveDot.vue';

export interface QBracketSide { name?: string; seed?: number; score?: number; /** Text for an empty slot, default «در انتظار». */ placeholder?: string }
export interface QBracketMatch {
  id: string;
  label?: string;
  state: MatchCardState;
  time?: string;
  top: QBracketSide;
  bottom: QBracketSide;
  winner?: 'top' | 'bottom' | null;
  /** «فقط در صورت نیاز» (grand-final reset). */
  conditional?: boolean;
  href?: string;
}
export interface QBracketRound { label?: string; matches: QBracketMatch[] }
export interface QBracketSection { key?: string; label?: string; rounds: QBracketRound[] }
/**
 * Elimination bracket. `rounds` (single elimination) or `sections` (double elimination). First round at inline-start;
 * roving tabindex per section, ↑ ↓ within a round, ← → between rounds (RTL-aware), Home / End, Enter / click emits `open`
 * (falls back to navigating to match.href when nobody listens). Below `breakpoint` (720px) one round at a time.
 */
export interface QBracketProps {
  rounds?: (QBracketRound[]) | undefined;
  sections?: (QBracketSection[]) | undefined;
  title?: (string) | undefined;
  layout?: ('auto' | 'full' | 'stepped') | undefined;
  breakpoint?: (number) | undefined;
  'aria-label'?: (string) | undefined;
}
const p = withDefaults(defineProps<QBracketProps>(), { layout: 'auto', breakpoint: 720 });
const emit = defineEmits<{ open: [match: QBracketMatch] }>();
const inst = getCurrentInstance();
/** Vue normalises the declared 'aria-label' prop key to ariaLabel. */
const ariaLabel = computed(() => (p as { ariaLabel?: string }).ariaLabel);
const uid = useId();

const root = ref<HTMLElement | null>(null);
const width = useWidth(root);
const narrow = computed(() => p.layout === 'stepped' || (p.layout !== 'full' && width.value > 0 && width.value < p.breakpoint));
const cur = ref<number[]>([]);
const focusKey = ref<(string | null)[]>([]);

const keyOf = (ri: number, mi: number) => `${ri}:${mi}`;
const secs = computed(() => (p.sections ?? [{ key: 'main', label: p.title, rounds: p.rounds ?? [] }]).map((sec, si) => {
  const rounds = sec.rounds ?? [];
  const c = cur.value[si] ?? 0;
  const visible = narrow.value ? [Math.min(c, rounds.length - 1)] : rounds.map((_, i) => i);
  const v0 = visible[0] ?? 0;
  const activeKey = focusKey.value[si] || (rounds[v0]?.matches[0] ? keyOf(v0, 0) : null);
  const columns = visible.filter((ri) => rounds[ri]).map((ri) => {
    const rd = rounds[ri]!;
    const next = rounds[ri + 1];
    const name = roundName(rounds, ri);
    const showOut = !narrow.value && !!next;
    const showIn = !narrow.value && ri > 0 && !!rounds[ri - 1];
    const paired = showOut && !!next && next.matches.length * 2 === rd.matches.length;
    const pairs: number[] = [];
    if (paired) for (let i = 0; i < rd.matches.length; i += 2) pairs.push(i);
    return { ri, rd, name, showOut, showIn, paired, pairs };
  });
  return { si, key: sec.key || si, label: sec.label, rounds, cur: c, visible, activeKey, columns };
}));

function setCur(si: number, v: number) {
  cur.value[si] = v;
  focusKey.value[si] = null;
}
function focusSlot(si: number, ri: number, mi: number) {
  const k = keyOf(ri, mi);
  focusKey.value[si] = k;
  void nextTick(() => {
    const sec = root.value?.querySelectorAll('.q-bracket__section')[si];
    const el = sec?.querySelector<HTMLElement>(`[data-slot="${k}"]`);
    el?.focus();
  });
}
function open(m: QBracketMatch) {
  if (inst?.vnode.props?.onOpen) emit('open', m);
  else if (m.href) window.location.assign(m.href);
}
function onKey(e: KeyboardEvent, si: number, ri: number, mi: number) {
  const sec = secs.value[si];
  if (!sec) return;
  const { rounds, visible } = sec;
  /* Rounds flow from inline-start, so "forward" is the arrow pointing to inline-end: ← in RTL, → in LTR. */
  const target = e.currentTarget as HTMLElement | null;
  const cs = target && typeof getComputedStyle === 'function' ? getComputedStyle(target).direction : '';
  const rtl = cs ? cs === 'rtl' : isRtl();
  let r = ri;
  let i = mi;
  if (e.key === 'ArrowDown') i++;
  else if (e.key === 'ArrowUp') i--;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const fwd = (e.key === 'ArrowLeft') === rtl;
    if (narrow.value) {
      const nr = ri + (fwd ? 1 : -1);
      if (nr < 0 || nr >= rounds.length) { e.preventDefault(); return; }
      cur.value[si] = nr;
      r = nr;
    } else {
      const nv = visible.indexOf(ri) + (fwd ? 1 : -1);
      if (nv < 0 || nv >= visible.length) { e.preventDefault(); return; }
      r = visible[nv]!;
    }
    i = Math.floor((mi * (rounds[r]?.matches.length ?? 0)) / (rounds[ri]?.matches.length || 1));
  } else if (e.key === 'Home') i = 0;
  else if (e.key === 'End') i = (rounds[ri]?.matches.length ?? 1) - 1;
  else return;
  e.preventDefault();
  i = Math.max(0, Math.min(i, (rounds[r]?.matches.length ?? 1) - 1));
  focusSlot(si, r, i);
}

function head(m: QBracketMatch): { cls: string; text: string } | null {
  if (m.state === 'live') return null;
  if (m.state === 'final') return { cls: 'q-bracket__done', text: tr('نهایی', 'Final') };
  if (m.state === 'cancelled') return { cls: 'q-bracket__cancel', text: tr('لغوشده', 'Cancelled') };
  if (m.state === 'provisional') return { cls: 'q-bracket__prov', text: tr(MATCH_STATE.provisional?.[1] ?? '', 'Provisional') };
  if (m.state === 'disputed') return { cls: 'q-bracket__prov', text: matchStateLabel('disputed') };
  if (m.time) return { cls: 'q-bracket__time', text: m.time };
  return { cls: 'q-bracket__done', text: m.conditional ? tr('فقط در صورت نیاز', 'Only if needed') : '—' };
}
function teams(m: QBracketMatch) {
  return (['top', 'bottom'] as const).map((pos) => {
    const t = m[pos] ?? {};
    const win = m.winner === pos;
    return {
      pos, t, win,
      cls: ['q-bracket__team', { 'q-bracket__team--win': win, 'q-bracket__team--lose': !!m.winner && !win, 'q-bracket__team--tbd': !t.name }],
      name: t.name ? t.name : (t.placeholder || tbd()),
    };
  });
}
function btn(m: QBracketMatch, si: number, ri: number, mi: number, round: string, activeKey: string | null) {
  const k = keyOf(ri, mi);
  return {
    'data-slot': k,
    tabindex: k === activeKey ? 0 : -1,
    class: ['q-bracket__match', { 'q-bracket__match--live': m.state === 'live', 'q-bracket__match--cond': m.conditional }],
    'aria-label': bracketSlotLabel(round, m),
    'aria-describedby': `${uid}-h${si}`,
    onKeydown: (e: KeyboardEvent) => onKey(e, si, ri, mi),
    onFocus: () => { focusKey.value[si] = k; },
    onClick: () => open(m),
  };
}
</script>

<template>
  <div ref="root" class="q-bracket">
    <section v-for="sec in secs" :key="sec.key" class="q-bracket__section" :aria-label="sec.label || ariaLabel || tr('جدول مسابقات', 'Bracket')">
      <div v-if="sec.label || narrow" class="q-bracket__bar">
        <h3 v-if="sec.label" class="h4 q-bracket__stitle">{{ sec.label }}</h3>
        <span v-else />
        <div v-if="narrow && sec.rounds.length > 1" class="q-bracket__nav">
          <QButton size="sm" icon-only icon="chevron-left" flip-icon :aria-label="tr('دور قبلی', 'Previous round')" :disabled="sec.cur <= 0" @click="setCur(sec.si, sec.cur - 1)" />
          <label class="q-sr" :for="`${uid}-s${sec.si}`">{{ tr('انتخاب دور', 'Choose round') }}</label>
          <select :id="`${uid}-s${sec.si}`" class="q-bracket__select label" :value="sec.cur" @change="setCur(sec.si, Number(($event.target as HTMLSelectElement).value))">
            <option v-for="(_, i) in sec.rounds" :key="i" :value="i">{{ roundName(sec.rounds, i) }}</option>
          </select>
          <QButton size="sm" icon-only icon="chevron-right" flip-icon :aria-label="tr('دور بعدی', 'Next round')" :disabled="sec.cur >= sec.rounds.length - 1" @click="setCur(sec.si, sec.cur + 1)" />
        </div>
      </div>
      <p :id="`${uid}-h${sec.si}`" class="q-sr">{{ bracketHint() }}</p>
      <div :class="['q-bracket__scroll', { 'q-bracket__scroll--narrow': narrow }]">
        <div class="q-bracket__grid">
          <div v-for="col in sec.columns" :key="col.ri" role="group" :aria-label="col.name" :class="['q-bracket__round', { 'q-bracket__round--in': col.showIn }]">
            <h4 class="q-bracket__rlabel micro">{{ col.name }}<span class="q-bracket__rcount"> ({{ fa(col.rd.matches.length) }})</span></h4>
            <div class="q-bracket__rbody">
              <template v-if="col.paired">
                <div v-for="i in col.pairs" :key="i" class="q-bracket__pair">
                  <div v-for="j in [i, i + 1]" :key="j" class="q-bracket__slot">
                    <button v-if="col.rd.matches[j]" type="button" v-bind="btn(col.rd.matches[j]!, sec.si, col.ri, j, col.name, sec.activeKey)">
                      <span class="q-bracket__mhead">
                        <span class="q-bracket__mlabel">{{ col.rd.matches[j]!.label || '' }}</span>
                        <span v-if="col.rd.matches[j]!.state === 'live'" class="q-bracket__live"><QLiveDot />{{ tr('زنده', 'Live') }}</span>
                        <span v-else :class="head(col.rd.matches[j]!)?.cls">{{ head(col.rd.matches[j]!)?.text }}</span>
                      </span>
                      <span v-for="t in teams(col.rd.matches[j]!)" :key="t.pos" :class="t.cls">
                        <span class="q-bracket__seed" :title="t.t.seed != null ? tr('بذر', 'Seed') : undefined">{{ t.t.seed != null ? fa(t.t.seed) : '' }}</span>
                        <bdi class="q-bracket__name">{{ t.name }}</bdi>
                        <QIcon v-if="t.win" name="check" :size="14" :stroke-width="2.8" class="q-bracket__check" />
                        <span class="q-bracket__score">{{ t.t.score != null ? fa(t.t.score) : '' }}</span>
                      </span>
                    </button>
                  </div>
                </div>
              </template>
              <template v-else>
                <div v-for="(m, j) in col.rd.matches" :key="j" :class="['q-bracket__slot', { 'q-bracket__slot--out': col.showOut }]">
                  <button type="button" v-bind="btn(m, sec.si, col.ri, j, col.name, sec.activeKey)">
                    <span class="q-bracket__mhead">
                      <span class="q-bracket__mlabel">{{ m.label || '' }}</span>
                      <span v-if="m.state === 'live'" class="q-bracket__live"><QLiveDot />{{ tr('زنده', 'Live') }}</span>
                      <span v-else :class="head(m)?.cls">{{ head(m)?.text }}</span>
                    </span>
                    <span v-for="t in teams(m)" :key="t.pos" :class="t.cls">
                      <span class="q-bracket__seed" :title="t.t.seed != null ? tr('بذر', 'Seed') : undefined">{{ t.t.seed != null ? fa(t.t.seed) : '' }}</span>
                      <bdi class="q-bracket__name">{{ t.name }}</bdi>
                      <QIcon v-if="t.win" name="check" :size="14" :stroke-width="2.8" class="q-bracket__check" />
                      <span class="q-bracket__score">{{ t.t.score != null ? fa(t.t.score) : '' }}</span>
                    </span>
                  </button>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
