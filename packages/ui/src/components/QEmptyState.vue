<script setup lang="ts">
import { computed, useSlots } from 'vue';
import type { IconName } from '../icons';
import { emptyTitle, laterBody, laterTitle } from '../maps/display';
import { defined } from '../composables/inputs-field';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';

/**
 * Honest empty panel: icon in a soft circle, title, body, optional action. variant later = later-stage notice
 * «این بخش در مرحله بعد تکمیل می‌شود». title / body / action / media: prop or slot; default slot = body.
 * actionLabel renders a Button that emits action(event). role / style / aria-* fall through to the root.
 */
export interface QEmptyStateProps {
  icon?: IconName | undefined;
  title?: string | undefined;
  body?: string | undefined;
  action?: string | undefined;
  actionLabel?: string | undefined;
  actionIcon?: IconName | undefined;
  actionVariant?: 'primary' | 'green' | 'secondary' | 'ghost' | undefined;
  actionHref?: string | undefined;
  variant?: 'default' | 'later' | undefined;
  tone?: 'neutral' | 'info' | 'warning' | 'danger' | 'success' | undefined;
  compact?: boolean | undefined;
  bordered?: boolean | undefined;
  media?: string | undefined;
}
const p = withDefaults(defineProps<QEmptyStateProps>(), { variant: 'default', actionVariant: 'green', bordered: true });
const emit = defineEmits<{ action: [event: MouseEvent] }>();
const slots = useSlots();
const later = computed(() => p.variant === 'later');
const t = computed(() => p.tone || (later.value ? 'info' : 'neutral'));
const hasBody = computed(() => !!(slots.default || slots.body || p.body || later.value));
const hasAction = computed(() => !!(slots.action || p.action || p.actionLabel));
</script>

<template>
  <div :class="['q-empty-state', `q-empty-state--${t}`, { 'q-empty-state--compact': compact, 'q-empty-state--plain': !bordered }]">
    <slot name="media">
      <template v-if="media">{{ media }}</template>
      <span v-else class="q-empty-state__icon"><QIcon :name="icon || (later ? 'clock' : 'inbox')" :size="compact ? 22 : 28" /></span>
    </slot>
    <p class="q-empty-state__title"><slot name="title">{{ title || (later ? laterTitle() : emptyTitle()) }}</slot></p>
    <div v-if="hasBody" class="q-empty-state__body"><slot><slot name="body">{{ body || laterBody() }}</slot></slot></div>
    <div v-if="hasAction" class="q-empty-state__action">
      <slot name="action">
        <template v-if="action">{{ action }}</template>
        <QButton v-else :variant="actionVariant" size="md" v-bind="defined({ icon: actionIcon, href: actionHref })" @click="emit('action', $event)">{{ actionLabel }}</QButton>
      </slot>
    </div>
  </div>
</template>
