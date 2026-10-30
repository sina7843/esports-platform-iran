<script setup lang="ts" generic="Row extends object">
import { computed, h, onBeforeUnmount, onMounted, ref, useSlots, type FunctionalComponent, type VNodeChild } from 'vue';
import { fa, tr } from '../locale';
import type { IconName } from '../icons';
import { compare, defaultCell, px, range, type QDataTableColumn, type QDataTableKey as Key, type QDataTableSort } from '../maps/data';
import QIcon from './QIcon.vue';

/**
 * DataTable: columns + rows with caption, sortable headers, selection, row actions, sticky header, skeleton/empty states;
 * stacks into cards below `stackBelow` px. Cells: `#cell-<key>="{ row, index, value }"` > `columns[].render` > default.
 * Row actions: `#row-actions="{ row, index }"`. Models: `v-model:sort`, `v-model:selected`.
 */
interface QDataTableProps<R> {
  columns: QDataTableColumn<R>[];
  rows: R[];
  rowKey?: string | ((row: R, index: number) => Key);
  rowHeader?: string;
  caption?: string;
  captionHidden?: boolean;
  /** Names the scroll region / card list when there is no string caption. */
  ariaLabel?: string;
  toolbar?: string;
  sortable?: boolean;
  defaultSort?: QDataTableSort | null;
  defaultSelected?: Key[];
  selectable?: boolean;
  actionsHeader?: string;
  stickyHeader?: boolean;
  maxHeight?: number | string;
  stackBelow?: number;
  layout?: 'auto' | 'table' | 'cards';
  loading?: boolean;
  skeletonRows?: number;
  emptyText?: string;
  emptyIcon?: IconName;
}
const p = withDefaults(defineProps<QDataTableProps<Row>>(), { stickyHeader: true, stackBelow: 640, layout: 'auto' });
const emit = defineEmits<{ sortChange: [sort: QDataTableSort]; selectionChange: [keys: Key[]] }>();
const sortModel = defineModel<QDataTableSort | null | undefined>('sort', { default: undefined });
const selModel = defineModel<Key[] | undefined>('selected', { default: undefined });
const slots = useSlots();

/* uncontrolled seeds (DS useControlled) */
if (sortModel.value === undefined && p.defaultSort) sortModel.value = p.defaultSort;
if (selModel.value === undefined && p.defaultSelected) selModel.value = p.defaultSelected;
const sort = computed(() => sortModel.value ?? null);
const selected = computed(() => selModel.value ?? []);
const setSort = (s: QDataTableSort) => { sortModel.value = s; emit('sortChange', s); };
const setSel = (k: Key[]) => { selModel.value = k; emit('selectionChange', k); };

/* container width → cards (ResizeObserver guarded for happy-dom / old browsers) */
const box = ref<HTMLElement | null>(null);
const width = ref(0);
let ro: ResizeObserver | undefined;
onMounted(() => {
  const el = box.value;
  if (!el) return;
  width.value = el.getBoundingClientRect().width;
  if (typeof window === 'undefined' || !window.ResizeObserver) return;
  ro = new ResizeObserver((es) => { width.value = es[0]?.contentRect.width ?? width.value; });
  ro.observe(el);
});
onBeforeUnmount(() => ro?.disconnect());
const cards = computed(() => p.layout === 'cards' || (p.layout === 'auto' && p.stackBelow > 0 && width.value > 0 && width.value < p.stackBelow));

const cellValue = (r: Row, c: QDataTableColumn<Row>): unknown => (c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]);
const keyOf = (r: Row, i: number): Key => {
  if (typeof p.rowKey === 'function') return p.rowKey(r, i);
  const rec = r as Record<string, unknown>;
  const v = p.rowKey ? rec[p.rowKey] : rec.id != null ? rec.id : i;
  return typeof v === 'number' ? v : String(v);
};
const headKey = computed(() => p.rowHeader ?? p.columns[0]?.key);
const headCol = computed(() => p.columns.find((c) => c.key === headKey.value));
const restCols = computed(() => p.columns.filter((c) => c.key !== headKey.value));
const isSortable = (c: QDataTableColumn<Row>) => (c.sortable != null ? c.sortable : !!p.sortable);

const list = computed(() => {
  const s = sort.value;
  const sc = s?.key ? p.columns.find((c) => c.key === s.key) : undefined;
  if (!s || !sc) return p.rows;
  const get = sc.sortValue ?? ((r: Row) => cellValue(r, sc));
  return p.rows.slice().sort((a, b) => {
    const x = get(a), y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const c = compare(x, y);
    return s.dir === 'desc' ? -c : c;
  });
});
const keys = computed(() => list.value.map(keyOf));
const nSel = computed(() => keys.value.filter((k) => selected.value.includes(k)).length);
const isSel = (i: number) => selected.value.includes(keys.value[i] as Key);
const toggle = (i: number) => {
  const k = keys.value[i] as Key;
  setSel(selected.value.includes(k) ? selected.value.filter((x) => x !== k) : selected.value.concat([k]));
};
const toggleAll = () => {
  const ks = keys.value;
  setSel(nSel.value === ks.length ? selected.value.filter((k) => !ks.includes(k)) : selected.value.concat(ks.filter((k) => !selected.value.includes(k))));
};
const clickSort = (c: QDataTableColumn<Row>) => {
  const active = sort.value?.key === c.key;
  setSort(active && sort.value?.dir === 'asc' ? { key: c.key, dir: 'desc' } : { key: c.key, dir: 'asc' });
};
const dirOf = (c: QDataTableColumn<Row>) => (sort.value?.key === c.key ? sort.value.dir : null);
const ariaSort = (c: QDataTableColumn<Row>) => {
  if (!isSortable(c)) return undefined;
  const d = dirOf(c);
  return d === 'asc' ? 'ascending' : d === 'desc' ? 'descending' : 'none';
};
const rowName = (r: Row) => {
  const v = headCol.value ? cellValue(r, headCol.value) : undefined;
  return typeof v === 'string' || typeof v === 'number' ? fa(v) : '';
};
const alignCls = (c: QDataTableColumn<Row>) => {
  const a = c.align ?? (c.numeric ? 'end' : 'start');
  return a === 'start' ? null : `q-data-table--align-${a}`;
};
const hasCaption = computed(() => !!(p.caption || slots.caption));
const captionText = computed(() => p.caption ?? p.ariaLabel);
const hasActions = computed(() => !!slots['row-actions']);
const colCount = computed(() => p.columns.length + (p.selectable ? 1 : 0) + (hasActions.value ? 1 : 0));
const showHeader = computed(() => (hasCaption.value && !p.captionHidden) || !!(p.toolbar || slots.toolbar));

/** Renders a column's `render()` result (string or VNode). */
const Out: FunctionalComponent<{ v: VNodeChild }> = (o) => o.v as never;
const rendered = (r: Row, i: number, c: QDataTableColumn<Row>): VNodeChild => (c.render ? c.render(r, i) : defaultCell(cellValue(r, c), c.numeric));

/** DS `Check`: native checkbox with a 44px hit area; `indeterminate` is a DOM property. */
const Check: FunctionalComponent<{ checked: boolean; indeterminate?: boolean; label: string; onToggle: () => void }> = (c) =>
  h('label', { class: 'q-data-table__check' }, [
    h('input', { type: 'checkbox', class: 'q-data-table__check-input', checked: c.checked, indeterminate: !!c.indeterminate, 'aria-label': c.label, onChange: c.onToggle }),
    h('span', { class: 'q-data-table__check-box', 'aria-hidden': 'true' }, [h(QIcon, { name: c.indeterminate ? 'minus' : 'check', size: 14, strokeWidth: 3 })]),
  ]);
</script>

<template>
  <div ref="box" :class="['q-data-table', cards ? 'q-data-table--cards' : 'q-data-table--table', { 'q-data-table--sticky': stickyHeader !== false }]">
    <div v-if="showHeader" class="q-data-table__header">
      <div v-if="hasCaption && !captionHidden" class="q-data-table__title" :aria-hidden="cards ? undefined : 'true'"><slot name="caption">{{ caption }}</slot></div>
      <span v-else />
      <div v-if="toolbar || slots.toolbar" class="q-data-table__toolbar"><slot name="toolbar">{{ toolbar }}</slot></div>
    </div>

    <ul v-if="cards" class="q-data-table__cards" :aria-label="captionText" :aria-busy="loading ? 'true' : undefined">
      <template v-if="loading">
        <li v-for="i in range(skeletonRows ?? 3)" :key="'s' + i" class="q-data-table__card">
          <span class="q-data-table__skeleton" :style="{ width: '45%', height: '16px' }" />
          <span v-for="j in range(3)" :key="j" class="q-data-table__skeleton" :style="{ width: [80, 60, 70][j] + '%' }" />
        </li>
      </template>
      <li v-else-if="!list.length" class="q-data-table__card q-data-table__card--empty">
        <div class="q-data-table__empty">
          <QIcon :name="emptyIcon ?? 'inbox'" :size="28" />
          <p><slot name="emptyText">{{ emptyText || tr('موردی برای نمایش نیست.', 'Nothing to show.') }}</slot></p>
          <slot name="emptyAction" />
        </div>
      </li>
      <template v-else>
        <li v-for="(r, i) in list" :key="keys[i]" :class="['q-data-table__card', { 'is-selected': isSel(i) }]">
          <div class="q-data-table__card-head">
            <Check v-if="selectable" :checked="isSel(i)" :label="tr('انتخاب ', 'Select ') + rowName(r)" @toggle="toggle(i)" />
            <div v-if="headCol" class="q-data-table__card-title">
              <slot :name="`cell-${headCol.key}`" :row="r" :index="i" :value="cellValue(r, headCol)"><Out :v="rendered(r, i, headCol)" /></slot>
            </div>
          </div>
          <dl class="q-data-table__dl">
            <div v-for="c in restCols" :key="c.key" class="q-data-table__pair">
              <dt>{{ c.header }}</dt>
              <dd :class="c.numeric ? 'q-num' : undefined">
                <slot :name="`cell-${c.key}`" :row="r" :index="i" :value="cellValue(r, c)"><Out :v="rendered(r, i, c)" /></slot>
              </dd>
            </div>
          </dl>
          <div v-if="hasActions" class="q-data-table__card-actions"><slot name="row-actions" :row="r" :index="i" /></div>
        </li>
      </template>
    </ul>

    <div
      v-else
      class="q-data-table__scroll"
      role="region"
      tabindex="0"
      :aria-label="captionText"
      :style="maxHeight ? { maxHeight: px(maxHeight) } : undefined"
    >
      <table class="q-data-table__table" :aria-busy="loading ? 'true' : undefined">
        <caption v-if="hasCaption" class="q-sr"><slot name="caption">{{ caption }}</slot></caption>
        <thead>
          <tr>
            <th v-if="selectable" scope="col" class="q-data-table__th q-data-table__th--check">
              <Check :checked="keys.length > 0 && nSel === keys.length" :indeterminate="nSel > 0 && nSel < keys.length" :label="tr('انتخاب همه', 'Select all')" @toggle="toggleAll" />
            </th>
            <th
              v-for="c in columns"
              :key="c.key"
              scope="col"
              :style="c.width ? { width: px(c.width) } : undefined"
              :class="['q-data-table__th', { 'q-data-table__th--sortable': isSortable(c) }, alignCls(c)]"
              :aria-sort="ariaSort(c)"
            >
              <button v-if="isSortable(c)" type="button" :class="['q-data-table__sort', { 'is-active': dirOf(c) }]" @click="clickSort(c)">
                <span>{{ c.header }}</span>
                <QIcon :name="dirOf(c) === 'desc' ? 'chevron-down' : 'chevron-up'" :size="16" :class="['q-data-table__sort-icon', { 'is-idle': !dirOf(c) }]" />
              </button>
              <template v-else>{{ c.header }}</template>
            </th>
            <th v-if="hasActions" scope="col" class="q-data-table__th q-data-table__th--actions">
              <slot name="actionsHeader"><template v-if="actionsHeader">{{ actionsHeader }}</template><span v-else class="q-sr">{{ tr('عملیات', 'Actions') }}</span></slot>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-if="loading">
            <tr v-for="i in range(skeletonRows ?? 4)" :key="'s' + i" class="q-data-table__tr">
              <td v-for="j in range(colCount)" :key="j" class="q-data-table__td">
                <span class="q-data-table__skeleton" :style="{ width: [72, 56, 40, 64, 48][(i + j) % 5] + '%' }" />
              </td>
            </tr>
          </template>
          <tr v-else-if="!list.length">
            <td :colspan="colCount" class="q-data-table__td q-data-table__td--empty">
              <div class="q-data-table__empty">
                <QIcon :name="emptyIcon ?? 'inbox'" :size="28" />
                <p><slot name="emptyText">{{ emptyText || tr('موردی برای نمایش نیست.', 'Nothing to show.') }}</slot></p>
                <slot name="emptyAction" />
              </div>
            </td>
          </tr>
          <template v-else>
            <tr v-for="(r, i) in list" :key="keys[i]" :class="['q-data-table__tr', { 'is-selected': isSel(i) }]">
              <td v-if="selectable" class="q-data-table__td q-data-table__td--check">
                <Check :checked="isSel(i)" :label="tr('انتخاب ', 'Select ') + rowName(r)" @toggle="toggle(i)" />
              </td>
              <component
                :is="c.key === headKey ? 'th' : 'td'"
                v-for="c in columns"
                :key="c.key"
                :scope="c.key === headKey ? 'row' : undefined"
                :class="[c.key === headKey ? 'q-data-table__th-row' : 'q-data-table__td', alignCls(c), { 'q-num q-data-table__num': c.numeric }]"
              >
                <slot :name="`cell-${c.key}`" :row="r" :index="i" :value="cellValue(r, c)"><Out :v="rendered(r, i, c)" /></slot>
              </component>
              <td v-if="hasActions" class="q-data-table__td q-data-table__td--actions">
                <div class="q-data-table__actions"><slot name="row-actions" :row="r" :index="i" /></div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
