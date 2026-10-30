import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import QDiscoveryCard from './QDiscoveryCard.vue';

// No built-in strings: fa/en does not apply.
describe('QDiscoveryCard', () => {
  it('link card with heading, arrow and aria-current', () => {
    const w = mount(QDiscoveryCard, { props: { title: 'رویدادها', href: '/events', description: 'd', current: true } });
    expect(w.element.tagName).toBe('A');
    expect(w.attributes('href')).toBe('/events');
    expect(w.attributes('aria-current')).toBe('page');
    expect(w.classes()).toEqual(['q-discovery-card', 'q-discovery-card--interactive']);
    expect(w.find('h3.q-discovery-card__title').text()).toBe('رویدادها');
    expect(w.find('.q-discovery-card__tile').attributes('aria-hidden')).toBe('true');
    expect(w.find('.q-discovery-card__arrow').classes()).toContain('q-icon-flip');
  });
  it('button with a click listener, static div otherwise', async () => {
    let n = 0;
    const b = mount(QDiscoveryCard, { props: { title: 't' }, attrs: { onClick: () => { n++; } } });
    expect(b.element.tagName).toBe('BUTTON');
    expect(b.attributes('type')).toBe('button');
    expect(b.find('span.q-discovery-card__title').exists()).toBe(true);
    await b.trigger('click');
    expect(n).toBe(1);
    const d = mount(QDiscoveryCard, { props: { title: 't', headingLevel: 4 } });
    expect(d.element.tagName).toBe('DIV');
    expect(d.classes()).toEqual(['q-discovery-card']);
    expect(d.find('h4').exists()).toBe(true);
    expect(d.find('.q-discovery-card__arrow').exists()).toBe(false);
  });
});
