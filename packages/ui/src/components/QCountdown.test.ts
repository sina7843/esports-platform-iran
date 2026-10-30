import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QCountdown from './QCountdown.vue';

const now = '2026-12-01T00:00:00Z';
const target = '2026-12-04T14:22:05Z'; // 3 d 14 h 22 m 5 s
afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QCountdown', () => {
  it('cells with a hidden sentence and role=timer', () => {
    const w = mount(QCountdown, { props: { target, now } });
    expect(w.attributes('role')).toBe('timer');
    expect(w.classes()).toEqual(['q-countdown', 'q-countdown--cells']);
    expect(w.find('.q-countdown__label').text()).toBe('پایان ثبت‌نام تا');
    expect(w.findAll('.q-countdown__num').map((n) => n.text())).toEqual(['۰۳', '۱۴', '۲۲']);
    expect(w.find('.q-countdown__cells').attributes('aria-hidden')).toBe('true');
    expect(w.find('.q-sr').text()).toBe('۳ روز و ۱۴ ساعت و ۲۲ دقیقه مانده');
  });
  it('inline in en', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QCountdown, { props: { target, now, variant: 'inline', label: null } });
    expect(w.find('.q-countdown__label').exists()).toBe(false);
    expect(w.find('.q-countdown__clock').text()).toBe('86:22:05');
    expect(w.find('.q-sr').text()).toBe('3 days, 14 hours, 22 minutes and 5 seconds left');
  });
  it('ended state emits end once', async () => {
    const w = mount(QCountdown, { props: { target: now, now } });
    expect(w.classes()).toContain('q-countdown--ended');
    expect(w.text()).toContain('به پایان رسید');
    expect(w.emitted('end')).toHaveLength(1);
    await w.setProps({ now: '2026-12-02T00:00:00Z' });
    expect(w.emitted('end')).toHaveLength(1);
  });
  it('a fixed now freezes the clock (no interval)', () => {
    const w = mount(QCountdown, { props: { target, now, seconds: true } });
    expect(w.findAll('.q-countdown__num').map((n) => n.text())).toEqual(['۰۳', '۱۴', '۲۲', '۰۵']);
    w.unmount();
  });
});
