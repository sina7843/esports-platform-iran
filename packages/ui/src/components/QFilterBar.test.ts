import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QFilterBar, { type FilterBarFilter } from './QFilterBar.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

const filters: FilterBarFilter[] = [{ key: 'status', label: 'وضعیت', options: [{ value: 'open', label: 'ثبت‌نام باز' }] }];
const views = [{ value: 'cards', label: 'کارت‌ها' }, { value: 'list', label: 'فهرست' }];

describe('QFilterBar', () => {
  it('search role, labelled fields, all-option, view toggle', () => {
    const w = mount(QFilterBar, { props: { filters, views } });
    expect(w.classes()).toEqual(['q-filter-bar']);
    expect(w.attributes('role')).toBe('search');
    expect(w.attributes('aria-label')).toBe('فیلترها');
    const input = w.find('input[type="search"]');
    expect(w.find(`label[for="${input.attributes('id')}"]`).text()).toBe('جست‌وجو');
    expect(input.attributes('placeholder')).toBe('جست‌وجو…');
    expect(w.find('select option').text()).toBe('همه وضعیت');
    expect(w.find('.q-filter-bar__views').attributes('aria-label')).toBe('نحوهٔ نمایش');
    expect(w.find('.q-filter-bar__chips').exists()).toBe(false);
  });

  it('filter change, chips, clear', async () => {
    const w = mount(QFilterBar, { props: { filters, resultLabel: '۲۴ رویداد' } });
    await w.find('select').setValue('open');
    expect(w.emitted('filterChange')![0]).toEqual(['status', 'open', { status: 'open' }]);
    expect(w.emitted('update:values')![0]).toEqual([{ status: 'open' }]);
    expect(w.find('.q-filter-bar__select').classes()).toContain('is-set');
    const chip = w.find('.q-filter-bar__chip');
    expect(chip.attributes('aria-label')).toBe('حذف فیلتر وضعیت: ثبت‌نام باز');
    expect(w.find('.q-filter-bar__chips-label').text()).toBe('فیلترهای فعال:');
    expect(w.find('.q-filter-bar__result').attributes('aria-live')).toBe('polite');
    await w.find('input').setValue('لیگ');
    expect(w.emitted('queryChange')![0]).toEqual(['لیگ']);
    expect(w.findAll('.q-filter-bar__chip')[0]!.attributes('aria-label')).toBe('حذف جست‌وجو: لیگ');
    await w.find('.q-filter-bar__clear').trigger('click');
    expect(w.emitted('clear')).toHaveLength(1);
    expect(w.findAll('.q-filter-bar__chip')).toHaveLength(0);
    expect((w.find('select').element as HTMLSelectElement).value).toBe('');
  });

  it('en strings, search=false, view change', async () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QFilterBar, { props: { filters: [{ key: 'g', label: 'Game', options: [] }], search: false, views } });
    expect(w.find('input[type="search"]').exists()).toBe(false);
    expect(w.find('select option').text()).toBe('Any game');
    expect(w.attributes('aria-label')).toBe('Filters');
    await w.findAll('[role="radio"]')[1]!.trigger('click');
    expect(w.emitted('viewChange')![0]).toEqual(['list']);
    expect(w.emitted('update:view')![0]).toEqual(['list']);
  });
});
