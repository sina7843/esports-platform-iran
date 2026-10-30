<script setup lang="ts">
import { computed, ref } from 'vue';
import { tr } from '../locale';
import type { IconName } from '../icons';
import { useControlled, useUid } from '../composables/inputs-field';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';

export interface QSearchFieldSuggestion { id?: string; label: string; meta?: string }
export interface QSearchFieldGroup { label: string; icon?: IconName; items: QSearchFieldSuggestion[] }
/**
 * SearchField: search icon, input, clear button and a green «جست‌وجو» submit; optional grouped suggestions.
 * v-model + change(value, event); submit(value); select(item, group). Filtering is the consumer's job.
 */
export interface QSearchFieldProps {
  label?: string;
  placeholder?: string;
  submitLabel?: string;
  clearLabel?: string;
  suggestions?: QSearchFieldGroup[];
  suggestionsLabel?: string;
  defaultOpen?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  defaultValue?: string;
}
const p = defineProps<QSearchFieldProps>();
const model = defineModel<string>();
const emit = defineEmits<{ change: [value: string, event: Event | null]; submit: [value: string]; select: [item: QSearchFieldSuggestion, group: QSearchFieldGroup] }>();
const cur = useControlled(model, p.defaultValue ?? '');
const val = computed(() => cur.value || '');
const open = ref(!!p.defaultOpen);
const active = ref(-1);
const inputRef = ref<HTMLInputElement | null>(null);
const id = useUid('q-search', () => p.id);
const listId = computed(() => `${id.value}-list`);

interface Entry { g: QSearchFieldGroup; it: QSearchFieldSuggestion; k: number }
const groups = computed(() => {
  let k = -1;
  return (p.suggestions ?? []).map((g) => ({ g, items: (g.items ?? []).map((it): Entry => ({ g, it, k: ++k })) }));
});
const flat = computed(() => groups.value.flatMap((x) => x.items));
const hasList = computed(() => (p.suggestions?.length ?? 0) > 0);
const shown = computed(() => hasList.value && open.value && flat.value.length > 0);

function set(v: string, e: Event | null) {
  model.value = v;
  emit('change', v, e);
}
function pick(entry?: Entry) {
  if (!entry) return;
  emit('select', entry.it, entry.g);
  open.value = false;
}
function onKeyDown(e: KeyboardEvent) {
  if (!hasList.value) return;
  const n = flat.value.length;
  if (e.key === 'ArrowDown') { e.preventDefault(); open.value = true; active.value = n ? (active.value + 1) % n : -1; }
  else if (e.key === 'ArrowUp') { e.preventDefault(); open.value = true; active.value = n ? (active.value - 1 + n) % n : -1; }
  else if (e.key === 'Enter' && shown.value && active.value >= 0) { e.preventDefault(); pick(flat.value[active.value]); }
  else if (e.key === 'Escape') { if (shown.value) { e.preventDefault(); open.value = false; } }
}
function onInput(e: Event) {
  set((e.target as HTMLInputElement).value, e);
  open.value = true;
  active.value = -1;
}
function onSubmit() {
  open.value = false;
  emit('submit', val.value);
}
function onBlur(e: FocusEvent) {
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) open.value = false;
}
function clear() {
  set('', null);
  open.value = false;
  inputRef.value?.focus();
}
/** Highlight the first case-insensitive match of the query. */
function mark(label: string): [string, string, string] | null {
  const q = val.value.trim();
  const i = q ? label.toLowerCase().indexOf(q.toLowerCase()) : -1;
  return i < 0 ? null : [label.slice(0, i), label.slice(i, i + q.length), label.slice(i + q.length)];
}
</script>

<template>
  <form role="search" class="q-search-field" novalidate @submit.prevent="onSubmit" @focusout="onBlur">
    <label :for="id" class="q-sr">{{ label || tr('جست‌وجو', 'Search') }}</label>
    <div class="q-search-field__box">
      <QIcon name="search" :size="20" class="q-search-field__icon" />
      <input
        :id="id"
        ref="inputRef"
        type="search"
        :name="name || 'q'"
        autocomplete="off"
        enterkeyhint="search"
        class="q-search-field__input"
        :value="val"
        :disabled="disabled"
        :placeholder="placeholder || tr('نام تیم، بازیکن، رویداد یا خبر…', 'Team, player, event or news…')"
        :role="hasList ? 'combobox' : undefined"
        :aria-expanded="hasList ? (shown ? 'true' : 'false') : undefined"
        :aria-controls="hasList ? listId : undefined"
        :aria-autocomplete="hasList ? 'list' : undefined"
        :aria-activedescendant="shown && active >= 0 ? `${listId}-o${active}` : undefined"
        @input="onInput"
        @focus="val && (open = true)"
        @keydown="onKeyDown"
      />
      <button v-if="val" type="button" class="q-search-field__clear" :aria-label="clearLabel || tr('پاک کردن جست‌وجو', 'Clear search')" @click="clear">
        <QIcon name="x" :size="18" />
      </button>
      <QButton type="submit" variant="green" size="md" class="q-search-field__submit" :disabled="disabled">{{ submitLabel || tr('جست‌وجو', 'Search') }}</QButton>
    </div>
    <div v-if="hasList" :id="listId" role="listbox" class="q-search-field__panel" :hidden="!shown" :aria-label="suggestionsLabel || tr('پیشنهادها', 'Suggestions')">
      <div v-for="(grp, gi) in groups" :key="`g${gi}`" role="group" :aria-labelledby="`${listId}-g${gi}`" class="q-search-field__group">
        <div :id="`${listId}-g${gi}`" class="q-search-field__group-label" role="presentation">
          <QIcon v-if="grp.g.icon" :name="grp.g.icon" :size="16" />{{ grp.g.label }}
        </div>
        <div
          v-for="e in grp.items"
          :id="`${listId}-o${e.k}`"
          :key="`i${e.it.id || e.it.label}`"
          role="option"
          :aria-selected="e.k === active ? 'true' : 'false'"
          :class="['q-search-field__option', { 'q-search-field__option--active': e.k === active }]"
          @mousedown.prevent
          @mouseenter="active = e.k"
          @click="pick(e)"
        >
          <span class="q-search-field__option-label"><template v-if="mark(e.it.label)">{{ mark(e.it.label)![0] }}<mark class="q-search-field__mark">{{ mark(e.it.label)![1] }}</mark>{{ mark(e.it.label)![2] }}</template><template v-else>{{ e.it.label }}</template></span>
          <span v-if="e.it.meta" class="q-search-field__option-meta">{{ e.it.meta }}</span>
        </div>
      </div>
    </div>
  </form>
</template>
