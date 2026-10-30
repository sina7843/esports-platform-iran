import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QLeaderboardRow from './QLeaderboardRow.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QLeaderboardRow', () => {
  it('fa: medal rank, rating, delta up, mine', () => {
    const w = mount(QLeaderboardRow, { props: { rank: 1, name: 'علی', handle: 'ali#1', rating: 1520, rd: 40, delta: 12, mine: true, href: '/p/1' } });
    expect(w.element.tagName).toBe('A');
    expect(w.classes()).toEqual(expect.arrayContaining(['q-leaderboard-row', 'q-leaderboard-row--mine', 'q-leaderboard-row--link']));
    expect(w.attributes('aria-current')).toBe('true');
    expect(w.find('.q-leaderboard-row__rank--gold .q-num').text()).toBe('۱');
    expect(w.find('.q-leaderboard-row__rank .q-sr').text()).toBe('رتبه');
    expect(w.find('.q-leaderboard-row__handle').classes()).toContain('q-ltr');
    expect(w.find('.numeral').text()).toBe('۱۵۲۰');
    expect(w.find('.q-leaderboard-row__rd').text()).toBe('±۴۰');
    expect(w.find('.q-leaderboard-row__delta--up bdi').text()).toBe('+۱۲');
    expect(w.find('.q-leaderboard-row__delta .q-sr').text()).toBe('افزایش');
    expect(w.find('.q-leaderboard-row__you').text()).toBe('شما');
    expect(w.findAll('.q-leaderboard-row__delta polyline')).toHaveLength(2);
  });
  it('en: no rank, team avatar, down delta, custom tag', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QLeaderboardRow, { props: { rank: null, name: 'Simorgh', kind: 'team', rating: 1400, delta: -3, as: 'li', inactive: true } });
    expect(w.element.tagName).toBe('LI');
    expect(w.classes()).toContain('q-leaderboard-row--inactive');
    expect(w.find('.q-num').text()).toBe('—');
    expect(w.find('.q-leaderboard-row__avatar').classes()).toEqual(expect.arrayContaining(['q-leaderboard-row__avatar--team', 'q-chamfer-xs']));
    expect(w.find('.q-leaderboard-row__avatar').text()).toBe('S');
    expect(w.find('.q-leaderboard-row__delta--down bdi').text()).toBe('−3');
    expect(w.find('.q-leaderboard-row__delta .q-sr').text()).toBe('down');
  });
});
