<script setup lang="ts">
import { computed, ref } from 'vue';
import { fa, tr } from '../locale';
import { initialOf, pl } from '../maps/competition';
import { useCountdown } from '../composables/useCountdown';
import QButton from './QButton.vue';
import QCard from './QCard.vue';
import QIcon from './QIcon.vue';

export interface QReadyCheckSide { name: string; initial?: string; logo?: string; ready?: boolean }
/** Pre-match readiness: each side ready or waiting, the green countdown and «اعلام آمادگی» for the viewer's side. */
export interface QReadyCheckProps {
  sides: QReadyCheckSide[];
  /** Index of the viewer's side; shows «اعلام آمادگی» while it is not ready. */
  viewerSide?: number;
  /** Seconds to start. */
  seconds?: number;
  /** Tick the countdown locally (server time stays authoritative). */
  running?: boolean;
  /** Officials only; when false a waiting note is shown instead. */
  canStart?: boolean;
  title?: string;
  context?: string;
  bothReadyText?: string;
  startLabel?: string;
  /** Readiness comes only from sides[].ready (no local optimistic update). */
  controlled?: boolean;
}
const p = withDefaults(defineProps<QReadyCheckProps>(), { canStart: true });
const emit = defineEmits<{ ready: [side: number]; startSelection: [] }>();

const localReady = ref<number | null>(null);
const secs = useCountdown(() => p.seconds ?? 0, () => !!p.running);
const ready = computed(() => p.sides.map((s, i) => !!s.ready || localReady.value === i));
const both = computed(() => ready.value.length > 1 && ready.value.every(Boolean));
const canDeclare = computed(() => p.viewerSide != null && !ready.value[p.viewerSide]);
const warn = computed(() => secs.value <= 10);
const timerAria = computed(() => tr(`${fa(secs.value)} ثانیه تا شروع`, `${secs.value} ${secs.value === 1 ? 'second' : 'seconds'} to start`));

function declare() {
  if (p.viewerSide == null) return;
  emit('ready', p.viewerSide);
  if (!p.controlled) localReady.value = p.viewerSide;
}
</script>

<template>
  <QCard :class="['q-ready-check', { 'q-ready-check--both': both }]">
    <div class="q-ready-check__head">
      <h3 class="h4 q-ready-check__title">{{ title || tr('اعلام آمادگی', 'Ready check') }}</h3>
      <span v-if="context" class="caption q-ready-check__ctx">{{ context }}</span>
    </div>
    <div class="q-ready-check__sides">
      <div v-for="(s, i) in sides" :key="i" :class="['q-ready-check__side', ready[i] ? 'q-ready-check__side--ready' : 'q-ready-check__side--wait', { 'q-ready-check__side--me': viewerSide === i }]">
        <span class="q-ready-check__crest q-chamfer-sm" aria-hidden="true"><img v-if="s.logo" :src="s.logo" alt="" /><template v-else>{{ initialOf(s) }}</template></span>
        <span class="q-ready-check__who">
          <span class="q-ready-check__nm">
            <bdi class="label q-ready-check__name">{{ s.name }}</bdi>
            <span v-if="viewerSide === i" class="micro q-ready-check__you">{{ tr('تیم شما', 'Your team') }}</span>
          </span>
          <span class="q-ready-check__state label" role="status">
            <QIcon :name="ready[i] ? 'check-circle' : 'clock'" :size="18" />{{ ready[i] ? tr('آماده', 'Ready') : tr('در انتظار', 'Waiting') }}
          </span>
        </span>
      </div>
    </div>
    <div v-if="both" class="q-ready-check__done" role="status"><QIcon name="check-circle" :size="20" />{{ bothReadyText || tr('هر دو طرف آماده‌اند.', 'Both sides are ready.') }}</div>
    <div v-else :class="['q-ready-check__timer', { 'q-ready-check__timer--warn': warn }]" role="timer" :aria-label="timerAria">
      <strong class="q-ready-check__secs" aria-hidden="true">{{ fa(secs) }}</strong>
      <span class="label" aria-hidden="true">{{ pl(secs, 'ثانیه تا شروع', 'second to start', 'seconds to start') }}</span>
    </div>
    <div class="q-ready-check__actions">
      <template v-if="both">
        <QButton v-if="canStart !== false" variant="primary" size="lg" icon="play" flip-icon class="q-ready-check__cta" @click="emit('startSelection')">{{ startLabel || tr('شروع انتخاب‌ها', 'Start selection') }}</QButton>
        <span v-else class="caption q-ready-check__wait">{{ tr('در انتظار شروع انتخاب‌ها توسط داور', 'Waiting for the referee to start selection') }}</span>
      </template>
      <QButton v-else-if="canDeclare" variant="primary" size="lg" icon="check" class="q-ready-check__cta" @click="declare">{{ tr('اعلام آمادگی', 'Declare ready') }}</QButton>
      <span v-else-if="viewerSide != null" class="caption q-ready-check__wait">{{ tr('آمادگی شما ثبت شد؛ در انتظار طرف مقابل.', 'You are marked ready; waiting for the opponent.') }}</span>
    </div>
  </QCard>
</template>
