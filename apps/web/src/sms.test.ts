import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import OtpField from './components/OtpField.vue';
import KavenegarPanel from './components/KavenegarPanel.vue';
import { setLocale } from './settings';

afterEach(() => vi.unstubAllGlobals());
describe('Persian SMS UI adapted from VibeFarsi', () => {
  it('accepts a complete Persian OTP from autofill and emits ASCII digits in an LTR group', async () => {
    setLocale('fa');
    const w = mount(OtpField, { props: { id: 'otp', modelValue: '' } });
    await w.get('input').setValue('۱۲۳۴۵۶');
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['123456']);
    expect(w.get('[role="group"]').attributes('dir')).toBe('ltr');
    expect(w.get('input').attributes('autocomplete')).toBe('one-time-code');
    expect(w.findAll('input')).toHaveLength(6);
    w.unmount();
  });
  it('supports paste and backward deletion without losing digit positions', async () => {
    const w = mount(OtpField, { props: { id: 'otp', modelValue: '' } });
    await w.get('input').trigger('paste', { clipboardData: { getData: () => '۰۱۲۳۴۵' } });
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['012345']);
    await w.findAll('input')[5]!.setValue('');
    await w.findAll('input')[5]!.trigger('keydown', { key: 'Backspace' });
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['0123']);
    w.unmount();
  });
  it('shows runtime configuration and prepares provider registration without making a send request', async () => {
    setLocale('fa');
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ adapter: 'kavenegar', apiKeyConfigured: true, template: 'EsportsOtp', sender: null, health: { status: 'unconfigured' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const w = mount(KavenegarPanel); await flushPromises();
    expect(w.text()).toContain('EsportsOtp'); expect(w.text()).toContain('پیامک آزمایشی ارسال نمی‌شود');
    expect(w.find('input[type="password"]').exists()).toBe(false);
    await w.findAll('button').find(b => b.text().includes('آماده‌سازی'))!.trigger('click');
    expect(w.emitted('preset')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/providers/sms');
    w.unmount();
  });
});
