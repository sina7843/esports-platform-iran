<script setup lang="ts">
import { computed } from 'vue';
import { formatJalali, type DateFormat } from '../locale';
import { useNow } from '../composables/useNow';

/** JalaliDate: an ISO instant as locale date text (Jalali in fa, Gregorian in en) inside <time datetime>; empty shows «—». */
export interface QJalaliDateProps {
  iso: string | null | undefined;
  format?: (DateFormat) | undefined;
  /** Fixed reference time for `relative`. */
  now?: string | number | undefined;
  /** Re-render `relative` every minute. */
  live?: (boolean) | undefined;
  timeZone?: string | undefined;
  /** Tooltip; defaults to the full datetime. false hides it. */
  title?: string | false | undefined;
  fallback?: (string) | undefined;
}
const p = withDefaults(defineProps<QJalaliDateProps>(), { format: 'datetime', title: undefined });

const ticking = computed(() => p.format === 'relative' && p.live && p.now == null);
const tick = useNow(() => (ticking.value ? null : 0), 60000);
const opts = (now?: string | number) => {
  const o: { now?: string | number; timeZone?: string } = {};
  if (now != null) o.now = now;
  if (p.timeZone) o.timeZone = p.timeZone;
  return o;
};
const text = computed(() => (p.iso ? formatJalali(p.iso, p.format, opts(p.now ?? (ticking.value ? tick.value : undefined))) : ''));
const machine = computed(() => {
  const d = new Date(p.iso ?? '');
  return Number.isNaN(d.getTime()) ? String(p.iso) : d.toISOString();
});
const tip = computed(() => (p.title === false || p.format === 'datetime' ? undefined : p.title || formatJalali(p.iso, 'datetime', opts())));
</script>

<template>
  <span v-if="!iso" class="q-jalali-date q-jalali-date--empty"><slot name="fallback">{{ fallback || '—' }}</slot></span>
  <time v-else class="q-jalali-date q-num" :datetime="machine" :title="tip">{{ text }}</time>
</template>
