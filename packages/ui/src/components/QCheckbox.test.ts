import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QCheckbox from './QCheckbox.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QCheckbox', () => {
  it('renders the DS structure with description and error ids', () => {
    const w = mount(QCheckbox, { props: { id: 'c', label: 'قوانین را می‌پذیرم', description: 'توضیح', error: 'الزامی است', required: true, ariaDescribedby: 'extra' } });
    expect(w.classes()).toEqual(['q-checkbox', 'q-checkbox--invalid']);
    const input = w.find('input');
    expect(input.attributes('type')).toBe('checkbox');
    expect(input.attributes('aria-describedby')).toBe('c-desc c-error extra');
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(w.find('label').attributes('for')).toBe('c');
    expect(w.find('.q-checkbox__error').attributes('role')).toBe('alert');
    expect(w.find('label .q-sr').text()).toBe('الزامی');
  });
  it('defaultChecked seeds, toggling emits v-model + change; indeterminate shows minus', async () => {
    const w = mount(QCheckbox, { props: { label: 'x', defaultChecked: true, indeterminate: true } });
    const input = w.find('input');
    expect((input.element as HTMLInputElement).checked).toBe(true);
    expect((input.element as HTMLInputElement).indeterminate).toBe(true);
    await input.setValue(false);
    expect(w.emitted('update:modelValue')?.[0]).toEqual([false]);
    expect(w.emitted('change')?.[0]?.[0]).toBe(false);
  });
  it('en required word', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QCheckbox, { props: { label: 'x', required: true } });
    expect(w.find('.q-sr').text()).toBe('required');
  });
});
