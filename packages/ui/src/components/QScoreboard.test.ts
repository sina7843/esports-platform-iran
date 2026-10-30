import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QScoreboard from './QScoreboard.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QScoreboard', () => {
  const props = {
    home: { name: 'سیمرغ', score: 13, line: 'بذر ۱ · ۲ برد پیاپی' }, away: { name: 'پارس', score: 7 }, live: true,
    eventName: 'جام', context: 'نقشه ۲', roomHref: '/room/1',
    maps: [{ name: 'Lotus', score: '13–7', status: 'done' as const }, { name: 'Bind', status: 'live' as const }],
  };
  it('live: card glow, score group, maps', () => {
    const w = mount(QScoreboard, { props });
    expect(w.classes()).toEqual(expect.arrayContaining(['q-card', 'q-card--live', 'q-scoreboard']));
    const g = w.find('.q-scoreboard__score[role="group"]');
    expect(g.attributes('aria-label')).toBe('نتیجه: سیمرغ ۱۳، پارس ۷');
    expect(g.find('.q-scoreboard__lead').text()).toBe('۱۳');
    expect(w.find('.q-scoreboard__ctx').text()).toBe('جام · نقشه ۲');
    expect(w.findAll('.q-scoreboard__line > span:not(.q-scoreboard__sep)').map((s) => s.text())).toEqual(['بذر ۱', '۲ برد پیاپی']);
    expect(w.find('.q-scoreboard__room').text()).toBe('ورود به اتاق مسابقه');
    expect(w.findAll('.q-scoreboard__map')[0]!.find('.q-ltr').text()).toBe('Lotus · ۱۳–۷');
    expect(w.find('.q-scoreboard__map--live .q-sr').text()).toBe('، زنده');
    const row = w.find('.q-scoreboard__vsrow').element.children;
    expect([...row].map((e) => e.className)).toEqual(['q-scoreboard__team', 'q-scoreboard__score', 'q-scoreboard__team q-scoreboard__team--end']);
  });
  it('en: scheduled shows the start time; winner after final', () => {
    setLocale('en', { keepDocument: true });
    const s = mount(QScoreboard, { props: { home: { name: 'A' }, away: { name: 'B' }, time: '18:30' } });
    expect(s.find('.q-scoreboard__vs').text()).toBe('Starts');
    expect(s.find('.q-scoreboard__time').text()).toBe('18:30');
    expect(s.find('.q-badge--info').text()).toContain('Scheduled');
    const f = mount(QScoreboard, { props: { home: { name: 'A', score: 1 }, away: { name: 'B', score: 2 }, state: 'final' } });
    expect(f.findAll('.q-scoreboard__team')[1]!.find('.q-scoreboard__check').attributes('aria-label')).toBe('Winner');
  });
});
