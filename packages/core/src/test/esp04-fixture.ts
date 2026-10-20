import { eventMachine, matchMachine, type Clause } from '@esp/contracts';
import type { Container } from '../container.js';
import type { MatchDoc, StageDoc } from '../db/collections.js';
import type { MatchOutcome } from '../db/collections-esp04.js';
import { seedIds } from '../db/seed-ids.js';
import { applyTransition } from '../domain/transition.js';
import { EventsService } from '../events/events.js';
import { newId } from '../ids.js';
import { DrawService, type DrawInput } from '../competition/draws.js';
import { StructureService } from '../competition/structure.js';
import { MatchResultService } from '../competition/results.js';
import { clause, preparePublishable } from './esp03-fixture.js';

/**
 * TEST ONLY fixture for ESP-04: a published event with one discipline and the given stages (stages freeze at
 * publication), n confirmed participations with one principal each, and the seed referee granted on the event.
 */
export async function competition(
  ct: Container,
  opts: { clauses: Clause[]; stages: Array<{ name: string; format: string; links?: StageDoc['links']; phases?: StageDoc['phases']; settings?: Record<string, unknown>; overrides?: StageDoc['overrides']; presence?: 'online' | 'offline' | 'hybrid' }>; n: number },
): Promise<{ eventId: string; disciplineId: string; stageIds: string[]; participants: string[]; principals: string[] }> {
  const pkg = await preparePublishable(ct, [clause('roster.min', 1), ...opts.clauses]);
  const ev = new EventsService(ct);
  const rid = `fx4_${newId()}`;
  const e = await ev.create({ organizerOrgId: seedIds.orgA, name: 'رقابت آزمون (TEST ONLY)', slug: `fx4-${newId().toLowerCase()}`, visibility: 'public', timeZone: 'Asia/Tehran', startsAt: new Date(Date.now() + 3 * 3600_000).toISOString(), endsAt: null, description: null, posterFileId: null, presence: 'hybrid', regions: [], language: 'fa', contact: null, rated: false, prizes: [], refundPolicy: null, cancellationTerms: 'TEST ONLY', disputeTerms: 'TEST ONLY', isTemplate: false, seasonId: null }, seedIds.organizer, rid);
  const d = await ev.addDiscipline(e._id, {
    name: 'D', gameId: 'game_seed_synthetic', gameVersion: 'test', platform: 'pc', mode: '5v5', rulesPackageId: pkg, participantKind: 'player', capacity: Math.max(opts.n, 2), minParticipants: 0, feeRial: 0,
    registrationOpensAt: null, registrationClosesAt: new Date(Date.now() + 3600_000).toISOString(), lateRegistrationUntil: null, editDeadline: null, withdrawalDeadline: null, paymentWindowMinutes: 30,
    autoApprove: true, quotas: [], formFields: [], requiredDocuments: [], checkin: null, seasonChangeCap: null, presence: 'online', regions: [],
  }, seedIds.organizer, rid);
  const stageIds: string[] = [];
  for (const [i, s] of opts.stages.entries()) {
    const links = (s.links ?? []).map((l) => ({ ...l, fromStageId: l.fromStageId === 'PREV' ? stageIds[i - 1]! : l.fromStageId }));
    const st = await ev.addStage(d._id, { name: s.name, order: i + 1, format: s.format as never, presence: s.presence ?? 'online', dependsOnStageIds: links.filter((l) => l.fromStageId).map((l) => l.fromStageId!), links }, seedIds.organizer, rid);
    await ct.c.stages.updateOne({ _id: st._id }, { $set: { ...(s.phases ? { phases: s.phases } : {}), ...(s.settings ? { settings: s.settings } : {}), ...(s.overrides ? { overrides: s.overrides } : {}) } });
    stageIds.push(st._id);
  }
  const pub = await ev.publish(e._id, seedIds.organizer, rid);
  await applyTransition(eventMachine, ct.c.events, e._id, { transition: 'open_registration', expectedVersion: pub.version, actorRoles: ['organizer'] });
  const now = new Date().toISOString();
  const participants: string[] = [];
  const principals: string[] = [];
  for (let i = 1; i <= opts.n; i++) {
    const pr = `usr_fx4_${newId().slice(-8)}_${i}`;
    await ct.c.principals.insertOne({ _id: pr, kind: 'user', displayName: `P${i}`, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0 });
    await ct.acl.grant({ principalId: pr, role: 'player', scope: { type: 'site', id: 'site' }, expiresAt: null, reason: 'fixture' }, { principalId: 'system', requestId: rid });
    const id = newId('ptc');
    await ct.c.participations.insertOne({ _id: id, eventId: e._id, disciplineId: d._id, kind: 'player', snapshot: { displayName: `بازیکن ${i}`, teamId: null, roster: [{ principalId: pr, displayName: `P${i}`, role: 'player' }] }, acceptedRules: null, registrationState: 'confirmed', createdAt: now, updatedAt: now, version: 0 });
    participants.push(id);
    principals.push(pr);
  }
  await ct.acl.grant({ principalId: seedIds.referee, role: 'referee', scope: { type: 'event', id: e._id }, expiresAt: null, reason: 'fixture' }, { principalId: 'system', requestId: rid });
  return { eventId: e._id, disciplineId: d._id, stageIds, participants, principals };
}

/** Draw → confirm → lock → publish → generate, through the real services. */
export async function drawAndGenerate(ct: Container, stageId: string, input: DrawInput = { method: 'random' }) {
  const draws = new DrawService(ct);
  const rid = `fx4_${newId()}`;
  const d = await draws.preview(stageId, input, seedIds.organizer, rid);
  await draws.confirm(d._id, seedIds.organizer, rid);
  await draws.lock(d._id, seedIds.organizer, rid);
  await draws.publish(d._id, seedIds.organizer, rid);
  return { draw: d, structure: await new StructureService(ct).generate(stageId, seedIds.organizer, rid) };
}

/** Moves a sided match to live with system transitions (readiness/selection are tested elsewhere). */
export async function toLive(ct: Container, m: MatchDoc): Promise<MatchDoc> {
  let cur = m;
  for (const t of ['open_checkin', 'mark_ready', 'start']) {
    cur = (await applyTransition(matchMachine, ct.c.matches, cur._id, { transition: t, expectedVersion: cur.version, actorRoles: ['system'] })).doc;
  }
  return cur;
}

/**
 * Plays every playable match of a stage: side 0 submits the outcome chosen by `decide`, the referee finalises,
 * the consumer advances. Returns how many matches were played. Asserts nobody plays two matches at once.
 */
export async function playStage(ct: Container, stageId: string, decide: (m: MatchDoc) => MatchOutcome, opts: { maxLoops?: number } = {}): Promise<number> {
  const results = new MatchResultService(ct);
  let played = 0;
  for (let loop = 0; loop < (opts.maxLoops ?? 200); loop++) {
    const sided = await ct.c.matches.find({ stageId, state: 'scheduled' }).toArray();
    if (!sided.length) break;
    // play the lowest open round of each bracket (round robins have every round sided from the start)
    const minRound = new Map<string, number>();
    for (const m of sided) minRound.set(m.slot!.bracket, Math.min(minRound.get(m.slot!.bracket) ?? Infinity, m.slot!.round));
    const ready = sided.filter((m) => m.slot!.round === minRound.get(m.slot!.bracket));
    const busy = ready.flatMap((m) => m.participantIds ?? []);
    if (new Set(busy).size !== busy.length) throw new Error('a participant is scheduled in two matches at once');
    for (const m of ready) {
      const live = await toLive(ct, m);
      const submitter = live.sides[0]!.roster[0]!.principalId;
      await results.submit(live._id, decide(live), [], submitter, `fx4_${newId()}`);
      await results.finalize(live._id, null, seedIds.referee, `fx4_${newId()}`);
      played++;
    }
    await ct.consumer.drain();
  }
  return played;
}

export const win = (side: 0 | 1, scores: [number, number] = side === 0 ? [2, 0] : [0, 2]): MatchOutcome => ({ kind: 'win', winnerSide: side, scores, maps: null, forfeit: false, reason: null });

export const TABLE_RULES = (): Clause[] => [clause('points.win', 3), clause('points.draw', 1), clause('points.loss', 0), clause('tiebreak.order', ['head_to_head', 'score_diff', 'score_for']), clause('rr.legs', 1)];
