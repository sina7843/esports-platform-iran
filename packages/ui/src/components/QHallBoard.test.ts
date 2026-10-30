import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QHallBoard from './QHallBoard.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QHallBoard', () => {
  const props = {
    eventName: 'لیگ دانشجویی', clock: '۱۸:۴۲', notice: 'تأخیر ۱۰ دقیقه',
    live: [{ id: '1', home: 'سیمرغ', away: 'پارس', score: [2, 1] as [number, number], stage: 'نقشه ۲', station: 'ایستگاه ۴' }],
    called: [{ home: 'البرز', away: 'دماوند', station: null }, { home: 'الف', away: 'ب', station: 'ایستگاه ۲', callup: 'ready' as const }],
    upcoming: [{ home: 'الف', away: 'ب', time: '۱۹:۳۰', estimated: true }],
    results: [],
  };
  it('fa: region, zones, live tile, call-ups, alert notice, empty zone', () => {
    const w = mount(QHallBoard, { props });
    expect(w.classes()).toEqual(['q-hall-board']);
    expect(w.find('.q-hall-board__frame').attributes('aria-label')).toBe('نمایشگر سالن — لیگ دانشجویی');
    expect(w.find('[role="alert"]').text()).toBe('تأخیر ۱۰ دقیقه');
    expect(w.findAll('.q-hall-board__zone').map((z) => z.attributes('aria-label'))).toEqual(['در حال برگزاری', 'فراخوان', 'بازی‌های بعدی', 'نتایج نهایی']);
    const tile = w.find('.q-hall-board__tile');
    expect(tile.attributes('aria-label')).toBe('سیمرغ ۲، پارس ۱');
    expect(tile.find('.q-hall-board__team--lead .q-hall-board__team-score').text()).toBe('۲');
    expect(tile.find('.q-hall-board__team--trail .q-hall-board__crest').text()).toBe('پ');
    const calls = w.findAll('.q-hall-board__call');
    expect(calls[0]!.classes()).toContain('q-hall-board__call--called');
    expect(calls[0]!.find('.q-hall-board__call-station--tbd').text()).toBe('ایستگاه اعلام می‌شود');
    expect(calls[0]!.find('.q-hall-board__call-state').text()).toBe('به ایستگاه بیایید');
    expect(calls[1]!.find('.q-hall-board__call-state').text()).toBe('آماده');
    expect(w.find('.q-hall-board__approx').attributes('title')).toBe('زمان تقریبی');
    expect(w.find('.q-hall-board__zone--results .q-hall-board__empty').text()).toBe('—');
    expect(w.find('.q-hall-board__clock-value').text()).toBe('۱۸:۴۲');
  });
  it('en strings, label overrides and limits', () => {
    setLocale('en', { keepDocument: true });
    const { notice: _n, ...rest } = props;
    const w = mount(QHallBoard, { props: { ...rest, labels: { title: 'Arena screen' }, callupLabels: { ready: 'Go' }, maxCalled: 1,
      results: [{ home: 'A', away: 'B', score: [0, 2] as [number, number], winner: 1 as const }] } });
    expect(w.find('.q-hall-board__kicker').text()).toBe('Arena screen');
    expect(w.find('.q-hall-board__zone--live .q-hall-board__zone-title').text()).toBe('Live now');
    expect(w.findAll('.q-hall-board__call')).toHaveLength(1);
    expect(w.find('.q-hall-board__call-state').text()).toBe('Come to your station');
    expect(w.find('.q-hall-board__row--result').attributes('aria-label')).toBe('A 0, B 2');
    expect(w.find('.q-hall-board__res-team--end').classes()).toContain('q-hall-board__res-team--win');
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });
});
