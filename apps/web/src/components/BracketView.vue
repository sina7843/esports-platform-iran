<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp04, type SlotView } from '../api/esp04';
import DataState from './DataState.vue';
import JalaliDate from './JalaliDate.vue';
import StatusBadge from './StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import { settings } from '../settings';

/**
 * DRAW-004 / AC-24: bracket and round view for every format. Rounds are fetched page by page from the server (large
 * competitions never ship the whole bracket), the winners/losers/final brackets are separate tabs, keyboard arrows move
 * between matches (RTL-aware), Enter opens the match room. On narrow screens one round is shown at a time.
 */
const props = defineProps<{ stageId: string; token?: string | undefined }>();
const router = useRouter();
const PAGE = 32;
const brackets = ref<string[]>([]);
const rounds = ref<number[]>([]);
const bracket = ref('');
const firstRound = ref(1);
const columns = reactive<Record<number, { slots: SlotView[]; total: number; offset: number }>>({});
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
const narrow = ref(typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 720px)').matches : false);
const visibleRounds = computed(() => {
  const rs = roundsOf.value;
  const i = Math.max(0, rs.indexOf(firstRound.value));
  return rs.slice(i, i + (narrow.value ? 1 : 4));
});
const roundsOf = ref<number[]>([]);

async function loadMeta() {
  loading.value = true;
  error.value = null;
  try {
    const v = await esp04.bracket(props.stageId, { limit: 1, t: props.token });
    brackets.value = v.brackets;
    rounds.value = v.rounds;
    bracket.value = bracket.value && v.brackets.includes(bracket.value) ? bracket.value : (v.brackets[0] ?? '');
    await loadBracket();
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
async function loadBracket() {
  for (const k of Object.keys(columns)) delete columns[Number(k)];
  const all = await esp04.bracket(props.stageId, { bracket: bracket.value, limit: 1, t: props.token });
  roundsOf.value = all.rounds.filter((r) => r > 0);
  // rounds that actually contain slots of this bracket
  const present: number[] = [];
  for (const r of roundsOf.value) {
    const page = await esp04.bracket(props.stageId, { bracket: bracket.value, round: r, limit: PAGE, t: props.token });
    if (page.total) {
      columns[r] = { slots: page.slots, total: page.total, offset: 0 };
      present.push(r);
    }
  }
  roundsOf.value = present;
  firstRound.value = present[0] ?? 1;
}
async function more(round: number) {
  const col = columns[round]!;
  const page = await esp04.bracket(props.stageId, { bracket: bracket.value, round, offset: col.slots.length, limit: PAGE, t: props.token });
  col.slots.push(...page.slots);
}
onMounted(() => void loadMeta());
watch(() => props.stageId, () => void loadMeta());
watch(bracket, () => void loadBracket().catch((e) => (error.value = toClientError(e))));

const bracketLabel = (b: string) => (b === 'W' ? t('br.winners') : b === 'L' ? t('br.losers') : b === 'GF' ? t('br.final') : b === 'P3' ? t('br.third') : b.startsWith('G-') ? t('br.group', { g: b.slice(2) }) : b === 'SW' ? t('br.swiss') : b === 'RR' ? t('br.rr') : b === 'LB' ? t('br.lobbies') : b === 'AT' ? t('br.attempts') : b === 'LD' ? t('br.ladder') : b);
const roundLabel = (r: number) => (bracket.value === 'GF' ? (r === Math.min(...roundsOf.value) ? t('br.final') : t('br.reset')) : t('br.round', { n: num(r) }));
const canPrev = computed(() => roundsOf.value.indexOf(firstRound.value) > 0);
const canNext = computed(() => roundsOf.value.indexOf(firstRound.value) + visibleRounds.value.length < roundsOf.value.length);
const shift = (d: number) => {
  const i = roundsOf.value.indexOf(firstRound.value) + d;
  if (i >= 0 && i < roundsOf.value.length) firstRound.value = roundsOf.value[i]!;
};

// roving focus over the visible grid
const focusKey = ref<string | null>(null);
const cardId = (key: string) => `slot-${props.stageId}-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
function onKey(e: KeyboardEvent, ci: number, si: number) {
  const rtl = settings.locale === 'fa';
  const cols = visibleRounds.value.map((r) => columns[r]?.slots ?? []);
  let c = ci;
  let s = si;
  if (e.key === 'ArrowDown') s++;
  else if (e.key === 'ArrowUp') s--;
  else if (e.key === 'ArrowRight') c += rtl ? -1 : 1;
  else if (e.key === 'ArrowLeft') c += rtl ? 1 : -1;
  else if (e.key === 'Enter' || e.key === ' ') {
    const slot = cols[ci]?.[si];
    if (slot?.match) void router.push(`/matches/${slot.match.id}`);
    e.preventDefault();
    return;
  } else return;
  e.preventDefault();
  if (c < 0 || c >= cols.length) return;
  s = Math.max(0, Math.min(s, (cols[c]?.length ?? 1) - 1));
  const target = cols[c]?.[s];
  if (!target) return;
  focusKey.value = target.key;
  void nextTick(() => document.getElementById(cardId(target.key))?.focus());
}
const firstFocusable = computed(() => focusKey.value ?? columns[visibleRounds.value[0] ?? -1]?.slots[0]?.key ?? null);
const outcomeText = (s: SlotView) => {
  const o = s.match?.outcome as { kind?: string; scores?: number[] | null; maps?: number[] | null; forfeit?: boolean } | null;
  if (!o) return '';
  if (o.kind === 'win' && o.forfeit) return t('br.forfeit');
  const v = o.maps ?? o.scores;
  return v ? `${num(v[0]!)} – ${num(v[1]!)}` : '';
};
</script>

<template>
  <DataState :loading="loading" :error="error" :empty="!loading && !brackets.length" @retry="loadMeta">
    <div class="bracket">
      <div class="bar">
        <div v-if="brackets.length > 1" class="tabs" role="tablist" :aria-label="t('br.brackets')">
          <button v-for="b in brackets" :key="b" type="button" role="tab" class="btn btn-sm" :aria-selected="bracket === b" :class="{ active: bracket === b }" @click="bracket = b">{{ bracketLabel(b) }}</button>
        </div>
        <div class="row nav">
          <button type="button" class="btn btn-sm" :disabled="!canPrev" :aria-label="t('br.prevRounds')" @click="shift(-1)">‹</button>
          <label v-if="narrow" class="sr-only" for="round-pick">{{ t('br.pickRound') }}</label>
          <select v-if="narrow" id="round-pick" v-model.number="firstRound" class="input">
            <option v-for="r in roundsOf" :key="r" :value="r">{{ roundLabel(r) }}</option>
          </select>
          <button type="button" class="btn btn-sm" :disabled="!canNext" :aria-label="t('br.nextRounds')" @click="shift(1)">›</button>
        </div>
      </div>
      <p class="sr-only">{{ t('br.keyboardHint') }}</p>
      <div class="grid" role="grid" :aria-label="bracketLabel(bracket)">
        <section v-for="(r, ci) in visibleRounds" :key="r" class="col" role="row">
          <h3 class="round">{{ roundLabel(r) }} <span class="muted">({{ num(columns[r]?.total ?? 0) }})</span></h3>
          <article
            v-for="(s, si) in columns[r]?.slots ?? []" :id="cardId(s.key)" :key="s.key" class="card slot" role="gridcell"
            :tabindex="s.key === firstFocusable ? 0 : -1" :data-status="s.status"
            :aria-label="`${roundLabel(r)} — ${s.participants.map((p) => p.name ?? t('br.tbd')).join(' / ')} — ${s.status}`"
            @keydown="onKey($event, ci, si)" @focus="focusKey = s.key"
          >
            <ol class="sides">
              <li v-for="(p, i) in s.participants" :key="i" :class="{ win: !!s.winner && p.name === s.winner, bye: p.name === 'BYE' }">
                <bdi>{{ p.name === 'BYE' ? t('br.bye') : p.name ?? t('br.tbd') }}</bdi>
              </li>
            </ol>
            <div class="meta">
              <StatusBadge :state="s.match?.state ?? s.status" />
              <span v-if="outcomeText(s)" class="score num">{{ outcomeText(s) }}</span>
              <span v-if="s.match?.scheduledAt" class="muted small"><JalaliDate :iso="s.match.scheduledAt" format="datetime" /><template v-if="s.match.estimated"> ({{ t('br.estimated') }})</template></span>
              <span v-if="s.conditional" class="muted small">{{ t('br.ifNeeded') }}</span>
            </div>
            <RouterLink v-if="s.match" :to="`/matches/${s.match.id}`" class="small" tabindex="-1">{{ t('br.openMatch') }}</RouterLink>
          </article>
          <button v-if="(columns[r]?.slots.length ?? 0) < (columns[r]?.total ?? 0)" type="button" class="btn btn-sm" @click="more(r)">{{ t('br.more') }}</button>
        </section>
      </div>
    </div>
  </DataState>
</template>

<style scoped>
.bar { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--sp-2); margin-block-end: var(--sp-3); }
.tabs { display: flex; flex-wrap: wrap; gap: var(--sp-1); }
.tabs .active { background: var(--accent-soft); color: var(--accent-strong); border-color: var(--accent); }
.nav { gap: var(--sp-1); align-items: center; }
.grid { display: flex; gap: var(--sp-3); overflow-x: auto; padding-block-end: var(--sp-2); }
.col { flex: 1 0 14rem; display: flex; flex-direction: column; gap: var(--sp-2); justify-content: space-around; min-inline-size: 14rem; }
.round { font-size: var(--fs-sm); margin: 0; }
.slot { padding: var(--sp-2) var(--sp-3); display: grid; gap: var(--sp-1); outline-offset: 2px; }
.slot:focus { outline: 3px solid var(--accent); }
.slot[data-status='auto_advance'], .slot[data-status='not_needed'] { opacity: 0.6; }
.sides { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.sides li { padding: 2px var(--sp-1); border-radius: var(--radius-sm); }
.sides .win { font-weight: 700; background: var(--ok-soft); }
.sides .bye { color: var(--text-muted); font-style: italic; }
.meta { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.small { font-size: var(--fs-xs); }
.score { font-weight: 700; }
@media (max-width: 720px) {
  .col { min-inline-size: 100%; }
}
</style>
