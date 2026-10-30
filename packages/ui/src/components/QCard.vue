<script setup lang="ts">
import { computed } from 'vue';
import QLink from './QLink.vue';

/** Card: the Arena surface. chamfer cuts the corners (feature cards); live adds the red glow; href/interactive add hover; as picks the element. */
export interface QCardProps {
  as?: string;
  href?: string;
  padding?: 'default' | 'lg' | 'none';
  chamfer?: boolean;
  live?: boolean;
  interactive?: boolean;
}
const p = withDefaults(defineProps<QCardProps>(), { padding: 'default' });
const classes = computed(() => ['q-card', p.padding === 'none' ? 'q-card--flush' : p.padding === 'lg' ? 'q-card--lg' : null,
  { 'q-chamfer-xl': p.chamfer, 'q-card--live': p.live, 'q-card--interactive': p.interactive || !!p.href }]);
</script>

<template>
  <QLink v-if="href && !as" :href="href" :class="classes"><slot /></QLink>
  <component :is="as ?? (href ? 'a' : 'div')" v-else :href="href" :class="classes"><slot /></component>
</template>
