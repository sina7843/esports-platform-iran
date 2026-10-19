<script setup lang="ts">
import { computed } from 'vue';
import { approvalLabel, stateLabel } from '../i18n';

const props = defineProps<{ state: string; kind?: 'entity' | 'approval' }>();
const tone = computed(() => {
  if (['published', 'registration_open', 'active', 'live', 'final', 'approved', 'executed', 'ok', 'done', 'clean'].includes(props.state)) return 'ok';
  if (['paused', 'pending', 'in_review', 'degraded', 'disputed', 'provisional', 'preparing', 'unconfigured'].includes(props.state)) return 'warn';
  if (['cancelled', 'rejected', 'down', 'dead_letter', 'failed', 'expired', 'infected'].includes(props.state)) return 'danger';
  if (['scheduled', 'ready', 'registration_closed'].includes(props.state)) return 'info';
  return 'neutral';
});
const label = computed(() => (props.kind === 'approval' ? approvalLabel(props.state) : stateLabel(props.state)));
</script>

<template>
  <span class="badge" :data-tone="tone">{{ label }}</span>
</template>

<style scoped>
.badge { display: inline-block; padding: 0 var(--sp-3); border-radius: 999px; font-size: var(--fs-sm); line-height: 1.7; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); white-space: nowrap; }
[data-tone='ok'] { background: var(--ok-soft); color: var(--ok); border-color: transparent; }
[data-tone='warn'] { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
[data-tone='danger'] { background: var(--danger-soft); color: var(--danger); border-color: transparent; }
[data-tone='info'] { background: var(--info-soft); color: var(--info); border-color: transparent; }
</style>
