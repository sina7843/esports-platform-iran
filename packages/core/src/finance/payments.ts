import type { ClientSession } from 'mongodb';
import { DomainError, SITE_SCOPE, type Scope } from '@esp/contracts';
import type { Container } from '../container.js';
import type { CallbackPayload } from '../adapters/types.js';
import type { OrderDoc, PaymentDoc, ProductKind, RefundDoc } from '../db/collections-esp03.js';
import { newId } from '../ids.js';
import { Ledger } from './ledger.js';

/**
 * Orders, payments, PSP callbacks, reconciliation, refunds and manual payments (FIN-001..006/011/012).
 *
 * Trust model: the browser return is never proof of payment and neither is a callback by itself. A callback must
 * carry a valid signature AND the payment is then verified server-side with the provider (amount, currency,
 * order, merchant). Every state change is a conditional write on `version`/`state`, inside a transaction together
 * with ledger lines and an outbox event, so duplicate/late/out-of-order callbacks and concurrent clicks have a single
 * effect. Card data never touches the platform (FIN-012): the PSP hosts the payment page.
 */
const iso = () => new Date().toISOString();

export interface CreateOrderInput {
  kind: ProductKind;
  payerPrincipalId: string;
  items: OrderDoc['items'];
  refs: OrderDoc['refs'];
  productKey: string | null;
  discountCode: string | null;
  /** Account credited with the net amount (e.g. `payable:organization:<id>` for entry/ticket revenue). */
  creditAccount: string;
}

export class PaymentsService {
  readonly ledger: Ledger;
  constructor(private readonly ct: Container) {
    this.ledger = new Ledger(ct.c);
  }
  private get c() {
    return this.ct.c;
  }

  private async audit(actor: string, action: string, targetType: string, targetId: string, requestId: string, details: Record<string, unknown> = {}, scope: Scope = SITE_SCOPE, session?: ClientSession) {
    await this.ct.audit.append({ actorPrincipalId: actor, action, target: { type: targetType, id: targetId }, scope, outcome: 'success', details, requestId }, session);
  }

  // ------------------------------------------------------------------ orders
  /** Price and fee come from the active price list version at order time; later price changes never touch the order (FIN-011). */
  async createOrder(input: CreateOrderInput, session: ClientSession): Promise<OrderDoc> {
    const now = iso();
    const price = input.productKey ? await this.c.priceLists.findOne({ productKey: input.productKey, effectiveFrom: { $lte: now }, supersededAt: null }, { sort: { version: -1 }, session }) : null;
    const subtotal = input.items.reduce((a, i) => a + i.amountRial * i.quantity, 0);
    let discountRial = 0;
    if (input.discountCode) {
      const d = await this.c.discounts.findOneAndUpdate(
        { _id: input.discountCode, appliesTo: input.kind, $expr: { $lt: ['$used', '$maxUses'] }, $and: [{ $or: [{ validFrom: null }, { validFrom: { $lte: now } }] }, { $or: [{ validTo: null }, { validTo: { $gt: now } }] }] },
        { $inc: { used: 1 } },
        { returnDocument: 'after', session },
      );
      if (!d) throw new DomainError('PRECONDITION_FAILED', 'discount code is invalid, expired or used up');
      discountRial = d.kind === 'percent' ? Math.floor((subtotal * Math.min(d.value, 100)) / 100) : Math.min(d.value, subtotal);
    }
    const total = subtotal - discountRial;
    const feeRial = price ? Math.floor((total * price.feeBps) / 10_000) : 0;
    const order: OrderDoc = {
      _id: newId('ord'),
      kind: input.kind,
      payerPrincipalId: input.payerPrincipalId,
      items: input.items,
      priceListId: price?._id ?? null,
      priceVersion: price?.version ?? null,
      subtotalRial: subtotal,
      discountCode: input.discountCode,
      discountRial,
      feeRial,
      totalRial: total,
      refs: input.refs,
      state: 'open',
      receiptNo: null,
      createdAt: now,
      updatedAt: now,
      version: 0,
      creditAccount: input.creditAccount,
    };
    await this.c.orders.insertOne(order, { session });
    if (total === 0) await this.markOrderPaid(order._id, null, 'system', `free:${order._id}`, session);
    return order;
  }

  private async markOrderPaid(orderId: string, payment: PaymentDoc | null, actor: string, correlationId: string, session: ClientSession) {
    const order = await this.c.orders.findOneAndUpdate(
      { _id: orderId, state: { $in: ['open', 'expired'] } },
      { $set: { state: 'paid', receiptNo: `RC-${newId().slice(-12)}`, updatedAt: iso() }, $inc: { version: 1 } },
      { returnDocument: 'after', session },
    );
    if (!order) throw new DomainError('CONFLICT', 'order is not payable');
    if (payment && order.totalRial > 0) {
      const credit = order.creditAccount;
      const cash = payment.manual ? 'cash:manual' : `cash:psp:${payment.adapter}`;
      const lines = [{ account: cash, amountRial: order.totalRial }, { account: credit, amountRial: -(order.totalRial - order.feeRial) }];
      if (order.feeRial > 0) lines.push({ account: 'fee:platform', amountRial: -order.feeRial });
      await this.ledger.post({ lines, kind: payment.manual ? 'manual_payment' : 'payment', refs: { orderId, paymentId: payment._id }, reason: null, createdBy: actor }, session);
      if (order.discountRial > 0) {
        // memo lines: discount granted, kept for reporting without moving cash
        await this.ledger.post({ lines: [{ account: `discount:${order.discountCode}`, amountRial: order.discountRial }, { account: `discount:granted`, amountRial: -order.discountRial }], kind: 'discount', refs: { orderId }, reason: null, createdBy: actor }, session);
      }
    }
    await this.ct.outbox.append({ type: 'finance.order.paid', aggregate: { type: 'order', id: orderId }, aggregateVersion: order.version, actor: { principalId: actor, kind: actor === 'system' ? 'system' : 'user' }, payload: { orderId, kind: order.kind, refs: order.refs, paymentId: payment?._id ?? null, totalRial: order.totalRial }, correlationId }, session);
    return order;
  }

  async getOrder(orderId: string, actor: string, requestId: string): Promise<OrderDoc> {
    const o = await this.c.orders.findOne({ _id: orderId });
    if (!o) throw new DomainError('NOT_FOUND', 'order not found');
    if (o.payerPrincipalId !== actor) await this.ct.acl.require(actor, 'finance.read', SITE_SCOPE, requestId);
    return o;
  }

  // ------------------------------------------------------------------ pay
  async pay(orderId: string, actor: string, returnUrl: string, requestId: string): Promise<{ payment: PaymentDoc; redirectUrl: string | null }> {
    if (this.ct.adapters.payment.name === 'none') throw new DomainError('PROVIDER_NOT_CONFIGURED', 'no payment provider is configured');
    const order = await this.c.orders.findOne({ _id: orderId });
    if (!order) throw new DomainError('NOT_FOUND', 'order not found');
    if (order.payerPrincipalId !== actor) throw new DomainError('FORBIDDEN', 'only the payer can pay this order');
    if (order.state !== 'open') throw new DomainError('PRECONDITION_FAILED', `order is ${order.state}`);
    const existing = await this.c.payments.findOne({ orderId, state: { $in: ['created', 'awaiting_gateway', 'unknown'] } });
    if (existing) return { payment: existing, redirectUrl: existing.state === 'awaiting_gateway' ? `${this.ct.config.PUBLIC_API_ORIGIN}/api/v1/dev/gateway/${existing.gatewayRef}` : null };
    const now = new Date();
    const payment: PaymentDoc = {
      _id: newId('pay'),
      orderId,
      amountRial: order.totalRial,
      adapter: this.ct.adapters.payment.name,
      gatewayRef: null,
      providerRef: null,
      state: 'created',
      manual: null,
      refundedRial: 0,
      expiresAt: new Date(now.getTime() + this.ct.config.PAYMENT_TTL_MINUTES * 60_000).toISOString(),
      verifiedAt: null,
      lastError: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      version: 0,
    };
    try {
      await this.c.payments.insertOne(payment);
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return this.pay(orderId, actor, returnUrl, requestId); // a parallel click won; reuse it
      throw e;
    }
    try {
      const r = await this.ct.adapters.payment.createPayment({ orderId, amount: { amount: order.totalRial, currency: 'IRR' }, description: order.items.map((i) => i.description).join(' / ').slice(0, 200), callbackUrl: returnUrl });
      const updated = await this.c.payments.findOneAndUpdate({ _id: payment._id, state: 'created' }, { $set: { state: 'awaiting_gateway', gatewayRef: r.gatewayRef, updatedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' });
      await this.audit(actor, 'finance.payment.redirect', 'payment', payment._id, requestId, { orderId, amountRial: order.totalRial });
      return { payment: updated!, redirectUrl: r.redirectUrl };
    } catch (e) {
      await this.c.payments.updateOne({ _id: payment._id, state: 'created' }, { $set: { state: 'failed', lastError: (e as Error).message, updatedAt: iso() }, $inc: { version: 1 } });
      throw e instanceof DomainError ? e : new DomainError('PROVIDER_UNAVAILABLE', 'payment provider did not accept the payment');
    }
  }

  // ------------------------------------------------------------------ callbacks and verification
  async handleCallback(payload: CallbackPayload, requestId: string): Promise<{ outcome: string; paymentId: string | null }> {
    const adapter = this.ct.adapters.payment;
    if (adapter.name === 'none') throw new DomainError('PROVIDER_NOT_CONFIGURED', 'no payment provider is configured');
    const signatureValid = adapter.verifyCallback(payload);
    const log = { _id: newId('cb'), gatewayRef: payload.gatewayRef, receivedAt: iso(), signatureValid, payload: { ...payload } as Record<string, unknown>, outcome: 'rejected' as const };
    if (!signatureValid) {
      await this.c.gatewayCallbacks.insertOne(log);
      await this.ct.audit.append({ actorPrincipalId: 'system:psp', action: 'finance.callback.invalid_signature', target: { type: 'payment', id: payload.gatewayRef }, scope: SITE_SCOPE, outcome: 'denied', details: { orderId: payload.orderId }, requestId });
      throw new DomainError('FORBIDDEN', 'invalid callback signature');
    }
    const payment = await this.c.payments.findOne({ gatewayRef: payload.gatewayRef });
    if (!payment) {
      await this.c.gatewayCallbacks.insertOne({ ...log, outcome: 'unknown_ref' });
      return { outcome: 'unknown_ref', paymentId: null };
    }
    const outcome = await this.verifyWithProvider(payment._id, 'system:psp', requestId);
    await this.c.gatewayCallbacks.insertOne({ ...log, outcome: outcome === 'already_final' ? 'duplicate' : outcome === 'provider_disagrees' ? 'out_of_order' : 'applied' });
    return { outcome, paymentId: payment._id };
  }

  /** Server-side verification with the provider. Idempotent; safe to call from callback, browser return and reconciliation. */
  async verifyWithProvider(paymentId: string, actor: string, requestId: string): Promise<'verified' | 'failed' | 'unknown' | 'already_final' | 'provider_disagrees'> {
    const p = await this.c.payments.findOne({ _id: paymentId });
    if (!p || !p.gatewayRef) return 'unknown';
    const r = await this.ct.adapters.payment.verify({ gatewayRef: p.gatewayRef, expectedAmount: { amount: p.amountRial, currency: 'IRR' }, orderId: p.orderId });
    if (['verified', 'awaiting_refund', 'refunded_partial', 'refunded_full'].includes(p.state)) return 'already_final';
    if (p.state === 'failed') {
      if (r.status === 'verified') {
        // provider took money for a payment we consider failed: never silently drop it — reconciliation queue
        await this.c.payments.updateOne({ _id: p._id, state: 'failed' }, { $set: { lastError: 'provider_verified_after_failure', providerRef: r.providerRef, updatedAt: iso() } });
        return 'provider_disagrees';
      }
      return 'already_final';
    }
    if (r.status === 'verified') {
      if (!r.amount || r.amount.amount !== p.amountRial || r.amount.currency !== 'IRR') {
        await this.failPayment(p, 'amount_mismatch', actor, requestId);
        return 'failed';
      }
      return this.ct.dbh.withTransaction(async (session) => {
        const updated = await this.c.payments.findOneAndUpdate(
          { _id: p._id, version: p.version, state: { $in: ['awaiting_gateway', 'unknown'] } },
          { $set: { state: 'verified', providerRef: r.providerRef, verifiedAt: iso(), updatedAt: iso(), lastError: null }, $inc: { version: 1 } },
          { returnDocument: 'after', session },
        );
        if (!updated) return 'already_final' as const; // a concurrent callback/reconciliation applied it first
        await this.markOrderPaid(p.orderId, updated, actor, requestId, session);
        await this.audit(actor, 'finance.payment.verified', 'payment', p._id, requestId, { orderId: p.orderId, amountRial: p.amountRial, providerRef: r.providerRef }, SITE_SCOPE, session);
        return 'verified' as const;
      });
    }
    if (r.status === 'failed') {
      await this.failPayment(p, 'provider_failed', actor, requestId);
      return 'failed';
    }
    if (p.state === 'awaiting_gateway') await this.c.payments.updateOne({ _id: p._id, version: p.version, state: 'awaiting_gateway' }, { $set: { state: 'unknown', updatedAt: iso() }, $inc: { version: 1 } });
    return 'unknown';
  }

  private async failPayment(p: PaymentDoc, reason: string, actor: string, requestId: string) {
    const r = await this.c.payments.updateOne({ _id: p._id, version: p.version, state: { $in: ['created', 'awaiting_gateway', 'unknown'] } }, { $set: { state: 'failed', lastError: reason, updatedAt: iso() }, $inc: { version: 1 } });
    if (r.modifiedCount) {
      await this.audit(actor, 'finance.payment.failed', 'payment', p._id, requestId, { reason });
      await this.ct.outbox.append({ type: 'finance.payment.failed', aggregate: { type: 'payment', id: p._id }, aggregateVersion: p.version + 1, actor: { principalId: actor, kind: 'system' }, payload: { orderId: p.orderId, reason }, correlationId: requestId });
    }
  }

  /** Browser return: only triggers server-side verification and reports the resulting state. */
  async paymentStatus(paymentId: string, actor: string, requestId: string): Promise<PaymentDoc> {
    const p = await this.c.payments.findOne({ _id: paymentId });
    if (!p) throw new DomainError('NOT_FOUND', 'payment not found');
    const order = await this.c.orders.findOne({ _id: p.orderId });
    if (order?.payerPrincipalId !== actor) await this.ct.acl.require(actor, 'finance.read', SITE_SCOPE, requestId);
    if (['awaiting_gateway', 'unknown'].includes(p.state)) await this.verifyWithProvider(p._id, actor, requestId);
    return (await this.c.payments.findOne({ _id: paymentId }))!;
  }

  // ------------------------------------------------------------------ reconciliation (FIN-004)
  async reconcile(now = new Date(), requestId = `reconcile:${now.toISOString()}`): Promise<{ checked: number; verified: number; failed: number; unknown: number; refundsRetried: number }> {
    const due = await this.c.payments.find({ $or: [{ state: 'unknown' }, { state: 'awaiting_gateway', expiresAt: { $lt: now.toISOString() } }, { state: 'failed', updatedAt: { $gt: new Date(now.getTime() - 86_400_000).toISOString() }, lastError: { $ne: 'provider_verified_after_failure' } }] }).limit(500).toArray();
    const res = { checked: due.length, verified: 0, failed: 0, unknown: 0, refundsRetried: 0 };
    for (const p of due) {
      const o = await this.verifyWithProvider(p._id, 'system:reconcile', requestId);
      if (o === 'verified') res.verified++;
      else if (o === 'failed') res.failed++;
      else if (o === 'unknown') res.unknown++;
    }
    for (const r of await this.c.refunds.find({ state: 'sent' }).limit(200).toArray()) {
      await this.executeRefund(r._id, 'system:reconcile', requestId);
      res.refundsRetried++;
    }
    return res;
  }

  /** Money without a final disposition stays visible here until a finance officer resolves it. */
  async reconciliationQueue(actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'finance.read', SITE_SCOPE, requestId);
    const [unknown, disagreements, refunds, unallocated] = await Promise.all([
      this.c.payments.find({ state: { $in: ['unknown', 'awaiting_gateway'] } }).sort({ createdAt: 1 }).limit(200).toArray(),
      this.c.payments.find({ lastError: 'provider_verified_after_failure' }).limit(200).toArray(),
      this.c.refunds.find({ state: { $in: ['requested', 'sent', 'failed', 'awaiting_approval'] } }).limit(200).toArray(),
      this.c.registrations.find({ state: 'awaiting_capacity', orderId: { $ne: null } }).limit(200).toArray(),
    ]);
    const paidUnallocated = [];
    for (const r of unallocated) {
      const o = await this.c.orders.findOne({ _id: r.orderId!, state: 'paid' });
      if (o) paidUnallocated.push({ registrationId: r._id, orderId: o._id, totalRial: o.totalRial });
    }
    return { unknownPayments: unknown, providerVerifiedAfterFailure: disagreements, openRefunds: refunds, paidWithoutCapacity: paidUnallocated };
  }

  // ------------------------------------------------------------------ refunds (FIN-006)
  async requestRefund(
    input: { paymentId: string; amountRial: number; reason: RefundDoc['reason']; idempotencyKey: string; approvalId: string | null; evidenceFileId: string | null },
    actor: string,
    requestId: string,
    opts: { system?: boolean } = {},
  ): Promise<RefundDoc> {
    if (!opts.system) await this.ct.acl.require(actor, 'finance.refund', SITE_SCOPE, requestId);
    const dup = await this.c.refunds.findOne({ idempotencyKey: input.idempotencyKey });
    if (dup) {
      if (dup.paymentId !== input.paymentId || dup.amountRial !== input.amountRial) throw new DomainError('CONFLICT', 'idempotency key reused with different parameters');
      return dup; // FIN-004: a repeated refund request has no second effect
    }
    if (!opts.system && input.amountRial >= this.ct.config.REFUND_APPROVAL_THRESHOLD_RIAL) {
      if (!input.approvalId) throw new DomainError('PRECONDITION_FAILED', 'refund above threshold needs an independent approval', { secondApproval: true });
      await this.ct.approvals.consume(input.approvalId, 'finance.refund.large', SITE_SCOPE, { principalId: actor, requestId });
    }
    let refund: RefundDoc;
    try {
      refund = await this.ct.dbh.withTransaction(async (session) => {
      const p = await this.c.payments.findOneAndUpdate(
        { _id: input.paymentId, state: { $in: ['verified', 'refunded_partial', 'awaiting_refund'] }, $expr: { $lte: [{ $add: ['$refundedRial', input.amountRial] }, '$amountRial'] } },
        { $inc: { refundedRial: input.amountRial, version: 1 }, $set: { state: 'awaiting_refund', updatedAt: iso() } },
        { returnDocument: 'after', session },
      );
      if (!p) throw new DomainError('PRECONDITION_FAILED', 'payment is not refundable for this amount');
      if (p.manual && !input.evidenceFileId) throw new DomainError('PRECONDITION_FAILED', 'refunding a manual payment requires evidence of the transfer');
      const doc: RefundDoc = { _id: newId('rfd'), paymentId: p._id, orderId: p.orderId, amountRial: input.amountRial, reason: input.reason, idempotencyKey: input.idempotencyKey, state: 'requested', approvalId: input.approvalId, providerRef: input.evidenceFileId ? `manual:${input.evidenceFileId}` : null, requestedBy: actor, createdAt: iso(), updatedAt: iso(), version: 0 };
      await this.c.refunds.insertOne(doc, { session });
      await this.audit(actor, 'finance.refund.requested', 'refund', doc._id, requestId, { paymentId: p._id, amountRial: input.amountRial, reason: input.reason }, SITE_SCOPE, session);
      return doc;
      });
    } catch (err) {
      // a concurrent request with the same idempotency key won the unique index; its transaction rolled back ours
      if ((err as { code?: number }).code !== 11000) throw err;
      const winner = await this.c.refunds.findOne({ idempotencyKey: input.idempotencyKey });
      if (!winner || winner.paymentId !== input.paymentId || winner.amountRial !== input.amountRial) throw new DomainError('CONFLICT', 'idempotency key reused with different parameters');
      return winner;
    }
    await this.executeRefund(refund._id, actor, requestId);
    return (await this.c.refunds.findOne({ _id: refund._id }))!;
  }

  /** Sends (or re-sends, idempotently) a requested refund and applies the provider's answer. */
  async executeRefund(refundId: string, actor: string, requestId: string): Promise<void> {
    const r = await this.c.refunds.findOne({ _id: refundId });
    if (!r || !['requested', 'sent'].includes(r.state)) return;
    const p = (await this.c.payments.findOne({ _id: r.paymentId }))!;
    let status: 'accepted' | 'rejected' | 'unknown';
    let ref: string | null = r.providerRef;
    if (p.manual) status = 'accepted'; // executed outside the PSP; evidence recorded in providerRef
    else {
      const res = await this.ct.adapters.payment.refund({ providerRef: p.providerRef!, amount: { amount: r.amountRial, currency: 'IRR' }, reason: r.reason, idempotencyKey: r.idempotencyKey }).catch(() => ({ status: 'unknown' as const, refundRef: null }));
      status = res.status;
      ref = res.refundRef ?? ref;
    }
    if (status === 'unknown') {
      await this.c.refunds.updateOne({ _id: r._id, state: 'requested' }, { $set: { state: 'sent', updatedAt: iso() }, $inc: { version: 1 } });
      return;
    }
    await this.ct.dbh.withTransaction(async (session) => {
      const done = await this.c.refunds.findOneAndUpdate({ _id: r._id, state: { $in: ['requested', 'sent'] } }, { $set: { state: status === 'accepted' ? 'confirmed' : 'failed', providerRef: ref, updatedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after', session });
      if (!done) return;
      const pay = (await this.c.payments.findOne({ _id: r.paymentId }, { session }))!;
      const order = (await this.c.orders.findOne({ _id: r.orderId }, { session }))!;
      if (status === 'accepted') {
        const full = pay.refundedRial >= pay.amountRial;
        const pending = await this.c.refunds.countDocuments({ paymentId: pay._id, state: { $in: ['requested', 'sent'] }, _id: { $ne: r._id } }, { session });
        await this.c.payments.updateOne({ _id: pay._id }, { $set: { state: pending ? 'awaiting_refund' : full ? 'refunded_full' : 'refunded_partial', updatedAt: iso() }, $inc: { version: 1 } }, { session });
        await this.c.orders.updateOne({ _id: order._id }, { $set: { state: full ? 'refunded' : 'partially_refunded', updatedAt: iso() }, $inc: { version: 1 } }, { session });
        const credit = order.creditAccount;
        await this.ledger.post({ lines: [{ account: credit, amountRial: r.amountRial }, { account: pay.manual ? 'cash:manual' : `cash:psp:${pay.adapter}`, amountRial: -r.amountRial }], kind: 'refund', refs: { orderId: order._id, paymentId: pay._id, refundId: r._id }, reason: r.reason, createdBy: actor }, session);
        await this.ct.outbox.append({ type: 'finance.refund.confirmed', aggregate: { type: 'order', id: order._id }, aggregateVersion: order.version + 1, actor: { principalId: actor, kind: 'system' }, payload: { refundId: r._id, orderId: order._id, amountRial: r.amountRial, refs: order.refs }, correlationId: requestId }, session);
      } else {
        // compensation: give the reserved amount back and restore the previous payment state
        const remaining = pay.refundedRial - r.amountRial;
        await this.c.payments.updateOne({ _id: pay._id }, { $inc: { refundedRial: -r.amountRial, version: 1 }, $set: { state: remaining > 0 ? 'refunded_partial' : 'verified', updatedAt: iso() } }, { session });
      }
      await this.audit(actor, status === 'accepted' ? 'finance.refund.confirmed' : 'finance.refund.failed', 'refund', r._id, requestId, { amountRial: r.amountRial, providerRef: ref }, SITE_SCOPE, session);
    });
  }

  /** Full refund of whatever is still refundable on an order's verified payment (used by cancellations/withdrawals). */
  async refundOrder(orderId: string, percent: number, reason: RefundDoc['reason'], idempotencyKey: string, actor: string, requestId: string): Promise<RefundDoc | null> {
    const pay = await this.c.payments.findOne({ orderId, state: { $in: ['verified', 'refunded_partial'] } });
    if (!pay) return null;
    const amount = Math.floor(((pay.amountRial - pay.refundedRial) * percent) / 100);
    if (amount <= 0) return null;
    return this.requestRefund({ paymentId: pay._id, amountRial: amount, reason, idempotencyKey, approvalId: null, evidenceFileId: null }, actor, requestId, { system: true });
  }

  // ------------------------------------------------------------------ manual payments (FIN-005)
  async recordManualPayment(input: { orderId: string; evidenceFileId: string; approvalId: string; note: string }, actor: string, requestId: string): Promise<PaymentDoc> {
    await this.ct.acl.require(actor, 'finance.read', SITE_SCOPE, requestId);
    const file = await this.ct.files.get(input.evidenceFileId);
    if (!file || file.quarantined || file.visibility !== 'private') throw new DomainError('PRECONDITION_FAILED', 'evidence must be a clean private file');
    await this.ct.approvals.consume(input.approvalId, 'finance.manual_payment', SITE_SCOPE, { principalId: actor, requestId });
    return this.ct.dbh.withTransaction(async (session) => {
      const order = await this.c.orders.findOne({ _id: input.orderId, state: { $in: ['open', 'expired'] } }, { session });
      if (!order) throw new DomainError('PRECONDITION_FAILED', 'order is not payable');
      const p: PaymentDoc = { _id: newId('pay'), orderId: order._id, amountRial: order.totalRial, adapter: 'manual', gatewayRef: null, providerRef: `manual:${input.evidenceFileId}`, state: 'verified', manual: { evidenceFileId: input.evidenceFileId, approvalId: input.approvalId, label: 'manual', recordedBy: actor }, refundedRial: 0, expiresAt: iso(), verifiedAt: iso(), lastError: null, createdAt: iso(), updatedAt: iso(), version: 0 };
      await this.c.payments.insertOne(p, { session });
      await this.markOrderPaid(order._id, p, actor, requestId, session);
      await this.audit(actor, 'finance.payment.manual', 'payment', p._id, requestId, { orderId: order._id, note: input.note, evidenceFileId: input.evidenceFileId }, SITE_SCOPE, session);
      return p;
    });
  }
}

