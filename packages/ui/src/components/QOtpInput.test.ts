import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QOtpInput from './QOtpInput.vue';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); setLocale('fa', { keepDocument: true }); });

describe('QOtpInput', () => {
  it('renders labelled LTR cells with Persian digits; stores ASCII', async () => {
    const w = mount(QOtpInput, { props: { id: 'o', length: 4, modelValue: '12' } });
    expect(w.classes()).toContain('q-otp-input');
    expect(w.find('legend').text()).toContain('کد تأیید');
    expect(w.find('.q-otp-input__cells').attributes('dir')).toBe('ltr');
    const cells = w.findAll('input');
    expect(cells).toHaveLength(4);
    expect(cells[0]!.attributes('autocomplete')).toBe('one-time-code');
    expect(cells[0]!.attributes('inputmode')).toBe('numeric');
    expect(cells[1]!.attributes('autocomplete')).toBe('off');
    expect(cells[0]!.attributes('aria-label')).toBe('رقم ۱ از ۴');
    expect(cells[0]!.element.value).toBe('۱');
    expect(cells[0]!.classes()).toContain('q-otp-input__cell--filled');
    await cells[2]!.setValue('۳'); // Persian digit
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['123']);
  });
  it('emits complete when full; paste fills; Backspace deletes', async () => {
    const w = mount(QOtpInput, { props: { length: 4 } });
    const cells = w.findAll('input');
    await cells[0]!.trigger('paste', { clipboardData: { getData: () => '٤٣21' } });
    expect(w.emitted('change')?.[0]?.[0]).toBe('4321');
    expect(w.emitted('complete')?.[0]).toEqual(['4321']);
    await cells[3]!.trigger('keydown', { key: 'Backspace' });
    expect(w.emitted('change')?.[1]?.[0]).toBe('432');
  });
  it('countdown then resend button (fa / en)', async () => {
    const w = mount(QOtpInput, { props: { resendIn: 2 } });
    expect(w.find('.q-otp-input__wait').text()).toBe('ارسال مجدد کد تا ۰:۰۲');
    vi.advanceTimersByTime(1000);
    await w.vm.$nextTick();
    expect(w.find('.q-otp-input__count').text()).toBe('۰:۰۱');
    vi.advanceTimersByTime(1000);
    await w.vm.$nextTick();
    const btn = w.find('.q-otp-input__resend-btn');
    expect(btn.text()).toBe('ارسال مجدد کد');
    setLocale('en', { keepDocument: true });
    await w.vm.$nextTick();
    expect(w.find('.q-otp-input__resend-btn').text()).toBe('Resend code');
    await w.find('.q-otp-input__resend-btn').trigger('click');
    expect(w.emitted('resend')).toHaveLength(1);
    expect(w.find('.q-otp-input__wait').text()).toBe('Resend code in 0:02');
  });
  it('digits=latn keeps Latin cells; hideResend hides the line', () => {
    const w = mount(QOtpInput, { props: { digits: 'latn', modelValue: '9', hideResend: true } });
    expect(w.find('input').element.value).toBe('9');
    expect(w.find('.q-otp-input__resend').exists()).toBe(false);
  });
});
