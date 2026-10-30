<script setup lang="ts">
import { computed, getCurrentInstance, ref } from 'vue';
import { fa, tr } from '../locale';
import { KIND, KIND_SHORT, kindLabel, resolvedLabel } from '../maps/competition';
import { useCountdown } from '../composables/useCountdown';
import QCard from './QCard.vue';
import QIcon from './QIcon.vue';

export interface QPickBanBoardStep { kind: 'ban' | 'pick' | 'side' | 'decider'; side: number | null; resolvedBy?: 'rule' | 'referee' }
export interface QPickBanBoardMap { id: string; name: string; image?: string; status: 'available' | 'banned' | 'picked' | 'decider'; by?: number; step?: number; resolvedBy?: 'rule' | 'referee' }
/**
 * Map veto board: turn banner with the server timer, map tiles, the step strip and the rule note.
 * Controlled when the parent listens to `change` (or binds v-model:maps / v-model:step); otherwise it keeps its own copy.
 */
export interface QPickBanBoardProps {
  teams: Array<{ name: string }>;
  sequence: QPickBanBoardStep[];
  step?: number;
  maps: QPickBanBoardMap[];
  secondsLeft?: number;
  running?: boolean;
  viewerSide?: number;
  state?: 'running' | 'waiting_referee' | 'complete';
  title?: string;
  context?: string;
  /** null hides the rule note. */
  note?: string | null;
}
const p = defineProps<QPickBanBoardProps>();
const emit = defineEmits<{
  select: [map: QPickBanBoardMap, step: QPickBanBoardStep];
  change: [maps: QPickBanBoardMap[], step: number];
  'update:maps': [maps: QPickBanBoardMap[]];
  'update:step': [step: number];
}>();
const inst = getCurrentInstance();
const controlled = () => { const v = inst?.vnode.props; return !!(v && (v.onChange || v['onUpdate:maps'] || v['onUpdate:step'])); };

const ownMaps = ref<QPickBanBoardMap[]>(p.maps ?? []);
const ownStep = ref(p.step ?? 0);
const maps = computed(() => (controlled() ? (p.maps ?? []) : ownMaps.value));
const step = computed(() => (controlled() ? (p.step ?? 0) : ownStep.value));
const seq = computed(() => p.sequence ?? []);
const secs = useCountdown(() => p.secondsLeft ?? 0, () => !!p.running);
const complete = computed(() => p.state === 'complete' || step.value >= seq.value.length);
const waitingRef = computed(() => p.state === 'waiting_referee');
const turn = computed(() => (complete.value ? undefined : seq.value[step.value]));
const turnTeam = computed(() => (turn.value && turn.value.side != null ? p.teams[turn.value.side] : undefined));
const mine = computed(() => !!turn.value && !waitingRef.value && p.viewerSide != null && turn.value.side === p.viewerSide);
const warn = computed(() => secs.value < 10);
const teamName = (i?: number | null) => (i != null ? p.teams[i]?.name ?? null : null);

function choose(map: QPickBanBoardMap) {
  const t = turn.value;
  if (!t || !mine.value || map.status !== 'available') return;
  const status = t.kind === 'ban' ? 'banned' : 'picked';
  let next = maps.value.map((m) => (m.id === map.id ? { ...m, status, by: t.side ?? undefined, step: step.value } as QPickBanBoardMap : m));
  let ns = step.value + 1;
  const left = next.filter((m) => m.status === 'available');
  if (seq.value[ns]?.kind === 'decider' && left.length === 1) {
    const only = left[0]!;
    const at = ns;
    next = next.map((m) => (m.id === only.id ? { ...m, status: 'decider', step: at } : m));
    ns++;
  }
  emit('select', map, t);
  if (controlled()) {
    emit('change', next, ns);
    emit('update:maps', next);
    emit('update:step', ns);
  } else {
    ownMaps.value = next;
    ownStep.value = ns;
  }
}

const tiles = computed(() => maps.value.map((m) => {
  const s = m.status || 'available';
  const by = teamName(m.by);
  const kind = turn.value?.kind;
  const tag = s === 'banned' ? tr('حذف', 'Banned') + (by ? ` · ${by}` : '')
    : s === 'picked' ? tr('انتخاب', 'Picked') + (by ? ` · ${by}` : '')
      : s === 'decider' ? tr('نقشه تعیین‌کننده', 'Decider map')
        : (mine.value ? (kind === 'ban' ? tr('حذف این نقشه', 'Ban this map') : tr('انتخاب این نقشه', 'Pick this map')) : tr('در دسترس', 'Available'));
  return {
    m, s, tag,
    interactive: s === 'available' && mine.value,
    aria: (kind === 'ban' ? tr('حذف ', 'Ban ') : tr('انتخاب ', 'Pick ')) + m.name,
    icon: s === 'banned' ? 'ban' as const : s === 'picked' ? 'check' as const : s === 'decider' ? 'target' as const : null,
  };
}));
const steps = computed(() => seq.value.map((t, i) => {
  const who = teamName(t.side);
  return {
    t, done: i < step.value, cur: i === step.value && !complete.value,
    text: kindLabel(KIND_SHORT, t.kind) + (who ? ` · ${who}` : ''),
  };
}));
</script>

<template>
  <QCard class="q-pick-ban-board">
    <div class="q-pick-ban-board__head">
      <h3 class="h4 q-pick-ban-board__title">{{ title || tr('انتخاب‌های پیش از بازی', 'Pre-game selection') }}</h3>
      <span v-if="context" class="caption q-pick-ban-board__ctx">{{ context }}</span>
    </div>
    <div v-if="complete || !turn" class="q-pick-ban-board__turn q-pick-ban-board__turn--done">
      <QIcon name="check-circle" :size="22" />
      <span class="h4">{{ tr('انتخاب‌ها کامل شد', 'Selection complete') }}</span>
    </div>
    <div v-else :class="['q-pick-ban-board__turn', { 'q-pick-ban-board__turn--mine': mine }]">
      <div class="q-pick-ban-board__turn-text">
        <span class="micro q-pick-ban-board__step">{{ tr(`گام ${fa(step + 1)} از ${fa(seq.length)}`, `Step ${step + 1} of ${seq.length}`) }}</span>
        <span class="h4">
          <template v-if="waitingRef">{{ tr('در انتظار تصمیم داور', 'Waiting for the referee’s decision') }}</template>
          <template v-else-if="turnTeam">{{ tr('نوبت ', 'Turn: ') }}<bdi>{{ turnTeam.name }}</bdi>{{ ' — ' + kindLabel(KIND, turn.kind) }}</template>
          <template v-else>{{ kindLabel(KIND, turn.kind) }}</template>
        </span>
        <span v-if="mine" class="caption q-pick-ban-board__hint">{{ turn.kind === 'ban' ? tr('یک نقشه را برای حذف انتخاب کنید.', 'Choose a map to ban.') : tr('نقشهٔ بازی را انتخاب کنید.', 'Choose the map to play.') }}</span>
      </div>
      <div
        v-if="!waitingRef"
        :class="['q-pick-ban-board__timer', { 'q-pick-ban-board__timer--warn': warn }]"
        role="timer"
        :aria-label="tr(`زمان باقی‌مانده نوبت: ${fa(secs)} ثانیه`, `Turn time left: ${secs} ${secs === 1 ? 'second' : 'seconds'}`)"
      >
        <QIcon name="clock" :size="18" />
        <span aria-hidden="true"><strong class="numeral">{{ fa(secs) }}</strong>{{ tr(' ثانیه تا پایان نوبت', ' s left in this turn') }}</span>
      </div>
    </div>
    <p v-if="waitingRef" class="q-pick-ban-board__alert body-sm" role="status">
      <QIcon name="gavel" :size="18" />{{ tr('زمان این نوبت تمام شد؛ طبق قانون، داور تصمیم می‌گیرد.', 'This turn timed out; under the rules the referee decides.') }}
    </p>
    <ul class="q-pick-ban-board__grid" :aria-label="tr('نقشه‌ها', 'Maps')">
      <li v-for="x in tiles" :key="x.m.id || x.m.name" :class="['q-pick-ban-board__tile', `q-pick-ban-board__tile--${x.s}`]">
        <component :is="x.interactive ? 'button' : 'div'" v-bind="x.interactive ? { type: 'button', 'aria-label': x.aria } : { 'aria-disabled': 'true' }" class="q-pick-ban-board__btn" @click="x.interactive && choose(x.m)">
          <span class="q-pick-ban-board__cover q-stripes" aria-hidden="true">
            <img v-if="x.m.image" :src="x.m.image" alt="" />
            <span v-else class="q-pick-ban-board__ghost" dir="ltr">{{ x.m.name }}</span>
            <span v-if="x.s === 'banned'" class="q-pick-ban-board__x" />
          </span>
          <span class="q-pick-ban-board__label">
            <bdi class="label q-ltr q-pick-ban-board__name">{{ x.m.name }}</bdi>
            <span class="micro q-pick-ban-board__tag">
              <QIcon v-if="x.icon" :name="x.icon" :size="14" :stroke-width="x.icon === 'check' ? 2.6 : 2" />
              <bdi>{{ x.tag }}</bdi>
            </span>
            <span v-if="x.m.resolvedBy" class="caption q-pick-ban-board__auto">{{ resolvedLabel(x.m.resolvedBy, true) }}</span>
          </span>
        </component>
      </li>
    </ul>
    <ol v-if="seq.length" class="q-pick-ban-board__seq" :aria-label="tr('ترتیب انتخاب‌ها', 'Selection order')">
      <li v-for="(x, i) in steps" :key="i" :class="['q-pick-ban-board__s', { 'q-pick-ban-board__s--done': x.done, 'q-pick-ban-board__s--cur': x.cur }, `q-pick-ban-board__s--${x.t.kind}`]" :aria-current="x.cur ? 'step' : undefined">
        <span class="q-pick-ban-board__sn q-num"><QIcon v-if="x.done" name="check" :size="12" :stroke-width="3" /><template v-else>{{ fa(i + 1) }}</template></span>
        <span>{{ x.text }}</span>
        <span v-if="x.t.resolvedBy" class="q-pick-ban-board__sauto">({{ resolvedLabel(x.t.resolvedBy, false) }})</span>
      </li>
    </ol>
    <p v-if="note !== null" class="caption q-pick-ban-board__note">
      <QIcon name="info" :size="16" />{{ note || tr('اگر زمان نوبت تمام شود، انتخاب «طبق قانون پس از اتمام زمان» انجام می‌شود یا «توسط داور» تعیین می‌شود.', 'If the turn timer runs out, the choice is made “by rule after timeout” or decided “by referee”.') }}
    </p>
  </QCard>
</template>
