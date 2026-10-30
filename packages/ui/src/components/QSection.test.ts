import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import QSection from './QSection.vue';
import QContainer from './QContainer.vue';

describe('QSection / QContainer', () => {
  it('renders the kit section head with labelled heading', () => {
    const w = mount(QSection, { props: { id: 'live', title: 'زنده', eyebrow: 'اکنون', description: 'd' }, slots: { default: '<p>x</p>', action: '<a>all</a>' } });
    expect(w.attributes('aria-labelledby')).toBe('live-h');
    expect(w.get('h2').attributes('id')).toBe('live-h');
    expect(w.get('h2').classes()).toContain('h2');
    expect(w.find('.k-section__eyebrow .q-tricolor').exists()).toBe(true);
    expect(w.find('.k-section__action a').text()).toBe('all');
  });
  it('small → h4 class, level picks the element', () => {
    const w = mount(QSection, { props: { title: 't', small: true, level: 'h3' } });
    expect(w.get('h3').classes()).toContain('h4');
  });
  it('container wide', () => {
    expect(mount(QContainer, { props: { wide: true } }).classes()).toEqual(['k-container', 'k-container--wide']);
  });
});
