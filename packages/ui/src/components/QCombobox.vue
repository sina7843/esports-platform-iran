<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { tr } from '../locale';
import type { IconName } from '../icons';
import { norm } from '../maps/inputs';
import { useControlled, useUid } from '../composables/inputs-field';
import QFormField from './QFormField.vue';
import QIcon from './QIcon.vue';

export interface QComboboxOption { value: string; label: string; description?: string; icon?: IconName; disabled?: boolean }
/**
 * Combobox: searchable listbox, single or multiple. Multiple shows removable chips inside the field.
 * Keyboard: ArrowDown/ArrowUp move, Enter picks, Escape closes, Backspace in an empty query removes the last chip.
 * v-model: string | null (single) or string[] (multiple); change(value, option).
 */
export interface QComboboxProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  options: QComboboxOption[];
  multiple?: boolean;
  placeholder?: string;
  addPlaceholder?: string;
  emptyText?: string;
  prefixIcon?: IconName;
  defaultOpen?: boolean;
  id?: string;
  defaultValue?: string | string[] | null;
}
type Val = string | string[] | null;
const p = defineProps<QComboboxProps>();
const model = defineModel<Val>();
const emit = defineEmits<{ change: [value: Val, option: QComboboxOption | null] }>();
const cur = useControlled<Val>(model, p.defaultValue !== undefined ? p.defaultValue : p.multiple ? [] : null);

const selected = computed<string[]>(() => {
  const v = cur.value;
  if (p.multiple) return Array.isArray(v) ? v : [];
  return v == null || v === '' ? [] : [String(v)];
});
const find = (v: string): QComboboxOption | null => p.options.find((o) => o.value === v) ?? null;
const query = ref('');
const editing = ref(false);
const open = ref(!!p.defaultOpen);
const active = ref(-1);
const inputRef = ref<HTMLInputElement | null>(null);
const listId = useUid('q-combobox-list', () => (p.id ? `${p.id}-list` : undefined));
const filterOn = computed(() => (p.multiple || editing.value ? norm(query.value) : ''));
const list = computed(() => p.options.filter((o) => !filterOn.value || norm(o.label).includes(filterOn.value) || (!!o.description && norm(o.description).includes(filterOn.value))));

watch([open, filterOn], () => {
  if (!open.value) return;
  const l = list.value;
  let i = -1;
  if (!filterOn.value) i = l.findIndex((o) => selected.value.includes(o.value));
  if (i < 0) i = l.findIndex((o) => !o.disabled);
  active.value = i;
}, { immediate: true });

function set(v: Val, o: QComboboxOption | null) {
  model.value = v;
  emit('change', v, o);
}
function choose(o?: QComboboxOption) {
  if (!o || o.disabled) return;
  if (p.multiple) {
    const has = selected.value.includes(o.value);
    set(has ? selected.value.filter((v) => v !== o.value) : [...selected.value, o.value], o);
    query.value = '';
  } else {
    set(o.value, o);
    query.value = '';
    editing.value = false;
    open.value = false;
  }
}
function remove(v: string) { set(selected.value.filter((x) => x !== v), find(v)); }
function move(d: number) {
  const l = list.value;
  if (!l.length) return;
  let i = active.value;
  for (let n = 0; n < l.length; n++) { i = (i + d + l.length) % l.length; if (!l[i]?.disabled) break; }
  active.value = i;
}
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); if (!open.value) open.value = true; else move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (!open.value) open.value = true; else move(-1); }
  else if (e.key === 'Enter') { if (open.value && active.value >= 0) { e.preventDefault(); choose(list.value[active.value]); } }
  else if (e.key === 'Escape') { if (open.value) { e.preventDefault(); open.value = false; } else if (editing.value) { editing.value = false; query.value = ''; } }
  else if (e.key === 'Backspace' && p.multiple && query.value === '' && selected.value.length) { remove(selected.value[selected.value.length - 1]!); }
  else if (e.key === 'Tab') open.value = false;
}
function onInput(e: Event) {
  query.value = (e.target as HTMLInputElement).value;
  editing.value = true;
  open.value = true;
}
function onAnchorBlur(e: FocusEvent) {
  const cur = e.currentTarget as HTMLElement;
  if (!cur.contains(e.relatedTarget as Node | null)) { open.value = false; editing.value = false; query.value = ''; }
}
function onControlDown(e: MouseEvent) {
  if (e.target === e.currentTarget) { e.preventDefault(); inputRef.value?.focus(); open.value = true; }
}
const singleLabel = computed(() => (!p.multiple && selected.value.length ? (find(selected.value[0]!)?.label ?? '') : ''));
const inputValue = computed(() => (p.multiple || editing.value ? query.value : singleLabel.value));
const optId = (i: number) => `${listId.value}-o${i}`;
</script>

<template>
  <QFormField :id="id" :label="label" :hint="hint" :error="error" :required="required" :disabled="disabled" class="q-combobox">
    <template v-if="$slots.label" #label><slot name="label" /></template>
    <template v-if="$slots.hint" #hint><slot name="hint" /></template>
    <template v-if="$slots.error" #error><slot name="error" /></template>
    <template #default="f">
      <div class="q-combobox__anchor" @focusout="onAnchorBlur">
        <div
          :class="['q-form-field__control', 'q-combobox__control', {
            'q-combobox__control--multiple': multiple, 'q-form-field__control--invalid': f.invalid, 'q-form-field__control--disabled': disabled }]"
          @mousedown="onControlDown"
        >
          <QIcon v-if="prefixIcon" :name="prefixIcon" :size="20" class="q-combobox__icon" />
          <template v-if="multiple">
            <span v-for="v in selected" :key="`c${v}`" class="q-combobox__chip">
              <span class="q-combobox__chip-label">{{ find(v)?.label ?? String(v) }}</span>
              <button
                v-if="!disabled"
                type="button"
                class="q-combobox__chip-x"
                :aria-label="tr('حذف ', 'Remove ') + (find(v)?.label ?? String(v))"
                @click="remove(v); inputRef?.focus()"
              >
                <QIcon name="x" :size="14" :stroke-width="2.5" />
              </button>
            </span>
          </template>
          <input
            :id="f.id"
            ref="inputRef"
            type="text"
            role="combobox"
            autocomplete="off"
            :disabled="disabled"
            class="q-combobox__input"
            :value="inputValue"
            :placeholder="multiple && selected.length ? (addPlaceholder || '') : placeholder"
            :aria-expanded="open ? 'true' : 'false'"
            :aria-controls="listId"
            aria-autocomplete="list"
            :aria-activedescendant="open && active >= 0 ? optId(active) : undefined"
            :aria-invalid="f.invalid ? 'true' : undefined"
            :aria-describedby="f.describedBy"
            :aria-required="f.required ? 'true' : undefined"
            @input="onInput"
            @click="open = true"
            @keydown="onKeyDown"
          />
          <button
            type="button"
            tabindex="-1"
            class="q-combobox__toggle"
            :disabled="disabled"
            :aria-label="open ? tr('بستن فهرست', 'Close list') : tr('نمایش گزینه‌ها', 'Show options')"
            @mousedown.prevent
            @click="open = !open; inputRef?.focus()"
          >
            <QIcon :name="open ? 'chevron-up' : 'chevron-down'" :size="20" />
          </button>
        </div>
        <ul
          :id="listId"
          role="listbox"
          class="q-combobox__list"
          :hidden="!open"
          :aria-labelledby="f.labelId"
          :aria-multiselectable="multiple ? 'true' : undefined"
        >
          <template v-if="list.length">
            <li
              v-for="(o, i) in list"
              :id="optId(i)"
              :key="`o${o.value}`"
              role="option"
              :aria-selected="selected.includes(o.value) ? 'true' : 'false'"
              :aria-disabled="o.disabled ? 'true' : undefined"
              :class="['q-combobox__option', { 'q-combobox__option--active': i === active, 'q-combobox__option--selected': selected.includes(o.value) }]"
              @mousedown.prevent
              @mouseenter="!o.disabled && (active = i)"
              @click="choose(o)"
            >
              <QIcon v-if="o.icon" :name="o.icon" :size="18" class="q-combobox__option-icon" />
              <span class="q-combobox__option-text">
                <span class="q-combobox__option-label">{{ o.label }}</span>
                <span v-if="o.description" class="q-combobox__option-desc">{{ o.description }}</span>
              </span>
              <span class="q-combobox__check" aria-hidden="true"><QIcon v-if="selected.includes(o.value)" name="check" :size="18" :stroke-width="2.5" /></span>
            </li>
          </template>
          <li v-else class="q-combobox__empty" role="presentation">{{ emptyText || tr('نتیجه‌ای پیدا نشد', 'No results found') }}</li>
        </ul>
      </div>
    </template>
  </QFormField>
</template>
