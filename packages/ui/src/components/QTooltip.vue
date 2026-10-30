<script setup lang="ts">
import { computed, onMounted, onUpdated, ref, useId } from 'vue';

/**
 * Short label bubble on hover/focus (never for essential info). placement top | bottom; open forces it visible.
 * The default slot holds one focusable element; it gets aria-describedby → the bubble id automatically (also passed
 * as the slot prop `id`). content: prop or #content slot.
 */
export interface QTooltipProps {
  content?: string | undefined;
  placement?: 'top' | 'bottom' | undefined;
  open?: boolean | undefined;
}
const p = withDefaults(defineProps<QTooltipProps>(), { placement: 'top', open: undefined });
const id = `q-tip-${(useId() ?? '').replace(/[^a-zA-Z0-9_-]/g, '')}`;
const on = ref(false);
const shown = computed(() => (p.open != null ? p.open : on.value));
const root = ref<HTMLElement | null>(null);

/** DS clones the child with aria-describedby; here the first element child gets the id appended. */
function link() {
  const el = root.value?.firstElementChild;
  if (!el || el.getAttribute('role') === 'tooltip') return;
  const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  if (!ids.includes(id)) el.setAttribute('aria-describedby', [...ids, id].join(' '));
}
onMounted(link);
onUpdated(link);
</script>

<template>
  <span
    ref="root"
    :class="['q-tooltip', `q-tooltip--${placement === 'bottom' ? 'bottom' : 'top'}`, { 'q-tooltip--open': shown }]"
    @mouseenter="on = true"
    @mouseleave="on = false"
    @focusin="on = true"
    @focusout="on = false"
    @keydown.esc="on = false"
  >
    <slot :id="id" />
    <span :id="id" role="tooltip" class="q-tooltip__bubble"><slot name="content">{{ content }}</slot></span>
  </span>
</template>
