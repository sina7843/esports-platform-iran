<script setup lang="ts">
import { computed } from 'vue';
import type { IconName } from '../icons';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';

/**
 * Button. variant: primary (red, one per view) | green (secondary action) | secondary (neutral outline)
 * | ghost (green text) | danger (outlined destructive, shows an alert icon). size: sm 40 | md 44 | lg 48 | xl 52.
 * href renders a link. iconOnly needs aria-label. aria-*, id, title, target, rel and @click fall through to the root.
 */
export interface QButtonProps {
  variant?: 'primary' | 'green' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  icon?: IconName;
  iconEnd?: IconName;
  flipIcon?: boolean;
  iconOnly?: boolean;
  chamfer?: boolean;
  block?: boolean;
  loading?: boolean;
  disabled?: boolean;
  href?: string;
  type?: 'button' | 'submit' | 'reset';
}
const p = withDefaults(defineProps<QButtonProps>(), { variant: 'secondary', size: 'md', type: 'button' });

const lead = computed<IconName | undefined>(() => p.icon ?? (p.variant === 'danger' && !p.iconOnly ? 'alert' : undefined));
const classes = computed(() => ['q-btn', `q-btn--${p.variant}`, `q-btn--${p.size}`, { 'q-btn--icon': p.iconOnly, 'q-btn--block': p.block, 'q-chamfer-md': p.chamfer }]);
const busy = computed(() => (p.loading ? 'true' : undefined));
</script>

<template>
  <QLink v-if="href" :href="href" :class="classes" :aria-busy="busy">
    <QIcon v-if="loading" name="loader" :size="18" class="q-spin" />
    <QIcon v-else-if="lead" :name="lead" :size="size === 'sm' ? 16 : 18" :flip="flipIcon" />
    <span v-if="!iconOnly"><slot /></span>
    <QIcon v-if="iconEnd && !iconOnly" :name="iconEnd" :size="18" :flip="flipIcon" />
  </QLink>
  <button v-else :type="type" :class="classes" :aria-busy="busy" :disabled="disabled || loading">
    <QIcon v-if="loading" name="loader" :size="18" class="q-spin" />
    <QIcon v-else-if="lead" :name="lead" :size="size === 'sm' ? 16 : 18" :flip="flipIcon" />
    <span v-if="!iconOnly"><slot /></span>
    <QIcon v-if="iconEnd && !iconOnly" :name="iconEnd" :size="18" :flip="flipIcon" />
  </button>
</template>
