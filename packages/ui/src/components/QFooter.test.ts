import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QFooter from './QFooter.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

const groups = [{ title: 'رقابت', links: [{ label: 'رویدادها', href: '/events' }, { label: 'اخبار' }] }];

describe('QFooter', () => {
  it('brand, link groups, seal placeholder, copyright with the Jalali year', () => {
    const w = mount(QFooter, { props: { groups, description: 'خانه ورزش‌های الکترونیکی', legalLinks: [{ label: 'شرایط', href: '/legal' }] } });
    expect(w.element.tagName).toBe('FOOTER');
    expect(w.classes()).toEqual(['q-footer']);
    expect(w.find('.q-footer__brand-copy strong').text()).toBe('پلتفرم ورزش‌های الکترونیکی');
    expect(w.find('.q-footer__brand-copy small').text()).toBe('میدان رقابت');
    expect(w.find('.q-footer__desc').text()).toBe('خانه ورزش‌های الکترونیکی');
    const nav = w.find('nav.q-footer__group');
    expect(nav.attributes('aria-label')).toBe('رقابت');
    const links = nav.findAll('a.q-footer__link');
    expect(links.map((l) => l.attributes('href'))).toEqual(['/events', '#']);
    const slot = w.find('.q-footer__seal-slot');
    expect(slot.attributes('role')).toBe('img');
    expect(slot.attributes('aria-label')).toBe('جای نماد اعتماد الکترونیکی');
    expect(w.find('.q-footer__copy').text()).toMatch(/^© [۰-۹]{4} پلتفرم ورزش‌های الکترونیکی$/);
    expect(w.find('.q-footer__link--inline').attributes('href')).toBe('/legal');
    expect(w.find('.q-footer__bottom .q-tricolor').exists()).toBe(true);
  });

  it('en strings and a real seal', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QFooter, { props: { seal: { src: '/seal.png', href: 'https://trustseal.enamad.ir/' } } });
    const a = w.find('a.q-footer__seal-link');
    expect(a.attributes('target')).toBe('_blank');
    expect(a.attributes('rel')).toBe('noopener');
    expect(a.find('img').attributes('alt')).toBe('eNAMAD trust seal');
    expect(a.find('img').attributes('width')).toBe('96');
    expect(w.find('.q-footer__copy').text()).toMatch(/^© \d{4} Esports Platform$/);
  });

  it('custom copyright', () => {
    const w = mount(QFooter, { props: { copyright: '© ۱۴۰۵ QeSB' } });
    expect(w.find('.q-footer__copy').text()).toBe('© ۱۴۰۵ QeSB');
  });
});
