import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import QDivider from './QDivider.vue';

describe('QDivider', () => {
  it('horizontal hr, lg spacing', () => {
    const w = mount(QDivider, { props: { spacing: 'lg' } });
    expect(w.element.tagName).toBe('HR');
    expect(w.classes()).toEqual(['q-divider', 'q-divider--horizontal', 'q-divider--lg']);
  });
  it('vertical separator', () => {
    const w = mount(QDivider, { props: { orientation: 'vertical' } });
    expect(w.classes()).toEqual(['q-divider', 'q-divider--vertical']);
    expect(w.attributes('role')).toBe('separator');
    expect(w.attributes('aria-orientation')).toBe('vertical');
  });
  it('labelled, start aligned', () => {
    const w = mount(QDivider, { props: { label: 'یا', align: 'start' } });
    expect(w.classes()).toEqual(['q-divider', 'q-divider--label', 'q-divider--start']);
    expect(w.attributes('role')).toBe('separator');
    expect(w.find('.q-divider__text').text()).toBe('یا');
  });
});
