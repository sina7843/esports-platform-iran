import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  DiscountCreateSchema,
  DomainError,
  ErrorResponse,
  GatewayCallbackSchema,
  ManualPaymentSchema,
  PaySchema,
  PriceListCreateSchema,
  PrizeConfirmPaidSchema,
  PrizePayoutSchema,
  PrizeRecipientSchema,
  PrizeReleaseSchema,
  RefundRequestSchema,
  SITE_SCOPE,
  SponsorPlacementSchema,
  SubscriptionCreateSchema,
  TicketCreateSchema,
  formatToman,
} from '@esp/contracts';
import { CommerceService, PaymentsService, PrizeService, type Container, type DevGatewayAdapter, type OrderDoc, type PaymentDoc } from '@esp/core';

/** Orders, payments, refunds, prizes, subscriptions, tickets, sponsors, reports (FIN-001..012). */
const Id = z.object({ id: z.string().min(1).max(64) });
const Out = z.record(z.string(), z.unknown());
/** Domain documents are returned as plain JSON records (fields are explicit projections or non-sensitive finance docs). */
const plain = <T extends object>(x: T): Record<string, unknown> => x as unknown as Record<string, unknown>;
const plainAll = <T extends object>(xs: T[]): Array<Record<string, unknown>> => xs.map(plain);
const orderOut = (o: OrderDoc, payments: PaymentDoc[] = []) => ({
  id: o._id, kind: o.kind, items: o.items, subtotalRial: o.subtotalRial, discountCode: o.discountCode, discountRial: o.discountRial, feeRial: o.feeRial, totalRial: o.totalRial,
  priceVersion: o.priceVersion, refs: o.refs, state: o.state, receiptNo: o.receiptNo, createdAt: o.createdAt, version: o.version,
  payments: payments.map((p) => ({ id: p._id, state: p.state, amountRial: p.amountRial, manual: !!p.manual, refundedRial: p.refundedRial, verifiedAt: p.verifiedAt, createdAt: p.createdAt })),
});

export function financeRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const payments = new PaymentsService(container);
  const prizes = new PrizeService(container);
  const commerce = new CommerceService(container);
  const errors = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 412: ErrorResponse, 503: ErrorResponse };
  const me = (req: { requireAuth(): { principal: { _id: string } } }) => req.requireAuth().principal._id;

  // ---- orders and payments
  r.get('/orders/:id', { schema: { tags: ['finance'], params: Id, response: { 200: Out, ...errors } } }, async (req) => {
    const o = await payments.getOrder(req.params.id, me(req), req.id);
    return orderOut(o, await container.c.payments.find({ orderId: o._id }).sort({ createdAt: -1 }).toArray());
  });
  r.get('/me/orders', { schema: { tags: ['finance'], response: { 200: z.object({ items: z.array(Out) }) } } }, async (req) => ({ items: (await container.c.orders.find({ payerPrincipalId: me(req) }).sort({ createdAt: -1 }).limit(100).toArray()).map((o) => orderOut(o)) }));
  r.post('/orders/:id/pay', { schema: { tags: ['finance'], params: Id, body: PaySchema, response: { 200: z.object({ paymentId: z.string(), redirectUrl: z.string().nullable() }), ...errors } } }, async (req) => {
    // the PSP sends the browser back only to our own web origin (no open redirect)
    if (!req.body.returnUrl.startsWith(container.config.PUBLIC_WEB_ORIGIN + '/')) throw new DomainError('VALIDATION_FAILED', 'return URL must be on the platform web origin');
    const res = await payments.pay(req.params.id, me(req), req.body.returnUrl, req.id);
    return { paymentId: res.payment._id, redirectUrl: res.redirectUrl };
  });
  /** Browser return: triggers server-side verification; the browser is never proof of payment (FIN-002). */
  r.post('/payments/:id/verify', { schema: { tags: ['finance'], params: Id, response: { 200: z.object({ id: z.string(), state: z.string(), orderId: z.string() }), ...errors } } }, async (req) => {
    const p = await payments.paymentStatus(req.params.id, me(req), req.id);
    return { id: p._id, state: p.state, orderId: p.orderId };
  });
  /** PSP server-to-server callback: signature + server-side verify; idempotent. */
  r.post('/payments/callback', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } }, schema: { tags: ['finance'], body: GatewayCallbackSchema, response: { 200: z.object({ outcome: z.string() }), ...errors } } }, async (req) => {
    const res = await payments.handleCallback(req.body, req.id);
    return { outcome: res.outcome };
  });

  // ---- development-only simulated PSP page (never registered in production)
  if (!container.config.isProduction && container.adapters.payment.name === 'dev-gateway') {
    const gw = container.adapters.payment as unknown as DevGatewayAdapter;
    app.get('/dev/gateway/:ref', async (req, reply) => {
      const ref = (req.params as { ref: string }).ref;
      const d = await gw.describe(ref);
      if (!d) throw new DomainError('NOT_FOUND', 'unknown payment');
      const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      const link = (o: string, label: string) => `<a class="b" href="/api/v1/dev/gateway/${encodeURIComponent(ref)}/settle?outcome=${o}">${label}</a>`;
      return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(`<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>درگاه آزمایشی</title><style>body{font-family:system-ui;max-width:28rem;margin:2rem auto;padding:1rem}.w{background:#fff4e5;color:#7a4100;padding:.75rem;border-radius:.5rem}.b{display:block;margin:.5rem 0;padding:.75rem;border:1px solid #888;border-radius:.5rem;text-align:center;text-decoration:none;color:inherit}</style><h1>درگاه پرداخت آزمایشی</h1><p class="w">TEST ONLY — این صفحه شبیه‌ساز توسعه است و هیچ پولی جابه‌جا نمی‌شود.</p><p>مبلغ: <strong>${esc(formatToman(d.amountRial, 'fa'))}</strong></p><p>سفارش: <bdi>${esc(d.orderId)}</bdi></p>${link('success', 'پرداخت موفق')}${link('failed', 'پرداخت ناموفق')}${link('unknown', 'بدون پاسخ (وضعیت نامعلوم)')}</html>`);
    });
    app.get('/dev/gateway/:ref/settle', async (req, reply) => {
      const ref = (req.params as { ref: string }).ref;
      const outcome = (req.query as { outcome?: string }).outcome;
      if (outcome !== 'success' && outcome !== 'failed' && outcome !== 'unknown') throw new DomainError('VALIDATION_FAILED', 'bad outcome');
      const d = await gw.describe(ref);
      if (!d) throw new DomainError('NOT_FOUND', 'unknown payment');
      const cb = await gw.settle(ref, outcome);
      if (cb) await payments.handleCallback(cb, req.id); // what the PSP would POST server-to-server
      const back = new URL(d.returnUrl);
      back.searchParams.set('order', d.orderId);
      return reply.redirect(back.toString(), 303);
    });
  }

  // ---- reconciliation (FIN-004)
  r.get('/finance/reconciliation', { schema: { tags: ['finance'], response: { 200: Out, ...errors } } }, async (req) => plain(await payments.reconciliationQueue(me(req), req.id)));
  r.post('/finance/reconciliation/run', { schema: { tags: ['finance'], response: { 200: Out, ...errors } } }, async (req) => {
    await req.requirePermission('finance.read', SITE_SCOPE);
    return plain(await payments.reconcile(new Date(), req.id));
  });

  // ---- refunds and manual payments (FIN-005/006)
  r.post('/payments/:id/refunds', { schema: { tags: ['finance'], params: Id, body: RefundRequestSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await payments.requestRefund({ paymentId: req.params.id, ...req.body }, me(req), req.id))));
  r.post('/finance/manual-payments', { schema: { tags: ['finance'], body: ManualPaymentSchema, response: { 201: Out, ...errors } } }, async (req, reply) => {
    const p = await payments.recordManualPayment(req.body, me(req), req.id);
    return reply.status(201).send({ id: p._id, orderId: p.orderId, state: p.state, label: 'manual' });
  });

  // ---- prizes (END-002, FIN-007/008)
  r.get('/events/:id/prizes', { schema: { tags: ['finance'], params: Id, response: { 200: z.object({ items: z.array(Out) }), ...errors } } }, async (req) => ({ items: plainAll(await prizes.list(req.params.id, me(req), req.id)) }));
  r.get('/events/:id/prizes/obligations', { schema: { tags: ['finance'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await prizes.obligations(req.params.id, me(req), req.id)));
  r.post('/prizes/:id/recipient', { schema: { tags: ['finance'], params: Id, body: PrizeRecipientSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await prizes.setRecipient(req.params.id, req.body, me(req), req.id)));
  r.post('/prizes/:id/release', { schema: { tags: ['finance'], params: Id, body: PrizeReleaseSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await prizes.release(req.params.id, req.body.resultRef, req.body.expectedVersion, me(req), req.id)));
  r.post('/prizes/:id/payout', { schema: { tags: ['finance'], params: Id, body: PrizePayoutSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await prizes.startPayout(req.params.id, req.body.approvalId, req.body.expectedVersion, me(req), req.id)));
  r.post('/prizes/:id/paid', { schema: { tags: ['finance'], params: Id, body: PrizeConfirmPaidSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await prizes.confirmPaid(req.params.id, req.body, me(req), req.id)));

  // ---- price lists, discounts, subscriptions, tickets, sponsors
  r.post('/finance/prices', { schema: { tags: ['finance'], body: PriceListCreateSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await commerce.createPriceVersion(req.body, me(req), req.id))));
  r.get('/finance/prices/:key', { schema: { tags: ['finance'], params: z.object({ key: z.string().max(80) }), response: { 200: z.object({ items: z.array(Out) }) } } }, async (req) => ({ items: plainAll(await commerce.priceHistory(req.params.key)) }));
  r.post('/finance/discounts', { schema: { tags: ['finance'], body: DiscountCreateSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await commerce.createDiscount(req.body, me(req), req.id))));
  r.post('/subscriptions', { schema: { tags: ['finance'], body: SubscriptionCreateSchema.extend({ discountCode: z.string().max(30).nullable().default(null) }), response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await commerce.subscribe(req.body.plan, req.body.holderRef, req.body.autoRenew, req.body.discountCode, me(req), req.id))));
  r.get('/me/subscriptions', { schema: { tags: ['finance'], response: { 200: z.object({ items: z.array(Out) }) } } }, async (req) => ({ items: plainAll(await container.c.subscriptions.find({ payerPrincipalId: me(req) }).sort({ createdAt: -1 }).toArray()) }));
  r.post('/subscriptions/:id/cancel', { schema: { tags: ['finance'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await commerce.cancelSubscription(req.params.id, me(req), req.id)));
  r.post('/subscriptions/:id/upgrade', { schema: { tags: ['finance'], params: Id, body: z.object({ plan: SubscriptionCreateSchema.shape.plan }), response: { 200: Out, ...errors } } }, async (req) => plain(await commerce.upgrade(req.params.id, req.body.plan, me(req), req.id)));
  r.post('/events/:id/tickets/config', { schema: { tags: ['finance'], params: Id, body: z.object({ capacity: z.number().int().min(1).max(100000), priceRial: z.number().int().min(0) }), response: { 204: z.null(), ...errors } } }, async (req, reply) => {
    await commerce.configureTickets(req.params.id, req.body.capacity, req.body.priceRial, me(req), req.id);
    return reply.status(204).send(null);
  });
  r.post('/events/:id/tickets', { schema: { tags: ['finance'], params: Id, body: TicketCreateSchema, response: { 201: Out, ...errors } } }, async (req, reply) => {
    const res = await commerce.buyTickets(req.params.id, req.body.quantity, me(req), req.id);
    return reply.status(201).send({ orderId: res.orderId, tickets: res.tickets.map((t) => ({ id: t._id, state: t.state })) });
  });
  r.get('/me/tickets', { schema: { tags: ['finance'], response: { 200: z.object({ items: z.array(Out) }) } } }, async (req) => ({ items: (await container.c.tickets.find({ holderPrincipalId: me(req) }).sort({ createdAt: -1 }).toArray()).map((t) => ({ id: t._id, eventId: t.eventId, state: t.state, code: t.state === 'valid' ? t.code : null, orderId: t.orderId })) }));
  r.post('/tickets/use', { schema: { tags: ['finance'], body: z.object({ code: z.string().min(6).max(64) }), response: { 200: Out, ...errors } } }, async (req) => {
    const t = await commerce.useTicket(req.body.code, me(req), req.id);
    return { id: t._id, eventId: t.eventId, state: t.state, usedAt: t.usedAt };
  });
  r.post('/events/:id/sponsors', { schema: { tags: ['finance'], params: Id, body: SponsorPlacementSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await commerce.addSponsor(req.params.id, req.body, me(req), req.id))));
  r.get('/events/:id/sponsors', { schema: { tags: ['finance'], params: Id, response: { 200: z.object({ items: z.array(Out) }), ...errors } } }, async (req) => {
    await req.requirePermission('event.manage', { type: 'event', id: req.params.id });
    return { items: plainAll(await container.c.sponsorPlacements.find({ eventId: req.params.id }).sort({ createdAt: -1 }).toArray()) };
  });
  r.post('/sponsors/:id/approve', { schema: { tags: ['finance'], params: Id, body: z.object({ note: z.string().max(1000).default('') }), response: { 200: Out, ...errors } } }, async (req) => plain(await commerce.approveSponsor(req.params.id, req.body.note, me(req), req.id)));

  // ---- reports, settlement and exports (FIN-008)
  r.get('/events/:id/financials', { schema: { tags: ['finance'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await commerce.eventFinancials(req.params.id, me(req), req.id)));
  r.get('/organizations/:id/balance', { schema: { tags: ['finance'], params: Id, response: { 200: z.object({ organizationId: z.string(), payableRial: z.number().int() }), ...errors } } }, async (req) => {
    if (!(await container.acl.can(me(req), 'finance.read', SITE_SCOPE))) await req.requirePermission('organization.manage', { type: 'organization', id: req.params.id });
    return { organizationId: req.params.id, payableRial: await commerce.organizerBalance(req.params.id) };
  });
  r.post('/organizations/:id/settlements', { schema: { tags: ['finance'], params: Id, body: z.object({ amountRial: z.number().int().positive(), approvalId: z.string(), evidenceFileId: z.string(), idempotencyKey: z.string().min(8).max(80) }), response: { 201: z.object({ txId: z.string() }), ...errors } } }, async (req, reply) => reply.status(201).send({ txId: await commerce.settleOrganizer(req.params.id, req.body.amountRial, req.body.approvalId, req.body.evidenceFileId, req.body.idempotencyKey, me(req), req.id) }));
  r.get('/finance/ledger.csv', { schema: { tags: ['finance'], querystring: z.object({ from: z.string().optional(), to: z.string().optional(), account: z.string().max(120).optional() }) } }, async (req, reply) => {
    const csv = await commerce.ledgerCsv(req.query, me(req), req.id);
    return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="ledger.csv"').header('Cache-Control', 'private, no-store').send(csv);
  });
}
