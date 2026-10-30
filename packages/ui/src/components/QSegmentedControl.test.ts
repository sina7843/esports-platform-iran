import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import QSegmentedControl from './QSegmentedControl.vue';

afterEach(() => vi.restoreAllMocks());

const options = [{ value: 'cards', label: 'کارت‌ها', icon: 'grid' as const }, { value: 'list', label: 'فهرست', icon: 'list' as const }, { value: 'map', label: 'نقشه', disabled: true }];

describe('QSegmentedControl', () => {
  it('radiogroup with radios, first selected by default', () => {
    const w = mount(QSegmentedControl, { props: { options, 'aria-label': 'نحوهٔ نمایش', size: 'sm', block: true } });
    expect(w.classes()).toEqual(['q-segmented-control', 'q-segmented-control--sm', 'q-segmented-control--block']);
    expect(w.attributes('role')).toBe('radiogroup');
    expect(w.attributes('aria-label')).toBe('نحوهٔ نمایش');
    const r = w.findAll('[role="radio"]');
    expect(r[0]!.attributes('aria-checked')).toBe('true');
    expect(r[0]!.attributes('tabindex')).toBe('0');
    expect(r[1]!.attributes('aria-checked')).toBe('false');
    expect(r[2]!.attributes('disabled')).toBeDefined();
  });

  it('v-model + change; iconOnly labels', async () => {
    const w = mount(QSegmentedControl, { props: { options, 'aria-label': 'v', iconOnly: true, modelValue: 'list' } });
    const r = w.findAll('[role="radio"]');
    expect(r[1]!.classes()).toContain('is-selected');
    expect(r[0]!.attributes('aria-label')).toBe('کارت‌ها');
    expect(r[0]!.find('span').exists()).toBe(false);
    await r[0]!.trigger('click');
    expect(w.emitted('update:modelValue')![0]).toEqual(['cards']);
    expect(w.emitted('change')![0]).toEqual(['cards']);
  });

  it('arrows (RTL-aware), skipping disabled; Home/End', async () => {
    const w = mount(QSegmentedControl, { props: { options, 'aria-label': 'v', defaultValue: 'cards' }, attachTo: document.body });
    await w.trigger('keydown', { key: 'ArrowRight' });
    expect(w.emitted('change')!.at(-1)).toEqual(['list']);
    expect(document.activeElement).toBe(w.findAll('[role="radio"]')[1]!.element);
    await w.trigger('keydown', { key: 'ArrowRight' });
    expect(w.emitted('change')!.at(-1)).toEqual(['cards']);
    await w.trigger('keydown', { key: 'End' });
    expect(w.emitted('change')!.at(-1)).toEqual(['list']);
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'rtl' } as CSSStyleDeclaration);
    await w.trigger('keydown', { key: 'ArrowLeft' });
    expect(w.emitted('change')!.at(-1)).toEqual(['cards']);
    w.unmount();
  });
});
