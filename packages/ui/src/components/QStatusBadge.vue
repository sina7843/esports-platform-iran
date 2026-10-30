<script setup lang="ts">
import { computed } from 'vue';
import type { IconName } from '../icons';
import { resolveStatus, type StatusBadgeMachine, type StatusBadgeTone } from '../maps/display';
import QBadge from './QBadge.vue';

/** Product state → Badge tone + label in the current locale. Pass machine for shared names (pending, ready, open …). Tables: maps/display.ts. */
export interface QStatusBadgeProps {
  state: string;
  machine?: (StatusBadgeMachine) | undefined;
  label?: (string) | undefined;
  tone?: (StatusBadgeTone) | undefined;
  dot?: (boolean) | undefined;
  icon?: (IconName) | undefined;
}
const p = defineProps<QStatusBadgeProps>();
const r = computed(() => resolveStatus(p.state, p.machine));
</script>

<template>
  <QBadge :tone="tone || r.tone" :dot="dot" v-bind="icon ? { icon } : {}" class="q-status-badge">{{ label || r.label }}</QBadge>
</template>
