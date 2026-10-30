import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QTimeline, { type QTimelineItem } from './QTimeline.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

const items: QTimelineItem[] = [
  { id: 1, type: 'result', at: '2026-12-03T15:00:00Z', actor: 'داور', action: 'نتیجه ثبت شد', detail: '۲–۱' },
  { id: 2, type: 'dispute', time: '18:40', action: 'اعتراض', tone: 'warning' },
];

describe('QTimeline', () => {
  it('ordered list with typed tones, times and decorative rail', () => {
    const w = mount(QTimeline, { props: { items, timeFormat: 'datetime' } });
    expect(w.element.tagName).toBe('OL');
    expect(w.classes()).toEqual(['q-timeline', 'q-timeline--dated']);
    const li = w.findAll('li');
    expect(li[0]!.classes()).toContain('q-timeline__item--green');
    expect(li[1]!.classes()).toContain('q-timeline__item--warning');
    expect(li[0]!.find('time').text()).toBe('۱۸:۳۰');
    expect(li[0]!.find('.q-timeline__date').text()).toBe('۱۲ آذر');
    expect(li[1]!.find('.q-timeline__time').text()).toBe('۱۸:۴۰');
    expect(li[0]!.find('.q-timeline__rail').attributes('aria-hidden')).toBe('true');
    expect(li[0]!.find('.q-timeline__head').text()).toBe('داور نتیجه ثبت شد');
    expect(li[0]!.find('.q-timeline__detail').text()).toBe('۲–۱');
  });
  it('compact drops icons', () => {
    expect(mount(QTimeline, { props: { items, compact: true } }).find('.q-timeline__node svg').exists()).toBe(false);
  });
  it('empty text fa / en', () => {
    expect(mount(QTimeline, { props: { items: [] } }).text()).toBe('رویدادی ثبت نشده است.');
    setLocale('en', { keepDocument: true });
    expect(mount(QTimeline, { props: { items: [] } }).text()).toBe('No events recorded yet.');
  });
});
