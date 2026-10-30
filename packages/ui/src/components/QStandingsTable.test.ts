import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QStandingsTable from './QStandingsTable.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

const rows = [
  { name: 'سیمرغ', played: 3, wins: 3, losses: 0, diff: 12, points: 9, form: ['W', 'W', 'L'] as Array<'W' | 'D' | 'L'>, change: 1, mine: true },
  { name: 'پارس', played: 3, wins: 1, draws: 1, losses: 1, diff: -4, points: 4, change: -2, tie: true },
  { name: 'البرز', played: 3, wins: 0, losses: 3, diff: 0, points: 0, href: '/t/3' },
  { name: 'دماوند', played: 3, wins: 0, losses: 3, diff: 0, points: 0 },
];

describe('QStandingsTable', () => {
  it('fa: medals, mine row, signed diff, form, change', () => {
    const w = mount(QStandingsTable, { props: { rows, provisional: true } });
    expect(w.classes()).toEqual(['q-standings-table']);
    expect(w.find('.q-badge--warning').text()).toContain('موقت');
    expect(w.find('caption').text()).toBe('جدول رتبه‌بندی');
    expect(w.find('[role="region"]').attributes('aria-label')).toBe('جدول رتبه‌بندی');
    const tr = w.findAll('tbody tr');
    expect(tr[0]!.classes()).toEqual(expect.arrayContaining(['q-standings-table__row--mine', 'q-standings-table__row--gold']));
    expect(tr[0]!.attributes('aria-current')).toBe('true');
    expect(tr[0]!.find('.q-icon[aria-label]').attributes('aria-label')).toBe('رتبه اول');
    expect(tr[0]!.find('.q-standings-table__you').text()).toBe('تیم شما');
    expect(tr[0]!.find('.q-standings-table__pos').text()).toBe('+۱۲');
    expect(tr[1]!.find('.q-standings-table__neg').text()).toBe('−۴');
    expect(tr[0]!.find('.q-standings-table__form').attributes('aria-label')).toBe('نتایج اخیر: برد، برد، باخت');
    expect(tr[0]!.findAll('.q-standings-table__dot').map((d) => d.text())).toEqual(['ب', 'ب', 'ش']);
    expect(tr[0]!.find('.q-standings-table__chg .q-sr').text()).toBe('۱ پله صعود');
    expect(tr[1]!.find('.q-standings-table__tie').exists()).toBe(true);
    expect(tr[3]!.classes()).not.toContain('q-standings-table__row--bronze');
    expect(tr[2]!.find('a.q-standings-table__name').attributes('href')).toBe('/t/3');
  });
  it('en: abbreviated heads, hidden columns, title makes caption sr-only', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QStandingsTable, { props: { rows, title: 'Group A', showDraws: false, showForm: false } });
    expect(w.find('caption').classes()).toEqual(['q-sr']);
    expect(w.findAll('thead abbr').map((a) => [a.text(), a.attributes('title')])).toEqual([['Played', 'Played'], ['W', 'Wins'], ['L', 'Losses'], ['Diff', 'Difference']]);
    expect(w.findAll('thead th')).toHaveLength(7);
    expect(w.findAll('tbody tr')[1]!.find('.q-standings-table__chg .q-sr').text()).toBe('down 2 places');
  });
});
