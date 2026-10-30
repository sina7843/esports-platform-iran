import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QGameCard from './QGameCard.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QGameCard', () => {
  it('fa article: stripes cover, state badge, mode readiness sr text, test-only', () => {
    const w = mount(QGameCard, { props: { title: 'والورانت', latinName: 'VALORANT', publisher: 'Riot', state: 'ready', modes: [{ name: '5v5', ready: true }, { name: '1v1', ready: false }], testOnly: true } });
    expect(w.element.tagName).toBe('ARTICLE');
    expect(w.classes()).toEqual(['q-game-card']);
    expect(w.attributes('aria-labelledby')).toBe(w.find('h3').attributes('id'));
    expect(w.find('.q-game-card__cover').classes()).toContain('q-stripes');
    expect(w.find('.q-game-card__latin').attributes('aria-hidden')).toBe('true');
    expect(w.find('.q-game-card__latin').text()).toBe('VALORANT');
    expect(w.find('.q-badge--success').text()).toBe('آماده برگزاری');
    expect(w.find('.q-game-card__mode--ready .q-sr').text()).toBe('آماده');
    expect(w.findAll('.q-game-card__mode')[1]!.find('.q-sr').text()).toBe('آماده نیست');
    expect(w.find('.q-game-card__test').text()).toBe('فقط آزمایشی');
  });
  it('en link card, archived, default proposed state, no modes', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QGameCard, { props: { title: 'Valorant', href: '/games/1', state: 'archived' } });
    expect(w.element.tagName).toBe('A');
    expect(w.attributes('href')).toBe('/games/1');
    expect(w.classes()).toEqual(expect.arrayContaining(['q-game-card', 'q-game-card--link', 'q-game-card--archived']));
    expect(w.find('.q-badge').text()).toBe('Archived');
    expect(w.find('.q-game-card__nomode').text()).toBe('No mode is declared ready for standard competitions.');
    expect(mount(QGameCard, { props: { title: 'x' } }).find('.q-badge').text()).toBe('Proposed');
  });
});
