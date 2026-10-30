<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import type { IconName } from '../icons';
import { countText } from '../maps/navigation';
import { elIsRtl, hStep } from '../composables/navigation-dom';
import QBadge from './QBadge.vue';
import QIcon from './QIcon.vue';

export interface TabsItem {
  key: string; label: string; icon?: IconName; count?: number; disabled?: boolean;
  /** Panel text; when any item has content (or the `panel` slot is used), tabpanels are rendered. */
  content?: string;
}
/**
 * Tabs — line (green underline) or pill (green-soft) tabs with optional counts. Arrow keys follow the computed direction,
 * Home/End jump; role tablist/tab/tabpanel. `v-model` (+ `change`) or `defaultValue`. Rich panels: `#panel="{ item }"`.
 */
export interface QTabsProps {
  items: TabsItem[];
  variant?: ('line' | 'pill') | undefined;
  defaultValue?: (string) | undefined;
  /** 'auto' (default) selects on arrow keys; 'manual' moves focus only. */
  activation?: ('auto' | 'manual') | undefined;
  /** Tabs share the full width equally. */
  fill?: (boolean) | undefined;
  /** v1.1 — 'wrap' (default) or 'scroll': one row that scrolls sideways with a fade on the hidden edge. */
  overflow?: ('wrap' | 'scroll') | undefined;
  ariaLabel?: (string) | undefined;
}
const p = withDefaults(defineProps<QTabsProps>(), { variant: 'line', activation: 'auto', overflow: 'wrap' });
const model = defineModel<string>();
const emit = defineEmits<{ change: [key: string] }>();
const slots = defineSlots<{ panel?(props: { item: TabsItem; selected: boolean }): unknown }>();

const id = useId();
const listRef = ref<HTMLElement | null>(null);
const enabled = computed(() => p.items.filter((i) => !i.disabled));
const sel = computed(() => model.value ?? p.defaultValue ?? enabled.value[0]?.key);
const hasPanels = computed(() => !!slots.panel || p.items.some((i) => i.content != null));
const scroll = computed(() => p.overflow === 'scroll');
const variantCls = computed(() => (p.variant === 'pill' ? 'pill' : 'line'));
const idx = (k: string) => p.items.findIndex((i) => i.key === k);
const tabId = (k: string) => `${id}-t-${idx(k)}`;
const panelId = (k: string) => `${id}-p-${idx(k)}`;

function select(k: string) {
  model.value = k;
  emit('change', k);
}

const fade = ref('');
function measure() {
  const el = listRef.value;
  if (!el) return;
  const x = Math.abs(el.scrollLeft), max = el.scrollWidth - el.clientWidth;
  const atStart = x > 1, atEnd = x < max - 1, rtl = elIsRtl(el);
  // physical sides: in RTL the start edge is on the right
  const l = rtl ? atEnd : atStart, r = rtl ? atStart : atEnd;
  fade.value = (l ? 'l' : '') + (r ? 'r' : '');
}
function reveal(tab: Element | null | undefined) {
  const el = listRef.value;
  if (!el || !tab) return;
  const lr = el.getBoundingClientRect(), tr = tab.getBoundingClientRect();
  if (tr.left < lr.left) el.scrollLeft -= lr.left - tr.left + 24;
  else if (tr.right > lr.right) el.scrollLeft += tr.right - lr.right + 24;
}
watch([scroll, sel, () => p.items.length, listRef], ([on]) => {
  window.removeEventListener('resize', measure);
  if (!on) return;
  void nextTick(() => {
    reveal(listRef.value?.querySelector('.is-selected'));
    measure();
  });
  window.addEventListener('resize', measure);
}, { immediate: true });
onBeforeUnmount(() => window.removeEventListener('resize', measure));

function onKey(e: KeyboardEvent) {
  const keys = enabled.value.map((i) => i.key);
  const cur = keys.indexOf((e.target as HTMLElement).getAttribute('data-key') ?? '');
  if (cur < 0) return;
  let n: number;
  const s = hStep(e.key, elIsRtl(listRef.value));
  if (s) n = (cur + s + keys.length) % keys.length;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = keys.length - 1;
  else return;
  e.preventDefault();
  const k = keys[n]!;
  const el = document.getElementById(tabId(k));
  if (el) { el.focus(); if (scroll.value) reveal(el); }
  if (p.activation !== 'manual') select(k);
}
</script>

<template>
  <div :class="['q-tabs', `q-tabs--${variantCls}`, { 'q-tabs--fill': fill, 'q-tabs--scroll': scroll }]">
    <div
      ref="listRef" role="tablist" :aria-label="ariaLabel" class="q-tabs__list"
      :data-fade="scroll && fade ? fade : undefined" @keydown="onKey" @scroll="scroll ? measure() : undefined"
    >
      <button
        v-for="it in items" :id="tabId(it.key)" :key="it.key" type="button" role="tab" :data-key="it.key"
        :aria-selected="it.key === sel ? 'true' : 'false'" :aria-controls="hasPanels ? panelId(it.key) : undefined"
        :tabindex="it.key === sel ? 0 : -1" :disabled="it.disabled" :class="['q-tabs__tab', { 'is-selected': it.key === sel }]"
        @click="select(it.key)"
      >
        <QIcon v-if="it.icon" :name="it.icon" :size="18" />
        <span>{{ it.label }}</span>
        <QBadge v-if="it.count != null" :tone="it.key === sel ? 'green' : 'neutral'" class="q-tabs__count">{{ countText(it.count) }}</QBadge>
      </button>
    </div>
    <template v-if="hasPanels">
      <div
        v-for="it in items" :id="panelId(it.key)" :key="it.key" role="tabpanel" :aria-labelledby="tabId(it.key)" tabindex="0"
        :hidden="it.key !== sel" class="q-tabs__panel"
      >
        <slot name="panel" :item="it" :selected="it.key === sel">{{ it.content }}</slot>
      </div>
    </template>
  </div>
</template>
