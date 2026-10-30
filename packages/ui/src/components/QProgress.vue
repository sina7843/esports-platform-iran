<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import { fa, tr } from '../locale';

defineOptions({ inheritAttrs: false });
/**
 * Capacity / completion bar. tone brand (brand-green) | warning | danger (full); size thin | thick; indeterminate;
 * segments → step meter. label: prop or slot (a string label also names the progressbar; else pass aria-label).
 */
export interface QProgressProps {
  value?: number;
  max?: number;
  label?: string;
  valueText?: string;
  unit?: string;
  showValue?: boolean;
  tone?: 'brand' | 'warning' | 'danger';
  size?: 'thin' | 'thick';
  indeterminate?: boolean;
  segments?: number;
  current?: boolean;
}
const p = withDefaults(defineProps<QProgressProps>(), { value: 0, tone: 'brand', size: 'thin', showValue: true, current: true });
// aria-label goes on the progressbar (DS); class / style / the rest stay on the root.
const attrs = useAttrs();
const rootAttrs = computed(() => { const { 'aria-label': _, ...rest } = attrs; return rest; });

const max = computed(() => p.max || p.segments || 100);
const value = computed(() => Math.max(0, Math.min(max.value, p.value || 0)));
const pct = computed(() => (max.value ? (value.value / max.value) * 100 : 0));
const vt = computed(() => (p.valueText != null ? p.valueText : p.indeterminate ? null : `${fa(value.value)}${tr(' از ', ' of ')}${fa(max.value)}${p.unit ? ` ${p.unit}` : ''}`));
const aria = computed(() => ({
  role: 'progressbar',
  'aria-label': p.label || (attrs['aria-label'] as string | undefined),
  'aria-valuemin': p.indeterminate ? undefined : 0,
  'aria-valuemax': p.indeterminate ? undefined : max.value,
  'aria-valuenow': p.indeterminate ? undefined : value.value,
  'aria-valuetext': vt.value || undefined,
}));
</script>

<template>
  <div v-bind="rootAttrs" :class="['q-progress', `q-progress--${tone}`, `q-progress--${size}`]">
    <div v-if="label || $slots.label || (vt && showValue)" class="q-progress__head" aria-hidden="true">
      <span class="q-progress__label"><slot name="label">{{ label }}</slot></span>
      <span v-if="vt && showValue" class="q-progress__value q-num">{{ vt }}</span>
    </div>
    <div v-if="segments" class="q-progress__segs" v-bind="aria">
      <span
        v-for="(_, i) in segments"
        :key="i"
        :class="['q-progress__seg', { 'q-progress__seg--on': i < value, 'q-progress__seg--current': i === value && current }]"
      />
    </div>
    <div v-else class="q-progress__track" v-bind="aria">
      <span :class="['q-progress__fill', { 'q-progress__fill--indeterminate': indeterminate }]" :style="indeterminate ? undefined : { inlineSize: `${pct}%` }" />
    </div>
  </div>
</template>
