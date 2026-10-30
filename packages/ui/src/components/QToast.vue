<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { tr } from '../locale';
import type { IconName } from '../icons';
import { TONE_ICON, noticeTone } from '../maps/display';
import QIcon from './QIcon.vue';

/**
 * One toast: tone, message (prop, #message or default slot), optional action and close.
 * The × shows when a @close listener is bound; `duration` (ms) auto-closes through it. Don't auto-close toasts with an action.
 */
export interface QToastProps {
  tone?: 'info' | 'success' | 'warning' | 'danger' | undefined;
  title?: string | undefined;
  message?: string | undefined;
  action?: { label: string; onClick?: (() => void) | undefined } | undefined;
  closeLabel?: string | undefined;
  duration?: number | undefined;
  icon?: IconName | undefined;
  /** Listener presence (@close) shows the × and enables `duration`, as in the DS. */
  onClose?: (() => void) | undefined;
}
const p = defineProps<QToastProps>();
const emit = defineEmits<{ close: [] }>();
const t = computed(() => noticeTone(p.tone));

watchEffect((onCleanup) => {
  if (!p.duration || !p.onClose) return;
  const timer = setTimeout(() => emit('close'), p.duration);
  onCleanup(() => clearTimeout(timer));
});
</script>

<template>
  <div :class="['q-toast', `q-toast--${t}`]" :role="t === 'danger' ? 'alert' : undefined">
    <span class="q-toast__icon"><QIcon :name="icon || TONE_ICON[t]" :size="18" /></span>
    <div class="q-toast__body">
      <p v-if="title || $slots.title" class="q-toast__title"><slot name="title">{{ title }}</slot></p>
      <p class="q-toast__text"><slot><slot name="message">{{ message }}</slot></slot></p>
    </div>
    <button v-if="action" type="button" class="q-toast__action" @click="action.onClick?.()">{{ action.label }}</button>
    <button v-if="onClose" type="button" class="q-toast__close" :aria-label="closeLabel || tr('بستن اعلان', 'Dismiss notification')" @click="emit('close')">
      <QIcon name="x" :size="16" />
    </button>
  </div>
</template>
