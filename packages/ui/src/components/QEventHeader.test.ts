import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QEventHeader from './QEventHeader.vue';

afterEach(() => { setLocale('fa', { keepDocument: true }); vi.useRealTimers(); });

describe('QEventHeader', () => {
  const base = { id: 'ev', title: 'جام پاییزه', status: 'registration_open' as const, verified: true, timeZone: 'Asia/Tehran', registration: { countdown: { days: 2, hours: 5, minutes: 7 }, fee: 0, capacity: '۱۱ از ۱۶ تیم' } };
  it('fa: labelled section, facts, countdown timer, CTA and note', () => {
    const w = mount(QEventHeader, { props: base });
    expect(w.element.tagName).toBe('SECTION');
    expect(w.attributes('aria-labelledby')).toBe('ev-t');
    expect(w.find('h1#ev-t').text()).toBe('جام پاییزه');
    expect(w.find('.q-event-header__verified').text()).toBe('برگزارکنندهٔ تأییدشده');
    expect(w.find('bdi.q-ltr').text()).toBe('Asia/Tehran');
    const t = w.find('[role="timer"]');
    expect(t.attributes('aria-label')).toBe('۲ روز و ۵ ساعت و ۷ دقیقه تا پایان ثبت‌نام');
    expect(t.findAll('strong').map((s) => s.text())).toEqual(['۰۲', '۰۵', '۰۷']);
    expect(w.find('.q-event-header__cta').text()).toBe('ثبت‌نام تیم');
    expect(w.find('.q-event-header__reg-meta').text()).toContain('رایگان');
    expect(w.find('.q-event-header__note').text()).toContain('هیچ‌کدام تضمین جایزه نیست');
  });
  it('en strings and register emit', async () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QEventHeader, { props: base });
    expect(w.find('[role="timer"]').attributes('aria-label')).toBe('2 days, 5 hours and 7 minutes until registration closes');
    expect(w.find('.q-event-header__cta').text()).toBe('Register team');
    await w.find('.q-event-header__cta').trigger('click');
    expect(w.emitted('register')).toHaveLength(1);
  });
  it('null hides the registration box and the note; a deadline ticks every 30 s', async () => {
    const hidden = mount(QEventHeader, { props: { ...base, registration: null, note: null } });
    expect(hidden.find('.q-event-header__reg').exists()).toBe(false);
    expect(hidden.find('.q-event-header__note').exists()).toBe(false);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const w = mount(QEventHeader, { props: { ...base, registration: { deadline: '2026-01-01T00:02:00Z' } } });
    expect(w.findAll('.q-event-header__cd strong')[2]!.text()).toBe('۰۲');
    vi.advanceTimersByTime(60000);
    await w.vm.$nextTick();
    expect(w.findAll('.q-event-header__cd strong')[2]!.text()).toBe('۰۱');
    w.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
