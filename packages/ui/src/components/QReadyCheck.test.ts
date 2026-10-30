import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QReadyCheck from './QReadyCheck.vue';

afterEach(() => { setLocale('fa', { keepDocument: true }); vi.useRealTimers(); });

const sides = [{ name: 'سیمرغ' }, { name: 'پارس', ready: true }];

describe('QReadyCheck', () => {
  it('fa: waiting side, timer, declare emits ready and updates locally', async () => {
    const w = mount(QReadyCheck, { props: { sides, viewerSide: 0, seconds: 45 } });
    expect(w.classes()).toEqual(expect.arrayContaining(['q-card', 'q-ready-check']));
    expect(w.find('.q-ready-check__title').text()).toBe('اعلام آمادگی');
    expect(w.find('.q-ready-check__side--me .q-ready-check__you').text()).toBe('تیم شما');
    expect(w.findAll('[role="status"]').map((s) => s.text())).toEqual(['در انتظار', 'آماده']);
    expect(w.find('[role="timer"]').attributes('aria-label')).toBe('۴۵ ثانیه تا شروع');
    await w.find('.q-ready-check__cta').trigger('click');
    expect(w.emitted('ready')).toEqual([[0]]);
    expect(w.classes()).toContain('q-ready-check--both');
    expect(w.find('.q-ready-check__done').text()).toBe('هر دو طرف آماده‌اند.');
    await w.find('.q-ready-check__cta').trigger('click');
    expect(w.emitted('startSelection')).toHaveLength(1);
  });
  it('controlled stays waiting; canStart=false shows the referee note', async () => {
    const w = mount(QReadyCheck, { props: { sides, viewerSide: 0, controlled: true } });
    await w.find('.q-ready-check__cta').trigger('click');
    expect(w.classes()).not.toContain('q-ready-check--both');
    const b = mount(QReadyCheck, { props: { sides: [{ name: 'a', ready: true }, { name: 'b', ready: true }], canStart: false } });
    expect(b.find('.q-ready-check__wait').text()).toBe('در انتظار شروع انتخاب‌ها توسط داور');
  });
  it('en: running countdown ticks, warns at 10 s and stops on unmount', async () => {
    setLocale('en', { keepDocument: true });
    vi.useFakeTimers();
    const w = mount(QReadyCheck, { props: { sides, viewerSide: 1, seconds: 11, running: true } });
    expect(w.find('.q-ready-check__wait').text()).toBe('You are marked ready; waiting for the opponent.');
    vi.advanceTimersByTime(1000);
    await w.vm.$nextTick();
    expect(w.find('[role="timer"]').attributes('aria-label')).toBe('10 seconds to start');
    expect(w.find('.q-ready-check__timer').classes()).toContain('q-ready-check__timer--warn');
    w.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
