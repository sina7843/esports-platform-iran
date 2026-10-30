<script setup lang="ts">
import type { IconName } from '../icons';
import QIcon from './QIcon.vue';

/** Badge: a small status or category tag. `dot` adds a leading dot (live always pulses). */
export interface QBadgeProps {
  tone?: ('neutral' | 'success' | 'warning' | 'danger' | 'info' | 'live' | 'red' | 'green') | undefined;
  dot?: (boolean) | undefined;
  icon?: (IconName) | undefined;
}
withDefaults(defineProps<QBadgeProps>(), { tone: 'neutral' });
</script>

<template>
  <span :class="['q-badge', `q-badge--${tone}`]">
    <span v-if="dot || tone === 'live'" :class="tone === 'live' ? 'q-live-dot' : 'q-badge-dot'" aria-hidden="true" />
    <QIcon v-if="icon" :name="icon" :size="14" />
    <slot />
  </span>
</template>
