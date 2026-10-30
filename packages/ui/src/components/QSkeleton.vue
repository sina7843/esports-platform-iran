<script setup lang="ts">
import { computed } from 'vue';
import { px } from '../maps/display';

/** Loading placeholder: line | block | circle | card | table-row. Decorative (aria-hidden); the container announces loading. */
export interface QSkeletonProps {
  variant?: ('line' | 'block' | 'circle' | 'card' | 'table-row') | undefined;
  lines?: (number) | undefined;
  width?: (number | string) | undefined;
  height?: (number | string) | undefined;
  size?: (number) | undefined;
}
const p = withDefaults(defineProps<QSkeletonProps>(), { variant: 'line', lines: 1, size: 40 });
const style = computed(() => (p.variant === 'circle' ? { width: px(p.size), height: px(p.size) } : { width: px(p.width), height: px(p.height) }));
</script>

<template>
  <div v-if="variant === 'card'" class="q-skeleton-card" aria-hidden="true">
    <span class="q-skeleton q-skeleton--block" :style="{ height: px(height ?? 96) }" />
    <span class="q-skeleton q-skeleton--line" style="width: 80%" />
    <span class="q-skeleton q-skeleton--line" style="width: 55%" />
    <span class="q-skeleton q-skeleton--line q-skeleton--bar" />
  </div>
  <div v-else-if="variant === 'table-row'" class="q-skeleton-row" aria-hidden="true">
    <span class="q-skeleton q-skeleton--circle" style="width: 32px; height: 32px" />
    <span class="q-skeleton q-skeleton--line" style="width: 70%" />
    <span class="q-skeleton q-skeleton--line" style="width: 50%" />
    <span class="q-skeleton q-skeleton--line" style="width: 40%" />
  </div>
  <div v-else-if="variant === 'line' && lines > 1" class="q-skeleton-lines" aria-hidden="true">
    <span v-for="i in lines" :key="i" class="q-skeleton q-skeleton--line" :style="{ width: i === lines ? '60%' : '100%' }" />
  </div>
  <span v-else :class="['q-skeleton', `q-skeleton--${variant}`]" :style="style" aria-hidden="true" />
</template>
