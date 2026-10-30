import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QTag from './QTag.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QTag', () => {
  it('static tag', () => {
    const w = mount(QTag, { props: { size: 'sm', icon: 'globe' }, slots: { default: 'آنلاین' } });
    expect(w.element.tagName).toBe('SPAN');
    expect(w.classes()).toEqual(['q-tag', 'q-tag--sm']);
    expect(w.find('.q-tag__remove').exists()).toBe(false);
  });
  it('selectable toggle: aria-pressed, check icon, v-model:selected + change', async () => {
    const w = mount(QTag, { props: { selectable: true }, slots: { default: 'CS2' } });
    expect(w.element.tagName).toBe('BUTTON');
    expect(w.classes()).toContain('q-tag--selectable');
    expect(w.attributes('aria-pressed')).toBe('false');
    await w.trigger('click');
    expect(w.emitted('update:selected')?.[0]).toEqual([true]);
    expect(w.emitted('change')?.[0]).toEqual([true]);
    expect(w.attributes('aria-pressed')).toBe('true');
    expect(w.classes()).toContain('q-tag--selected');
  });
  it('removable: × labelled «حذف <text>» / «Remove <text>»', async () => {
    const w = mount(QTag, { props: { onRemove: () => {} }, slots: { default: 'تهران' } });
    expect(w.classes()).toContain('q-tag--removable');
    expect(w.find('.q-tag__remove').attributes('aria-label')).toBe('حذف تهران');
    setLocale('en', { keepDocument: true });
    await w.vm.$nextTick();
    expect(w.find('.q-tag__remove').attributes('aria-label')).toBe('Remove تهران');
    await w.find('.q-tag__remove').trigger('click');
    expect(w.emitted('remove')).toHaveLength(1);
  });
});
