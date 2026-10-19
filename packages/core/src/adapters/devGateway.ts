import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import type { Money, ProviderHealth } from '@esp/contracts';
import type { CallbackPayload, PaymentAdapter } from './types.js';

/**
 * Development/test payment provider double (FIN-002/004). It behaves like a remote PSP that keeps its own state:
 * it lives in the `dev_gateway` collection (shared by api and worker), verifies amount/order/merchant, and emits
 * HMAC-signed callbacks. Outcomes are controlled explicitly (`settle`) so tests can drive success, failure,
 * unknown/pending, invalid signatures, duplicate, late and out-of-order callbacks deterministically.
 * It never moves money and production configuration refuses it.
 */
interface ProviderPayment {
  _id: string; // gatewayRef
  orderId: string;
  amountRial: number;
  outcome: 'pending' | 'success' | 'failed' | 'unknown';
  providerRef: string | null;
  refunds: Array<{ idempotencyKey: string; amountRial: number; refundRef: string }>;
  returnUrl: string;
  createdAt: string;
}

export function callbackSigningString(p: Omit<CallbackPayload, 'signature'>): string {
  return [p.gatewayRef, p.status, p.amountRial, p.orderId, p.merchantId, p.ts].join('|');
}

export class DevGatewayAdapter implements PaymentAdapter {
  readonly name = 'dev-gateway';
  readonly mode = 'development_double' as const;
  readonly capabilities = ['create', 'verify', 'refund', 'signed-callback', 'scenario-control'] as const;
  readonly merchantId = 'DEV-MERCHANT';
  private readonly col: Collection<ProviderPayment>;

  constructor(
    db: Db,
    private readonly secret: string,
    private readonly gatewayBaseUrl: string,
  ) {
    this.col = db.collection<ProviderPayment>('dev_gateway');
  }

  async health(): Promise<ProviderHealth> {
    return { kind: 'payment', adapter: this.name, mode: this.mode, status: 'ok', capabilities: [...this.capabilities], detail: 'test double: simulated Iranian PSP; no real money moves', checkedAt: new Date().toISOString() };
  }

  async createPayment(input: { orderId: string; amount: Money; description: string; callbackUrl: string }) {
    const gatewayRef = `devgw_${randomBytes(9).toString('hex')}`;
    await this.col.insertOne({ _id: gatewayRef, orderId: input.orderId, amountRial: input.amount.amount, outcome: 'pending', providerRef: null, refunds: [], returnUrl: input.callbackUrl, createdAt: new Date().toISOString() });
    return { gatewayRef, redirectUrl: `${this.gatewayBaseUrl}/api/v1/dev/gateway/${gatewayRef}` };
  }

  async verify(input: { gatewayRef: string; expectedAmount: Money; orderId: string }) {
    const p = await this.col.findOne({ _id: input.gatewayRef });
    if (!p || p.outcome === 'pending' || p.outcome === 'unknown') return { status: 'unknown' as const, providerRef: null, amount: null };
    if (p.orderId !== input.orderId || p.amountRial !== input.expectedAmount.amount) return { status: 'failed' as const, providerRef: null, amount: { amount: p.amountRial, currency: 'IRR' as const } };
    if (p.outcome === 'failed') return { status: 'failed' as const, providerRef: null, amount: null };
    return { status: 'verified' as const, providerRef: p.providerRef, amount: { amount: p.amountRial, currency: 'IRR' as const } };
  }

  async refund(input: { providerRef: string; amount: Money; reason: string; idempotencyKey: string }) {
    const p = await this.col.findOne({ providerRef: input.providerRef });
    if (!p || p.outcome !== 'success') return { status: 'rejected' as const, refundRef: null };
    const existing = p.refunds.find((r) => r.idempotencyKey === input.idempotencyKey);
    if (existing) return { status: 'accepted' as const, refundRef: existing.refundRef }; // provider-side idempotency
    const refunded = p.refunds.reduce((a, r) => a + r.amountRial, 0);
    if (refunded + input.amount.amount > p.amountRial) return { status: 'rejected' as const, refundRef: null };
    const refundRef = `devrf_${randomBytes(6).toString('hex')}`;
    await this.col.updateOne({ _id: p._id }, { $push: { refunds: { idempotencyKey: input.idempotencyKey, amountRial: input.amount.amount, refundRef } } });
    return { status: 'accepted' as const, refundRef };
  }

  verifyCallback(p: CallbackPayload): boolean {
    const expected = Buffer.from(this.sign(p));
    const given = Buffer.from(p.signature);
    return expected.length === given.length && timingSafeEqual(expected, given) && p.merchantId === this.merchantId;
  }

  private sign(p: Omit<CallbackPayload, 'signature'>): string {
    return createHmac('sha256', this.secret).update(callbackSigningString(p)).digest('hex');
  }

  // ---- development/test scenario control (never exposed in production)
  /** Moves the provider-side state and returns the callback the PSP would send. */
  async settle(gatewayRef: string, outcome: 'success' | 'failed' | 'unknown'): Promise<CallbackPayload | null> {
    const p = await this.col.findOne({ _id: gatewayRef });
    if (!p) return null;
    const providerRef = outcome === 'success' ? (p.providerRef ?? `devtx_${randomBytes(6).toString('hex')}`) : p.providerRef;
    await this.col.updateOne({ _id: gatewayRef }, { $set: { outcome, providerRef } });
    if (outcome === 'unknown') return null; // PSP stays silent: reconciliation must resolve it
    const base = { gatewayRef, status: outcome, amountRial: p.amountRial, orderId: p.orderId, merchantId: this.merchantId, ts: Date.now() } as const;
    return { ...base, signature: this.sign(base) };
  }

  /** Data for the development payment page (amount, order, where to send the browser back). */
  async describe(gatewayRef: string): Promise<{ orderId: string; amountRial: number; outcome: string; returnUrl: string } | null> {
    const p = await this.col.findOne({ _id: gatewayRef });
    return p ? { orderId: p.orderId, amountRial: p.amountRial, outcome: p.outcome, returnUrl: p.returnUrl } : null;
  }

  /** A callback with a forged signature (invalid-signature scenario). */
  forged(payload: CallbackPayload): CallbackPayload {
    return { ...payload, signature: 'f'.repeat(64) };
  }
}
