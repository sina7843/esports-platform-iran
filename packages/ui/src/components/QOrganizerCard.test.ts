import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QOrganizerCard from './QOrganizerCard.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QOrganizerCard', () => {
  it('fa: bare-number rating (the v1.0 crash) renders stars and score', () => {
    const w = mount(QOrganizerCard, { props: { name: 'لیگ', rating: 4.6, ratingCount: 12, events: 3, href: '/organizers/1' } });
    expect(w.classes()).toEqual(['q-organizer-card']);
    expect(w.find('.q-organizer-card__logo').classes()).toContain('q-chamfer-md');
    expect(w.find('.q-organizer-card__score').text()).toBe('۴٫۶ از ۵');
    expect(w.find('.q-organizer-card__count').text()).toBe('(۱۲ رأی)');
    expect(w.find('.q-organizer-card__stars').attributes('aria-hidden')).toBe('true');
    expect(w.find('.q-organizer-card__stars-fill').attributes('style')).toContain('width: 92%');
    expect(w.findAll('.q-organizer-card__stars-base svg')).toHaveLength(5);
    expect(w.find('.q-btn').text()).toBe('صفحهٔ برگزارکننده');
  });
  it('object rating, null rating and en strings', () => {
    setLocale('en', { keepDocument: true });
    const o = mount(QOrganizerCard, { props: { name: 'x', rating: { average: 4, count: 1 } } });
    expect(o.find('.q-organizer-card__score').text()).toBe('4.0 out of 5');
    expect(o.find('.q-organizer-card__count').text()).toBe('(1 vote)');
    expect(mount(QOrganizerCard, { props: { name: 'x', rating: null } }).find('.q-organizer-card__none').text()).toBe('No ratings yet.');
    expect(mount(QOrganizerCard, { props: { name: 'x', rating: { average: null } } }).find('.q-organizer-card__none').exists()).toBe(true);
    expect(mount(QOrganizerCard, { props: { name: 'x' } }).find('.q-organizer-card__none').exists()).toBe(true);
  });
  it('disclaimer tooltip: describedby, click toggles, Escape closes', async () => {
    const w = mount(QOrganizerCard, { props: { name: 'x', verified: true } });
    const btn = w.find('.q-organizer-card__info');
    const tip = w.find('[role="tooltip"]');
    expect(btn.attributes('aria-describedby')).toBe(tip.attributes('id'));
    expect(btn.attributes('aria-label')).toBe('دربارهٔ نشان تأیید');
    expect(tip.text()).toContain('ضمانت مالی');
    expect(w.find('.q-verified-mark__text').text()).toBe('برگزارکنندهٔ تأییدشده');
    await btn.trigger('click');
    expect(btn.attributes('aria-expanded')).toBe('true');
    expect(w.find('.q-organizer-card__tip--open').exists()).toBe(true);
    await w.find('.q-organizer-card__verify').trigger('keydown', { key: 'Escape' });
    expect(w.find('.q-organizer-card__tip--open').exists()).toBe(false);
  });
});
