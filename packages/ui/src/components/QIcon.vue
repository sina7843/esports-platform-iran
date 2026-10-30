<script setup lang="ts">
import { computed } from 'vue';
import { ICONS, type IconName } from '../icons';

/** Lucide-style stroke icon. Decorative unless `label` is given. `flip` mirrors it in RTL; `filled` fills closed shapes. */
export interface QIconProps {
  name: IconName;
  size?: (number) | undefined;
  label?: (string) | undefined;
  flip?: (boolean) | undefined;
  filled?: (boolean) | undefined;
  strokeWidth?: (number) | undefined;
}
const p = withDefaults(defineProps<QIconProps>(), { size: 20, strokeWidth: 2 });
const paths = computed(() => ICONS[p.name] ?? '');
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <svg :class="['q-icon', { 'q-icon-flip': flip }]" :width="size" :height="size" viewBox="0 0 24 24" :fill="filled ? 'currentColor' : 'none'" stroke="currentColor" :stroke-width="strokeWidth" stroke-linecap="round" stroke-linejoin="round" :role="label ? 'img' : undefined" :aria-label="label || undefined" :aria-hidden="label ? undefined : 'true'" v-html="paths" />
</template>
