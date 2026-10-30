import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QMatchCard from './QMatchCard.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QMatchCard', () => {
  const final = { home: { name: 'سیمرغ', score: 2 }, away: { name: 'پارس', score: 1 }, state: 'final' as const, stage: 'یک‌چهارم نهایی', time: '۱۸:۳۰' };
  it('final: winner, lead/trail scores, state badge, link label', () => {
    const w = mount(QMatchCard, { props: { ...final, href: '/m/1' } });
    expect(w.element.tagName).toBe('A');
    expect(w.classes()).toEqual(expect.arrayContaining(['q-match-card', 'q-match-card--link']));
    expect(w.attributes('aria-label')).toBe('سیمرغ ۲ – ۱ پارس، نهایی، یک‌چهارم نهایی');
    const sides = w.findAll('.q-match-card__side');
    expect(sides[0]!.classes()).toContain('q-match-card__side--win');
    expect(sides[1]!.classes()).toContain('q-match-card__side--lose');
    expect(w.find('.q-match-card__check').attributes('aria-label')).toBe('برنده');
    expect(w.find('.q-match-card__score--lead').text()).toBe('۲');
    expect(w.find('.q-match-card__score--trail').text()).toBe('۱');
    expect(w.find('.q-match-card__foot .q-badge--neutral').text()).toBe('نهایی');
  });
  it('scheduled TBD side, en strings, extra slot', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QMatchCard, { props: { home: { name: 'Simorgh' }, away: {}, state: 'scheduled', time: '18:30', variant: 'card' }, slots: { extra: 'Main referee' } });
    expect(w.element.tagName).toBe('DIV');
    expect(w.attributes('aria-label')).toBeUndefined();
    expect(w.find('.q-match-card__side--tbd .q-match-card__name').text()).toBe('TBD');
    expect(w.find('.q-match-card__side--tbd .q-match-card__crest').text()).toBe('?');
    expect(w.find('.q-match-card__time').text()).toBe('18:30');
    expect(w.find('.q-match-card__extra').text()).toBe('Main referee');
    expect(w.find('.q-match-card__score').exists()).toBe(false);
  });
  it('live card shows the live badge', () => {
    const w = mount(QMatchCard, { props: { ...final, state: 'live', variant: 'card' } });
    expect(w.classes()).toContain('q-match-card--live');
    expect(w.find('.q-match-card__when .q-badge--live').text()).toContain('زنده');
  });
});
