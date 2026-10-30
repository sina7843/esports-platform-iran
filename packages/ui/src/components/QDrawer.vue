<script setup lang="ts">
import { ref, useId } from 'vue';
import { tr } from '../locale';
import { useFocusTrap } from '../composables/useFocusTrap';
import { useListenerCheck } from '../composables/navigation-dom';
import QButton from './QButton.vue';

/**
 * Drawer — side sheet from inline-start (mobile nav) or inline-end (filters, row details) with scrim, header, scrollable
 * body (default slot) and footer; modal focus behaviour like Dialog. `v-model:open` + `close`. Renders in place.
 */
export interface QDrawerProps {
  /** start = inline-start (right in RTL; mobile nav), end = inline-end (filters, row details). */
  side?: ('start' | 'end') | undefined;
  title?: (string) | undefined;
  footer?: (string) | undefined;
  /** Panel width in px (default 360 from CSS, never wider than the container minus 48px). */
  width?: (number) | undefined;
  closeLabel?: (string) | undefined;
  inline?: (boolean) | undefined;
  inlineHeight?: (number) | undefined;
  backdrop?: (string) | undefined;
}
const p = withDefaults(defineProps<QDrawerProps>(), { side: 'start' });
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ close: [] }>();
const listens = useListenerCheck();

const id = useId();
const panel = ref<HTMLElement | null>(null);
const canClose = () => listens('onClose', 'onUpdate:open');
function close() {
  if (!canClose()) return;
  emit('close');
  open.value = false;
}
const onKey = useFocusTrap(panel, () => !!open.value && !p.inline, () => { if (canClose()) close(); });
</script>

<template>
  <div
    v-if="open" :class="['q-drawer', `q-drawer--${side === 'end' ? 'end' : 'start'}`, { 'q-drawer--inline': inline }]"
    :style="inline ? { height: `${inlineHeight || 480}px` } : undefined"
  >
    <div v-if="inline && (backdrop || $slots.backdrop)" class="q-drawer__backdrop" aria-hidden="true"><slot name="backdrop">{{ backdrop }}</slot></div>
    <div class="q-drawer__scrim" aria-hidden="true" @click="close" />
    <div
      ref="panel" role="dialog" :aria-modal="inline ? undefined : 'true'" :aria-labelledby="`${id}-t`" tabindex="-1"
      class="q-drawer__panel" :style="width ? { width: `${width}px` } : undefined" @keydown="onKey"
    >
      <div class="q-drawer__head">
        <h2 :id="`${id}-t`" class="q-drawer__title"><slot name="title">{{ title }}</slot></h2>
        <QButton v-if="canClose()" variant="secondary" icon-only icon="x" :aria-label="closeLabel || tr('بستن', 'Close')" @click="close" />
      </div>
      <div class="q-drawer__body"><slot /></div>
      <div v-if="footer || $slots.footer" class="q-drawer__foot"><slot name="footer">{{ footer }}</slot></div>
    </div>
  </div>
</template>
