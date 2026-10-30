import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { setLocale } from '../locale';
import type { QDataTableColumn } from '../maps/data';
import QDataTable from './QDataTable.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

type Row = { id: string; name: string; pts: number; city?: string };
const rows: Row[] = [{ id: 'a', name: 'Beta', pts: 1200 }, { id: 'b', name: 'Alpha', pts: 30, city: 'Tabriz' }];
const columns: QDataTableColumn<Row>[] = [
  { key: 'name', header: 'تیم', sortable: true },
  { key: 'pts', header: 'امتیاز', numeric: true, sortable: true },
  { key: 'city', header: 'شهر', render: (r) => h('em', r.city ?? '—') },
];
// mount() cannot infer the generic Row; the SFC is typed with Row = object here.
const cols = columns as unknown as QDataTableColumn<object>[];

describe('QDataTable', () => {
  it('table with caption, scopes, region and default cells', () => {
    const w = mount(QDataTable, { props: { columns: cols, rows, caption: 'جدول', layout: 'table' } });
    expect(w.classes()).toEqual(['q-data-table', 'q-data-table--table', 'q-data-table--sticky']);
    expect(w.find('caption').text()).toBe('جدول');
    expect(w.find('.q-data-table__title').attributes('aria-hidden')).toBe('true');
    const region = w.find('.q-data-table__scroll');
    expect(region.attributes('role')).toBe('region');
    expect(region.attributes('tabindex')).toBe('0');
    expect(region.attributes('aria-label')).toBe('جدول');
    expect(w.findAll('thead th').every((t) => t.attributes('scope') === 'col')).toBe(true);
    const first = w.find('tbody tr');
    expect(first.find('th').attributes('scope')).toBe('row');
    expect(first.find('th').text()).toBe('Beta');
    expect(first.find('.q-data-table__num').text()).toBe('۱٬۲۰۰');
    expect(first.find('em').text()).toBe('—');
    expect(w.find('thead th').attributes('aria-sort')).toBe('none');
  });
  it('sort button cycles asc → desc and emits; v-model:sort', async () => {
    const w = mount(QDataTable, {
      props: { columns: cols, rows, layout: 'table' as const, sort: null, 'onUpdate:sort': (s: unknown) => w.setProps({ sort: s as never }) },
    });
    await w.find('.q-data-table__sort').trigger('click');
    expect(w.emitted('sortChange')).toEqual([[{ key: 'name', dir: 'asc' }]]);
    expect(w.find('thead th').attributes('aria-sort')).toBe('ascending');
    expect(w.find('tbody th').text()).toBe('Alpha');
    await w.find('.q-data-table__sort').trigger('click');
    expect(w.find('thead th').attributes('aria-sort')).toBe('descending');
    expect(w.find('tbody th').text()).toBe('Beta');
  });
  it('uncontrolled defaultSort', () => {
    const w = mount(QDataTable, { props: { columns: cols, rows, layout: 'table', defaultSort: { key: 'pts', dir: 'asc' } } });
    expect(w.find('tbody th').text()).toBe('Alpha');
  });
  it('selection: select all, labels, v-model:selected', async () => {
    const w = mount(QDataTable, {
      props: { columns: cols, rows, layout: 'table' as const, selectable: true, selected: [], 'onUpdate:selected': (k: unknown) => w.setProps({ selected: k as never }) },
    });
    const boxes = w.findAll('input[type="checkbox"]');
    expect(boxes[0]!.attributes('aria-label')).toBe('انتخاب همه');
    expect(boxes[1]!.attributes('aria-label')).toBe('انتخاب Beta');
    await boxes[1]!.trigger('change');
    expect(w.emitted('selectionChange')?.[0]).toEqual([['a']]);
    expect((w.find('thead input').element as HTMLInputElement).indeterminate).toBe(true);
    expect(w.find('tbody tr').classes()).toContain('is-selected');
    await w.find('thead input').trigger('change');
    expect(w.emitted('selectionChange')?.[1]).toEqual([['a', 'b']]);
  });
  it('cell and row-actions scoped slots', () => {
    const w = mount(QDataTable, {
      props: { columns: cols, rows, layout: 'table' },
      slots: {
        'cell-name': '<template #cell-name="{ row, index }"><b>{{ index }}:{{ row.name }}</b></template>',
        'row-actions': '<template #row-actions="{ row }"><button>{{ row.id }}</button></template>',
      },
    });
    expect(w.find('tbody th b').text()).toBe('0:Beta');
    expect(w.find('.q-data-table__actions button').text()).toBe('a');
    expect(w.find('.q-data-table__th--actions .q-sr').text()).toBe('عملیات');
  });
  it('cards layout: ul of dl pairs', () => {
    const w = mount(QDataTable, { props: { columns: cols, rows, layout: 'cards', caption: 'جدول' } });
    expect(w.classes()).toContain('q-data-table--cards');
    expect(w.find('ul').attributes('aria-label')).toBe('جدول');
    expect(w.find('.q-data-table__title').attributes('aria-hidden')).toBeUndefined();
    expect(w.find('.q-data-table__card-title').text()).toBe('Beta');
    expect(w.findAll('.q-data-table__card')[0]!.findAll('dt').map((d) => d.text())).toEqual(['امتیاز', 'شهر']);
  });
  it('empty and loading, fa and en', () => {
    const e = mount(QDataTable, { props: { columns: cols, rows: [], layout: 'table' } });
    expect(e.find('.q-data-table__td--empty').attributes('colspan')).toBe('3');
    expect(e.find('.q-data-table__empty p').text()).toBe('موردی برای نمایش نیست.');
    const l = mount(QDataTable, { props: { columns: cols, rows, layout: 'table', loading: true } });
    expect(l.find('table').attributes('aria-busy')).toBe('true');
    expect(l.findAll('tbody tr')).toHaveLength(4);
    setLocale('en', { keepDocument: true });
    expect(mount(QDataTable, { props: { columns: cols, rows: [], layout: 'cards' } }).find('.q-data-table__empty p').text()).toBe('Nothing to show.');
    expect(mount(QDataTable, { props: { columns: cols, rows, layout: 'table', selectable: true } }).find('input').attributes('aria-label')).toBe('Select all');
  });
});
