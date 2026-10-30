import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import QSelect from './QSelect.vue';

const options = [{ value: 'thr', label: 'تهران' }, { label: 'شمال', options: [{ value: 'rsh', label: 'رشت' }, { value: 'sri', label: 'ساری', disabled: true }] }];

describe('QSelect', () => {
  it('renders native select, placeholder and optgroups', () => {
    const w = mount(QSelect, { props: { id: 's', label: 'استان', placeholder: 'انتخاب کنید', required: true, options } });
    expect(w.find('.q-form-field__control').classes()).toContain('q-select');
    const sel = w.find('select');
    expect(sel.classes()).toEqual(['q-select__native', 'q-select__native--placeholder']);
    expect(w.find('option[value=""]').attributes('disabled')).toBeDefined();
    expect(w.findAll('optgroup')).toHaveLength(1);
    expect(w.find('optgroup').attributes('label')).toBe('شمال');
    expect(w.find('option[value="sri"]').attributes('disabled')).toBeDefined();
    expect(w.find('.q-select__chevron').exists()).toBe(true);
  });
  it('v-model + change', async () => {
    const w = mount(QSelect, { props: { options, defaultValue: 'thr' } });
    expect(w.find('select').element.value).toBe('thr');
    await w.find('select').setValue('rsh');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['rsh']);
    expect(w.emitted('change')?.[0]?.[0]).toBe('rsh');
  });
});
