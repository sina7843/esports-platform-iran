import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import QRadioGroup from './QRadioGroup.vue';

const options = [{ value: 'all', label: 'همه', description: 'عمومی' }, { value: 'team', label: 'تیم', meta: '۳' }, { value: 'me', label: 'فقط من', disabled: true }];

describe('QRadioGroup', () => {
  it('fieldset + radiogroup with card variant classes', () => {
    const w = mount(QRadioGroup, { props: { id: 'r', label: 'نمایش برای', options, variant: 'card', orientation: 'horizontal', defaultValue: 'team', error: 'خطا' } });
    expect(w.element.tagName).toBe('FIELDSET');
    expect(w.classes()).toEqual(expect.arrayContaining(['q-form-field', 'q-radio-group']));
    const g = w.find('[role=radiogroup]');
    expect(g.classes()).toEqual(['q-radio-group__list', 'q-radio-group__list--horizontal', 'q-radio-group__list--card']);
    expect(g.attributes('aria-labelledby')).toBe('r-label');
    expect(g.attributes('aria-invalid')).toBe('true');
    const labels = w.findAll('label.q-radio-group__option');
    expect(labels[1]!.classes()).toContain('q-radio-group__option--checked');
    expect(labels[2]!.classes()).toContain('q-radio-group__option--disabled');
    expect(w.find('#r-0').attributes('aria-describedby')).toBe('r-0-desc');
    expect(w.find('.q-radio-group__meta').text()).toBe('۳');
  });
  it('v-model + change', async () => {
    const w = mount(QRadioGroup, { props: { label: 'x', options } });
    await w.findAll('input')[0]!.setValue(true);
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['all']);
    expect(w.emitted('change')?.[0]?.[0]).toBe('all');
    expect(w.findAll('label.q-radio-group__option')[0]!.classes()).toContain('q-radio-group__option--checked');
  });
});
