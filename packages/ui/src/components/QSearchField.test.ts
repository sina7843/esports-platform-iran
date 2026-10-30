import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QSearchField from './QSearchField.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));
const suggestions = [
  { label: 'تیم‌ها', icon: 'users' as const, items: [{ id: 't1', label: 'Simorgh', meta: 'CS2' }] },
  { label: 'بازیکنان', items: [{ id: 'p1', label: 'Sina' }] },
];

describe('QSearchField', () => {
  it('form role=search with fa / en built-in strings', async () => {
    const w = mount(QSearchField, { props: { id: 'q' } });
    expect(w.element.tagName).toBe('FORM');
    expect(w.attributes('role')).toBe('search');
    expect(w.find('label.q-sr').text()).toBe('جست‌وجو');
    expect(w.find('input').attributes('placeholder')).toBe('نام تیم، بازیکن، رویداد یا خبر…');
    expect(w.find('input').attributes('role')).toBeUndefined();
    setLocale('en', { keepDocument: true });
    await w.vm.$nextTick();
    expect(w.find('.q-search-field__submit').text()).toBe('Search');
  });
  it('typing emits, clear resets, submit emits value', async () => {
    const w = mount(QSearchField, {});
    await w.find('input').setValue('sim');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['sim']);
    expect(w.find('.q-search-field__clear').attributes('aria-label')).toBe('پاک کردن جست‌وجو');
    await w.find('form').trigger('submit');
    expect(w.emitted('submit')?.[0]).toEqual(['sim']);
    await w.find('.q-search-field__clear').trigger('click');
    expect(w.emitted('change')?.[1]?.[0]).toBe('');
  });
  it('suggestions: combobox, arrows, mark, Enter selects', async () => {
    const w = mount(QSearchField, { props: { id: 'q', suggestions, modelValue: 'sim' } });
    const input = w.find('input');
    expect(input.attributes('role')).toBe('combobox');
    expect(input.attributes('aria-expanded')).toBe('false');
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(input.attributes('aria-expanded')).toBe('true');
    expect(input.attributes('aria-activedescendant')).toBe('q-list-o0');
    expect(w.find('mark.q-search-field__mark').text()).toBe('Sim');
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(w.find('#q-list-o1').attributes('aria-selected')).toBe('true');
    await input.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('select')?.[0]).toEqual([suggestions[1]!.items[0], suggestions[1]]);
    expect(w.find('[role=listbox]').attributes('hidden')).toBeDefined();
  });
});
