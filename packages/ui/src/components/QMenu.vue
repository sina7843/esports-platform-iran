<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import type { IconName } from '../icons';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';

export interface MenuItem {
  key?: string; label?: string; icon?: IconName;
  /** Shortcut hint, shown LTR (e.g. 'Ctrl+E'). */
  shortcut?: string;
  /** Destructive item (danger-text). */
  danger?: boolean;
  /** Makes it a checkable item; true shows the green check. */
  checked?: boolean;
  /** With checked: render as menuitemradio. */
  radio?: boolean;
  disabled?: boolean; href?: string; onSelect?: () => void;
  type?: 'item' | 'separator' | 'label';
}
/**
 * Menu — button-triggered dropdown (user menu, display settings, row actions); role=menu, full keyboard support.
 * `v-model:open` (+ `openChange`) or `defaultOpen`; `select` emits the item key.
 */
export interface QMenuProps {
  /** Trigger label (also aria-label when iconOnly). */
  label: string;
  icon?: IconName;
  iconOnly?: boolean;
  triggerVariant?: 'secondary' | 'ghost';
  items: MenuItem[];
  defaultOpen?: boolean;
  /** Close after toggling a checkable item (default: stay open). */
  closeOnCheck?: boolean;
  /** Align the list to the trigger's inline end. */
  align?: 'start' | 'end';
  /** Render the list in flow instead of absolutely positioned (docs, previews). */
  inline?: boolean;
}
const p = withDefaults(defineProps<QMenuProps>(), { triggerVariant: 'secondary', align: 'start' });
const model = defineModel<boolean | undefined>('open', { default: undefined });
const emit = defineEmits<{ openChange: [open: boolean]; select: [key: string] }>();

const id = useId();
const rootRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const trigRef = ref<HTMLButtonElement | null>(null);
const open = computed(() => model.value ?? p.defaultOpen);
const hasCheck = computed(() => p.items.some((i) => i.checked != null));
let pending: 'first' | 'last' | null = null;

function setOpen(v: boolean) {
  model.value = v;
  emit('openChange', v);
}
const enabledItems = () => Array.from(listRef.value?.querySelectorAll<HTMLElement>('[data-mi]:not([aria-disabled="true"])') ?? []);
function focusItem(n: number | 'first' | 'last') {
  const els = enabledItems();
  if (!els.length) return;
  const i = n === 'last' ? els.length - 1 : n === 'first' ? 0 : n;
  els[(i + els.length) % els.length]?.focus();
}
watch(open, (o) => {
  if (o && pending) { const w = pending; pending = null; void nextTick(() => focusItem(w)); }
});
function openWith(where: 'first' | 'last') {
  pending = where;
  if (open.value) { focusItem(where); pending = null; } else setOpen(true);
}
function close(refocus: boolean) {
  setOpen(false);
  if (refocus) trigRef.value?.focus();
}

const onDown = (e: MouseEvent) => { if (rootRef.value && !rootRef.value.contains(e.target as Node)) setOpen(false); };
watch(open, (o) => {
  document.removeEventListener('mousedown', onDown);
  if (o) document.addEventListener('mousedown', onDown);
}, { immediate: true });
onBeforeUnmount(() => document.removeEventListener('mousedown', onDown));

function onTrigKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); openWith('first'); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); openWith('last'); }
}
function onListKey(e: KeyboardEvent) {
  const els = enabledItems();
  const cur = els.indexOf(document.activeElement as HTMLElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(cur + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(cur - 1); }
  else if (e.key === 'Home') { e.preventDefault(); focusItem('first'); }
  else if (e.key === 'End') { e.preventDefault(); focusItem('last'); }
  else if (e.key === 'Escape') { e.preventDefault(); close(true); }
  else if (e.key === 'Tab') close(false);
  else if (e.key.length === 1 && /\S/.test(e.key)) {
    for (let k = 1; k <= els.length; k++) {
      const el = els[(cur + k) % els.length];
      if (el && (el.textContent ?? '').trim().charAt(0).toLowerCase() === e.key.toLowerCase()) { el.focus(); break; }
    }
  }
}
function choose(it: MenuItem, e: Event) {
  if (it.disabled) { e.preventDefault(); return; }
  it.onSelect?.();
  if (it.key != null) emit('select', it.key);
  if (it.checked == null || p.closeOnCheck) close(true);
}
const itemAttrs = (it: MenuItem) => ({
  'data-mi': '', tabindex: -1,
  role: it.checked != null ? (it.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem',
  'aria-checked': it.checked != null ? (it.checked ? 'true' : 'false') : undefined,
  'aria-disabled': it.disabled ? 'true' : undefined,
  class: ['q-menu__item', { 'q-menu__item--danger': it.danger, 'is-checked': it.checked }],
});
</script>

<template>
  <div ref="rootRef" :class="['q-menu', { 'q-menu--inline': inline, 'q-menu--end': align === 'end' }]">
    <button
      :id="`${id}-b`" ref="trigRef" type="button"
      :class="['q-menu__trigger', { 'q-menu__trigger--icon': iconOnly, 'q-menu__trigger--ghost': triggerVariant === 'ghost' }]"
      aria-haspopup="menu" :aria-expanded="open ? 'true' : 'false'" :aria-controls="open ? `${id}-m` : undefined"
      :aria-label="iconOnly ? label : undefined" :title="iconOnly ? label : undefined"
      @click="open ? close(false) : openWith('first')" @keydown="onTrigKey"
    >
      <QIcon v-if="icon" :name="icon" :size="18" />
      <span v-if="!iconOnly">{{ label }}</span>
      <QIcon v-if="!iconOnly" name="chevron-down" :size="16" class="q-menu__caret" />
    </button>
    <div v-if="open" :id="`${id}-m`" ref="listRef" role="menu" :aria-labelledby="`${id}-b`" class="q-menu__list" @keydown="onListKey">
      <template v-for="(it, i) in items" :key="it.key ?? i">
        <div v-if="it.type === 'separator'" role="separator" class="q-menu__sep" />
        <div v-else-if="it.type === 'label'" role="presentation" class="q-menu__label">{{ it.label }}</div>
        <component :is="it.href ? QLink : 'button'" v-else v-bind="{ ...itemAttrs(it), ...(it.href ? { href: it.href } : { type: 'button' }) }" @click="choose(it, $event)">
          <span v-if="hasCheck" class="q-menu__check" aria-hidden="true"><QIcon v-if="it.checked" name="check" :size="18" /></span>
          <QIcon v-if="it.icon" :name="it.icon" :size="18" class="q-menu__icon" />
          <span class="q-menu__text">{{ it.label }}</span>
          <kbd v-if="it.shortcut" class="q-menu__kbd q-ltr">{{ it.shortcut }}</kbd>
        </component>
      </template>
    </div>
  </div>
</template>
