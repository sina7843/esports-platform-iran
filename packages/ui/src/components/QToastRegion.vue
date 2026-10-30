<script setup lang="ts">
import { tr } from '../locale';
import { defined } from '../composables/inputs-field';
import QToast, { type QToastProps } from './QToast.vue';

export interface QToastRegionItem extends QToastProps { id?: string | number }
/**
 * Polite live region that stacks toasts at the bottom inline-start corner. Mount one in the app shell, fed by useToast():
 * <QToastRegion :toasts="toasts" @dismiss="dismiss" />. Or pass QToast children. inline renders it in flow (previews).
 */
export interface QToastRegionProps {
  toasts?: readonly QToastRegionItem[];
  label?: string;
  inline?: boolean;
  /** Listener presence (@dismiss) gives every toast a close button, as in the DS. */
  onDismiss?: (id: string | number) => void;
}
const p = defineProps<QToastRegionProps>();
const emit = defineEmits<{ dismiss: [id: string | number] }>();
const closeOf = (t: QToastRegionItem, i: number): (() => void) | undefined =>
  p.onDismiss ? () => emit('dismiss', t.id ?? i) : t.onClose;
</script>

<template>
  <section
    :class="['q-toast-region', { 'q-toast-region--inline': inline }]"
    :aria-label="label || tr('اعلان‌ها', 'Notifications')"
    aria-live="polite"
    aria-relevant="additions"
  >
    <template v-if="toasts">
      <QToast
        v-for="(t, i) in toasts"
        :key="t.id ?? i"
        :tone="t.tone"
        :title="t.title"
        :message="t.message"
        :action="t.action"
        :close-label="t.closeLabel"
        :duration="t.duration"
        :icon="t.icon"
        v-bind="defined({ onClose: closeOf(t, i) })"
      />
    </template>
    <slot v-else />
  </section>
</template>
