import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import QLowerThird from './QLowerThird.vue';

describe('QLowerThird', () => {
  it('green accent by default, group labelled by the title', () => {
    const w = mount(QLowerThird, { props: { title: 'علی رضایی', kicker: 'مفسر', subtitle: 'جام پاییزه' } });
    expect(w.classes()).toEqual(['q-lower-third']);
    expect(w.attributes('role')).toBe('group');
    expect(w.attributes('aria-label')).toBe('علی رضایی');
    expect(w.find('.q-lower-third__bar').classes()).toContain('q-lower-third__bar--green');
    expect(w.find('.q-lower-third__bar').attributes('aria-hidden')).toBe('true');
    expect(w.find('.q-lower-third__kicker').text()).toBe('مفسر');
    expect(w.find('.q-lower-third__title bdi').text()).toBe('علی رضایی');
    expect(w.find('.q-lower-third__subtitle bdi').text()).toBe('جام پاییزه');
    expect(w.find('.q-lower-third__logo').exists()).toBe(false);
  });
  it('tricolor accent, logo and transparent', () => {
    const w = mount(QLowerThird, { props: { title: 'X', accent: 'tricolor', logo: true, transparent: true } });
    expect(w.classes()).toContain('q-lower-third--transparent');
    expect(w.findAll('.q-lower-third__bar--tricolor i')).toHaveLength(3);
    expect(w.findAll('.q-lower-third__logo img.q-logo')).toHaveLength(2);
  });
});
