import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QFormField, { type QFormFieldRenderProps } from './QFormField.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QFormField', () => {
  it('wires label, hint and error ids into the scoped slot', () => {
    const w = mount(QFormField, {
      props: { id: 'f1', label: 'نام', hint: 'راهنما', error: 'خطا', required: true },
      slots: { default: (f: QFormFieldRenderProps) => h('input', { id: f.id, 'aria-describedby': f.describedBy, 'aria-invalid': f.invalid ? 'true' : undefined }) },
    });
    expect(w.classes()).toContain('q-form-field');
    expect(w.find('label').attributes('for')).toBe('f1');
    expect(w.find('label').attributes('id')).toBe('f1-label');
    const input = w.find('input');
    expect(input.attributes('aria-describedby')).toBe('f1-hint f1-error');
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(w.find('.q-form-field__error').attributes('role')).toBe('alert');
    expect(w.find('.q-form-field__req').attributes('aria-hidden')).toBe('true');
    expect(w.find('.q-sr').text()).toBe('الزامی');
  });
  it('en required word, generated id, group = fieldset + legend', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QFormField, { props: { label: 'Code', required: true, group: true, disabled: true } });
    expect(w.element.tagName).toBe('FIELDSET');
    expect(w.classes()).toEqual(expect.arrayContaining(['q-form-field--group', 'q-form-field--disabled']));
    expect(w.attributes('disabled')).toBeDefined();
    expect(w.find('legend').attributes('id')).toMatch(/^q-field-.+-label$/);
    expect(w.find('.q-sr').text()).toBe('required');
  });
  it('label slot wins and hideLabel adds q-sr', () => {
    const w = mount(QFormField, { props: { label: 'x', hideLabel: true }, slots: { label: '<b>slot</b>' } });
    expect(w.find('label b').text()).toBe('slot');
    expect(w.find('label').classes()).toContain('q-sr');
  });
});
