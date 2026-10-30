import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QCombobox from './QCombobox.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));
const options = [
  { value: 'a', label: 'سیمرغ' },
  { value: 'b', label: 'Team 5', description: 'تهران' },
  { value: 'c', label: 'عقاب', disabled: true },
];

describe('QCombobox', () => {
  it('opens with ArrowDown, moves, picks with Enter (single)', async () => {
    const w = mount(QCombobox, { props: { id: 'cb', label: 'تیم', options } });
    const input = w.find('input');
    expect(input.attributes('role')).toBe('combobox');
    expect(input.attributes('aria-expanded')).toBe('false');
    expect(w.find('ul').attributes('hidden')).toBeDefined();
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(input.attributes('aria-expanded')).toBe('true');
    expect(input.attributes('aria-activedescendant')).toBe('cb-list-o0');
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(input.attributes('aria-activedescendant')).toBe('cb-list-o1');
    await input.trigger('keydown', { key: 'ArrowDown' }); // skips disabled «عقاب»
    expect(input.attributes('aria-activedescendant')).toBe('cb-list-o0');
    await input.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['a']);
    expect(w.emitted('change')?.[0]).toEqual(['a', options[0]]);
    expect(input.element.value).toBe('سیمرغ');
    expect(input.attributes('aria-expanded')).toBe('false');
  });
  it('filters with Persian digits, shows the empty text in fa and en', async () => {
    const w = mount(QCombobox, { props: { options } });
    const input = w.find('input');
    await input.setValue('۵');
    expect(w.findAll('[role=option]').map((o) => o.find('.q-combobox__option-label').text())).toEqual(['Team 5']);
    await input.setValue('zzz');
    expect(w.find('.q-combobox__empty').text()).toBe('نتیجه‌ای پیدا نشد');
    setLocale('en', { keepDocument: true });
    await w.vm.$nextTick();
    expect(w.find('.q-combobox__empty').text()).toBe('No results found');
    await input.trigger('keydown', { key: 'Escape' });
    expect(input.attributes('aria-expanded')).toBe('false');
  });
  it('multiple: chips, toggle, Backspace removes the last chip', async () => {
    const w = mount(QCombobox, { props: { options, multiple: true, defaultValue: ['a', 'b'], defaultOpen: true } });
    expect(w.find('ul').attributes('aria-multiselectable')).toBe('true');
    expect(w.findAll('.q-combobox__chip')).toHaveLength(2);
    expect(w.find('.q-combobox__chip-x').attributes('aria-label')).toBe('حذف سیمرغ');
    expect(w.find('[role=option]').attributes('aria-selected')).toBe('true');
    await w.find('input').trigger('keydown', { key: 'Backspace' });
    expect(w.emitted('change')?.[0]?.[0]).toEqual(['a']);
    expect(w.findAll('.q-combobox__chip')).toHaveLength(1);
  });
});
