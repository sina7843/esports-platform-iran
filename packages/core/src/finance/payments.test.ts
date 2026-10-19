import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testContainer, rid } from '../test/harness.js';
import { seedIds } from '../db/seed-ids.js';
import { PaymentsService } from './payments.js';
import type { DevGatewayAdapter } from '../adapters/devGateway.js';
import type { CallbackPayload } from '../adapters/types.js';

let t: Awaited<ReturnType<typeof testContainer>>;
let pay: PaymentsService;
let gw: DevGatewayAdapter;
beforeAll(async () => {
  t = await testContainer({ seed: true });
  pay = new PaymentsService(t);
  gw = t.adapters.payment as unknown as DevGatewayAdapter;
});
afterAll(async () => {
  await t.drop();
});

const payer = seedIds.player;
async function order(amount = 500_000, discountCode: string | null = null) {
  return t.dbh.withTransaction((s) => pay.createOrder({ kind: 'entry', payerPrincipalId: payer, items: [{ productKey: 'entry:x', description: 'entry', amountRial: amount, quantity: 1 }], refs: {}, productKey: null, discountCode, creditAccount: 'payable:organization:org_seed_a' }, s));
}
async function started(amount = 500_000) {
  const o = await order(amount);
  const r = await pay.pay(o._id, payer, 'http://localhost/return', rid());
  return { o, p: r.payment };
}
async function ledgerFor(orderId: string) {
  return t.c.ledger.find({ 'refs.orderId': orderId, kind: { $in: ['payment', 'refund', 'manual_payment'] } }).toArray();
}

describe('payments (FIN-002/004, AC-04)', () => {
  it('verifies a signed callback server-side, marks the order paid once and writes a balanced ledger', async () => {
    const { o, p } = await started();
    const cb = (await gw.settle(p.gatewayRef!, 'success'))!;
    expect((await pay.handleCallback(cb, rid())).outcome).toBe('verified');
    // duplicate callback (AC-04): no second effect
    expect((await pay.handleCallback(cb, rid())).outcome).toBe('already_final');
    expect((await t.c.orders.findOne({ _id: o._id }))?.state).toBe('paid');
    const lines = await ledgerFor(o._id);
    expect(lines.length).toBe(2);
    expect(lines.reduce((a, l) => a + l.amountRial, 0)).toBe(0);
    expect(await pay.ledger.unbalancedTransactions()).toEqual([]);
    expect(await t.c.outbox.countDocuments({ type: 'finance.order.paid', 'payload.orderId': o._id })).toBe(1);
  });

  it('rejects a forged callback signature, audits it and changes nothing', async () => {
    const { o, p } = await started();
    const cb = (await gw.settle(p.gatewayRef!, 'success'))!;
    await expect(pay.handleCallback(gw.forged(cb), rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await t.c.payments.findOne({ _id: p._id }))?.state).toBe('awaiting_gateway');
    expect((await t.c.orders.findOne({ _id: o._id }))?.state).toBe('open');
    expect(await t.c.audit.countDocuments({ action: 'finance.callback.invalid_signature', 'target.id': p.gatewayRef! })).toBe(1);
  });

  it('a callback claiming success is not trusted when the provider has not settled (server-side verify)', async () => {
    const { o, p } = await started();
    const real = (await gw.settle(p.gatewayRef!, 'success'))!;
    await gw.settle(p.gatewayRef!, 'unknown'); // provider rolled back to pending/unknown
    const outcome = await pay.handleCallback(real, rid());
    expect(outcome.outcome).toBe('unknown');
    expect((await t.c.orders.findOne({ _id: o._id }))?.state).toBe('open');
  });

  it('browser return alone never confirms; reconciliation resolves unknown and late outcomes', async () => {
    const { o, p } = await started();
    expect((await pay.paymentStatus(p._id, payer, rid())).state).toBe('unknown'); // provider still pending
    // payment window passed, provider still silent: stays visible in the queue
    await t.c.payments.updateOne({ _id: p._id }, { $set: { expiresAt: new Date(Date.now() - 1000).toISOString() } });
    await pay.reconcile();
    const queue = await pay.reconciliationQueue(seedIds.finance, rid());
    expect(queue.unknownPayments.map((x) => x._id)).toContain(p._id);
    // late success at the provider: reconciliation applies it exactly once
    await gw.settle(p.gatewayRef!, 'success');
    expect((await pay.reconcile()).verified).toBeGreaterThanOrEqual(1);
    await pay.reconcile();
    expect((await t.c.orders.findOne({ _id: o._id }))?.state).toBe('paid');
    expect((await ledgerFor(o._id)).length).toBe(2);
  });

  it('out-of-order callbacks: a failure after success is ignored; success after failure goes to the reconciliation queue', async () => {
    const a = await started();
    const ok = (await gw.settle(a.p.gatewayRef!, 'success'))!;
    await pay.handleCallback(ok, rid());
    const failLate = (await gw.settle(a.p.gatewayRef!, 'failed'))!;
    await pay.handleCallback(failLate, rid());
    expect((await t.c.payments.findOne({ _id: a.p._id }))?.state).toBe('verified');

    const b = await started();
    await pay.handleCallback((await gw.settle(b.p.gatewayRef!, 'failed'))!, rid());
    expect((await t.c.payments.findOne({ _id: b.p._id }))?.state).toBe('failed');
    const late = (await gw.settle(b.p.gatewayRef!, 'success'))!;
    expect((await pay.handleCallback(late, rid())).outcome).toBe('provider_disagrees');
    const q = await pay.reconciliationQueue(seedIds.finance, rid());
    expect(q.providerVerifiedAfterFailure.map((x) => x._id)).toContain(b.p._id);
  });

  it('parallel "pay" clicks create a single in-flight payment', async () => {
    const o = await order();
    const [x, y] = await Promise.all([pay.pay(o._id, payer, 'http://localhost/r', rid()), pay.pay(o._id, payer, 'http://localhost/r', rid())]);
    expect(x.payment._id).toBe(y.payment._id);
    expect(await t.c.payments.countDocuments({ orderId: o._id })).toBe(1);
    await expect(pay.pay(o._id, seedIds.captain, 'http://localhost/r', rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('discounts are atomic and capped by max uses; zero totals are paid without a gateway', async () => {
    await t.c.discounts.insertOne({ _id: 'FREE1', kind: 'percent', value: 100, appliesTo: ['entry'], maxUses: 1, used: 0, validFrom: null, validTo: null, createdBy: 'x', createdAt: new Date().toISOString() });
    const results = await Promise.allSettled([order(100_000, 'FREE1'), order(100_000, 'FREE1')]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    const ok = results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof order>>>;
    expect((await t.c.orders.findOne({ _id: ok.value._id }))?.state).toBe('paid');
  });
});

describe('refunds (FIN-006, FIN-004)', () => {
  async function paid(amount = 1_000_000) {
    const { o, p } = await started(amount);
    await pay.handleCallback((await gw.settle(p.gatewayRef!, 'success')) as CallbackPayload, rid());
    return { o, p };
  }

  it('a repeated partial refund with the same key has one effect; totals can never exceed the payment', async () => {
    const { o, p } = await paid();
    const req = { paymentId: p._id, amountRial: 300_000, reason: 'withdrawal' as const, idempotencyKey: 'rf-key-0001', approvalId: null, evidenceFileId: null };
    // both concurrent calls must succeed idempotently and point at the same refund
    const [r1, r2] = await Promise.all([pay.requestRefund(req, seedIds.finance, rid()), pay.requestRefund(req, seedIds.finance, rid())]);
    expect(r1._id).toBe(r2._id);
    expect((await t.c.refunds.findOne({ _id: r1._id }))?.state).toBe('confirmed');
    expect(await t.c.refunds.countDocuments({ paymentId: p._id })).toBe(1);
    await pay.requestRefund({ ...req, idempotencyKey: 'rf-key-0002', amountRial: 700_000 }, seedIds.finance, rid());
    await expect(pay.requestRefund({ ...req, idempotencyKey: 'rf-key-0003', amountRial: 1 }, seedIds.finance, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect((await t.c.payments.findOne({ _id: p._id }))?.state).toBe('refunded_full');
    expect((await t.c.orders.findOne({ _id: o._id }))?.state).toBe('refunded');
    const lines = await ledgerFor(o._id);
    expect(lines.reduce((a, l) => a + l.amountRial, 0)).toBe(0);
    expect(lines.filter((l) => l.kind === 'refund').length).toBe(4);
  });

  it('concurrent different refunds cannot over-refund', async () => {
    const { p } = await paid(1_000_000);
    const reqs = [1, 2, 3].map((i) => pay.requestRefund({ paymentId: p._id, amountRial: 400_000, reason: 'manual', idempotencyKey: `race-${p._id}-${i}`, approvalId: null, evidenceFileId: null }, seedIds.finance, rid()).catch((e) => e));
    const res = await Promise.all(reqs);
    expect(res.filter((r) => r.state === 'confirmed').length).toBe(2);
    expect((await t.c.payments.findOne({ _id: p._id }))?.refundedRial).toBe(800_000);
  });

  it('refunds need finance permission; large refunds need an independent approval', async () => {
    const { p } = await paid(t.config.REFUND_APPROVAL_THRESHOLD_RIAL + 10);
    const req = { paymentId: p._id, amountRial: t.config.REFUND_APPROVAL_THRESHOLD_RIAL, reason: 'manual' as const, idempotencyKey: `big-${p._id}`, approvalId: null, evidenceFileId: null };
    await expect(pay.requestRefund(req, seedIds.referee, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(pay.requestRefund(req, seedIds.finance, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const a = await t.approvals.request({ action: 'finance.refund.large', scope: { type: 'site', id: 'site' }, payload: { paymentId: p._id }, reason: 'customer request' }, { principalId: seedIds.finance, requestId: rid() });
    await t.approvals.decide(a._id, { decision: 'approve', reason: 'ok', expectedVersion: 0 }, { principalId: seedIds.finance2, requestId: rid() });
    expect((await pay.requestRefund({ ...req, approvalId: a._id }, seedIds.finance, rid())).state).toBe('confirmed');
  });
});

describe('manual payments (FIN-005)', () => {
  it('require an approved independent approval and clean private evidence, and are labelled manual', async () => {
    const o = await order(200_000);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 3)]);
    const f = await t.files.upload({ data: png, originalName: 'receipt.png', declaredMime: 'image/png', visibility: 'private', scope: { type: 'site', id: 'site' }, retentionClass: 'dispute_evidence' }, { principalId: seedIds.admin, requestId: rid() });
    const a = await t.approvals.request({ action: 'finance.manual_payment', scope: { type: 'site', id: 'site' }, payload: { orderId: o._id }, reason: 'bank transfer' }, { principalId: seedIds.finance, requestId: rid() });
    await expect(pay.recordManualPayment({ orderId: o._id, evidenceFileId: f._id, approvalId: a._id, note: 'transfer' }, seedIds.finance, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' }); // not yet approved
    await t.approvals.decide(a._id, { decision: 'approve', reason: 'checked bank statement', expectedVersion: 0 }, { principalId: seedIds.finance2, requestId: rid() });
    const p = await pay.recordManualPayment({ orderId: o._id, evidenceFileId: f._id, approvalId: a._id, note: 'transfer' }, seedIds.finance, rid());
    expect(p.manual?.label).toBe('manual');
    expect((await t.c.orders.findOne({ _id: o._id }))?.state).toBe('paid');
    expect((await ledgerFor(o._id)).map((l) => l.account)).toContain('cash:manual');
  });
});
