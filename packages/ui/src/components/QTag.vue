<script setup lang="ts">
import { computed, useSlots } from 'vue';
import { tr } from '../locale';
import type { IconName } from '../icons';
import { useControlled } from '../composables/inputs-field';
import QIcon from './QIcon.vue';

/**
 * Chip: static, selectable (aria-pressed; v-model:selected + change(selected)) or removable (× with «حذف …» / «Remove …»,
 * rendered when a @remove listener is bound). size sm | md. Text: default slot.
 */
export interface QTagProps {
  size?: 'sm' | 'md' | undefined;
  icon?: IconName | undefined;
  defaultSelected?: boolean | undefined;
  selectable?: boolean | undefined;
  removeLabel?: string | undefined;
  disabled?: boolean | undefined;
  /** Listener presence (@remove) shows the × button, as in the DS. */
  onRemove?: (() => void) | undefined;
}
const p = withDefaults(defineProps<QTagProps>(), { size: 'md', defaultSelected: undefined });
const selected = defineModel<boolean | null>('selected', { default: null });
const emit = defineEmits<{ change: [selected: boolean]; remove: [] }>();
const slots = useSlots();
const sel = useControlled(selected, !!p.defaultSelected);
const toggle = computed(() => p.selectable || selected.value != null || p.defaultSelected != null);
const iconSize = computed(() => (p.size === 'sm' ? 14 : 16));

/** Plain text of the default slot, for «حذف <text>». */
function slotText(): string {
  const nodes = slots.default?.() ?? [];
  return nodes.map((n) => (typeof n.children === 'string' ? n.children : '')).join('').trim();
}
function flip() {
  const v = !sel.value;
  selected.value = v;
  emit('change', v);
}
</script>

<template>
  <button
    v-if="toggle"
    type="button"
    :class="['q-tag', `q-tag--${size}`, { 'q-tag--selected': sel }, 'q-tag--selectable']"
    :aria-pressed="sel ? 'true' : 'false'"
    :disabled="disabled"
    @click="flip"
  >
    <QIcon v-if="sel" name="check" :size="iconSize" />
    <QIcon v-else-if="icon" :name="icon" :size="iconSize" />
    <span><slot /></span>
  </button>
  <span v-else :class="['q-tag', `q-tag--${size}`, { 'q-tag--selected': sel, 'q-tag--removable': onRemove }]">
    <QIcon v-if="icon" :name="icon" :size="iconSize" />
    <span><slot /></span>
    <button v-if="onRemove" type="button" class="q-tag__remove" :aria-label="removeLabel || tr('حذف ', 'Remove ') + slotText()" :disabled="disabled" @click="emit('remove')">
      <QIcon name="x" :size="size === 'sm' ? 12 : 14" />
    </button>
  </span>
</template>
