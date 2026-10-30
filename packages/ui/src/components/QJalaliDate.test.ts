import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QJalaliDate from './QJalaliDate.vue';

const at = '2026-12-03T15:00:00Z';
afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QJalaliDate', () => {
  it('renders <time datetime> with Jalali text and a full-datetime title for short formats', () => {
    const w = mount(QJalaliDate, { props: { iso: at, format: 'date' } });
    expect(w.element.tagName).toBe('TIME');
    expect(w.classes()).toEqual(['q-jalali-date', 'q-num']);
    expect(w.attributes('datetime')).toBe('2026-12-03T15:00:00.000Z');
    expect(w.text()).toBe('۱۲ آذر ۱۴۰۵');
    expect(w.attributes('title')).toBe('۱۲ آذر ۱۴۰۵ ساعت ۱۸:۳۰');
  });
  it('no title for datetime or title=false', () => {
    expect(mount(QJalaliDate, { props: { iso: at } }).attributes('title')).toBeUndefined();
    expect(mount(QJalaliDate, { props: { iso: at, format: 'time', title: false } }).attributes('title')).toBeUndefined();
  });
  it('relative with a fixed now, in en', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QJalaliDate, { props: { iso: at, format: 'relative', now: '2026-12-03T17:00:00Z' } });
    expect(w.text()).toBe('2 hours ago');
  });
  it('empty shows the fallback', () => {
    const w = mount(QJalaliDate, { props: { iso: null } });
    expect(w.classes()).toContain('q-jalali-date--empty');
    expect(w.text()).toBe('—');
    expect(mount(QJalaliDate, { props: { iso: '' }, slots: { fallback: 'نامشخص' } }).text()).toBe('نامشخص');
  });
});
