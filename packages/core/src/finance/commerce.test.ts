import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testContainer, rid } from '../test/harness.js';
import { clause, openEvent, preparePublishable } from '../test/esp03-fixture.js';
import { seedIds } from '../db/seed-ids.js';
import { CommerceService } from './commerce.js';
import { PaymentsService } from './payments.js';
import type { DevGatewayAdapter } from '../adapters/devGateway.js';

let t: Awaited<ReturnType<typeof testContainer>>;
let com: CommerceService;
let pay: PaymentsService;
let gw: DevGatewayAdapter;
let pkg: string;
beforeAll(async () => {
  t = await testContainer({ seed: true });
  com = new CommerceService(t);
  pay = new PaymentsService(t);
  gw = t.adapters.payment as unknown as DevGatewayAdapter;
  pkg = await preparePublishable(t, [clause('roster.min', 1)]);
});
afterAll(async () => {
  await t.drop();
});

async function paid(orderId: string, payer: string) {
  const { payment } = await pay.pay(orderId, payer, 'http://localhost/r', rid());
  await pay.handleCallback((await gw.settle(payment.gatewayRef!, 'success'))!, rid());
  await t.consumer.drain();
}
const past = () => new Date(Date.now() - 1000).toISOString();
async function evidence() {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
  return (await t.files.upload({ data: png, originalName: 'transfer.png', declaredMime: 'image/png', visibility: 'private', scope: { type: 'site', id: 'site' }, retentionClass: 'dispute_evidence' }, { principalId: seedIds.admin, requestId: rid() }))._id;
}
async function approved(action: 'finance.payout', reason: string) {
  const a = await t.approvals.request({ action, scope: { type: 'site', id: 'site' }, payload: {}, reason }, { principalId: seedIds.finance, requestId: rid() });
  await t.approvals.decide(a._id, { decision: 'approve', reason: 'checked', expectedVersion: 0 }, { principalId: seedIds.finance2, requestId: rid() });
  return a._id;
}

describe('versioned prices (FIN-011)', () => {
  it('only platform settings may version prices; a confirmed order keeps the version it was priced with', async () => {
    const v = { productKey: 'subscription:player_pro', kind: 'subscription' as const, amountRial: 900_000, feeBps: 0, effectiveFrom: past() };
    await expect(com.createPriceVersion(v, seedIds.finance, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await com.createPriceVersion(v, seedIds.admin, rid());
    const sub = await com.subscribe('player_pro', seedIds.player, true, null, seedIds.player, rid());
    await com.createPriceVersion({ ...v, amountRial: 1_200_000, effectiveFrom: past() }, seedIds.admin, rid());
    await expect(com.createPriceVersion({ ...v, kind: 'ticket' }, seedIds.admin, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const history = await com.priceHistory('subscription:player_pro');
    expect(history.map((h) => [h.version, h.amountRial, h.supersededAt === null])).toEqual([[1, 900_000, false], [2, 1_200_000, true]]);
    const o = await t.c.orders.findOne({ _id: sub.orderId });
    expect([o!.totalRial, o!.priceVersion]).toEqual([900_000, 1]);
  });
});

describe('subscriptions (FIN-009, BASE-007)', () => {
  it('activate on payment, renew before the end, expire after it; features never grant authority', async () => {
    await com.createPriceVersion({ productKey: 'subscription:team_pro', kind: 'subscription', amountRial: 2_000_000, feeBps: 0, effectiveFrom: past() }, seedIds.admin, rid());
    await expect(com.subscribe('player_pro', seedIds.captain, false, null, seedIds.player, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(com.subscribe('organizer_pro', seedIds.orgA, false, null, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' }); // no published price
    const s = (await t.c.subscriptions.findOne({ plan: 'player_pro', 'holder.ref': seedIds.player }))!;
    await expect(com.subscribe('player_pro', seedIds.player, true, null, seedIds.player, rid())).rejects.toMatchObject({ code: 'CONFLICT' });
    await paid(s.orderIds[0]!, seedIds.player);
    const active = (await t.c.subscriptions.findOne({ _id: s._id }))!;
    expect(active.state).toBe('active');
    expect(Date.parse(active.periodEnd!) - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect(await com.hasFeature(seedIds.player, 'profile_highlight')).toBe(true);
    expect(await t.acl.can(seedIds.player, 'match.result.verify', { type: 'site', id: 'site' })).toBe(false);

    // three days before the end a renewal order is created once; after the end without payment it expires
    const nearEnd = new Date(Date.parse(active.periodEnd!) - 2 * 86_400_000);
    expect((await com.renewAndExpire(nearEnd)).renewed).toBe(1);
    expect((await com.renewAndExpire(nearEnd)).renewed).toBe(0);
    const renewal = (await t.c.subscriptions.findOne({ _id: s._id }))!.orderIds[1]!;
    expect((await t.c.orders.findOne({ _id: renewal }))!.totalRial).toBe(1_200_000); // the current price version
    await paid(renewal, seedIds.player);
    const extended = (await t.c.subscriptions.findOne({ _id: s._id }))!;
    expect(Date.parse(extended.periodEnd!) - Date.parse(active.periodEnd!)).toBe(30 * 86_400_000);
    expect((await com.renewAndExpire(new Date(Date.parse(extended.periodEnd!) + 1000))).expired).toBeGreaterThanOrEqual(1);
    expect((await t.c.subscriptions.findOne({ _id: s._id }))!.state).toBe('expired');

    // two concurrent purchases for the same holder and plan: exactly one wins (unique index, not the read-check)
    const race = await Promise.allSettled([com.subscribe('player_pro', seedIds.player, false, null, seedIds.player, rid()), com.subscribe('player_pro', seedIds.player, false, null, seedIds.player, rid())]);
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(race.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } });
    // cancel stops renewal and is payer-only; upgrade buys the new plan for the same holder
    await expect(com.subscribe('team_pro', seedIds.teamA, true, null, seedIds.captain, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' }); // a captain does not manage the team
    await t.acl.grant({ principalId: seedIds.captain, role: 'team_owner', scope: { type: 'team', id: seedIds.teamA }, expiresAt: null, reason: 'test owner' }, { principalId: 'system', requestId: rid() });
    const team = await com.subscribe('team_pro', seedIds.teamA, true, null, seedIds.captain, rid());
    await expect(com.cancelSubscription(team.subscription._id, seedIds.player, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await com.cancelSubscription(team.subscription._id, seedIds.captain, rid())).state).toBe('cancelled');
  });
});

describe('tickets (FIN-001)', () => {
  it('capacity is atomic, a paid ticket admits once, and only event officials can admit', async () => {
    const { eventId } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'T', participantKind: 'player', capacity: 2 }] });
    await com.configureTickets(eventId, 3, 50_000, seedIds.organizer, rid());
    await expect(com.buyTickets(eventId, 4, seedIds.player, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const results = await Promise.allSettled([com.buyTickets(eventId, 2, seedIds.player, rid()), com.buyTickets(eventId, 2, seedIds.captain, rid())]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const ok = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ orderId: string }>).value;
    const buyer = (await t.c.orders.findOne({ _id: ok.orderId }))!.payerPrincipalId;
    await paid(ok.orderId, buyer);
    const [tk] = await t.c.tickets.find({ orderId: ok.orderId }).toArray();
    expect(tk!.state).toBe('valid');
    await expect(com.useTicket(tk!.code, seedIds.player, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await com.useTicket(tk!.code, seedIds.organizer, rid())).state).toBe('used');
    await expect(com.useTicket(tk!.code, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('organizer settlement and sponsors (FIN-008/010)', () => {
  it('settles at most the owed balance, once per key, with approval and evidence; the ledger stays balanced', async () => {
    const { disciplineIds: [d] } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'S', participantKind: 'player', capacity: 2, feeRial: 700_000 }], refund: { before: 100, after: 50, cancel: 100, dq: 0 } });
    const disc = (await t.c.disciplines.findOne({ _id: d! }))!;
    const { RegistrationService } = await import('../registration/registration.js');
    const reg = await new RegistrationService(t).create(d!, { teamId: null, roster: [], formAnswers: {}, documentFileIds: {}, entryCode: null, acceptRulesHash: disc.rulesSnapshot!.hash }, seedIds.player, rid());
    await paid(reg.orderId!, seedIds.player);
    const owed = await com.organizerBalance(seedIds.orgA);
    expect(owed).toBeGreaterThanOrEqual(700_000);
    const file = await evidence();
    await expect(com.settleOrganizer(seedIds.orgA, 100_000, 'apr_missing', file, 'settle-key-0001', seedIds.player, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(com.settleOrganizer(seedIds.orgA, owed + 1, await approved('finance.payout', 'too much'), file, 'settle-key-0002', seedIds.finance, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await com.settleOrganizer(seedIds.orgA, 300_000, await approved('finance.payout', 'monthly'), file, 'settle-key-0003', seedIds.finance, rid());
    expect(await com.organizerBalance(seedIds.orgA)).toBe(owed - 300_000);
    await expect(com.settleOrganizer(seedIds.orgA, 300_000, await approved('finance.payout', 'retry'), file, 'settle-key-0003', seedIds.finance, rid())).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await com.organizerBalance(seedIds.orgA)).toBe(owed - 300_000);
    expect(await pay.ledger.unbalancedTransactions()).toEqual([]);
  });

  it('a sponsor stays off the public page until event staff approve it with its label', async () => {
    const { eventId } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'P', participantKind: 'player', capacity: 2 }] });
    const s = await com.addSponsor(eventId, { sponsorName: 'TEST ONLY Co', placement: 'event_header', label: 'advertisement', publisherRestrictionNote: null }, seedIds.organizer, rid());
    await expect(com.addSponsor(eventId, { sponsorName: 'X', placement: 'event_header', label: 'sponsor', publisherRestrictionNote: null }, seedIds.organizerB, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await com.publicSponsors(eventId)).toEqual([]);
    await com.approveSponsor(s._id, 'no publisher restriction in TEST ONLY package', seedIds.organizer, rid());
    expect(await com.publicSponsors(eventId)).toEqual([{ id: s._id, sponsorName: 'TEST ONLY Co', placement: 'event_header', label: 'advertisement' }]);
    await expect(com.approveSponsor(s._id, 'again', seedIds.organizer, rid())).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
