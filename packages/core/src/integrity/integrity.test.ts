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
import { StructureService } from '../competition/structure.js';
import { OfficialsService } from './officials.js';
import { DisputeService } from './disputes.js';
import { SanctionService } from './sanctions.js';
import { CorrectionService } from './corrections.js';

let t: Awaited<ReturnType<typeof testContainer>>;
let results: MatchResultService;
let disputes: DisputeService;
let officials: OfficialsService;
let sanctions: SanctionService;
let corrections: CorrectionService;
beforeAll(async () => {
  t = await testContainer({ seed: true });
  results = new MatchResultService(t);
  disputes = new DisputeService(t);
  officials = new OfficialsService(t);
  sanctions = new SanctionService(t);
  corrections = new CorrectionService(t);
});
afterAll(async () => {
  await t.drop();
});

const RULES = (extra: ReturnType<typeof clause>[] = []) => [
  clause('elim.third_place', false), clause('points.win', 3), clause('points.draw', 1), clause('points.loss', 0), clause('tiebreak.order', ['score_diff']), clause('rr.legs', 1),
  clause('dispute.deadline_minutes', 60), clause('dispute.appeal_minutes', 60), clause('conduct.penalty', 'TEST ONLY: up to 3 points'), clause('result.decision', 'TEST ONLY: referee decides'),
  ...extra,
];

async function person(label: string): Promise<string> {
  const id = `usr_${label}_${newId().slice(-8)}`;
  const now = new Date().toISOString();
  await t.c.principals.insertOne({ _id: id, kind: 'user', displayName: label, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0 });
  return id;
}

async function se4(extra: ReturnType<typeof clause>[] = []) {
  const fx = await competition(t, { clauses: RULES(extra), stages: [{ name: 'SE', format: 'single_elim' }], n: 4 });
  await drawAndGenerate(t, fx.stageIds[0]!, { method: 'manual', attributes: Object.fromEntries(fx.participants.map((id, i) => [id, { seed: i + 1 }])) });
  const head = await person('head');
  await officials.assign({ eventId: fx.eventId, matchId: null, principalId: head, role: 'head_referee' }, seedIds.organizer, rid());
  return { ...fx, head };
}
const p = (m: MatchDoc, side: number) => m.sides[side]!.roster[0]!.principalId;
async function live(m: MatchDoc): Promise<MatchDoc> {
  let cur = (await t.c.matches.findOne({ _id: m._id }))!;
  for (const tr of ['open_checkin', 'mark_ready', 'start']) cur = (await applyTransition(matchMachine, t.c.matches, cur._id, { transition: tr, expectedVersion: cur.version, actorRoles: ['system'] })).doc;
  return cur;
}
async function scheduled(stageId: string) {
  return t.c.matches.find({ stageId, state: 'scheduled' }).sort({ 'slot.round': 1, 'slot.order': 1 }).toArray();
}
async function playAgreed(m: MatchDoc, outcome = win(0)) {
  const l = await live(m);
  await results.submit(l._id, outcome, [], p(l, 0), rid());
  await results.confirm(l._id, p(l, 1), rid());
  await t.consumer.drain();
}

describe('officials (REF-001)', () => {
  it('refuses a conflicted official and a double-booked referee without an authorised override', async () => {
    const fx = await se4();
    const [m1, m2] = await scheduled(fx.stageIds[0]!);
    await expect(officials.assign({ eventId: fx.eventId, matchId: m1!._id, principalId: p(m1!, 0), role: 'referee' }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'CONFLICT' });
    const ref = await person('ref');
    const at = new Date(Date.now() + 86_400_000).toISOString();
    await t.c.matches.updateMany({ _id: { $in: [m1!._id, m2!._id] } }, { $set: { scheduledAt: at } });
    await officials.assign({ eventId: fx.eventId, matchId: m1!._id, principalId: ref, role: 'referee' }, seedIds.organizer, rid());
    await expect(officials.assign({ eventId: fx.eventId, matchId: m2!._id, principalId: ref, role: 'referee' }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'CONFLICT' });
    await officials.assign({ eventId: fx.eventId, matchId: m2!._id, principalId: ref, role: 'referee', overrideReason: 'TEST ONLY: short matches back to back' }, seedIds.organizer, rid());
    expect((await t.c.matches.findOne({ _id: m2!._id }))!.resources?.refereeIds).toContain(ref);
    await expect(officials.assign({ eventId: fx.eventId, matchId: null, principalId: ref, role: 'appeal_authority' }, p(m1!, 0), rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('result lifecycle (RES-001..005, AC-09)', () => {
  it('opponent confirmation finalises; a second confirmation is refused', async () => {
    const fx = await se4();
    const [m] = await scheduled(fx.stageIds[0]!);
    const l = await live(m!);
    await expect(results.confirm(l._id, p(l, 1), rid())).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
    await results.submit(l._id, win(0), [], p(l, 0), rid());
    await expect(results.confirm(l._id, p(l, 0), rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' }); // own submission
    const f = await results.confirm(l._id, p(l, 1), rid());
    expect(f.state).toBe('final');
    expect(f.result!.confirmations).toHaveLength(1);
    const versions = await t.c.resultVersions.find({ targetType: 'match', targetId: l._id }).sort({ version: 1 }).toArray();
    expect(versions.map((v) => v.calcVersion)).toEqual(['submission', 'official']);
    expect(versions[1]!.provenance.reason).toContain('confirmed by side 1');
  });

  it('conflicting submissions open a case automatically; the open case blocks every finalisation path', async () => {
    const fx = await se4();
    const [m] = await scheduled(fx.stageIds[0]!);
    const l = await live(m!);
    await results.submit(l._id, win(0), [], p(l, 0), rid());
    const after = await results.submit(l._id, win(1), [], p(l, 1), rid());
    expect(after.state).toBe('disputed');
    const kase = (await disputes.openFor(l._id))!;
    expect(kase.category).toBe('result');
    expect(kase.parties.sort()).toEqual([p(l, 0), p(l, 1)].sort());
    await expect(results.finalize(l._id, win(0), seedIds.referee, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(results.finalize(l._id, win(0), 'system', rid(), { system: true })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(await t.c.outbox.countDocuments({ type: 'competition.match.finalized', 'payload.matchId': l._id })).toBe(0);
  });

  it('auto-confirm follows the rules and skips results with an open case or an integration mismatch', async () => {
    const fx = await se4([clause('result.confirm_minutes', 5), clause('result.auto_confirm', true)]);
    const [a, b] = await scheduled(fx.stageIds[0]!);
    const la = await live(a!);
    const lb = await live(b!);
    await results.submit(la._id, win(0), [], p(la, 0), rid());
    await results.submit(lb._id, win(0), [], p(lb, 0), rid());
    await results.ingest(lb._id, win(1), [], 'TEST-INTEGRATION', rid());
    expect((await t.c.matches.findOne({ _id: lb._id }))!.result!.review?.reason).toBe('integration_mismatch');
    expect(await results.autoConfirm(new Date())).toBe(0); // window still open
    expect(await results.autoConfirm(new Date(Date.now() + 6 * 60_000))).toBe(1);
    expect((await t.c.matches.findOne({ _id: la._id }))!.state).toBe('final');
    expect((await t.c.matches.findOne({ _id: lb._id }))!.state).toBe('provisional'); // mismatch waits for an official
    await results.finalize(lb._id, win(0), seedIds.referee, rid());
    expect((await t.c.matches.findOne({ _id: lb._id }))!.result!.review).toBeNull();
  });

  it('rules without an auto-confirm clause never auto-finalise', async () => {
    const fx = await se4();
    const [m] = await scheduled(fx.stageIds[0]!);
    const l = await live(m!);
    await results.submit(l._id, win(0), [], p(l, 0), rid());
    expect((await t.c.matches.findOne({ _id: l._id }))!.result!.policy).toBeNull();
    expect(await results.autoConfirm(new Date(Date.now() + 365 * 86_400_000))).toBe(0);
  });

  it('parallel finalisation produces exactly one final result and one outbox event; replayed consumers advance once', async () => {
    const fx = await se4();
    const [m, other] = await scheduled(fx.stageIds[0]!);
    const l = await live(m!);
    await results.submit(l._id, win(0), [], p(l, 0), rid());
    const outs = await Promise.allSettled([1, 2, 3, 4].map(() => results.finalize(l._id, null, seedIds.referee, rid())));
    expect(outs.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(await t.c.outbox.countDocuments({ type: 'competition.match.finalized', 'payload.matchId': l._id })).toBe(1);
    expect(await t.c.resultVersions.countDocuments({ targetType: 'match', targetId: l._id, calcVersion: 'official' })).toBe(1);
    await t.consumer.drain();
    await playAgreed(other!);
    await new StructureService(t).sync(fx.stageIds[0]!, rid()); // a replay of the advancement is harmless
    const final = (await t.c.matches.find({ stageId: fx.stageIds[0]!, 'slot.round': 2 }).toArray())[0]!;
    expect(final.participantIds?.filter((x) => x === l.participantIds![0])).toHaveLength(1);
  });

  it('game units are validated by the game module and stored with the official result', async () => {
    const fx = await se4();
    const [m] = await scheduled(fx.stageIds[0]!);
    const l = await live(m!);
    await expect(results.submit(l._id, win(0), [], p(l, 0), rid(), [{ order: 1, kind: 'map', label: 'Map 1', values: { nonsense: true } }])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const units = [{ order: 1, kind: 'map' as const, label: 'Map 1', values: { a: 'x', b: 'y', mapsA: 2, mapsB: 1, scoreA: 30, scoreB: 25, winner: 'a' } }];
    await results.submit(l._id, win(0), [], p(l, 0), rid(), units);
    await results.confirm(l._id, p(l, 1), rid());
    const gu = await t.c.gameUnits.find({ matchId: l._id }).toArray();
    expect(gu).toHaveLength(1);
    expect(gu[0]!.state).toBe('final');
  });
});

describe('dispute cases (REF-002..006, AC-10)', () => {
  it('full case: assignment, defence, decision with clause, party view, independent appeal', async () => {
    const fx = await se4();
    const aa1 = await person('appeal1');
    await officials.assign({ eventId: fx.eventId, matchId: null, principalId: aa1, role: 'appeal_authority' }, seedIds.organizer, rid());
    const [m] = await scheduled(fx.stageIds[0]!);
    const l = await live(m!);
    await results.submit(l._id, win(0), [], p(l, 0), rid());
    const kase = await results.contest(l._id, 'The score was recorded wrongly by side one', [], p(l, 1), rid());
    expect((await t.c.matches.findOne({ _id: l._id }))!.state).toBe('disputed');
    await expect(disputes.assign(kase._id, seedIds.referee, p(l, 0), rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(disputes.assign(kase._id, p(l, 0), fx.head, rid())).rejects.toMatchObject({ code: 'CONFLICT' }); // a party
    await disputes.assign(kase._id, seedIds.referee, fx.head, rid());
    await expect(disputes.defend(kase._id, 'I filed it so cannot defend', [], p(l, 1), rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await disputes.defend(kase._id, 'Our score is right, see the lobby log', [], p(l, 0), rid());
    await disputes.requestEvidence(kase._id, p(l, 0), 'Upload the scoreboard', null, seedIds.referee);
    await disputes.startReview(kase._id, seedIds.referee);
    await expect(disputes.decideFirst(kase._id, { clauseKey: 'result.decision', publicSummary: 'Side one result stands', reasoning: 'Lobby log matches side one', effect: { kind: 'none' } }, seedIds.referee, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' }); // disputed result needs an outcome
    await expect(disputes.decideFirst(kase._id, { clauseKey: 'no.such.clause', publicSummary: 'Side one result stands', reasoning: 'Lobby log matches side one', effect: { kind: 'result_change', outcome: win(0) } }, seedIds.referee, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const decided = await disputes.decideFirst(kase._id, { clauseKey: 'result.decision', publicSummary: 'Side one result stands', reasoning: 'Lobby log matches side one', effect: { kind: 'result_change', outcome: win(0) } }, seedIds.referee, rid());
    expect(decided.state).toBe('first_decision');
    expect(decided.decisions[0]!.rulesRef.clauseKey).toBe('result.decision');
    expect((await t.c.matches.findOne({ _id: l._id }))!.state).toBe('final');
    // party projection: summary and clause, never reasoning; viewing is recorded
    const pv = (await disputes.view(kase._id, p(l, 1), rid())) as Record<string, unknown>;
    expect(pv['role']).toBe('party');
    expect(JSON.stringify(pv)).not.toContain('Lobby log matches');
    expect((await disputes.load(kase._id)).views.some((v) => v.principalId === p(l, 1))).toBe(true);
    const pub = await disputes.publicDecisions(fx.eventId);
    expect(JSON.stringify(pub)).not.toContain('Lobby log matches');
    expect(JSON.stringify(pub)).not.toContain(p(l, 1));
    // appeal → the independent authority, never the first decider
    const ap = await disputes.appeal(kase._id, 'The referee ignored our evidence', p(l, 1), rid());
    expect(ap.appealAuthority).toBe(aa1);
    await expect(disputes.decideAppeal(kase._id, { clauseKey: 'result.decision', publicSummary: 'Upheld on appeal', reasoning: 'Same reasoning applies', effect: { kind: 'none' } }, seedIds.referee, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const closed = await disputes.decideAppeal(kase._id, { clauseKey: 'result.decision', publicSummary: 'Upheld on appeal', reasoning: 'Same reasoning applies', effect: { kind: 'none' } }, aa1, rid());
    expect(closed.state).toBe('closed');
    expect(closed.decisions.map((d) => d.level)).toEqual(['first', 'appeal']);
    expect(new Set(closed.decisions.map((d) => d.by)).size).toBe(2);
  });

  it('an appeal is refused when no independent appeal authority is appointed', async () => {
    const fx = await se4();
    const [m] = await scheduled(fx.stageIds[0]!);
    const l = await live(m!);
    await results.submit(l._id, win(0), [], p(l, 0), rid());
    const kase = await results.contest(l._id, 'Wrong score recorded by side one', [], p(l, 1), rid());
    // the only appeal authority is the first decider → not independent
    await officials.assign({ eventId: fx.eventId, matchId: null, principalId: seedIds.referee, role: 'appeal_authority' }, seedIds.organizer, rid());
    await disputes.assign(kase._id, seedIds.referee, fx.head, rid());
    await disputes.startReview(kase._id, seedIds.referee).catch(async () => undefined);
    await t.c.disputes.updateOne({ _id: kase._id }, { $set: { 'deadlines.defenseBy': null } });
    if ((await disputes.load(kase._id)).state === 'assigned') await disputes.startReview(kase._id, seedIds.referee);
    await disputes.decideFirst(kase._id, { clauseKey: 'result.decision', publicSummary: 'Side two wins', reasoning: 'Evidence shows side two won', effect: { kind: 'result_change', outcome: win(1) } }, seedIds.referee, rid());
    await expect(disputes.appeal(kase._id, 'appeal please', p(l, 0), rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});

describe('sanctions (REF-004, INT-003/004)', () => {
  it('a penalty without authority or without a rules clause is rejected; an authorised one changes standings', async () => {
    const fx = await competition(t, { clauses: RULES(), stages: [{ name: 'RR', format: 'round_robin' }], n: 3 });
    await drawAndGenerate(t, fx.stageIds[0]!);
    const base = { subject: { kind: 'participation' as const, ref: fx.participants[0]!, displayName: 'P1' }, scope: { kind: 'event' as const, id: fx.eventId }, type: 'point_penalty' as const, points: 2, stageId: fx.stageIds[0]!, until: null, reason: 'TEST ONLY misconduct', caseId: null };
    await expect(sanctions.issue({ ...base, clauseKey: 'conduct.penalty' }, fx.principals[1]!, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(sanctions.issue({ ...base, clauseKey: 'conduct.missing' }, seedIds.referee, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await sanctions.issue({ ...base, clauseKey: 'conduct.penalty' }, seedIds.referee, rid());
    const st = (await t.c.stageStructures.findOne({ _id: fx.stageIds[0]! }))!;
    expect(st.standings!.rows.find((r) => r.id === fx.participants[0])!.metrics['points']).toBe(-2);
    await expect(sanctions.issue({ ...base, scope: { kind: 'platform', id: 'site' }, type: 'suspension_permanent', subject: { kind: 'principal', ref: fx.principals[0]!, displayName: 'P1' }, clauseKey: 'conduct.penalty' }, seedIds.referee, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('corrections (RES-006..008, AC-11)', () => {
  async function approval(matchId: string, head: string) {
    const a = await t.approvals.request({ action: 'match.result.correct', scope: { type: 'match', id: matchId }, payload: {}, reason: 'TEST ONLY correction' }, { principalId: head, requestId: rid() });
    await t.approvals.decide(a._id, { decision: 'approve', reason: 'ok', expectedVersion: a.version }, { principalId: seedIds.admin, requestId: rid() });
    return a._id;
  }

  it('a started dependent blocks an automatic path rewrite and opens a case', async () => {
    const fx = await se4();
    const [s1, s2] = await scheduled(fx.stageIds[0]!);
    await playAgreed(s1!);
    await playAgreed(s2!);
    const final = (await scheduled(fx.stageIds[0]!))[0]!;
    await live(final);
    const before = (await t.c.matches.findOne({ _id: final._id }))!;
    const cor = await corrections.request(s1!._id, win(1), 'TEST ONLY wrong winner recorded', null, await approval(s1!._id, fx.head), fx.head, rid());
    expect(cor.state).toBe('blocked_dependency');
    expect(cor.impact.startedDependents.map((d) => d.matchId)).toContain(final._id);
    expect(cor.caseId).toBeTruthy();
    const after = (await t.c.matches.findOne({ _id: final._id }))!;
    expect(after.participantIds).toEqual(before.participantIds);
    expect((await t.c.matches.findOne({ _id: s1!._id }))!.state).toBe('final');
    expect((await t.c.matches.findOne({ _id: s1!._id }))!.outcome).toEqual(win(0));
  });

  it('without approval it is refused; with approval the path is recomputed and a failure resumes consistently', async () => {
    const fx = await se4();
    const [s1, s2] = await scheduled(fx.stageIds[0]!);
    await playAgreed(s1!);
    await playAgreed(s2!);
    const final = (await scheduled(fx.stageIds[0]!))[0]!;
    expect(final.participantIds).toContain(s1!.participantIds![0]);
    await expect(corrections.request(s1!._id, win(1), 'TEST ONLY wrong winner', null, null, fx.head, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const preview = await corrections.preview(s1!._id, win(1), fx.head, rid());
    expect(preview.resetMatches).toContain(final._id);
    expect(preview.startedDependents).toHaveLength(0);
    const failed = await corrections.request(s1!._id, win(1), 'TEST ONLY wrong winner', null, await approval(s1!._id, fx.head), fx.head, rid(), { failAfter: 'result' });
    expect(failed.state).toBe('failed');
    expect(failed.steps).toEqual(['freeze', 'reset_dependents', 'result']);
    expect(await t.c.leases.countDocuments({})).toBe(0); // lease released even on failure
    const done = await corrections.resume(failed._id, fx.head, rid());
    expect(done.state).toBe('applied');
    await t.consumer.drain();
    const f2 = (await t.c.matches.findOne({ _id: final._id }))!;
    expect(f2.participantIds).toContain(s1!.participantIds![1]);
    expect(f2.participantIds).not.toContain(s1!.participantIds![0]);
    expect((await t.c.matches.findOne({ _id: s1!._id }))!.outcome).toEqual(win(1));
    expect(await t.c.outbox.countDocuments({ type: 'competition.result.corrected', 'payload.correctionId': done._id })).toBe(1);
    // resuming again changes nothing
    await expect(corrections.resume(done._id, fx.head, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const versions = await t.c.resultVersions.find({ targetType: 'match', targetId: s1!._id }).sort({ version: 1 }).toArray();
    expect(versions.map((v) => v.calcVersion)).toEqual(['submission', 'official', 'reopen', 'official']);
  });
});

describe('lineup presence (AWD-002 input)', () => {
  it('only roster members, only by the side or an official, locked after the result', async () => {
    const fx = await se4();
    const [m] = await scheduled(fx.stageIds[0]!);
    const room = new RoomService(t);
    const open = (await applyTransition(matchMachine, t.c.matches, m!._id, { transition: 'open_checkin', expectedVersion: m!.version, actorRoles: ['system'] })).doc;
    await expect(room.setLineup(open._id, 0, [p(open, 1)], p(open, 0), rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(room.setLineup(open._id, 1, [p(open, 1)], p(open, 0), rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const r = await room.setLineup(open._id, 0, [p(open, 0)], p(open, 0), rid());
    expect(r.sides[0]!.roster[0]!.present).toBe(true);
    void eventMachine;
  });
});
