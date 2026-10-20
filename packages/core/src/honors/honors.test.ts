import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventMachine, matchMachine } from '@esp/contracts';
import { testContainer, rid } from '../test/harness.js';
import { clause } from '../test/esp03-fixture.js';
import { competition, drawAndGenerate, win } from '../test/esp04-fixture.js';
import { seedIds } from '../db/seed-ids.js';
import { applyTransition } from '../domain/transition.js';
import { newId } from '../ids.js';
import type { MatchDoc } from '../db/collections.js';
import { MatchResultService } from '../competition/results.js';
import { RoomService } from '../competition/room.js';
import { OfficialsService } from '../integrity/officials.js';
import { DisputeService } from '../integrity/disputes.js';
import { RatingService } from '../ranking/ratings.js';
import { HonorService } from './honors.js';
import { EventCloseService } from './close.js';
import { CareerService } from '../ranking/career.js';

let t: Awaited<ReturnType<typeof testContainer>>;
beforeAll(async () => {
  t = await testContainer({ seed: true });
});
afterAll(async () => {
  await t.drop();
});

const RULES = () => [clause('elim.third_place', false), clause('dispute.appeal_minutes', 60), clause('result.decision', 'TEST ONLY: referee decides'), clause('honors.presence_min_matches', 1)];

async function person(label: string): Promise<string> {
  const id = `usr_${label}_${newId().slice(-8)}`;
  const now = new Date().toISOString();
  await t.c.principals.insertOne({ _id: id, kind: 'user', displayName: label, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0 });
  return id;
}

/** A rated SE-4 event where participant 0 is seed team A with a second, never-present roster member. */
async function playedEvent() {
  const fx = await competition(t, { clauses: RULES(), stages: [{ name: 'SE', format: 'single_elim' }], n: 4 });
  const bench = await person('bench');
  await t.c.events.updateOne({ _id: fx.eventId }, { $set: { 'config.rated': true } });
  await t.c.participations.updateOne({ _id: fx.participants[0]! }, { $set: { 'snapshot.teamId': seedIds.teamA, 'snapshot.displayName': 'تیم الف', 'snapshot.roster': [{ principalId: fx.principals[0]!, displayName: 'P1', role: 'captain' }, { principalId: bench, displayName: 'Bench', role: 'player' }] } });
  await drawAndGenerate(t, fx.stageIds[0]!, { method: 'manual', attributes: Object.fromEntries(fx.participants.map((id, i) => [id, { seed: i + 1 }])) });
  return { ...fx, bench };
}
async function play(stageId: string) {
  const results = new MatchResultService(t);
  const room = new RoomService(t);
  for (let loop = 0; loop < 5; loop++) {
    const ms = await t.c.matches.find({ stageId, state: 'scheduled' }).toArray();
    if (!ms.length) break;
    for (const m of ms) {
      let cur: MatchDoc = (await applyTransition(matchMachine, t.c.matches, m._id, { transition: 'open_checkin', expectedVersion: m.version, actorRoles: ['system'] })).doc;
      for (const side of [0, 1]) cur = await room.setLineup(cur._id, side, [cur.sides[side]!.roster[0]!.principalId], seedIds.referee, rid());
      for (const tr of ['mark_ready', 'start']) cur = (await applyTransition(matchMachine, t.c.matches, cur._id, { transition: tr, expectedVersion: cur.version, actorRoles: ['system'] })).doc;
      // the lower seed (side 0) wins every match
      await results.submit(cur._id, win(0), [], cur.sides[0]!.roster[0]!.principalId, rid());
      await results.confirm(cur._id, cur.sides[1]!.roster[0]!.principalId, rid());
    }
    await t.consumer.drain();
  }
}
async function activate(eventId: string) {
  for (const [tr, role] of [['close_registration', 'system'], ['start_preparation', 'system'], ['activate', 'organizer']] as const) {
    const e = (await t.c.events.findOne({ _id: eventId }))!;
    await applyTransition(eventMachine, t.c.events, eventId, { transition: tr, expectedVersion: e.version, actorRoles: [role] });
  }
}
const version = async (eventId: string) => (await t.c.events.findOne({ _id: eventId }))!.version;
async function closeApproval(eventId: string) {
  const a = await t.approvals.request({ action: 'event.close', scope: { type: 'event', id: eventId }, payload: {}, reason: 'TEST ONLY close' }, { principalId: seedIds.organizer, requestId: rid() });
  await t.approvals.decide(a._id, { decision: 'approve', reason: 'ok', expectedVersion: a.version }, { principalId: seedIds.admin, requestId: rid() });
  return a._id;
}

describe('event close, honors, certificates (END-001..007, AWD-001..004, AC-12/13)', () => {
  it('finish/close gates, exactly-once honors, presence condition, history preserved across rename and roster moves', async () => {
    const fx = await playedEvent();
    const close = new EventCloseService(t);
    const honors = new HonorService(t);
    await activate(fx.eventId);
    await expect(close.finish(fx.eventId, await version(fx.eventId), seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await play(fx.stageIds[0]!);
    expect((await t.c.stages.findOne({ _id: fx.stageIds[0]! }))!.state).toBe('finished');
    await close.finish(fx.eventId, await version(fx.eventId), seedIds.organizer, rid());
    // an open case blocks the close
    const ds = new DisputeService(t);
    const head = await person('head');
    await new OfficialsService(t).assign({ eventId: fx.eventId, matchId: null, principalId: head, role: 'head_referee' }, seedIds.organizer, rid());
    const kase = await ds.file({ eventId: fx.eventId, matchId: null, category: 'conduct', claim: 'Unsporting chat after the final', evidenceFileIds: [] }, fx.principals[1]!, rid());
    await expect(close.close(fx.eventId, await version(fx.eventId), null, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await ds.assign(kase._id, seedIds.referee, head, rid());
    await ds.startReview(kase._id, seedIds.referee);
    await ds.decideFirst(kase._id, { clauseKey: 'result.decision', publicSummary: 'Warning only, no sanction', reasoning: 'Chat log reviewed, minor', effect: { kind: 'none' } }, seedIds.referee, rid());
    expect(await ds.closeExpired(new Date(Date.now() + 2 * 3600_000))).toBe(1);
    // ranking system published before the close so the close triggers its rebuild
    const officer = await person('rules');
    await t.acl.grant({ principalId: officer, role: 'rules_officer', scope: { type: 'site', id: 'site' }, expiresAt: null, reason: 'TEST ONLY' }, { principalId: 'system', requestId: rid() });
    const ratings = new RatingService(t);
    const sys = await ratings.create({ gameId: 'game_seed_synthetic', mode: '5v5', platform: 'pc', subject: 'team', model: 'glicko2', params: { initialRating: 1500, initialRd: 350, initialVolatility: 0.06, tau: 0.5, periodDays: 7 }, seasonId: null, carry: { kind: 'reset', factor: null }, inactivityDays: 180, tiebreak: ['games'], regionBasis: 'TEST ONLY profile region at result time', eventWeights: { standard: 1 }, eligibility: 'TEST ONLY rated events' }, officer, rid());
    await ratings.publish(sys._id, officer, rid());
    // close (twice: the second call resumes and must not duplicate anything) and a concurrent issuer
    await expect(close.close(fx.eventId, await version(fx.eventId), null, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const first = await close.close(fx.eventId, await version(fx.eventId), await closeApproval(fx.eventId), seedIds.organizer, rid());
    expect(first.event.state).toBe('closed');
    await close.close(fx.eventId, await version(fx.eventId), null, seedIds.organizer, rid());
    await Promise.all([1, 2, 3].map(() => honors.issueForEvent(fx.eventId, rid())));
    const all = await t.c.honors.find({ eventId: fx.eventId, state: 'active' }).toArray();
    expect(all.filter((h) => h.label === 'champion')).toHaveLength(1);
    expect(all.filter((h) => h.label === 'silver')).toHaveLength(1);
    const champ = all.find((h) => h.label === 'champion')!;
    expect(champ.participationId).toBe(fx.participants[0]);
    expect(champ.team).toEqual({ teamId: seedIds.teamA, nameAtTime: 'تیم الف' });
    expect(champ.recipients.find((r) => r.principalId === fx.bench)!.eligible).toBe(false); // never present
    expect(champ.recipients.find((r) => r.principalId === fx.principals[0])!.eligible).toBe(true);
    expect(await t.c.outbox.countDocuments({ type: 'honors.issued', 'payload.eventId': fx.eventId })).toBe(all.length);
    expect(await t.c.outbox.countDocuments({ type: 'competition.event.closed', 'aggregate.id': fx.eventId })).toBe(1);
    expect(await t.c.eventArchives.countDocuments({ _id: fx.eventId })).toBe(1);
    // certificates: attendance for the present, placement for eligible recipients, never for the bench
    expect(await t.c.certificates.countDocuments({ eventId: fx.eventId, principalId: fx.bench })).toBe(0);
    expect(await t.c.certificates.countDocuments({ eventId: fx.eventId, principalId: fx.principals[0]!, state: 'active' })).toBe(2);
    // history: rename the team and move the player out — the honor keeps the name at the time
    await t.c.teams.updateOne({ _id: seedIds.teamA }, { $set: { name: 'Renamed Team' } });
    await t.c.teamMemberships.deleteMany({ teamId: seedIds.teamA, principalId: fx.principals[0]! });
    const teamView = await honors.forTeam(seedIds.teamA);
    expect(teamView.verified.find((h) => h.id === champ._id)!.team!.nameAtTime).toBe('تیم الف');
    expect((await honors.forPrincipal(fx.principals[0]!)).verified.map((h) => h.id)).toContain(champ._id);
    expect((await honors.forPrincipal(fx.bench)).verified).toHaveLength(0);
    // verification and share card
    const v = await honors.verify(champ.verifyCode);
    expect(v.valid).toBe(true);
    const svg = await honors.shareCard(champ._id);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(champ.verifyCode);
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/); // no remote assets
    // revocation needs authority and a reason
    await expect(honors.revoke(champ._id, 'TEST ONLY doping', seedIds.organizer, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await honors.revoke(champ._id, 'TEST ONLY eligibility fraud found later', seedIds.admin, rid());
    expect((await honors.verify(champ.verifyCode)).valid).toBe(false);
    // feedback once per participant; outsiders refused
    await close.feedback(fx.eventId, 5, 'خوب بود', fx.principals[1]!);
    await expect(close.feedback(fx.eventId, 4, null, fx.principals[1]!)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(close.feedback(fx.eventId, 4, null, officer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const report = await close.report(fx.eventId, seedIds.organizer, rid());
    expect(report.feedback).toMatchObject({ count: 1, average: 5 });
    expect(report.casesByCategory).toEqual({ conduct: 1 });
    // career read model: the team keeps its record and placement after the rename and roster move
    const career = new CareerService(t);
    const teamCareer = await career.team(seedIds.teamA);
    expect(teamCareer).toMatchObject({ played: 2, wins: 2, losses: 0 });
    expect(teamCareer.standings[0]).toMatchObject({ place: 1, nameAtTime: 'تیم الف' });
    expect((await career.player(fx.bench)).played).toBe(0); // never on the field
    const h2h = await career.headToHead('player', fx.principals[0]!, fx.principals[3]!);
    expect(h2h).toMatchObject({ played: 1, wins: 1 });

    // ---- ratings: the close started a build; run it, then prove replay / mid-build failure give the same state
    const job = (await t.c.ratingJobs.find({ systemId: sys._id, state: 'running' }).toArray())[0]!;
    const done = await ratings.runJob(job._id);
    expect(done.state).toBe('complete');
    expect(done.processed).toBe(3);
    expect(await t.c.ratingEvents.countDocuments({ build: job._id })).toBe(6);
    await ratings.runJob(job._id); // replay of a finished build
    expect(await t.c.ratingEvents.countDocuments({ build: job._id })).toBe(6);
    const board = await ratings.leaderboard(sys._id, { offset: 0, limit: 10 });
    expect(board.label).toMatchObject({ official: false, text: 'internal_unapproved' });
    expect(board.rows[0]!.subjectId).toBe(seedIds.teamA);
    const b2 = await ratings.startBuild(sys._id);
    await expect(ratings.runJob(b2._id, { failAfter: 1 })).rejects.toThrow('injected');
    expect((await t.c.ratingJobs.findOne({ _id: b2._id }))!.processed).toBe(1);
    expect((await t.c.ratingSystems.findOne({ _id: sys._id }))!.activeBuild).toBe(job._id); // the half build is never shown
    await ratings.runJob(b2._id);
    const r1 = (await t.c.ratings.find({ build: job._id }).toArray()).map((r) => [r.subjectId, r.rating, r.rd, r.games]).sort();
    const r2 = (await t.c.ratings.find({ build: b2._id }).toArray()).map((r) => [r.subjectId, r.rating, r.rd, r.games]).sort();
    expect(r2).toEqual(r1);
    expect((await t.c.ratingSystems.findOne({ _id: sys._id }))!.activeBuild).toBe(b2._id);
    // approval: never by the author; then the label is official
    await expect(ratings.approve(sys._id, 'TEST ONLY owner letter 1', officer, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await ratings.approve(sys._id, 'TEST ONLY owner letter 1', seedIds.admin, rid());
    expect((await ratings.leaderboard(sys._id, { offset: 0, limit: 10 })).label.official).toBe(true);
    expect((await ratings.trend(seedIds.teamA))[0]!.points).toHaveLength(2);
  });

  it('special awards need an approver other than the proposer, in the declared role', async () => {
    const fx = await competition(t, { clauses: RULES(), stages: [{ name: 'SE', format: 'single_elim' }], n: 2 });
    const honors = new HonorService(t);
    const a = await honors.proposeSpecial({ eventId: fx.eventId, title: 'MVP', method: 'official_selection', approverRole: 'organizer', participationId: fx.participants[0]!, principalId: fx.principals[0]!, justification: 'TEST ONLY best performance' }, seedIds.organizer, rid());
    await expect(honors.decideSpecial(a._id, true, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTIES' });
    await expect(honors.decideSpecial(a._id, true, seedIds.referee, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const head = await person('head');
    const b = await honors.proposeSpecial({ eventId: fx.eventId, title: 'MVP', method: 'statistics', approverRole: 'head_referee', participationId: fx.participants[0]!, principalId: fx.principals[0]!, justification: 'TEST ONLY most kills' }, seedIds.organizer, rid());
    await new OfficialsService(t).assign({ eventId: fx.eventId, matchId: null, principalId: head, role: 'head_referee' }, seedIds.organizer, rid());
    const ok = await honors.decideSpecial(b._id, true, head, rid());
    expect(ok.state).toBe('approved');
    const h = (await t.c.honors.findOne({ _id: ok.honorId! }))!;
    expect(h.kind).toBe('mvp');
    expect(h.recipients.map((r) => r.principalId)).toEqual([fx.principals[0]]);
  });

  it('declared achievements stay separate and need an independent review', async () => {
    const honors = new HonorService(t);
    const d = await honors.declare({ owner: { kind: 'principal', ref: seedIds.player }, title: 'قهرمان لیگ محلی', eventName: 'TEST ONLY local cup', year: 2024, evidenceFileIds: [] }, seedIds.player, rid());
    await expect(honors.declare({ owner: { kind: 'principal', ref: seedIds.captain }, title: 'x claim', eventName: 'TEST ONLY cup', year: null, evidenceFileIds: [] }, seedIds.player, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await honors.forPrincipal(seedIds.player)).declared[0]).toMatchObject({ label: 'declared_unverified' });
    await expect(honors.reviewDeclared(d._id, 'verified', null, seedIds.player, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await honors.reviewDeclared(d._id, 'verified', null, seedIds.admin, rid());
    const view = await honors.forPrincipal(seedIds.player);
    expect(view.declared[0]).toMatchObject({ label: 'declared_verified' });
    expect(view.verified).toHaveLength(0); // never mixed with platform honors
  });
});

describe('rating parameters (RANK-001/002)', () => {
  it('validates glicko ranges and lobby point tables with a cited source', () => {
    const r = new RatingService(t);
    expect(() => r.validateParams('glicko2', { initialRating: 1500, initialRd: 600, initialVolatility: 0.06, tau: 0.5, periodDays: 7 })).toThrow();
    expect(() => r.validateParams('lobby_points', { placementPoints: [10, 12], killPoints: 1, source: 'rules#lobby' })).toThrow();
    expect(() => r.validateParams('lobby_points', { placementPoints: [12, 9, 7], killPoints: 1, source: '' })).toThrow();
    expect(() => r.validateParams('lobby_points', { placementPoints: [12, 9, 7], killPoints: 1, source: 'TEST ONLY package clause lobby.placement_points' })).not.toThrow();
  });
});
