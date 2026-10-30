<script setup lang="ts">
import { computed, useId } from 'vue';
import QIcon from './QIcon.vue';

export interface AccordionItem {
  key: string; title: string; content: string;
  /** Clause number etc. */
  prefix?: string;
  meta?: string;
  disabled?: boolean;
}
/**
 * Accordion — expandable sections for rules clauses and FAQs. type 'single' | 'multiple'; `v-model` (key or null / key array)
 * + `change`. Rich content: scoped slots `#title`, `#content`, `#prefix`, `#meta` with `{ item, open }`.
 */
export interface QAccordionProps {
  items: AccordionItem[];
  type?: ('single' | 'multiple') | undefined;
  defaultValue?: (string | string[] | null) | undefined;
  /** single: allow closing the open item (default true). */
  collapsible?: (boolean) | undefined;
  headingLevel?: (2 | 3 | 4 | 5 | 6) | undefined;
}
const p = withDefaults(defineProps<QAccordionProps>(), { type: 'single', collapsible: true, headingLevel: 3 });
const model = defineModel<string | string[] | null | undefined>({ default: undefined });
const emit = defineEmits<{ change: [v: string | string[] | null] }>();

const id = useId();
const multiple = computed(() => p.type === 'multiple');
const val = computed(() => (model.value !== undefined ? model.value : p.defaultValue !== undefined ? p.defaultValue : multiple.value ? [] : null));
const list = () => (Array.isArray(val.value) ? val.value : []);
const isOpen = (k: string) => (multiple.value ? list().includes(k) : val.value === k);
function toggle(k: string) {
  let next: string | string[] | null;
  if (multiple.value) next = isOpen(k) ? list().filter((x) => x !== k) : [...list(), k];
  else next = val.value === k ? (p.collapsible === false ? k : null) : k;
  model.value = next;
  emit('change', next);
}
</script>

<template>
  <div class="q-accordion">
    <div v-for="(it, i) in items" :key="it.key" :class="['q-accordion__item', { 'is-open': isOpen(it.key) }]">
      <component :is="`h${headingLevel}`" class="q-accordion__heading">
        <button
          :id="`${id}-b${i}`" type="button" class="q-accordion__trigger" :aria-expanded="isOpen(it.key) ? 'true' : 'false'"
          :aria-controls="`${id}-p${i}`" :disabled="it.disabled" @click="toggle(it.key)"
        >
          <span v-if="it.prefix || $slots.prefix" class="q-accordion__prefix"><slot name="prefix" :item="it" :open="isOpen(it.key)">{{ it.prefix }}</slot></span>
          <span class="q-accordion__title"><slot name="title" :item="it" :open="isOpen(it.key)">{{ it.title }}</slot></span>
          <span v-if="it.meta || $slots.meta" class="q-accordion__meta"><slot name="meta" :item="it" :open="isOpen(it.key)">{{ it.meta }}</slot></span>
          <QIcon name="chevron-down" :size="20" class="q-accordion__chevron" />
        </button>
      </component>
      <div :id="`${id}-p${i}`" role="region" :aria-labelledby="`${id}-b${i}`" class="q-accordion__panel" :hidden="!isOpen(it.key)">
        <div class="q-accordion__content"><slot name="content" :item="it" :open="isOpen(it.key)">{{ it.content }}</slot></div>
      </div>
    </div>
  </div>
</template>
