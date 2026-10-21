import { afterEach, describe, expect, it, vi } from 'vitest';
import { KavenegarSmsAdapter } from './kavenegar.js';
import type { Db } from 'mongodb';
import { buildAdapters } from './registry.js';
import { loadConfig } from '../config.js';
import { guarded, resetBreaker } from '../integrations/providers.js';

const key = 'FAKEKEYFORTEST';
const otp = { to: '+989123456789', text: 'کد تأیید: 123456', kind: 'otp' as const, otpCode: '123456', idempotencyKey: 'otp_test_1' };
const reply = (entries: unknown, status = 200) => new Response(JSON.stringify({ return: { status, message: `${key} ${otp.otpCode}` }, entries }), { headers: { 'Content-Type': 'application/json' } });
const message = (status = 1) => [{ messageid: 234567, status }];
function adapter(transport = vi.fn<typeof fetch>().mockImplementation(async () => reply(message())), allowed = true) {
  return { transport, sms: new KavenegarSmsAdapter({ apiKey: key, template: 'EsportsOtp', sender: '10004346', timeoutMs: 500, transport, allowed: async () => allowed }) };
}
afterEach(() => resetBreaker('sms'));

describe('Kavenegar production adapter (mocked transport; never sends a real SMS)', () => {
  it('posts an explicit OTP token to Verify Lookup with national mobile format and no sender', async () => {
    const { sms, transport } = adapter();
    expect(await sms.send(otp)).toEqual({ status: 'queued', providerRef: '234567' });
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe(`https://api.kavenegar.com/v1/${key}/verify/lookup.json`);
    expect(init?.method).toBe('POST'); expect(init?.redirect).toBe('error');
    const body = init?.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({ receptor: '09123456789', token: '123456', template: 'EsportsOtp', type: 'sms' });
    expect(String(url)).not.toContain('123456');
  });
  it('accepts Persian digits and normalizes +98 / 0098 mobile numbers', async () => {
    const { sms, transport } = adapter();
    await sms.send({ ...otp, to: '۰۰۹۸۹۱۲۳۴۵۶۷۸۹' });
    expect((transport.mock.calls[0]![1]?.body as URLSearchParams).get('receptor')).toBe('09123456789');
  });
  it('blocks unselected origins and unsupported or malformed messages before any network call', async () => {
    const { sms, transport } = adapter(undefined, false);
    await expect(sms.send(otp)).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(transport).not.toHaveBeenCalled();
    const other = adapter();
    await expect(other.sms.send({ ...otp, otpCode: undefined } as never)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(other.sms.send({ ...otp, kind: 'promotional' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(other.sms.send({ ...otp, to: 'invalid' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(other.transport).not.toHaveBeenCalled();
  });
  it('uses sms/send and a stable numeric localid for transactional deduplication', async () => {
    const { sms, transport } = adapter();
    await sms.send({ ...otp, kind: 'transactional' }); await sms.send({ ...otp, kind: 'transactional' });
    const first = transport.mock.calls[0]![1]?.body as URLSearchParams;
    const second = transport.mock.calls[1]![1]?.body as URLSearchParams;
    expect(String(transport.mock.calls[0]![0])).toContain('/sms/send.json');
    expect(first.get('message')).toBe(otp.text); expect(first.get('sender')).toBe('10004346');
    expect(first.get('localid')).toMatch(/^\d+$/); expect(first.get('localid')).toBe(second.get('localid'));
    expect(first.has('token')).toBe(false);
  });
  it.each([403, 418, 424, 426])('handles business failure %s inside HTTP 200 without leaking a key or token', async status => {
    const { sms } = adapter(vi.fn<typeof fetch>().mockResolvedValue(reply(null, status)));
    let error: unknown; try { await sms.send(otp); } catch (e) { error = e; }
    expect(error).toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(String(error)).not.toContain(key); expect(String(error)).not.toContain(otp.otpCode);
  });
  it('rejects malformed and HTTP failures and never automatically retries ambiguous sends', async () => {
    const { sms, transport } = adapter(vi.fn<typeof fetch>().mockRejectedValue(new Error(`upstream ${key} ${otp.otpCode}`)));
    await expect(guarded('sms', 'send', () => sms.send(otp))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: expect.not.stringContaining(key) });
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(adapter(vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json', { status: 502 }))).sms.send(otp)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(adapter(vi.fn<typeof fetch>().mockResolvedValue(reply([]))).sms.send(otp)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
  it('aborts a hanging request and sanitizes the transport error', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('test transport stalled')), 100);
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error(key)); });
    }));
    const sms = new KavenegarSmsAdapter({ apiKey: key, template: 'EsportsOtp', timeoutMs: 20, allowed: async () => true, transport });
    await expect(sms.send(otp)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: expect.not.stringContaining(key) });
    expect(transport.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('maps carrier delivery separately from queue acceptance', async () => {
    for (const [status, expected] of [[1, 'unknown'], [5, 'unknown'], [10, 'delivered'], [11, 'failed'], [100, 'failed']] as const) {
      const { sms } = adapter(vi.fn<typeof fetch>().mockResolvedValue(reply(message(status))));
      expect(await sms.deliveryStatus('234567')).toBe(expected);
    }
    expect(await adapter(vi.fn<typeof fetch>().mockResolvedValue(reply(message(6)))).sms.send(otp)).toMatchObject({ status: 'failed' });
  });
  it('checks account/info without sending an SMS and caches health without exposing account data', async () => {
    const { sms, transport } = adapter(vi.fn<typeof fetch>().mockResolvedValue(reply({ remaincredit: 200000 })));
    expect(await sms.health()).toMatchObject({ status: 'ok', adapter: 'kavenegar', mode: 'production' });
    await sms.health(); expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0]![0])).toContain('/account/info.json');
    expect(JSON.stringify(await sms.health())).not.toContain(key);
    expect((await adapter(vi.fn<typeof fetch>().mockResolvedValue(reply({ remaincredit: 0 }))).sms.health()).status).toBe('degraded');
    expect((await adapter(undefined, false).sms.health()).status).toBe('unconfigured');
  });
  it('wires the runtime adapter to the selected provider registry and blocks outbound traffic otherwise', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const collection = vi.fn().mockReturnValue({ findOne });
    const sms = buildAdapters(loadConfig({ SMS_ADAPTER: 'kavenegar', KAVENEGAR_API_KEY: key, KAVENEGAR_OTP_TEMPLATE: 'EsportsOtp' }), { collection } as unknown as Db).sms;
    expect(sms.name).toBe('kavenegar');
    await expect(sms.send(otp)).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(collection).toHaveBeenCalledWith('provider_registry');
    expect(findOne).toHaveBeenCalledWith({ category: 'sms', state: 'selected', origins: 'https://api.kavenegar.com' });
  });
  it('fails fast when Kavenegar credentials are absent and correctly parses false environment switches', () => {
    expect(() => loadConfig({ SMS_ADAPTER: 'kavenegar' })).toThrow('KAVENEGAR_API_KEY');
    const config = loadConfig({ NODE_ENV: 'production', APP_ENV: 'production', APP_SECRET: 'x'.repeat(64), TRUST_PROXY: 'true', AUTH_DEV_LOGIN_ENABLED: 'false', SMS_ADAPTER: 'kavenegar', KAVENEGAR_API_KEY: key, KAVENEGAR_OTP_TEMPLATE: 'EsportsOtp', PAYMENT_ADAPTER: 'none', EMAIL_ADAPTER: 'none', VIDEO_ADAPTER: 'none', MAP_ADAPTER: 'none', SCANNER_ADAPTER: 'none' });
    expect(config.devLoginEnabled).toBe(false); expect(config.mfaEnforced).toBe(true);
    expect(loadConfig({ TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
  });
});
