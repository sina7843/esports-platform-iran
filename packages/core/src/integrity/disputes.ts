import { DomainError, disputeMachine, matchMachine } from '@esp/contracts';
import type { Container } from '../container.js';
import type { MatchDoc } from '../db/collections.js';
import type { MatchOutcome } from '../db/collections-esp04.js';
import type { DisputeDoc } from '../db/collections-esp05.js';
import { applyTransition } from '../domain/transition.js';
import { newId } from '../ids.js';
import { conflictedFor, OfficialsService } from './officials.js';
import { citeClause, SanctionService } from './sanctions.js';

const iso = () => new Date().toISOString();
const OPEN: DisputeDoc['state'][] = ['filed', 'assigned', 'defense_received', 'under_review', 'first_decision', 'appeal'];
type Effect = { kind: 'none' | 'result_change' | 'sanction'; outcome?: MatchOutcome | null; sanctions?: Array<Parameters<SanctionService['issue']>[0]> };



/**
 * REF-002/003/005/006, AC-09/10: dispute and appeal cases. A case on a provisional result blocks finalisation; the
 * assignee and the appeal authority must be independent (not a party, not conflicted, appeal authority ≠ first
 * decider); every decision cites a rules version and clause; parties see the public summary, officials see evidence
 * and reasoning; delivery/viewing of each decision is recorded.
 */
export class DisputeService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  async load(caseId: string): Promise<DisputeDoc> {
    const d = await this.c.disputes.findOne({ _id: caseId });
    if (!d) throw new DomainError('NOT_FOUND', 'case not found');
    return d;
  }
  /** A minutes clause from the match's frozen rules, or (event-level case) from the event's disciplines. */
  private async minutesClause(m: MatchDoc | null, eventId: string, key: string): Promise<number | null> {
    const pick = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);
    if (m) return pick(m.rulesSnapshot?.clauses.find((c) => c.key === key)?.value);
    for (const d of await this.c.disciplines.find({ eventId }, { projection: { rulesSnapshot: 1 } }).toArray()) {
      const v = pick(d.rulesSnapshot?.clauses.find((c) => c.key === key)?.value);
      if (v) return v;
    }
    return null;
  }
  async openFor(matchId: string): Promise<DisputeDoc | null> {
    return this.c.disputes.findOne({ matchId, state: { $in: OPEN } });
  }
  private async notify(d: DisputeDoc, type: string, extra: Record<string, unknown>, requestId: string) {
    await this.ct.outbox.append({ type: `integrity.dispute.${type}`, aggregate: { type: 'dispute', id: d._id }, aggregateVersion: d.version, actor: { principalId: 'system', kind: 'system' }, payload: { caseId: d._id, eventId: d.eventId, matchId: d.matchId, principals: [...new Set([...d.parties, ...(d.assignee ? [d.assignee] : []), ...(d.appealAuthority ? [d.appealAuthority] : [])])], ...extra }, correlationId: requestId });
  }

  /** A party files a case; for a provisional result the match moves to "disputed" and cannot be finalised. */
  async file(input: { eventId: string; matchId: string | null; category: DisputeDoc['category']; claim: string; evidenceFileIds: string[] }, actor: string, requestId: string, opts: { system?: boolean } = {}): Promise<DisputeDoc> {
    if (input.claim.trim().length < 10) throw new DomainError('VALIDATION_FAILED', 'describe the claim (at least 10 characters)');
    let m: MatchDoc | null = null;
    let parties: string[];
    let filedSide: number | null = null;
    if (input.matchId) {
      m = await this.c.matches.findOne({ _id: input.matchId, eventId: input.eventId });
      if (!m) throw new DomainError('NOT_FOUND', 'match not found');
      parties = m.principalIds ?? [];
      filedSide = m.sides.findIndex((s) => s.roster.some((r) => r.principalId === actor));
      if (!opts.system && filedSide < 0) throw new DomainError('FORBIDDEN', 'only a side of the match can file a case about it');
      if (!['provisional', 'disputed', 'final', 'live', 'paused'].includes(m.state)) throw new DomainError('PRECONDITION_FAILED', `nothing to dispute yet (match is ${m.state})`);
      const window = await this.minutesClause(m, input.eventId, 'dispute.deadline_minutes');
      const since = m.state === 'final' ? m.updatedAt : null;
      if (!opts.system && window && since && Date.now() > Date.parse(since) + window * 60_000) throw new DomainError('PRECONDITION_FAILED', `the filing deadline (${window} min after the final result) has passed`);
      if (await this.openFor(m._id)) throw new DomainError('CONFLICT', 'this match already has an open case');
    } else {
      const part = await this.c.participations.findOne({ eventId: input.eventId, 'snapshot.roster.principalId': actor });
      if (!opts.system && !part) throw new DomainError('FORBIDDEN', 'only participants of the event can file a case');
      parties = [actor];
    }
    for (const f of input.evidenceFileIds) {
      const file = await this.c.files.findOne({ _id: f });
      if (!file || file.ownerPrincipalId !== actor || file.visibility !== 'private' || file.quarantined) throw new DomainError('VALIDATION_FAILED', 'evidence must be your own clean private files');
    }
    const defenseMin = await this.minutesClause(m, input.eventId, 'dispute.defense_minutes');
    const doc: DisputeDoc = {
      _id: newId('dsp'), eventId: input.eventId, matchId: input.matchId, category: input.category, claim: input.claim, filedBy: actor, filedSide: filedSide !== null && filedSide >= 0 ? filedSide : null, parties, state: 'filed',
      deadlines: { defenseBy: defenseMin ? new Date(Date.now() + defenseMin * 60_000).toISOString() : null, appealBy: null, fileBy: null }, assignee: null, appealAuthority: null,
      evidence: input.evidenceFileIds.map((fileId) => ({ fileId, by: actor, at: iso(), note: null })), defense: [], evidenceRequests: [], reports: [], decisions: [], views: [], linkedCorrectionId: null, createdAt: iso(), updatedAt: iso(), version: 0,
    };
    await this.ct.dbh.withTransaction(async (session) => {
      await this.c.disputes.insertOne(doc, { session });
      if (m && m.state === 'provisional') await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'dispute', expectedVersion: m.version, actorRoles: ['system'] }, {}, session);
      await this.ct.audit.append({ actorPrincipalId: actor, action: 'dispute.file', target: { type: 'dispute', id: doc._id }, scope: m ? { type: 'match', id: m._id } : { type: 'event', id: input.eventId }, outcome: 'success', details: { category: input.category }, requestId }, session);
    });
    await this.notify(doc, 'filed', { category: doc.category }, requestId);
    return doc;
  }

  private async headAuthority(d: DisputeDoc, actor: string, requestId: string) {
    // "head referee" authority: may correct results in this event/match
    await this.ct.acl.require(actor, 'match.result.correct', d.matchId ? { type: 'match', id: d.matchId } : { type: 'event', id: d.eventId }, requestId);
  }
  private async independent(d: DisputeDoc, principalId: string): Promise<void> {
    if (d.parties.includes(principalId) || d.filedBy === principalId) throw new DomainError('CONFLICT', 'a party cannot handle this case');
    const m = d.matchId ? await this.c.matches.findOne({ _id: d.matchId }) : null;
    const conflict = await conflictedFor(this.ct, principalId, m, d.parties);
    if (conflict) throw new DomainError('CONFLICT', `conflict of interest: ${conflict}`);
  }

  async assign(caseId: string, assignee: string, actor: string, requestId: string): Promise<DisputeDoc> {
    const d = await this.load(caseId);
    await this.headAuthority(d, actor, requestId);
    await this.independent(d, assignee);
    if (!(await this.ct.acl.can(assignee, 'dispute.decide_first', d.matchId ? { type: 'match', id: d.matchId } : { type: 'event', id: d.eventId }))) throw new DomainError('PRECONDITION_FAILED', 'the assignee has no first-instance refereeing authority here');
    const { doc } = await applyTransition(disputeMachine, this.c.disputes, d._id, { transition: 'assign', expectedVersion: d.version, actorRoles: ['head_referee'] }, { assignee, updatedAt: iso() } as Partial<DisputeDoc>);
    await this.notify(doc, 'assigned', {}, requestId);
    return doc;
  }

  /** The other side's defence (with private evidence) within the defence deadline. */
  async defend(caseId: string, text: string, fileIds: string[], actor: string, requestId: string): Promise<DisputeDoc> {
    const d = await this.load(caseId);
    if (!d.parties.includes(actor) || d.filedBy === actor) throw new DomainError('FORBIDDEN', 'only the other party can submit a defence');
    if (d.deadlines.defenseBy && Date.now() > Date.parse(d.deadlines.defenseBy)) throw new DomainError('PRECONDITION_FAILED', 'the defence deadline has passed');
    if (text.trim().length < 10) throw new DomainError('VALIDATION_FAILED', 'the defence needs text');
    const m = d.matchId ? await this.c.matches.findOne({ _id: d.matchId }) : null;
    const side = m ? m.sides.findIndex((s) => s.roster.some((r) => r.principalId === actor)) : null;
    const entry = { by: actor, side: side !== null && side >= 0 ? side : null, text, fileIds, at: iso() };
    if (d.state === 'assigned') {
      const { doc } = await applyTransition(disputeMachine, this.c.disputes, d._id, { transition: 'receive_defense', expectedVersion: d.version, actorRoles: ['player'] }, { defense: [...d.defense, entry], updatedAt: iso() } as Partial<DisputeDoc>);
      return doc;
    }
    if (!['filed', 'defense_received', 'under_review'].includes(d.state)) throw new DomainError('ILLEGAL_TRANSITION', `case is ${d.state}`);
    const r = await this.c.disputes.findOneAndUpdate({ _id: d._id }, { $push: { defense: entry }, $set: { updatedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' });
    void requestId;
    return r!;
  }

  async requestEvidence(caseId: string, to: string, text: string, dueAt: string | null, actor: string): Promise<DisputeDoc> {
    const d = await this.load(caseId);
    if (d.assignee !== actor) throw new DomainError('FORBIDDEN', 'only the assigned official can request evidence');
    if (!d.parties.includes(to)) throw new DomainError('VALIDATION_FAILED', 'requests go to a party of the case');
    const r = await this.c.disputes.findOneAndUpdate({ _id: d._id, state: { $in: ['assigned', 'defense_received', 'under_review'] } }, { $push: { evidenceRequests: { id: newId('erq'), to, text, dueAt, answer: null, answeredAt: null } }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('ILLEGAL_TRANSITION', `case is ${d.state}`);
    return r;
  }
  async answerRequest(caseId: string, requestIdInCase: string, answer: string, fileIds: string[], actor: string): Promise<DisputeDoc> {
    const d = await this.load(caseId);
    const req = d.evidenceRequests.find((x) => x.id === requestIdInCase);
    if (!req || req.to !== actor) throw new DomainError('FORBIDDEN', 'this request is not addressed to you');
    const r = await this.c.disputes.findOneAndUpdate({ _id: d._id, 'evidenceRequests.id': requestIdInCase, 'evidenceRequests.answer': null }, { $set: { 'evidenceRequests.$.answer': answer, 'evidenceRequests.$.answeredAt': iso() }, $push: { evidence: { $each: fileIds.map((fileId) => ({ fileId, by: actor, at: iso(), note: `answer to ${requestIdInCase}` })) } }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('CONFLICT', 'already answered');
    return r;
  }
  async report(caseId: string, text: string, actor: string, requestId: string): Promise<DisputeDoc> {
    const d = await this.load(caseId);
    await this.ct.acl.require(actor, 'match.result.verify', d.matchId ? { type: 'match', id: d.matchId } : { type: 'event', id: d.eventId }, requestId);
    const r = await this.c.disputes.findOneAndUpdate({ _id: d._id }, { $push: { reports: { by: actor, text, at: iso() } }, $inc: { version: 1 } }, { returnDocument: 'after' });
    return r!;
  }
  async startReview(caseId: string, actor: string): Promise<DisputeDoc> {
    const d = await this.load(caseId);
    if (d.assignee !== actor) throw new DomainError('FORBIDDEN', 'only the assigned official');
    const defenseOver = !d.deadlines.defenseBy || Date.now() > Date.parse(d.deadlines.defenseBy) || d.state === 'defense_received';
    if (!defenseOver) throw new DomainError('PRECONDITION_FAILED', 'wait for the defence or its deadline');
    return (await applyTransition(disputeMachine, this.c.disputes, d._id, { transition: 'start_review', expectedVersion: d.version, actorRoles: ['referee'] }, { updatedAt: iso() } as Partial<DisputeDoc>)).doc;
  }

  private async applyEffect(d: DisputeDoc, effect: Effect, actor: string, requestId: string): Promise<{ sanctionIds: string[]; correctionId: string | null }> {
    const sanctionIds: string[] = [];
    let correctionId: string | null = null;
    if (effect.kind === 'result_change') {
      if (!d.matchId || !effect.outcome) throw new DomainError('VALIDATION_FAILED', 'a result change needs the match outcome');
      const m = (await this.c.matches.findOne({ _id: d.matchId }))!;
      if (m.state === 'final') {
        const { CorrectionService } = await import('./corrections.js');
        correctionId = (await new CorrectionService(this.ct).request(m._id, effect.outcome, `case ${d._id}`, d._id, null, actor, requestId, { fromCase: true }))._id;
      } else {
        const { MatchResultService } = await import('../competition/results.js');
        await new MatchResultService(this.ct).finalize(m._id, effect.outcome, actor, requestId, { caseId: d._id });
      }
    }
    if (effect.kind === 'sanction') for (const s of effect.sanctions ?? []) sanctionIds.push((await new SanctionService(this.ct).issue({ ...s, caseId: d._id }, actor, requestId))._id);
    return { sanctionIds, correctionId };
  }

  /** First-instance decision by the assigned official, citing the frozen rules clause. */
  async decideFirst(caseId: string, input: { clauseKey: string; publicSummary: string; reasoning: string; effect: Effect }, actor: string, requestId: string): Promise<DisputeDoc> {
    const d = await this.load(caseId);
    if (d.assignee !== actor) throw new DomainError('FORBIDDEN', 'only the assigned official decides this case');
    if (d.state !== 'under_review') throw new DomainError('ILLEGAL_TRANSITION', `case is ${d.state}`);
    if (input.publicSummary.trim().length < 10 || input.reasoning.trim().length < 10) throw new DomainError('VALIDATION_FAILED', 'a decision needs a public summary and reasoning');
    const m = d.matchId ? await this.c.matches.findOne({ _id: d.matchId }) : null;
    if (m?.state === 'disputed' && input.effect.kind !== 'result_change') throw new DomainError('VALIDATION_FAILED', 'a disputed result needs a decided outcome (result_change)');
    const rulesRef = await citeClause(this.ct, d.eventId, input.clauseKey);
    const appealMin = await this.minutesClause(m, d.eventId, 'dispute.appeal_minutes');
    const res = await this.applyEffect(d, input.effect, actor, requestId);
    const fresh = await this.load(caseId);
    const decision = { level: 'first' as const, by: actor, at: iso(), rulesRef, publicSummary: input.publicSummary, reasoning: input.reasoning, effect: { kind: input.effect.kind, outcome: input.effect.outcome ?? null, sanctionIds: res.sanctionIds } };
    const { doc } = await applyTransition(disputeMachine, this.c.disputes, d._id, { transition: 'decide_first', expectedVersion: fresh.version, actorRoles: ['referee'] }, { decisions: [...fresh.decisions, decision], 'deadlines.appealBy': appealMin ? new Date(Date.now() + appealMin * 60_000).toISOString() : null, linkedCorrectionId: res.correctionId, updatedAt: iso() } as Partial<DisputeDoc>);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'dispute.decide_first', target: { type: 'dispute', id: d._id }, scope: { type: 'event', id: d.eventId }, outcome: 'success', details: { clause: input.clauseKey, effect: input.effect.kind }, requestId });
    await this.notify(doc, 'decided', { level: 'first' }, requestId);
    return doc;
  }

  /** REF-005: appeal within the deadline; the appeal authority must be appointed and independent of the first decider. */
  async appeal(caseId: string, text: string, actor: string, requestId: string): Promise<DisputeDoc> {
    const d = await this.load(caseId);
    if (!d.parties.includes(actor)) throw new DomainError('FORBIDDEN', 'only a party can appeal');
    if (d.deadlines.appealBy && Date.now() > Date.parse(d.deadlines.appealBy)) throw new DomainError('PRECONDITION_FAILED', 'the appeal deadline has passed');
    const first = d.decisions.find((x) => x.level === 'first');
    if (!first) throw new DomainError('ILLEGAL_TRANSITION', 'nothing to appeal yet');
    let authority: string | null = null;
    for (const p of await new OfficialsService(this.ct).appealAuthorities(d.eventId)) {
      if (p === first.by || p === d.assignee) continue;
      try {
        await this.independent(d, p);
        authority = p;
        break;
      } catch {
        // conflicted authority skipped
      }
    }
    if (!authority) throw new DomainError('PRECONDITION_FAILED', 'no independent appeal authority is appointed for this event (REF-005)');
    const { doc } = await applyTransition(disputeMachine, this.c.disputes, d._id, { transition: 'appeal', expectedVersion: d.version, actorRoles: ['player'] }, { appealAuthority: authority, defense: [...d.defense, { by: actor, side: null, text: `APPEAL: ${text}`, fileIds: [], at: iso() }], updatedAt: iso() } as Partial<DisputeDoc>);
    await this.notify(doc, 'appealed', {}, requestId);
    return doc;
  }

  async decideAppeal(caseId: string, input: { clauseKey: string; publicSummary: string; reasoning: string; effect: Effect }, actor: string, requestId: string): Promise<DisputeDoc> {
    const d = await this.load(caseId);
    if (d.state !== 'appeal') throw new DomainError('ILLEGAL_TRANSITION', `case is ${d.state}`);
    // independence is enforced here, whatever the API call says
    if (d.appealAuthority !== actor) throw new DomainError('FORBIDDEN', 'only the appointed appeal authority decides this appeal');
    if (d.decisions.some((x) => x.by === actor) || d.assignee === actor) throw new DomainError('SEPARATION_OF_DUTIES', 'the first-instance decider cannot decide the appeal');
    await this.ct.acl.require(actor, 'dispute.decide_appeal', { type: 'event', id: d.eventId }, requestId);
    const rulesRef = await citeClause(this.ct, d.eventId, input.clauseKey);
    const res = await this.applyEffect(d, input.effect, actor, requestId);
    const fresh = await this.load(caseId);
    const decision = { level: 'appeal' as const, by: actor, at: iso(), rulesRef, publicSummary: input.publicSummary, reasoning: input.reasoning, effect: { kind: input.effect.kind, outcome: input.effect.outcome ?? null, sanctionIds: res.sanctionIds } };
    const { doc } = await applyTransition(disputeMachine, this.c.disputes, d._id, { transition: 'close', expectedVersion: fresh.version, actorRoles: ['appeal_authority'] }, { decisions: [...fresh.decisions, decision], linkedCorrectionId: res.correctionId ?? fresh.linkedCorrectionId, updatedAt: iso() } as Partial<DisputeDoc>);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'dispute.decide_appeal', target: { type: 'dispute', id: d._id }, scope: { type: 'event', id: d.eventId }, outcome: 'success', details: { clause: input.clauseKey, effect: input.effect.kind }, requestId });
    await this.notify(doc, 'decided', { level: 'appeal' }, requestId);
    return doc;
  }

  /** Closing after the appeal window (or by the head referee when the rules define no appeal window). */
  async close(caseId: string, actor: string, requestId: string, now = new Date()): Promise<DisputeDoc> {
    const d = await this.load(caseId);
    if (d.state !== 'first_decision') throw new DomainError('ILLEGAL_TRANSITION', `case is ${d.state}`);
    if (actor === 'system' && !d.deadlines.appealBy) throw new DomainError('PRECONDITION_FAILED', 'no appeal window: the head referee closes this case');
    if (actor !== 'system') await this.headAuthority(d, actor, requestId);
    if (d.deadlines.appealBy && now.getTime() <= Date.parse(d.deadlines.appealBy)) throw new DomainError('PRECONDITION_FAILED', 'the appeal window is still open');
    const { doc } = await applyTransition(disputeMachine, this.c.disputes, d._id, { transition: 'close', expectedVersion: d.version, actorRoles: actor === 'system' ? ['system'] : ['head_referee'] }, { updatedAt: iso() } as Partial<DisputeDoc>);
    await this.notify(doc, 'closed', {}, requestId);
    return doc;
  }
  async closeExpired(now = new Date()): Promise<number> {
    const due = await this.c.disputes.find({ state: 'first_decision', 'deadlines.appealBy': { $ne: null, $lt: now.toISOString() } }).limit(200).toArray();
    let n = 0;
    for (const d of due) {
      await this.close(d._id, 'system', `dispute-close:${d._id}`, now).then(() => n++).catch(() => undefined);
    }
    return n;
  }

  /** Role-based projection; parties' viewing of each decision is recorded (REF-006). */
  async view(caseId: string, viewer: string, requestId: string) {
    const d = await this.load(caseId);
    const scope = d.matchId ? { type: 'match' as const, id: d.matchId } : { type: 'event' as const, id: d.eventId };
    const official = d.assignee === viewer || d.appealAuthority === viewer || (await this.ct.acl.can(viewer, 'event.evidence.read', scope));
    const party = d.parties.includes(viewer);
    if (!official && !party) {
      await this.ct.acl.require(viewer, 'event.evidence.read', scope, requestId); // audited denial
    }
    if (party && d.decisions.length) {
      const seen = new Set(d.views.filter((v) => v.principalId === viewer).map((v) => v.decisionIndex));
      const fresh = d.decisions.map((_, i) => i).filter((i) => !seen.has(i));
      if (fresh.length) await this.c.disputes.updateOne({ _id: d._id }, { $push: { views: { $each: fresh.map((i) => ({ principalId: viewer, decisionIndex: i, at: iso() })) } } });
    }
    if (official) return { ...d, role: 'official' as const };
    return {
      _id: d._id, eventId: d.eventId, matchId: d.matchId, category: d.category, claim: d.claim, state: d.state, deadlines: d.deadlines, role: 'party' as const,
      myEvidence: d.evidence.filter((e) => e.by === viewer).map((e) => e.fileId),
      defense: d.defense.map((x) => ({ side: x.side, text: x.text, at: x.at, mine: x.by === viewer })),
      requests: d.evidenceRequests.filter((x) => x.to === viewer),
      decisions: d.decisions.map((x) => ({ level: x.level, at: x.at, rulesRef: x.rulesRef, publicSummary: x.publicSummary, effect: { kind: x.effect.kind, outcome: x.effect.outcome ?? null } })),
    };
  }

  /** Public version of decisions: summary, clause and outcome only — never evidence, reasoning or party identities. */
  async publicDecisions(eventId: string) {
    const ds = await this.c.disputes.find({ eventId, 'decisions.0': { $exists: true } }).sort({ createdAt: -1 }).limit(200).toArray();
    return ds.map((d) => ({ caseId: d._id, matchId: d.matchId, category: d.category, state: d.state, decisions: d.decisions.map((x) => ({ level: x.level, at: x.at, clause: x.rulesRef.clauseKey, citation: x.rulesRef.citation, rulesVersion: x.rulesRef.version, summary: x.publicSummary, effect: x.effect.kind })) }));
  }

  async queue(eventId: string, actor: string, requestId: string): Promise<DisputeDoc[]> {
    await this.ct.acl.require(actor, 'match.result.verify', { type: 'event', id: eventId }, requestId);
    return this.c.disputes.find({ eventId }).sort({ state: 1, createdAt: -1 }).limit(300).toArray();
  }
  async mine(actor: string): Promise<DisputeDoc[]> {
    return this.c.disputes.find({ $or: [{ parties: actor }, { assignee: actor }, { appealAuthority: actor }] }).sort({ updatedAt: -1 }).limit(100).toArray();
  }
}
