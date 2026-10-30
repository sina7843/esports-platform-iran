import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QDateField from './QDateField.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));
const today = '2026-12-09T08:00:00Z'; // ۱۸ آذر ۱۴۰۵, Wednesday

describe('QDateField', () => {
  it('Jalali grid in fa: Saturday first, today marked, pick emits ISO date', async () => {
    const w = mount(QDateField, { props: { id: 'd', label: 'تاریخ', today, defaultOpen: true }, attachTo: document.body });
    expect(w.classes()).toContain('q-date-field');
    const trigger = w.find('button.q-date-field__trigger');
    expect(trigger.attributes('aria-haspopup')).toBe('dialog');
    expect(trigger.attributes('aria-expanded')).toBe('true');
    expect(w.find('.q-date-field__value').text()).toBe('انتخاب تاریخ');
    expect(w.find('.q-date-field__title').text()).toBe('آذر ۱۴۰۵');
    expect(w.findAll('th .q-sr').map((x) => x.text())[0]).toBe('شنبه');
    const todayBtn = w.find('.q-date-field__day--today');
    expect(todayBtn.text()).toBe('۱۸');
    expect(todayBtn.attributes('aria-current')).toBe('date');
    expect(todayBtn.attributes('tabindex')).toBe('0');
    expect(w.find('.q-date-field__tz').text()).toBe('تقویم هجری شمسی');
    await todayBtn.trigger('click');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['2026-12-09']);
    expect(w.emitted('change')?.[0]).toEqual(['2026-12-09']);
    expect(w.find('.q-date-field__value').text()).toBe('چهارشنبه ۱۸ آذر ۱۴۰۵');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    w.unmount();
  });
  it('en: Gregorian, Monday first; ArrowDown moves a week; disablePast', async () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QDateField, { props: { today, defaultOpen: true, disablePast: true }, attachTo: document.body });
    expect(w.find('.q-date-field__title').text()).toBe('December 2026');
    expect(w.findAll('th .q-sr').map((x) => x.text())[0]).toBe('Monday');
    expect(w.find('.q-date-field__tz').text()).toBe('Gregorian calendar');
    const days = w.findAll('.q-date-field__day');
    expect(days[0]!.attributes('disabled')).toBeDefined(); // 1 December is past
    await w.find('.q-date-field__day--today').trigger('keydown', { key: 'ArrowDown' });
    expect(w.find('.q-date-field__day[tabindex="0"]').text()).toBe('16');
    await w.find('.q-date-field__nav').trigger('click');
    expect(w.find('.q-date-field__title').text()).toBe('November 2026');
    w.unmount();
  });
  it('withTime: Tehran hint, time selects, ISO with +03:30', async () => {
    const w = mount(QDateField, { props: { today, withTime: true, modelValue: '2026-12-09T18:30:00+03:30' } });
    expect(w.find('.q-form-field__hint').text()).toBe('زمان‌ها به وقت تهران');
    expect(w.find('.q-date-field__value').text()).toBe('چهارشنبه ۱۸ آذر ۱۴۰۵، ساعت ۱۸:۳۰');
    await w.findAll('select')[0]!.setValue('20');
    expect(w.emitted('change')?.[0]).toEqual(['2026-12-09T20:30:00+03:30']);
    expect(w.find('.q-date-field__done').text()).toBe('تأیید');
  });
  it('Escape closes the popover', async () => {
    const w = mount(QDateField, { props: { today, defaultOpen: true } });
    await w.find('.q-date-field__anchor').trigger('keydown', { key: 'Escape' });
    expect(w.find('.q-date-field__pop').attributes('hidden')).toBeDefined();
  });
});
