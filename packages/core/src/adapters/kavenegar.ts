import { createHash } from 'node:crypto';
import { DomainError, normalizeIranMobile, type ProviderHealth } from '@esp/contracts';
import { z } from 'zod';
import type { SmsAdapter, SmsSendInput } from './types.js';

export const KAVENEGAR_ORIGIN = 'https://api.kavenegar.com';
const Entry = z.object({ messageid: z.number().int().positive(), status: z.number().int() });
const Envelope = z.object({ return: z.object({ status: z.number().int() }), entries: z.unknown().optional() });
const Account = z.object({ remaincredit: z.number().nonnegative() });
const FAILED = new Set([6, 11, 13, 14, 100]);

/** Official REST API, fixed HTTPS origin, POST body, no redirects or automatic send retries.
 * Never include an upstream URL, response message or thrown fetch error in logs: they can contain the API key/OTP.
 * A queued response is acceptance by Kavenegar, not proof of delivery to the recipient.
 */
export class KavenegarSmsAdapter implements SmsAdapter {
  readonly name = 'kavenegar';
  readonly mode = 'production' as const;
  readonly capabilities = ['otp', 'verify-lookup', 'transactional', 'delivery-status'] as const;
  private cached: { until: number; health: ProviderHealth } | null = null;

  constructor(private readonly options: {
    apiKey: string; template: string; sender?: string | undefined; timeoutMs: number;
    allowed: () => Promise<boolean>;
    transport?: typeof fetch;
  }) {}

  private async request(method: string, body: URLSearchParams): Promise<unknown> {
    if (!await this.options.allowed()) throw new DomainError('PROVIDER_NOT_CONFIGURED', 'Kavenegar must be selected in the provider registry with its official API origin');
    let data: z.infer<typeof Envelope>;
    try {
      const response = await (this.options.transport ?? fetch)(`${KAVENEGAR_ORIGIN}/v1/${encodeURIComponent(this.options.apiKey)}/${method}.json`, {
        method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body, signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      // Kavenegar may return a business error with HTTP 200, so check both levels.
      data = Envelope.parse(await response.json());
      if (!response.ok && data.return.status === 200) throw new Error('invalid HTTP response');
    } catch {
      this.cached = null;
      throw new DomainError('PROVIDER_UNAVAILABLE', 'Kavenegar did not return a valid response; delivery is not confirmed');
    }
    const status = data.return.status;
    if (status !== 200) {
      this.cached = null;
      if ([401, 403, 406, 412, 416, 418, 424, 426, 427, 432, 501].includes(status)) {
        throw new DomainError('PROVIDER_NOT_CONFIGURED', `Kavenegar configuration or account requires attention (code ${status})`);
      }
      if ([429, 451].includes(status)) throw new DomainError('RATE_LIMITED', 'Kavenegar request limit reached');
      throw new DomainError('PROVIDER_UNAVAILABLE', `Kavenegar rejected the request (code ${status})`);
    }
    return data.entries;
  }

  async send(input: SmsSendInput) {
    const receptor = normalizeIranMobile(input.to);
    if (!receptor) throw new DomainError('VALIDATION_FAILED', 'invalid Iranian mobile number');
    // Promotional messages are intentionally excluded from the login/transactional integration.
    if (input.kind === 'promotional') throw new DomainError('VALIDATION_FAILED', 'promotional SMS is not enabled');
    const body = new URLSearchParams({ receptor: '0' + receptor.slice(3) });
    let method: string;
    if (input.kind === 'otp') {
      if (!input.otpCode || !/^\d{6}$/.test(input.otpCode)) throw new DomainError('VALIDATION_FAILED', 'a six-digit OTP token is required');
      method = 'verify/lookup';
      body.set('token', input.otpCode); body.set('template', this.options.template); body.set('type', 'sms');
    } else {
      if (!this.options.sender) throw new DomainError('PROVIDER_NOT_CONFIGURED', 'Kavenegar sender is required for transactional messages');
      if (!input.text.trim()) throw new DomainError('VALIDATION_FAILED', 'message is empty');
      method = 'sms/send'; body.set('sender', this.options.sender); body.set('message', input.text);
      body.set('localid', BigInt('0x' + createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 15)).toString());
    }
    const result = await this.request(method, body);
    const entries = z.array(Entry).min(1).safeParse(Array.isArray(result) ? result : [result]);
    if (!entries.success) throw new DomainError('PROVIDER_UNAVAILABLE', 'Kavenegar response has no valid message reference');
    const entry = entries.data[0]!;
    if (![1, 2, 4, 5, 10].includes(entry.status) && !FAILED.has(entry.status)) throw new DomainError('PROVIDER_UNAVAILABLE', 'Kavenegar returned an unknown message status');
    return { status: FAILED.has(entry.status) ? 'failed' as const : entry.status === 10 ? 'sent' as const : 'queued' as const, providerRef: String(entry.messageid) };
  }

  async deliveryStatus(providerRef: string): Promise<'delivered' | 'failed' | 'unknown'> {
    if (!/^\d+$/.test(providerRef)) throw new DomainError('VALIDATION_FAILED', 'invalid message reference');
    const result = await this.request('sms/status', new URLSearchParams({ messageid: providerRef }));
    const entries = z.array(Entry).min(1).safeParse(result);
    if (!entries.success) return 'unknown';
    const entry = entries.data.find(e => String(e.messageid) === providerRef);
    if (!entry) return 'unknown';
    return entry.status === 10 ? 'delivered' : FAILED.has(entry.status) ? 'failed' : 'unknown';
  }

  /** Read-only account probe; never sends a test SMS, caches success/outage for one minute. */
  async health(): Promise<ProviderHealth> {
    if (this.cached && this.cached.until > Date.now()) return this.cached.health;
    let status: ProviderHealth['status'];
    let detail: string;
    try {
      const account = Account.safeParse(await this.request('account/info', new URLSearchParams()));
      if (!account.success) { status = 'down'; detail = 'Kavenegar returned an invalid account response'; }
      else { status = account.data.remaincredit > 0 ? 'ok' : 'degraded'; detail = account.data.remaincredit > 0 ? 'Kavenegar account is reachable; template approval and live delivery still require verification' : 'Kavenegar account has no remaining credit'; }
    } catch (error) {
      status = error instanceof DomainError && error.code === 'PROVIDER_NOT_CONFIGURED' ? 'unconfigured' : 'down';
      detail = error instanceof DomainError ? error.message : 'Kavenegar account probe failed';
    }
    const health = { kind: 'sms' as const, adapter: this.name, mode: this.mode, status, capabilities: [...this.capabilities], detail, checkedAt: new Date().toISOString() };
    this.cached = { until: status === 'unconfigured' ? 0 : Date.now() + 60_000, health };
    return health;
  }
}
