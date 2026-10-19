import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { DomainError, SITE_SCOPE, SubscriptionPlans, type DiscountCreateSchema, type PriceListCreateSchema, type Scope, type SponsorPlacementSchema } from '@esp/contracts';
import type { Container } from '../container.js';
import type { DiscountDoc, PriceListDoc, SponsorPlacementDoc, SubscriptionDoc, TicketDoc } from '../db/collections-esp03.js';
import { newId } from '../ids.js';
import { toCsv } from '../files/csv.js';
import { PaymentsService } from './payments.js';

/**
 * Commercial products and reporting (FIN-001/003/008/009/010/011):
 * versioned price lists (never retroactive), discounts, subscriptions (renew/expire/upgrade), tickets, organizer
 * settlements with double-settlement protection, sponsor/advert placements with labels and publisher-rule checks,
 * financial summaries and an accounting export. Purchases never grant competitive points or refereeing authority
 * (BASE-007): subscription features are presentation/tooling flags only.
 */
const iso = () => new Date().toISOString();

export class CommerceService {
  readonly payments: PaymentsService;
  constructor(private readonly ct: Container) {
    this.payments = new PaymentsService(ct);
  }
  private get c() {
    return this.ct.c;
  }
  private async audit(actor: string, action: string, targetType: string, targetId: string, scope: Scope, requestId: string, details: Record<string, unknown> = {}) {
    await this.ct.audit.append({ actorPrincipalId: actor, action, target: { type: targetType, id: targetId }, scope, outcome: 'success', details, requestId });
  }

  // ------------------------------------------------------------------ price lists and discounts (FIN-011)
  async createPriceVersion(input: z.infer<typeof PriceListCreateSchema>, actor: string, requestId: string): Promise<PriceListDoc> {
    await this.ct.acl.require(actor, 'platform.settings', SITE_SCOPE, requestId);
    return this.ct.dbh.withTransaction(async (session) => {
      const last = await this.c.priceLists.findOne({ productKey: input.productKey }, { sort: { version: -1 }, session });
      if (last && last.kind !== input.kind) throw new DomainError('VALIDATION_FAILED', 'product kind cannot change between versions');
      const doc: PriceListDoc = { _id: newId('prl'), ...input, version: (last?.version ?? 0) + 1, createdBy: actor, createdAt: iso(), supersededAt: null };
      if (last) await this.c.priceLists.updateMany({ productKey: input.productKey, supersededAt: null, version: { $lt: doc.version } }, { $set: { supersededAt: input.effectiveFrom } }, { session });
      await this.c.priceLists.insertOne(doc, { session });
      await this.ct.audit.append({ actorPrincipalId: actor, action: 'finance.price.version', target: { type: 'price', id: input.productKey }, scope: SITE_SCOPE, outcome: 'success', details: { version: doc.version, amountRial: input.amountRial, feeBps: input.feeBps }, requestId }, session);
      return doc;
    });
  }

  async priceHistory(productKey: string): Promise<PriceListDoc[]> {
    return this.c.priceLists.find({ productKey }).sort({ version: 1 }).toArray();
  }

  async createDiscount(input: z.infer<typeof DiscountCreateSchema>, actor: string, requestId: string): Promise<DiscountDoc> {
    await this.ct.acl.require(actor, 'platform.settings', SITE_SCOPE, requestId);
    if (input.kind === 'percent' && input.value > 100) throw new DomainError('VALIDATION_FAILED', 'percent discount cannot exceed 100');
    const { code, ...rest } = input;
    const doc: DiscountDoc = { _id: code, ...rest, used: 0, createdBy: actor, createdAt: iso() };
    try {
      await this.c.discounts.insertOne(doc);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'discount code exists');
      throw err;
    }
    await this.audit(actor, 'finance.discount.create', 'discount', code, SITE_SCOPE, requestId, { kind: input.kind, value: input.value });
    return doc;
  }

  // ------------------------------------------------------------------ subscriptions (FIN-009)
  async subscribe(plan: keyof typeof SubscriptionPlans, holderRef: string, autoRenew: boolean, discountCode: string | null, actor: string, requestId: string): Promise<{ subscription: SubscriptionDoc; orderId: string }> {
    const def = SubscriptionPlans[plan];
    // the payer must control the holder
    if (def.holder === 'player' && holderRef !== actor) throw new DomainError('FORBIDDEN', 'player plans are bought for yourself');
    if (def.holder === 'team') await this.ct.acl.require(actor, 'team.manage', { type: 'team', id: holderRef }, requestId);
    if (def.holder === 'organization') await this.ct.acl.require(actor, 'organization.manage', { type: 'organization', id: holderRef }, requestId);
    const price = await this.c.priceLists.findOne({ productKey: def.priceKey, effectiveFrom: { $lte: iso() }, supersededAt: null }, { sort: { version: -1 } });
    if (!price) throw new DomainError('PRECONDITION_FAILED', 'this plan has no published price (commercial setting pending, 17.2)');
    const active = await this.c.subscriptions.findOne({ plan, 'holder.ref': holderRef, state: { $in: ['active', 'pending_payment'] } });
    if (active) throw new DomainError('CONFLICT', 'a subscription for this plan is already active or awaiting payment');
    return this.ct.dbh.withTransaction(async (session) => {
      const sub: SubscriptionDoc = { _id: newId('sbs'), plan, holder: { kind: def.holder, ref: holderRef }, payerPrincipalId: actor, state: 'pending_payment', periodStart: null, periodEnd: null, autoRenew, features: [...def.features], orderIds: [], createdAt: iso(), version: 0 };
      // the unique index (0007) settles concurrent purchases; the read above only gives a friendlier early answer
      await this.c.subscriptions.insertOne(sub, { session }).catch((err: { code?: number }) => {
        if (err.code === 11000) throw new DomainError('CONFLICT', 'a subscription for this plan is already active or awaiting payment');
        throw err;
      });
      const order = await this.payments.createOrder({ kind: 'subscription', payerPrincipalId: actor, items: [{ productKey: def.priceKey, description: `subscription ${plan}`, amountRial: price.amountRial, quantity: 1 }], refs: { subscriptionId: sub._id }, productKey: def.priceKey, discountCode, creditAccount: 'revenue:platform:subscription' }, session);
      await this.c.subscriptions.updateOne({ _id: sub._id }, { $push: { orderIds: order._id } }, { session });
      return { subscription: { ...sub, orderIds: [order._id] }, orderId: order._id };
    });
  }

  /** Called when a subscription order is paid: activate or extend by one period (idempotent per order). */
  async onSubscriptionPaid(subscriptionId: string, orderId: string): Promise<void> {
    const s = await this.c.subscriptions.findOne({ _id: subscriptionId });
    if (!s) return;
    const days = SubscriptionPlans[s.plan as keyof typeof SubscriptionPlans].days;
    const start = s.state === 'active' && s.periodEnd && s.periodEnd > iso() ? s.periodEnd : iso();
    const end = new Date(Date.parse(start) + days * 86_400_000).toISOString();
    await this.c.subscriptions.updateOne({ _id: s._id, orderIds: orderId, [`applied.${orderId}`]: { $exists: false } }, { $set: { state: 'active', periodStart: s.periodStart ?? start, periodEnd: end, [`applied.${orderId}`]: true }, $inc: { version: 1 } });
  }

  /** Worker job: create renewal orders shortly before the end; expire unpaid subscriptions after the end. */
  async renewAndExpire(now = new Date()): Promise<{ renewed: number; expired: number }> {
    const soon = new Date(now.getTime() + 3 * 86_400_000).toISOString();
    let renewed = 0;
    for (const s of await this.c.subscriptions.find({ state: 'active', autoRenew: true, periodEnd: { $lte: soon } }).toArray()) {
      const def = SubscriptionPlans[s.plan as keyof typeof SubscriptionPlans];
      const price = await this.c.priceLists.findOne({ productKey: def.priceKey, supersededAt: null }, { sort: { version: -1 } });
      if (!price) continue;
      const open = await this.c.orders.findOne({ _id: { $in: s.orderIds }, state: 'open' });
      if (open) continue;
      await this.ct.dbh.withTransaction(async (session) => {
        const order = await this.payments.createOrder({ kind: 'subscription', payerPrincipalId: s.payerPrincipalId, items: [{ productKey: def.priceKey, description: `renewal ${s.plan}`, amountRial: price.amountRial, quantity: 1 }], refs: { subscriptionId: s._id }, productKey: def.priceKey, discountCode: null, creditAccount: 'revenue:platform:subscription' }, session);
        await this.c.subscriptions.updateOne({ _id: s._id }, { $push: { orderIds: order._id } }, { session });
      });
      renewed++;
    }
    const r = await this.c.subscriptions.updateMany({ state: 'active', periodEnd: { $lt: now.toISOString() } }, { $set: { state: 'expired' }, $inc: { version: 1 } });
    return { renewed, expired: r.modifiedCount };
  }

  async cancelSubscription(subscriptionId: string, actor: string, requestId: string): Promise<SubscriptionDoc> {
    const s = await this.c.subscriptions.findOne({ _id: subscriptionId });
    if (!s) throw new DomainError('NOT_FOUND', 'subscription not found');
    if (s.payerPrincipalId !== actor) throw new DomainError('FORBIDDEN', 'only the payer can cancel');
    // FIN-009: cancelling stops renewal; the paid period remains usable until its end (no silent proration)
    const r = await this.c.subscriptions.findOneAndUpdate({ _id: s._id }, { $set: { autoRenew: false, ...(s.state === 'pending_payment' ? { state: 'cancelled' } : {}) }, $inc: { version: 1 } }, { returnDocument: 'after' });
    await this.audit(actor, 'finance.subscription.cancel', 'subscription', s._id, SITE_SCOPE, requestId);
    return r!;
  }

  /** FIN-009: upgrade = new plan bought now; the old plan stops renewing (documented: no proration in this release). */
  async upgrade(subscriptionId: string, plan: keyof typeof SubscriptionPlans, actor: string, requestId: string) {
    const s = await this.cancelSubscription(subscriptionId, actor, requestId);
    return this.subscribe(plan, s.holder.ref, true, null, actor, requestId);
  }

  async hasFeature(holderRef: string, feature: string): Promise<boolean> {
    return !!(await this.c.subscriptions.findOne({ 'holder.ref': holderRef, state: 'active', features: feature, periodEnd: { $gt: iso() } }));
  }

  // ------------------------------------------------------------------ tickets (FIN-001; venue validation in ESP-04/LAN-006)
  async configureTickets(eventId: string, capacity: number, priceRial: number, actor: string, requestId: string): Promise<void> {
    await this.ct.acl.require(actor, 'event.manage', { type: 'event', id: eventId }, requestId);
    const e = await this.c.events.findOne({ _id: eventId });
    if (!e || e.config.presence === 'online') throw new DomainError('PRECONDITION_FAILED', 'tickets exist only for offline or hybrid events');
    await this.c.capacityCounters.updateOne({ _id: `${eventId}:tickets` }, { $set: { capacity }, $setOnInsert: { disciplineId: eventId, quotaKind: 'tickets', held: 0, confirmed: 0, version: 0 } }, { upsert: true });
    const key = `ticket:${eventId}`;
    const last = await this.c.priceLists.findOne({ productKey: key }, { sort: { version: -1 } });
    if (!last || last.amountRial !== priceRial) await this.c.priceLists.insertOne({ _id: newId('prl'), productKey: key, kind: 'ticket', amountRial: priceRial, feeBps: last?.feeBps ?? 0, version: (last?.version ?? 0) + 1, effectiveFrom: iso(), createdBy: actor, createdAt: iso(), supersededAt: null });
    if (last && last.amountRial !== priceRial) await this.c.priceLists.updateOne({ _id: last._id }, { $set: { supersededAt: iso() } });
    await this.audit(actor, 'finance.tickets.configure', 'event', eventId, { type: 'event', id: eventId }, requestId, { capacity, priceRial });
  }

  async buyTickets(eventId: string, quantity: number, actor: string, requestId: string): Promise<{ orderId: string; tickets: TicketDoc[] }> {
    const e = await this.c.events.findOne({ _id: eventId });
    if (!e || !['published', 'registration_open', 'registration_closed', 'preparing', 'active'].includes(e.state)) throw new DomainError('PRECONDITION_FAILED', 'tickets are not on sale');
    const price = await this.c.priceLists.findOne({ productKey: `ticket:${eventId}`, supersededAt: null }, { sort: { version: -1 } });
    if (!price) throw new DomainError('PRECONDITION_FAILED', 'tickets are not configured');
    const out = await this.ct.dbh.withTransaction(async (session) => {
      const held = await this.c.capacityCounters.findOneAndUpdate({ _id: `${eventId}:tickets`, $expr: { $lte: [{ $add: ['$held', '$confirmed', quantity] }, '$capacity'] } }, { $inc: { held: quantity } }, { returnDocument: 'after', session });
      if (!held) throw new DomainError('PRECONDITION_FAILED', 'not enough tickets left');
      const tickets: TicketDoc[] = Array.from({ length: quantity }, () => ({ _id: newId('tkt'), eventId, holderPrincipalId: actor, orderId: '', code: randomBytes(9).toString('base64url'), state: 'pending_payment', usedAt: null, createdAt: iso(), version: 0 }));
      const order = await this.payments.createOrder({ kind: 'ticket', payerPrincipalId: actor, items: [{ productKey: `ticket:${eventId}`, description: `${e.name} ticket`, amountRial: price.amountRial, quantity }], refs: { eventId, ticketId: tickets[0]!._id }, productKey: `ticket:${eventId}`, discountCode: null, creditAccount: `payable:organization:${e.organizerOrgId}` }, session);
      for (const t of tickets) t.orderId = order._id;
      await this.c.tickets.insertMany(tickets, { session });
      return { orderId: order._id, tickets };
    });
    await this.audit(actor, 'finance.tickets.buy', 'order', out.orderId, { type: 'event', id: eventId }, requestId, { quantity });
    return out;
  }

  async onTicketsPaid(orderId: string): Promise<void> {
    const tickets = await this.c.tickets.find({ orderId, state: 'pending_payment' }).toArray();
    if (!tickets.length) return;
    await this.c.tickets.updateMany({ orderId, state: 'pending_payment' }, { $set: { state: 'valid' }, $inc: { version: 1 } });
    await this.c.capacityCounters.updateOne({ _id: `${tickets[0]!.eventId}:tickets` }, { $inc: { held: -tickets.length, confirmed: tickets.length } });
  }

  /** LAN-006 foundation: a ticket code admits once. */
  async useTicket(code: string, actor: string, requestId: string): Promise<TicketDoc> {
    const t = await this.c.tickets.findOne({ code });
    if (!t) throw new DomainError('NOT_FOUND', 'unknown ticket');
    await this.ct.acl.require(actor, 'match.manage', { type: 'event', id: t.eventId }, requestId);
    const r = await this.c.tickets.findOneAndUpdate({ code, state: 'valid' }, { $set: { state: 'used', usedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('CONFLICT', `ticket is ${t.state}`);
    return r;
  }

  async voidTicketsForEvent(eventId: string, refundPercent: number, requestId: string): Promise<number> {
    const orders = await this.c.tickets.distinct('orderId', { eventId, state: { $in: ['valid', 'pending_payment'] } });
    await this.c.tickets.updateMany({ eventId, state: { $in: ['valid', 'pending_payment'] } }, { $set: { state: 'void' }, $inc: { version: 1 } });
    for (const o of orders) {
      await this.c.orders.updateOne({ _id: o, state: 'open' }, { $set: { state: 'cancelled', updatedAt: iso() } });
      if (refundPercent > 0) await this.payments.refundOrder(o, refundPercent, 'event_cancelled', `tickets:${o}:event_cancelled`, 'system', requestId);
    }
    return orders.length;
  }

  // ------------------------------------------------------------------ organizer settlement (FIN-008)
  async organizerBalance(orgId: string): Promise<number> {
    return -(await this.payments.ledger.balance(`payable:organization:${orgId}`)); // credit balance = amount owed to the organizer
  }

  /** Pays out the organizer's payable balance; idempotency key + approval + evidence; never more than the balance. */
  async settleOrganizer(orgId: string, amountRial: number, approvalId: string, evidenceFileId: string, idempotencyKey: string, actor: string, requestId: string): Promise<string> {
    await this.ct.acl.require(actor, 'finance.payout', SITE_SCOPE, requestId);
    if (await this.c.ledger.findOne({ kind: 'payout', 'refs.idempotencyKey': idempotencyKey })) throw new DomainError('CONFLICT', 'this settlement was already recorded');
    await this.ct.approvals.consume(approvalId, 'finance.payout', SITE_SCOPE, { principalId: actor, requestId });
    const f = await this.c.files.findOne({ _id: evidenceFileId });
    if (!f || f.quarantined || f.visibility !== 'private') throw new DomainError('PRECONDITION_FAILED', 'settlement needs clean private evidence');
    return this.ct.dbh.withTransaction(async (session) => {
      const lock = await this.c.counters.findOneAndUpdate({ _id: `settle:${idempotencyKey}` }, { $setOnInsert: { value: 1 } }, { upsert: true, returnDocument: 'before', session });
      if (lock) throw new DomainError('CONFLICT', 'this settlement was already recorded');
      const owed = -((await this.c.ledger.aggregate<{ t: number }>([{ $match: { account: `payable:organization:${orgId}` } }, { $group: { _id: null, t: { $sum: '$amountRial' } } }], { session }).toArray())[0]?.t ?? 0);
      if (amountRial <= 0 || amountRial > owed) throw new DomainError('PRECONDITION_FAILED', 'amount exceeds the organizer balance', { owed });
      return this.payments.ledger.post({ lines: [{ account: `payable:organization:${orgId}`, amountRial }, { account: 'cash:payout', amountRial: -amountRial }], kind: 'payout', refs: { organizationId: orgId, idempotencyKey, evidenceFileId, approvalId }, reason: 'organizer settlement', createdBy: actor }, session);
    });
  }

  // ------------------------------------------------------------------ sponsors (FIN-010)
  async addSponsor(eventId: string, input: z.infer<typeof SponsorPlacementSchema>, actor: string, requestId: string): Promise<SponsorPlacementDoc> {
    await this.ct.acl.require(actor, 'event.manage', { type: 'event', id: eventId }, requestId);
    const doc: SponsorPlacementDoc = { _id: newId('spn'), eventId, sponsorName: input.sponsorName, placement: input.placement, label: input.label, publisherRestrictionCheck: { checked: false, packageId: null, note: input.publisherRestrictionNote, checkedBy: null }, state: 'draft', createdBy: actor, createdAt: iso(), version: 0 };
    await this.c.sponsorPlacements.insertOne(doc);
    return doc;
  }

  /** Approval requires an explicit check against publisher/event sponsorship restrictions of every discipline's rules. */
  async approveSponsor(placementId: string, note: string, actor: string, requestId: string): Promise<SponsorPlacementDoc> {
    const s = await this.c.sponsorPlacements.findOne({ _id: placementId });
    if (!s) throw new DomainError('NOT_FOUND', 'placement not found');
    await this.ct.acl.require(actor, 'event.manage', { type: 'event', id: s.eventId }, requestId);
    const disciplines = await this.c.disciplines.find({ eventId: s.eventId }).toArray();
    const restrictions = [];
    for (const d of disciplines) {
      if (!d.rulesSnapshot) continue;
      const pkg = await this.c.rulesPackages.findOne({ _id: d.rulesSnapshot.packageId });
      if (pkg?.publisherRights.restrictions) restrictions.push({ packageId: pkg._id, restrictions: pkg.publisherRights.restrictions });
    }
    if (restrictions.length && note.trim().length < 10) throw new DomainError('PRECONDITION_FAILED', 'publisher restrictions apply; explain how this placement complies', { restrictions });
    const r = await this.c.sponsorPlacements.findOneAndUpdate({ _id: s._id, state: 'draft' }, { $set: { state: 'approved', publisherRestrictionCheck: { checked: true, packageId: restrictions[0]?.packageId ?? null, note, checkedBy: actor } }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('CONFLICT', 'placement is not a draft');
    await this.audit(actor, 'finance.sponsor.approve', 'sponsor', s._id, { type: 'event', id: s.eventId }, requestId, { restrictions: restrictions.length });
    return r;
  }

  async publicSponsors(eventId: string) {
    return (await this.c.sponsorPlacements.find({ eventId, state: 'approved' }).toArray()).map((s) => ({ id: s._id, sponsorName: s.sponsorName, placement: s.placement, label: s.label }));
  }

  // ------------------------------------------------------------------ reports and exports (FIN-008, ADM-011 foundation)
  async eventFinancials(eventId: string, actor: string, requestId: string) {
    const e = await this.c.events.findOne({ _id: eventId });
    if (!e) throw new DomainError('NOT_FOUND', 'event not found');
    if (!(await this.ct.acl.can(actor, 'finance.read', SITE_SCOPE))) await this.ct.acl.require(actor, 'event.manage', { type: 'event', id: eventId }, requestId);
    const orders = await this.c.orders.find({ 'refs.eventId': eventId }).toArray();
    const sum = (f: (o: (typeof orders)[number]) => boolean, k: 'totalRial' | 'feeRial' | 'discountRial') => orders.filter(f).reduce((a, o) => a + o[k], 0);
    const paid = (o: (typeof orders)[number]) => ['paid', 'partially_refunded', 'refunded'].includes(o.state);
    const refunds = await this.c.refunds.find({ orderId: { $in: orders.map((o) => o._id) }, state: 'confirmed' }).toArray();
    const prizes = await this.c.prizes.find({ eventId }).toArray();
    return {
      eventId,
      currency: 'IRR',
      ordersByKind: Object.fromEntries(['entry', 'ticket'].map((k) => [k, { count: orders.filter((o) => o.kind === k && paid(o)).length, grossRial: sum((o) => o.kind === k && paid(o), 'totalRial') }])),
      feesRial: sum(paid, 'feeRial'),
      discountsRial: sum(paid, 'discountRial'),
      refundedRial: refunds.reduce((a, r) => a + r.amountRial, 0),
      openOrders: orders.filter((o) => o.state === 'open').length,
      organizerPayableRial: await this.organizerBalance(e.organizerOrgId),
      prizes: { totalRial: prizes.reduce((a, p) => a + p.amountRial, 0), byState: Object.fromEntries([...new Set(prizes.map((p) => p.state))].map((s) => [s, prizes.filter((p) => p.state === s).reduce((a, p) => a + p.amountRial, 0)])), guaranteeShown: false },
    };
  }

  /** Accounting export of ledger lines (formula-injection safe CSV). */
  async ledgerCsv(filter: { from?: string | undefined; to?: string | undefined; account?: string | undefined }, actor: string, requestId: string): Promise<string> {
    await this.ct.acl.require(actor, 'finance.read', SITE_SCOPE, requestId);
    const q: Record<string, unknown> = {};
    if (filter.account) q['account'] = filter.account;
    if (filter.from || filter.to) q['createdAt'] = { ...(filter.from ? { $gte: filter.from } : {}), ...(filter.to ? { $lt: filter.to } : {}) };
    const rows = await this.c.ledger.find(q).sort({ seq: 1 }).limit(50_000).toArray();
    await this.audit(actor, 'finance.export.ledger', 'ledger', 'export', SITE_SCOPE, requestId, { rows: rows.length });
    return toCsv(['seq', 'txId', 'createdAt', 'account', 'amountRial', 'kind', 'refs', 'reason', 'reversalOf'], rows.map((l) => [l.seq, l.txId, l.createdAt, l.account, l.amountRial, l.kind, l.refs, l.reason, l.reversalOf]));
  }
}
