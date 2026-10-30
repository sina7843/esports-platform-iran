<script setup lang="ts">
import { computed, ref, useId, useSlots } from 'vue';
import type { IconName } from '../icons';
import { tr } from '../locale';
import { useFocusTrap } from '../composables/useFocusTrap';
import { useListenerCheck } from '../composables/navigation-dom';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';

/**
 * Dialog — modal with scrim, title, body (default slot) and footer actions; focus trap, Escape and scrim click close,
 * focus returns to the opener. `v-model:open` + `close`. Renders in place (position: fixed); `class` goes to the panel.
 * Without a `close` / `update:open` listener (or with dismissible=false) there is no close button, like the DS without onClose.
 */
export interface QDialogProps {
  title?: string;
  description?: string;
  /** Footer actions (or the `footer` slot), end-aligned (secondary first, the primary last). */
  footer?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Leading icon tile and its tone. */
  icon?: IconName;
  tone?: 'neutral' | 'danger' | 'warning' | 'success' | 'info';
  /** false: no close button, Escape and scrim do nothing. */
  dismissible?: boolean;
  role?: 'dialog' | 'alertdialog';
  closeLabel?: string;
  /** Render inside its container instead of fixed to the viewport (no focus move, no scroll lock). */
  inline?: boolean;
  inlineHeight?: number;
  backdrop?: string;
}
defineOptions({ inheritAttrs: false });
const p = withDefaults(defineProps<QDialogProps>(), { size: 'md', tone: 'neutral', dismissible: true, role: 'dialog' });
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ close: [] }>();
const slots = useSlots();
const listens = useListenerCheck();

const id = useId();
const panel = ref<HTMLElement | null>(null);
const canDismiss = () => p.dismissible !== false && listens('onClose', 'onUpdate:open');
function dismiss() {
  if (!canDismiss()) return;
  emit('close');
  open.value = false;
}
const onKey = useFocusTrap(panel, () => !!open.value && !p.inline, () => { if (canDismiss()) dismiss(); });
const hasDesc = computed(() => !!p.description || !!slots.description);
</script>

<template>
  <div v-if="open" :class="['q-dialog', { 'q-dialog--inline': inline }]" :style="inline && inlineHeight ? { minHeight: `${inlineHeight}px` } : undefined">
    <div v-if="inline && (backdrop || $slots.backdrop)" class="q-dialog__backdrop" aria-hidden="true"><slot name="backdrop">{{ backdrop }}</slot></div>
    <div class="q-dialog__scrim" aria-hidden="true" @click="dismiss" />
    <div
      ref="panel" :role="role" :aria-modal="inline ? undefined : 'true'" :aria-labelledby="`${id}-t`"
      :aria-describedby="hasDesc ? `${id}-d` : undefined" tabindex="-1" :class="['q-dialog__panel', `q-dialog__panel--${size}`]"
      v-bind="$attrs" @keydown="onKey"
    >
      <div class="q-dialog__head">
        <span v-if="icon" :class="['q-dialog__icon', `q-dialog__icon--${tone}`]" aria-hidden="true"><QIcon :name="icon" :size="22" /></span>
        <div class="q-dialog__titles">
          <h2 :id="`${id}-t`" class="q-dialog__title"><slot name="title">{{ title }}</slot></h2>
          <p v-if="hasDesc" :id="`${id}-d`" class="q-dialog__desc"><slot name="description">{{ description }}</slot></p>
        </div>
        <QButton v-if="canDismiss()" variant="secondary" icon-only icon="x" :aria-label="closeLabel || tr('بستن', 'Close')" class="q-dialog__close" @click="dismiss" />
      </div>
      <div v-if="$slots.default" class="q-dialog__body"><slot /></div>
      <div v-if="footer || $slots.footer" class="q-dialog__foot"><slot name="footer">{{ footer }}</slot></div>
    </div>
  </div>
</template>
