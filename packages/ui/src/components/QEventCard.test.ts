import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QEventCard from './QEventCard.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QEventCard', () => {
  const props = { title: 'جام پاییزه', status: 'registration_open' as const, href: '/events/1', game: 'VALORANT', capacity: { filled: 11, total: 16 }, featured: true };
  it('renders the DS link, classes and fa strings', () => {
    const w = mount(QEventCard, { props });
    expect(w.element.tagName).toBe('A');
    expect(w.attributes('href')).toBe('/events/1');
    expect(w.classes()).toEqual(expect.arrayContaining(['q-event-card', 'q-event-card--card', 'q-event-card--featured']));
    expect(w.find('.q-badge--success').text()).toBe('ثبت‌نام باز');
    expect(w.find('.q-event-card__featured').text()).toBe('رویداد ویژه');
    expect(w.find('.q-num').text()).toBe('۱۱ از ۱۶ تیم');
    expect(w.find('.q-event-card__free').text()).toBe('رایگان');
    expect(w.find('.q-event-card__game').attributes('dir')).toBe('ltr');
    expect(w.find('.q-event-card__meter span').attributes('style')).toContain('inline-size: 69%');
  });
  it('en strings, fee in toman, list layout, cancelled', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QEventCard, { props: { ...props, feeRial: 1200000, layout: 'list' as const, status: 'cancelled' as const, mode: 'offline', city: 'Tehran' } });
    expect(w.classes()).toEqual(expect.arrayContaining(['q-event-card--list', 'q-event-card--cancelled']));
    expect(w.find('.q-badge--danger').text()).toBe('Cancelled');
    expect(w.find('.q-num').text()).toBe('11 of 16 teams');
    expect(w.find('.q-event-card__fee .label').text()).toBe('120,000 Toman');
    expect(w.text()).toContain('In person · Tehran');
  });
  it('native click falls through', async () => {
    let n = 0;
    const w = mount(QEventCard, { props, attrs: { onClick: (e: Event) => { e.preventDefault(); n++; } } });
    await w.trigger('click');
    expect(n).toBe(1);
  });
});
