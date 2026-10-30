import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QCtaBanner from './QCtaBanner.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QCtaBanner', () => {
  it('labelled section with default copy and the green rules button', () => {
    const w = mount(QCtaBanner);
    expect(w.classes()).toEqual(['q-cta-banner']);
    expect(w.attributes('aria-labelledby')).toBe(w.find('h2').attributes('id'));
    expect(w.find('h2').text()).toBe('مسابقه بعدی، قدم بعدی');
    expect(w.find('.q-cta-banner__desc').text()).toBe('برنامه، قوانین و نتایج را پیش از ورود به رقابت بررسی کن.');
    const a = w.find('a.q-btn');
    expect(a.classes()).toEqual(['q-btn', 'q-btn--green', 'q-btn--lg']);
    expect(a.text()).toBe('قوانین');
    expect(w.find('.q-cta-banner__tile').attributes('aria-hidden')).toBe('true');
  });
  it('text=false and action=null hide them; en copy', () => {
    const w = mount(QCtaBanner, { props: { text: false, action: null, headingLevel: 3 } });
    expect(w.find('.q-cta-banner__desc').exists()).toBe(false);
    expect(w.find('.q-cta-banner__action').exists()).toBe(false);
    expect(w.find('h3').exists()).toBe(true);
    setLocale('en', { keepDocument: true });
    const en = mount(QCtaBanner);
    expect(en.find('h2').text()).toBe('Your next match. Your next step.');
    expect(en.find('.q-btn').text()).toBe('Rules');
  });
});
