<script setup lang="ts">
/** Hairline separator. orientation horizontal | vertical; optional centred label (prop or slot). */
export interface QDividerProps {
  orientation?: ('horizontal' | 'vertical') | undefined;
  label?: (string) | undefined;
  align?: ('center' | 'start') | undefined;
  spacing?: ('md' | 'lg') | undefined;
}
withDefaults(defineProps<QDividerProps>(), { orientation: 'horizontal', align: 'center', spacing: 'md' });
</script>

<template>
  <span v-if="orientation === 'vertical'" class="q-divider q-divider--vertical" role="separator" aria-orientation="vertical" />
  <div v-else-if="label || $slots.label" :class="['q-divider', 'q-divider--label', { 'q-divider--start': align === 'start' }]" role="separator">
    <span class="q-divider__text"><slot name="label">{{ label }}</slot></span>
  </div>
  <hr v-else :class="['q-divider', 'q-divider--horizontal', { 'q-divider--lg': spacing === 'lg' }]" />
</template>
