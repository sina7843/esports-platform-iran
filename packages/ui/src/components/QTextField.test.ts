import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QTextField from './QTextField.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QTextField', () => {
  it('renders the DS control and emits v-model + change', async () => {
    const w = mount(QTextField, { props: { id: 't', label: 'تلفن', ltr: true, suffix: 'تومان', error: 'نامعتبر' } });
    const ctl = w.find('.q-form-field__control');
    expect(ctl.classes()).toEqual(expect.arrayContaining(['q-text-field', 'q-form-field__control--invalid']));
    const input = w.find('input');
    expect(input.classes()).toEqual(['q-text-field__input', 'q-text-field__input--ltr']);
    expect(input.attributes('dir')).toBe('ltr');
    expect(input.attributes('type')).toBe('text');
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('aria-describedby')).toBe('t-error');
    expect(w.find('.q-text-field__suffix').text()).toBe('تومان');
    await input.setValue('0912');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['0912']);
    expect(w.emitted('change')?.[0]?.[0]).toBe('0912');
    expect(input.element.value).toBe('0912');
  });
  it('multiline counter in fa and en', async () => {
    const w = mount(QTextField, { props: { id: 'm', multiline: true, maxLength: 280, modelValue: 'سلام' } });
    expect(w.find('textarea').attributes('rows')).toBe('4');
    expect(w.find('textarea').attributes('aria-describedby')).toBe('m-count');
    expect(w.find('.q-text-field__count [aria-hidden]').text()).toBe('۴ / ۲۸۰');
    expect(w.find('.q-text-field__count .q-sr').text()).toBe('۴ از ۲۸۰ نویسه');
    setLocale('en', { keepDocument: true });
    await w.vm.$nextTick();
    expect(w.find('.q-text-field__count .q-sr').text()).toBe('4 of 280 characters');
  });
  it('emits blur / focus / keyDown', async () => {
    const w = mount(QTextField, { props: { defaultValue: 'a' } });
    expect(w.find('input').element.value).toBe('a');
    await w.find('input').trigger('focus');
    await w.find('input').trigger('keydown', { key: 'Enter' });
    await w.find('input').trigger('blur');
    expect(Object.keys(w.emitted())).toEqual(expect.arrayContaining(['focus', 'keyDown', 'blur']));
  });
});
