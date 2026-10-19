import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testContainer, rid } from '../test/harness.js';
import { clause, openEvent, preparePublishable } from '../test/esp03-fixture.js';
import { seedIds } from '../db/seed-ids.js';
import { EventsService } from '../events/events.js';
import { RegistrationService } from './registration.js';
import { RosterService } from './roster.js';
import { RegistrationIo } from './io.js';
import { PaymentsService } from '../finance/payments.js';
import { PrizeService } from '../finance/prizes.js';
import { CommerceService } from '../finance/commerce.js';
import type { DevGatewayAdapter } from '../adapters/devGateway.js';
import { TeamService } from '../teams/teams.js';
import { applyTransition } from '../domain/transition.js';
import { eventMachine } from '@esp/contracts';

let t: Awaited<ReturnType<typeof testContainer>>;
let regs: RegistrationService;
let pay: PaymentsService;
let gw: DevGatewayAdapter;
let pkg: string;
let teamPkg: string;
beforeAll(async () => {
  t = await testContainer({ seed: true });
  regs = new RegistrationService(t);
  pay = new PaymentsService(t);
  gw = t.adapters.payment as unknown as DevGatewayAdapter;
  pkg = await preparePublishable(t, [clause('roster.min', 1)]);
  teamPkg = await preparePublishable(t, [clause('roster.min', 2), clause('roster.substitutes', 1)]);
});
afterAll(async () => {
  await t.drop();
});

/** Fresh active principals with profiles so each test owns its players. */
let n = 0;
async function player(): Promise<string> {
  const k = ++n;
  const id = `usr_t3_${k}`;
  const now = new Date().toISOString();
  await t.c.principals.insertOne({ _id: id, kind: 'user', displayName: `P${k}`, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0 });
  await t.acl.grant({ principalId: id, role: 'player', scope: { type: 'site', id: 'site' }, expiresAt: null, reason: 'test' }, { principalId: 'system', requestId: rid() });
  const { createDefaultProfile } = await import('../profiles/defaults.js');
  await t.c.profiles.insertOne(createDefaultProfile(id, `p3_${k}`));
  return id;
}
const hashOf = async (disciplineId: string) => (await t.c.disciplines.findOne({ _id: disciplineId }))!.rulesSnapshot!.hash;
const counter = async (disciplineId: string, kind = 'public') => (await t.c.capacityCounters.findOne({ _id: `${disciplineId}:${kind}` }))!;
const register = async (disciplineId: string, actor: string, extra: Record<string, unknown> = {}) => regs.create(disciplineId, { teamId: null, roster: [], formAnswers: {}, documentFileIds: {}, entryCode: null, acceptRulesHash: await hashOf(disciplineId), ...extra }, actor, rid());
async function settle(registrationId: string, outcome: 'success' | 'failed' = 'success') {
  const r = await t.c.registrations.findOne({ _id: registrationId });
  const { payment } = await pay.pay(r!.orderId!, r!.applicantPrincipalId, 'http://localhost/return', rid());
  const cb = (await gw.settle(payment.gatewayRef!, outcome))!;
  await pay.handleCallback(cb, rid());
  await t.consumer.drain();
}

describe('publication gate (EVT-005/007, EVT-003)', () => {
  it('refuses publication until terms, rules, readiness and organizer authority are satisfied; then freezes snapshots and counters', async () => {
    const ev = new EventsService(t);
    const e = await ev.create({ organizerOrgId: seedIds.orgA, name: 'x', slug: `gate-${Date.now()}`, visibility: 'link_only', timeZone: 'Asia/Tehran', startsAt: null, endsAt: null, description: null, posterFileId: null, presence: 'online', regions: [], language: 'fa', contact: null, rated: false, prizes: [], refundPolicy: null, cancellationTerms: null, disputeTerms: null, isTemplate: false, seasonId: null }, seedIds.organizer, rid());
    const first = await ev.publishCheck(e._id);
    expect(first.problems.map((p) => p.code)).toEqual(expect.arrayContaining(['starts_at', 'disciplines', 'cancellation_terms', 'dispute_terms']));
    await expect(ev.publish(e._id, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    // another organizer cannot even edit it (contextual ACL)
    await expect(ev.update(e._id, { name: 'hijack', expectedVersion: 0 }, seedIds.organizerB, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const { eventId, disciplineIds } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'A', participantKind: 'player', capacity: 2 }], visibility: 'link_only' });
    const pub = (await t.c.events.findOne({ _id: eventId }))!;
    expect(pub.config.linkToken).toBeTruthy();
    expect((await t.c.disciplines.findOne({ _id: disciplineIds[0]! }))!.rulesSnapshot?.packageId).toBe(pkg);
    expect((await counter(disciplineIds[0]!)).capacity).toBe(2);
    expect(await ev.canView(pub, null, null)).toBe(false); // link_only is not public
    expect(await ev.canView(pub, null, pub.config.linkToken)).toBe(true);
    // published competitive terms are frozen
    await expect(ev.update(eventId, { cancellationTerms: 'changed later', expectedVersion: pub.version }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});

describe('registration and capacity (REG-001..010, AC-01, AC-03)', () => {
  it('AC-01: two disciplines keep independent capacity and registrations', async () => {
    const { disciplineIds: [a, b] } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'A', participantKind: 'player', capacity: 1 }, { name: 'B', participantKind: 'player', capacity: 1 }] });
    const p = await player();
    const ra = await register(a!, p);
    const rb = await register(b!, p);
    expect(ra.state).toBe('confirmed');
    expect(rb.state).toBe('confirmed');
    expect((await counter(a!)).confirmed).toBe(1);
    expect((await counter(b!)).confirmed).toBe(1);
    await expect(register(a!, p)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', details: { issues: [expect.objectContaining({ code: 'multi_registration' })] } }); // one active registration per discipline
  });

  it('AC-03: concurrent requests for the last place confirm exactly one; the other waits in FIFO order', async () => {
    const { disciplineIds: [d] } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'Last', participantKind: 'player', capacity: 1 }] });
    const ps = await Promise.all([player(), player(), player()]);
    const results = await Promise.all(ps.map((p) => register(d!, p)));
    expect(results.filter((r) => r.state === 'confirmed').length).toBe(1);
    expect(results.filter((r) => r.state === 'awaiting_capacity').length).toBe(2);
    const c = await counter(d!);
    expect(c.held + c.confirmed).toBe(1);
    // the confirmed one withdraws → the earliest waitlisted is promoted
    const winner = results.find((r) => r.state === 'confirmed')!;
    const waiting = results.filter((r) => r.state === 'awaiting_capacity').sort((x, y) => x.waitlistSeq! - y.waitlistSeq!);
    await regs.withdraw(winner._id, winner.applicantPrincipalId, rid());
    expect((await t.c.registrations.findOne({ _id: waiting[0]!._id }))!.state).toBe('confirmed');
    expect((await t.c.registrations.findOne({ _id: waiting[1]!._id }))!.state).toBe('awaiting_capacity');
  });

  it('rejects stale rules acceptance and registrations outside the window', async () => {
    const { disciplineIds: [d] } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'W', participantKind: 'player', capacity: 5 }] });
    const p = await player();
    await expect(register(d!, p, { acceptRulesHash: 'x'.repeat(64) })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await t.c.disciplines.updateOne({ _id: d! }, { $set: { 'config.registrationClosesAt': new Date(Date.now() - 1000).toISOString() } });
    await expect(register(d!, p)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});

describe('paid registration (AC-04, REG-010, FIN-004)', () => {
  it('browser drop after payment loses nothing; duplicate callbacks create one participation and one ledger effect', async () => {
    const { disciplineIds: [d] } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'Paid', participantKind: 'player', capacity: 3, feeRial: 1_000_000 }], refund: { before: 100, after: 50, cancel: 100, dq: 0 } });
    const p = await player();
    const r = await register(d!, p);
    expect(r.state).toBe('awaiting_payment');
    const { payment } = await pay.pay(r.orderId!, p, 'http://localhost/return', rid());
    const cb = (await gw.settle(payment.gatewayRef!, 'success'))!;
    // the browser never returns; only the PSP callback arrives — twice
    await pay.handleCallback(cb, rid());
    await pay.handleCallback(cb, rid());
    await t.consumer.drain();
    const done = (await t.c.registrations.findOne({ _id: r._id }))!;
    expect(done.state).toBe('confirmed');
    expect(await t.c.participations.countDocuments({ _id: done.participationId! })).toBe(1);
    expect(await t.c.ledger.countDocuments({ 'refs.orderId': r.orderId!, kind: 'payment' })).toBe(2);
  });

  it('payment racing the reservation expiry never confirms without capacity (allocate or refund)', async () => {
    const { disciplineIds: [d] } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'Race', participantKind: 'player', capacity: 1, feeRial: 500_000 }], refund: { before: 100, after: 100, cancel: 100, dq: 0 } });
    const late = await player();
    const r = await register(d!, late);
    const { payment } = await pay.pay(r.orderId!, late, 'http://localhost/return', rid());
    await t.c.registrations.updateOne({ _id: r._id }, { $set: { 'reservation.expiresAt': new Date(Date.now() - 1000).toISOString() } });
    // expiry and the verified payment happen concurrently
    const cb = (await gw.settle(payment.gatewayRef!, 'success'))!;
    await Promise.all([regs.expireReservations(), pay.handleCallback(cb, rid())]);
    // meanwhile someone else may take the freed place
    const other = await player();
    await register(d!, other).catch(() => undefined);
    await t.consumer.drain();
    const final = (await t.c.registrations.findOne({ _id: r._id }))!;
    const c = await counter(d!);
    expect(c.held + c.confirmed).toBeLessThanOrEqual(1);
    if (final.state === 'confirmed') expect(final.reservation?.released).toBe(false);
    else {
      expect(final.state).toBe('rejected');
      expect(await t.c.refunds.countDocuments({ orderId: r.orderId!, state: 'confirmed' })).toBe(1); // money returned, not lost
    }
    const q = await pay.reconciliationQueue(seedIds.finance, rid());
    expect(q.paidWithoutCapacity.map((x) => x.registrationId)).not.toContain(r._id);
  });

  it('withdrawal refunds per the published policy and a repeated withdrawal has no second effect', async () => {
    const { disciplineIds: [d] } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'WD', participantKind: 'player', capacity: 2, feeRial: 1_000_000 }], refund: { before: 80, after: 20, cancel: 100, dq: 0 } });
    const p = await player();
    const r = await register(d!, p);
    await settle(r._id);
    await regs.withdraw(r._id, p, rid());
    await expect(regs.withdraw(r._id, p, rid())).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
    const refunds = await t.c.refunds.find({ orderId: r.orderId! }).toArray();
    expect(refunds.length).toBe(1);
    expect(refunds[0]!.amountRial).toBe(800_000);
    expect((await counter(d!)).confirmed).toBe(0);
  });
});

describe('event cancellation (AC-19, 15.5)', () => {
  it('needs an independent approval; removes registrations, refunds, voids tickets and cancels prizes consistently', async () => {
    const { eventId, disciplineIds: [d] } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'C', participantKind: 'player', capacity: 3, feeRial: 300_000 }], refund: { before: 100, after: 100, cancel: 100, dq: 0 } });
    const p = await player();
    const r = await register(d!, p);
    await settle(r._id);
    const commerce = new CommerceService(t);
    await commerce.configureTickets(eventId, 10, 100_000, seedIds.organizer, rid());
    const fan = await player();
    const tk = await commerce.buyTickets(eventId, 2, fan, rid());
    const { payment } = await pay.pay(tk.orderId, fan, 'http://localhost/r', rid());
    await pay.handleCallback((await gw.settle(payment.gatewayRef!, 'success'))!, rid());
    await t.consumer.drain();
    expect((await t.c.tickets.find({ orderId: tk.orderId }).toArray()).every((x) => x.state === 'valid')).toBe(true);
    const ev = new EventsService(t);
    const appr = await t.approvals.request({ action: 'event.cancel', scope: { type: 'event', id: eventId }, payload: {}, reason: 'venue unavailable' }, { principalId: seedIds.organizer, requestId: rid() });
    await expect(ev.cancel(eventId, appr._id, 'venue unavailable', seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await t.approvals.decide(appr._id, { decision: 'approve', reason: 'confirmed', expectedVersion: 0 }, { principalId: seedIds.admin, requestId: rid() });
    await ev.cancel(eventId, appr._id, 'venue unavailable', seedIds.organizer, rid());
    await t.consumer.drain();
    expect((await t.c.registrations.findOne({ _id: r._id }))!.state).toBe('removed');
    expect(await t.c.refunds.countDocuments({ orderId: r.orderId!, state: 'confirmed' })).toBe(1);
    expect((await t.c.tickets.find({ orderId: tk.orderId }).toArray()).every((x) => x.state === 'void')).toBe(true);
    expect(await t.c.refunds.countDocuments({ orderId: tk.orderId, state: 'confirmed' })).toBe(1);
    expect((await t.c.prizes.find({ eventId }).toArray()).every((x) => x.state === 'cancelled')).toBe(true);
    expect((await counter(d!)).confirmed + (await counter(d!)).held).toBe(0);
    expect(await pay.ledger.unbalancedTransactions()).toEqual([]);
  });
});

describe('roles and duties', () => {
  it('a finance officer has no refereeing or registration-decision authority (BASE-007)', async () => {
    const { eventId } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'F', participantKind: 'player', capacity: 2 }] });
    expect(await t.acl.can(seedIds.finance, 'match.result.verify', { type: 'event', id: eventId })).toBe(false);
    expect(await t.acl.can(seedIds.finance, 'event.manage', { type: 'event', id: eventId })).toBe(false);
  });
});

describe('team roster, locks, substitutions and check-in (ROS, CHK, AC-02)', () => {
  it('team registration needs member confirmation; snapshots survive later team changes; substitutions follow the rules', async () => {
    const teams = new TeamService(t);
    const cap = await player();
    const m2 = await player();
    const m3 = await player();
    const team = await teams.createTeam(cap, { name: 'تیم آزمون', tag: `T${n}`, gameId: 'game_seed_synthetic', organizationId: null, description: null, city: null, links: [], sponsors: [], logoFileId: null, coverFileId: null }, rid());
    for (const m of [m2, m3]) {
      const inv = await teams.createInvitation(cap, team._id, { principalId: m, role: 'player', message: null }, rid());
      await teams.respondInvitation(m, inv._id, true, rid());
    }
    const { eventId, disciplineIds: [d] } = await openEvent(t, { packageId: teamPkg, disciplines: [{ name: 'Teams', participantKind: 'team', capacity: 4, checkin: true }] });
    const outsider = await player();
    await expect(register(d!, cap, { teamId: team._id, roster: [{ principalId: cap, role: 'starter' }, { principalId: outsider, role: 'starter' }] })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const r = await register(d!, cap, { teamId: team._id, roster: [{ principalId: cap, role: 'starter' }, { principalId: m2, role: 'starter' }, { principalId: m3, role: 'substitute' }] });
    expect(r.state).toBe('awaiting_review'); // m2 has not confirmed yet
    await regs.confirmMembership(r._id, 'confirm', m2, rid());
    const confirmed = (await t.c.registrations.findOne({ _id: r._id }))!;
    expect(confirmed.state).toBe('confirmed');
    const part = (await t.c.participations.findOne({ _id: confirmed.participationId! }))!;
    expect(part.snapshot.roster.map((x) => x.principalId).sort()).toEqual([cap, m2].sort());
    // AC-02: renaming the team afterwards does not change the competitive snapshot
    await teams.updateTeam(cap, team._id, { name: 'نام جدید', expectedVersion: (await t.c.teams.findOne({ _id: team._id }))!.version }, rid());
    expect((await t.c.participations.findOne({ _id: part._id }))!.snapshot.displayName).toBe('تیم آزمون');

    const roster = new RosterService(t);
    await expect(roster.lock('event', eventId, cap, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await roster.lock('event', eventId, seedIds.organizer, rid());
    // regular substitution after the lock is not allowed by this package
    await expect(roster.substitute(r._id, { kind: 'regular', outPrincipalId: m2, inPrincipalId: m3, matchId: null, reason: null }, cap, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    // emergency substitution needs an official and a reason
    await expect(roster.substitute(r._id, { kind: 'emergency', outPrincipalId: m2, inPrincipalId: m3, matchId: null, reason: 'injury' }, cap, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await roster.substitute(r._id, { kind: 'emergency', outPrincipalId: m2, inPrincipalId: m3, matchId: null, reason: 'hand injury before start' }, seedIds.organizer, rid());
    // season change cap of 1 is now reached
    await expect(roster.substitute(r._id, { kind: 'emergency', outPrincipalId: m3, inPrincipalId: m2, matchId: null, reason: 'second change' }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    // the original lock is unchanged (ROS-006)
    expect((await t.c.rosterLocks.findOne({ _id: `event:${eventId}:${r._id}` }))!.members.map((x) => x.principalId).sort()).toEqual([cap, m2].sort());

    // check-in (captain policy) within the window, then no-show finalisation for others
    const ci = await roster.checkIn('event', eventId, cap, rid());
    expect(ci.state).toBe('checked_in');
    await expect(roster.checkIn('event', eventId, outsider, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const ev = (await t.c.events.findOne({ _id: eventId }))!;
    const afterGrace = new Date(Date.parse(ev.startsAt!) - 30 * 60_000 + 11 * 60_000);
    expect(await roster.finalizeNoShows('event', eventId, 'system', rid(), afterGrace)).toEqual([]); // the only team checked in
  });
});

describe('eligibility, review and exports', () => {
  it('a human-review clause blocks auto-approval but a staff decision can approve with the reason recorded', async () => {
    const reviewPkg = await preparePublishable(t, [clause('roster.min', 1), clause('age.minimum', 16)]);
    const { disciplineIds: [d] } = await openEvent(t, { packageId: reviewPkg, disciplines: [{ name: 'Age', participantKind: 'player', capacity: 2 }] });
    const p = await player();
    const r = await register(d!, p);
    expect(r.state).toBe('awaiting_review');
    expect(r.eligibility.issues.map((i) => i.code)).toContain('age_review');
    await expect(regs.decide(r._id, 'approve', null, r.version, seedIds.referee, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await regs.decide(r._id, 'approve', null, r.version, seedIds.organizer, rid())).state).toBe('confirmed');
  });

  it('CSV export neutralises formula injection; invite import reports bad rows and binds codes to holders', async () => {
    const { disciplineIds: [d] } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'CSV', participantKind: 'player', capacity: 5, quotas: [{ kind: 'invite', size: 2 }] }] });
    const p = await player();
    await register(d!, p, { formAnswers: { note: '=HYPERLINK("http://evil")' } });
    const io = new RegistrationIo(t);
    // the organizer may export but private form answers stay hidden without evidence access (REG-008)
    expect(await io.exportCsv(d!, seedIds.organizer, rid())).not.toContain('HYPERLINK');
    const evId = (await t.c.disciplines.findOne({ _id: d! }))!.eventId;
    const ref = await player();
    await t.acl.grant({ principalId: ref, role: 'referee', scope: { type: 'event', id: evId }, expiresAt: null, reason: 'test' }, { principalId: 'system', requestId: rid() });
    const csv = await io.exportCsv(d!, ref, rid());
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    await expect(io.exportCsv(d!, p, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const invitee = await player();
    const res = await io.importInvites(d!, Buffer.from(`holderKey,quota\nplayer:${invitee},invite\nbogus,invite\nplayer:usr_missing,invite\n`), seedIds.organizer, rid());
    expect(res.created.length).toBe(1);
    expect(res.errors.map((e) => e.row)).toEqual([3, 4]);
    await expect(io.importInvites(d!, Buffer.from([0xff, 0xfe, 0x00, 0x41]), seedIds.organizer, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // the bound code works only for its holder, once, and uses the invite quota
    await expect(register(d!, p, { entryCode: res.created[0]!.code })).rejects.toBeTruthy();
    const ok = await register(d!, invitee, { entryCode: res.created[0]!.code });
    expect(ok.quotaKind).toBe('invite');
  });
});

describe('prizes (END-002, FIN-007/008)', () => {
  it('release needs a final result and finance authority; paid needs evidence; payout cannot repeat', async () => {
    const { eventId } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'P', participantKind: 'player', capacity: 2 }] });
    const prizes = new PrizeService(t);
    const prize = (await t.c.prizes.findOne({ eventId }))!;
    const winner = await player();
    let pz = await prizes.setRecipient(prize._id, { kind: 'player', ref: winner, payeePrincipalId: winner, shares: [], expectedVersion: prize.version, approvalId: null }, seedIds.organizer, rid());
    const ref = { matchOrStandingId: `standing_${eventId}`, resultVersion: 1, final: true as const };
    await expect(prizes.release(pz._id, ref, pz.version, seedIds.finance, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' }); // event not finished
    const e = (await t.c.events.findOne({ _id: eventId }))!;
    await t.c.events.updateOne({ _id: eventId }, { $set: { state: 'finished' } }); // provider stub for ESP-04/05
    await expect(prizes.release(pz._id, ref, pz.version, seedIds.finance, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' }); // no final result
    await t.c.resultVersions.insertOne({ _id: `rv_${eventId}`, targetType: 'standing', targetId: ref.matchOrStandingId, version: 1, calcVersion: 'contract-test', data: { final: true }, provenance: { source: 'contract-test', actorPrincipalId: null, reason: null, evidenceFileIds: [] }, createdAt: new Date().toISOString() });
    await expect(prizes.release(pz._id, ref, pz.version, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    pz = await prizes.release(pz._id, ref, pz.version, seedIds.finance, rid());
    expect(pz.state).toBe('ready_to_pay');
    const a = await t.approvals.request({ action: 'finance.payout', scope: { type: 'event', id: eventId }, payload: { prizeId: pz._id }, reason: 'prize payout' }, { principalId: seedIds.finance, requestId: rid() });
    await t.approvals.decide(a._id, { decision: 'approve', reason: 'ok', expectedVersion: 0 }, { principalId: seedIds.finance2, requestId: rid() });
    pz = await prizes.startPayout(pz._id, a._id, pz.version, seedIds.finance, rid());
    await expect(prizes.confirmPaid(pz._id, { evidenceFileId: null, providerRef: null, expectedVersion: pz.version }, seedIds.finance, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    pz = await prizes.confirmPaid(pz._id, { evidenceFileId: null, providerRef: 'BANK-REF-1', expectedVersion: pz.version }, seedIds.finance, rid());
    expect(pz.state).toBe('paid');
    await expect(prizes.confirmPaid(pz._id, { evidenceFileId: null, providerRef: 'BANK-REF-2', expectedVersion: pz.version }, seedIds.finance, rid())).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
    expect(await pay.ledger.unbalancedTransactions()).toEqual([]);
    void e;
    void applyTransition;
    void eventMachine;
  });
});
