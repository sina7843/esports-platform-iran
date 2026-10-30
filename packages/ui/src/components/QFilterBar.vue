<script setup lang="ts">
import { computed, useId } from 'vue';
import { tr } from '../locale';
import { allOf } from '../maps/navigation';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';
import QSegmentedControl, { type SegmentedControlOption } from './QSegmentedControl.vue';

export interface FilterBarOption { value: string; label: string }
export interface FilterBarFilter {
  key: string; label: string; options: FilterBarOption[];
  /** First option text; default «همه <label>» / «Any <label>». */
  allLabel?: string;
  defaultValue?: string;
}
/**
 * FilterBar — list toolbar: search, a few selects, the cards/list view toggle, «پاک کردن فیلترها» and removable chips.
 * Models: `v-model:values` (by key, '' = all), `v-model:query`, `v-model:view`; emits filterChange, queryChange, viewChange, clear.
 */
export interface QFilterBarProps {
  filters?: FilterBarFilter[];
  /** false hides the search field. */
  search?: boolean;
  defaultQuery?: string;
  searchLabel?: string;
  searchPlaceholder?: string;
  /** View toggle options (e.g. کارت‌ها / فهرست); rendered as a SegmentedControl. */
  views?: SegmentedControlOption[];
  defaultView?: string;
  viewLabel?: string;
  clearLabel?: string;
  /** Result count at the end of the chips row (or the `resultLabel` slot). */
  resultLabel?: string;
  ariaLabel?: string;
}
const p = withDefaults(defineProps<QFilterBarProps>(), { filters: () => [], search: true, defaultQuery: '' });
const values = defineModel<Record<string, string>>('values');
const queryModel = defineModel<string>('query');
const view = defineModel<string>('view');
const emit = defineEmits<{
  filterChange: [key: string, value: string, all: Record<string, string>];
  queryChange: [q: string];
  viewChange: [v: string];
  clear: [];
}>();

const id = useId();
const init = computed(() => Object.fromEntries(p.filters.map((f) => [f.key, f.defaultValue || ''])));
const vals = computed<Record<string, string>>(() => values.value ?? init.value);
const query = computed(() => queryModel.value ?? p.defaultQuery);

function setVal(k: string, v: string) {
  const next = { ...vals.value, [k]: v };
  values.value = next;
  emit('filterChange', k, v, next);
}
function setQuery(v: string) {
  queryModel.value = v;
  emit('queryChange', v);
}
function setView(v: string) {
  view.value = v;
  emit('viewChange', v);
}
const active = computed(() => p.filters.filter((f) => vals.value[f.key]).map((f) => {
  const o = (f.options ?? []).find((x) => String(x.value) === String(vals.value[f.key]));
  return { f, label: o ? o.label : (vals.value[f.key] ?? '') };
}));
const any = computed(() => active.value.length > 0 || !!query.value);
function clear() {
  values.value = Object.fromEntries(p.filters.map((f) => [f.key, '']));
  queryModel.value = '';
  emit('clear');
}
const target = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value;
</script>

<template>
  <div class="q-filter-bar" role="search" :aria-label="ariaLabel || tr('فیلترها', 'Filters')">
    <div class="q-filter-bar__row">
      <div v-if="search !== false" class="q-filter-bar__search">
        <QIcon name="search" :size="18" class="q-filter-bar__search-icon" />
        <label :for="`${id}-q`" class="q-sr">{{ searchLabel || tr('جست‌وجو', 'Search') }}</label>
        <input
          :id="`${id}-q`" type="search" class="q-filter-bar__input" :value="query"
          :placeholder="searchPlaceholder || tr('جست‌وجو…', 'Search…')" @input="setQuery(target($event))"
        />
      </div>
      <div v-for="f in filters" :key="f.key" :class="['q-filter-bar__select', { 'is-set': vals[f.key] }]">
        <label :for="`${id}-${f.key}`" class="q-sr">{{ f.label }}</label>
        <select :id="`${id}-${f.key}`" class="q-filter-bar__input q-filter-bar__input--select" :value="vals[f.key] || ''" @change="setVal(f.key, target($event))">
          <option value="">{{ f.allLabel || allOf(f.label) }}</option>
          <option v-for="o in f.options ?? []" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <QIcon name="chevron-down" :size="18" class="q-filter-bar__chevron" />
      </div>
      <QSegmentedControl
        v-if="views" :options="views" v-bind="{ ...(view != null ? { modelValue: view } : {}), ...(defaultView != null ? { defaultValue: defaultView } : {}) }"
        :aria-label="viewLabel || tr('نحوهٔ نمایش', 'View')" class="q-filter-bar__views" @change="setView"
      />
    </div>
    <div v-if="any || resultLabel || $slots.resultLabel" class="q-filter-bar__chips">
      <span v-if="any" class="q-filter-bar__chips-label">{{ tr('فیلترهای فعال:', 'Active filters:') }}</span>
      <button v-if="query" type="button" class="q-filter-bar__chip" :aria-label="tr('حذف جست‌وجو: ', 'Remove search: ') + query" @click="setQuery('')">
        <span>{{ tr('جست‌وجو: ', 'Search: ') }}<bdi>{{ query }}</bdi></span><QIcon name="x" :size="14" />
      </button>
      <button
        v-for="a in active" :key="a.f.key" type="button" class="q-filter-bar__chip"
        :aria-label="`${tr('حذف فیلتر ', 'Remove filter ')}${a.f.label}: ${a.label}`" @click="setVal(a.f.key, '')"
      >
        <span>{{ `${a.f.label}: ` }}<bdi>{{ a.label }}</bdi></span><QIcon name="x" :size="14" />
      </button>
      <QButton v-if="any" variant="ghost" size="sm" icon="x" class="q-filter-bar__clear" @click="clear">{{ clearLabel || tr('پاک کردن فیلترها', 'Clear filters') }}</QButton>
      <span v-if="resultLabel || $slots.resultLabel" class="q-filter-bar__result" aria-live="polite"><slot name="resultLabel">{{ resultLabel }}</slot></span>
    </div>
  </div>
</template>
