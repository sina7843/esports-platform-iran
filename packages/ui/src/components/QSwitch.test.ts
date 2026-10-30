import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import QSwitch from './QSwitch.vue';

describe('QSwitch', () => {
  it('role=switch with label/description wiring', () => {
    const w = mount(QSwitch, { props: { id: 's', label: 'دنبال تیم هستم', description: 'توضیح', block: true, hideLabel: true } });
    expect(w.classes()).toEqual(['q-switch', 'q-switch--block']);
    const b = w.find('button');
    expect(b.attributes('role')).toBe('switch');
    expect(b.attributes('aria-checked')).toBe('false');
    expect(b.attributes('aria-labelledby')).toBe('s-label');
    expect(b.attributes('aria-describedby')).toBe('s-desc');
    expect(w.find('label').classes()).toContain('q-sr');
  });
  it('click toggles uncontrolled state and emits v-model + change', async () => {
    const w = mount(QSwitch, { props: { label: 'x', defaultChecked: true } });
    expect(w.find('button').classes()).toContain('q-switch__control--on');
    await w.find('button').trigger('click');
    expect(w.emitted('update:modelValue')?.[0]).toEqual([false]);
    expect(w.emitted('change')?.[0]?.[0]).toBe(false);
    expect(w.find('button').attributes('aria-checked')).toBe('false');
  });
  it('controlled v-model stays until the parent updates it', async () => {
    // v-model = modelValue + onUpdate:modelValue; the parent ignores the update here
    const w = mount(QSwitch, { props: { label: 'x', modelValue: false, 'onUpdate:modelValue': () => {} } });
    await w.find('button').trigger('click');
    expect(w.find('button').attributes('aria-checked')).toBe('false');
    await w.setProps({ modelValue: true });
    expect(w.find('button').attributes('aria-checked')).toBe('true');
  });
});
