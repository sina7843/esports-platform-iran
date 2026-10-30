<script setup lang="ts">
import { computed, useSlots, watch } from 'vue';
import { tr } from '../locale';
import { countdownSpoken, pad2 } from '../maps/data';
import { useNow } from '../composables/useNow';
import QIcon from './QIcon.vue';

/** Countdown: days/hours/minutes(/seconds) cells to a target ISO time; inline variant; ended state. Ticks once per second. */
export interface QCountdownProps {
  target: string;
  /** Visible label. Default «پایان ثبت‌نام تا»; null hides it. */
  label?: string | null | undefined;
  /** cells (default) | inline «۰۳:۱۴:۲۲». */
  variant?: 'cells' | 'inline';
  seconds?: boolean;
  size?: 'sm' | 'md';
  endedLabel?: string;
  /** Freeze the clock at this instant (previews, tests). */
  now?: string | number;
}
const p = withDefaults(defineProps<QCountdownProps>(), { variant: 'cells', label: undefined });
const emit = defineEmits<{ end: [] }>();
const slots = useSlots();

const now = useNow(() => p.now, 1000);
const left = computed(() => {
  const l = Math.max(0, Math.floor((+new Date(p.target) - now.value) / 1000));
  return Number.isNaN(l) ? 0 : l;
});
const ended = computed(() => left.value <= 0);
watch(ended, (e) => { if (e) emit('end'); }, { immediate: true });

const d = computed(() => Math.floor(left.value / 86400));
const hr = computed(() => Math.floor((left.value % 86400) / 3600));
const mi = computed(() => Math.floor((left.value % 3600) / 60));
const se = computed(() => left.value % 60);
const inline = computed(() => p.variant === 'inline');
const labelText = computed(() => (p.label === undefined ? tr('پایان ثبت‌نام تا', 'Registration closes in') : p.label));
const spoken = computed(() => (ended.value ? '' : countdownSpoken(d.value, hr.value, mi.value, se.value, !!p.seconds || inline.value)));
const units = computed(() => {
  const u: [string, number][] = [[tr('روز', 'Days'), d.value], [tr('ساعت', 'Hours'), hr.value], [tr('دقیقه', 'Minutes'), mi.value]];
  if (p.seconds) u.push([tr('ثانیه', 'Seconds'), se.value]);
  return u;
});
</script>

<template>
  <div :class="['q-countdown', inline ? 'q-countdown--inline' : 'q-countdown--cells', { 'q-countdown--ended': ended, 'q-countdown--sm': size === 'sm' }]" role="timer">
    <span v-if="slots.label || labelText" class="q-countdown__label"><slot name="label">{{ labelText }}</slot></span>
    <span v-if="ended" class="q-countdown__ended"><QIcon name="clock" :size="16" />{{ endedLabel || tr('به پایان رسید', 'Ended') }}</span>
    <span v-else-if="inline" class="q-countdown__clock q-num q-ltr" aria-hidden="true">{{ pad2(d * 24 + hr) + ':' + pad2(mi) + ':' + pad2(se) }}</span>
    <span v-else class="q-countdown__cells" aria-hidden="true">
      <span v-for="u in units" :key="u[0]" class="q-countdown__cell">
        <strong class="q-countdown__num">{{ pad2(u[1]) }}</strong>
        <small class="q-countdown__unit">{{ u[0] }}</small>
      </span>
    </span>
    <span v-if="spoken" class="q-sr">{{ spoken }}</span>
  </div>
</template>
