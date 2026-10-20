import { DomainError, type Scope } from '@esp/contracts';
import type { Container } from '../container.js';
import type { IntegrityReportDoc, SanctionDoc } from '../db/collections-esp05.js';
import { newId } from '../ids.js';
import { StructureService } from '../competition/structure.js';

const iso = () => new Date().toISOString();
const SITE: Scope = { type: 'site', id: 'site' };
export const DEMO_NOTE = 'Demos, recordings and anti-cheat output are evidence for a human reviewer; the platform does not claim to detect all cheating (INT-002).';

/** Finds the rules clause a decision cites, in any frozen snapshot of the event's disciplines (RULE-011). */
export async function citeClause(ct: Container, eventId: string, clauseKey: string): Promise<{ packageId: string; version: string; clauseKey: string; citation: string }> {
  const ds = await ct.c.disciplines.find({ eventId }, { projection: { rulesSnapshot: 1 } }).toArray();
  for (const d of ds) {
    const c = d.rulesSnapshot?.clauses.find((x) => x.key === clauseKey);
    if (c) return { packageId: d.rulesSnapshot!.packageId, version: d.rulesSnapshot!.version, clauseKey, citation: c.citation ?? clauseKey };
  }
  throw new DomainError('VALIDATION_FAILED', `clause "${clauseKey}" is not in this event's frozen rules; a decision must cite the rules version and clause`);
}

/**
 * REF-004, INT-003/004: warnings, point penalties, forfeits, disqualifications and temporary/permanent suspensions,
 * each with scope, duration, reason, cited clause, issuer and appeal. Event-level sanctions need event refereeing
 * authority; extending to the whole platform needs disciplinary authority AND an independent approval.
 */
export class SanctionService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }

  async issue(
    input: { subject: SanctionDoc['subject']; scope: SanctionDoc['scope']; type: SanctionDoc['type']; points: number | null; stageId: string | null; until: string | null; reason: string; clauseKey: string; caseId: string | null; approvalId?: string | null | undefined; eventId?: string | null | undefined },
    actor: string,
    requestId: string,
  ): Promise<SanctionDoc> {
    if (input.reason.trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'a sanction needs a reason');
    let eventId = input.eventId ?? null;
    if (input.scope.kind === 'match') eventId = (await this.c.matches.findOne({ _id: input.scope.id }, { projection: { eventId: 1 } }))?.eventId ?? null;
    if (input.scope.kind === 'event') eventId = input.scope.id;
    let rulesRef: SanctionDoc['rulesRef'];
    let extension: SanctionDoc['extension'] = null;
    if (input.scope.kind === 'platform') {
      await this.ct.acl.require(actor, 'discipline.platform_wide', SITE, requestId);
      if (!input.approvalId) throw new DomainError('PRECONDITION_FAILED', 'a platform-wide sanction needs an independent disciplinary approval (INT-004)');
      const a = await this.ct.approvals.consume(input.approvalId, 'discipline.platform_extend', SITE, { principalId: actor, requestId });
      extension = { approvalId: a._id, by: a.decidedBy ?? 'unknown', at: iso() };
      rulesRef = eventId ? { ...(await citeClause(this.ct, eventId, input.clauseKey)) } : { packageId: null, clauseKey: input.clauseKey, citation: 'platform conduct policy' };
    } else {
      if (!eventId) throw new DomainError('NOT_FOUND', 'scope not found');
      await this.ct.acl.require(actor, 'dispute.decide_first', { type: input.scope.kind, id: input.scope.id }, requestId);
      rulesRef = await citeClause(this.ct, eventId, input.clauseKey);
    }
    if (input.type === 'point_penalty' && (!Number.isInteger(input.points) || (input.points ?? 0) <= 0 || !input.stageId)) throw new DomainError('VALIDATION_FAILED', 'a point penalty needs whole points > 0 and a stage');
    if (input.type === 'suspension_temporary' && (!input.until || Date.parse(input.until) <= Date.now())) throw new DomainError('VALIDATION_FAILED', 'a temporary suspension needs a future end');
    if (input.type === 'forfeit' && input.scope.kind !== 'match') throw new DomainError('VALIDATION_FAILED', 'a forfeit applies to a match');
    if (input.type === 'disqualification' && (input.scope.kind !== 'event' || input.subject.kind !== 'participation')) throw new DomainError('VALIDATION_FAILED', 'a disqualification applies to a participation in an event');
    const doc: SanctionDoc = { _id: newId('snc'), subject: input.subject, scope: input.scope, type: input.type, points: input.points, stageId: input.stageId, from: iso(), until: input.until, reason: input.reason, rulesRef, issuedBy: actor, caseId: input.caseId, extension, state: 'active', appeal: null, createdAt: iso(), version: 0 };
    await this.c.sanctions.insertOne(doc);
    // effects through the competition machinery, never by editing results directly
    const structure = new StructureService(this.ct);
    if (input.type === 'forfeit') {
      const m = (await this.c.matches.findOne({ _id: input.scope.id }))!;
      const side = m.participantIds?.indexOf(input.subject.ref) ?? -1;
      if (side < 0) throw new DomainError('VALIDATION_FAILED', 'the forfeiting participant is not a side of this match');
      await structure.recordForfeit(m, side === 0 ? 1 : 0, `sanction ${doc._id}: ${input.reason}`, actor, requestId);
    }
    if (input.type === 'disqualification') {
      for (const st of await this.c.stageStructures.find({ eventId: input.scope.id, seeds: input.subject.ref, state: 'active' }).toArray()) {
        await structure.withdraw(st._id, input.subject.ref, `disqualification (sanction ${doc._id}): ${input.reason}`, actor, requestId).catch(() => undefined);
      }
    }
    if (input.type === 'point_penalty' && input.stageId) await structure.sync(input.stageId, requestId);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'sanction.issue', target: { type: input.subject.kind, id: input.subject.ref }, scope: input.scope.kind === 'platform' ? SITE : { type: input.scope.kind, id: input.scope.id }, outcome: 'success', details: { sanctionId: doc._id, type: input.type, clause: rulesRef.clauseKey }, requestId });
    await this.ct.outbox.append({ type: 'integrity.sanction.issued', aggregate: { type: 'sanction', id: doc._id }, aggregateVersion: 0, actor: { principalId: actor, kind: 'user' }, payload: { sanctionId: doc._id, subject: input.subject, type: input.type, scope: input.scope, principals: await this.subjectPrincipals(doc) }, correlationId: requestId });
    return doc;
  }

  async subjectPrincipals(s: Pick<SanctionDoc, 'subject'>): Promise<string[]> {
    if (s.subject.kind === 'principal') return [s.subject.ref];
    if (s.subject.kind === 'participation') return ((await this.c.participations.findOne({ _id: s.subject.ref }))?.snapshot.roster ?? []).map((r) => r.principalId);
    return (await this.c.teamMemberships.find({ teamId: s.subject.ref, to: null }).toArray()).map((m) => m.principalId);
  }

  /** The sanctioned subject may appeal; an independent authority (not the issuer) decides. */
  async appeal(sanctionId: string, text: string, actor: string): Promise<SanctionDoc> {
    const s = await this.c.sanctions.findOne({ _id: sanctionId });
    if (!s) throw new DomainError('NOT_FOUND', 'sanction not found');
    if (!(await this.subjectPrincipals(s)).includes(actor)) throw new DomainError('FORBIDDEN', 'only the sanctioned subject can appeal');
    if (text.trim().length < 10) throw new DomainError('VALIDATION_FAILED', 'explain the appeal');
    const r = await this.c.sanctions.findOneAndUpdate({ _id: s._id, state: 'active', appeal: null }, { $set: { state: 'appealed', appeal: { by: actor, text, at: iso(), decidedBy: null, decision: null, decidedAt: null } }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('ILLEGAL_TRANSITION', 'this sanction cannot be appealed now');
    return r;
  }
  async decideAppeal(sanctionId: string, decision: 'upheld' | 'revoked', actor: string, requestId: string): Promise<SanctionDoc> {
    const s = await this.c.sanctions.findOne({ _id: sanctionId, state: 'appealed' });
    if (!s) throw new DomainError('NOT_FOUND', 'no pending appeal');
    if (s.issuedBy === actor) throw new DomainError('SEPARATION_OF_DUTIES', 'the issuer cannot decide the appeal (REF-005)');
    if (s.scope.kind === 'platform') await this.ct.acl.require(actor, 'discipline.platform_wide', SITE, requestId);
    else await this.ct.acl.require(actor, 'dispute.decide_appeal', { type: s.scope.kind, id: s.scope.id }, requestId);
    const r = await this.c.sanctions.findOneAndUpdate({ _id: s._id, state: 'appealed' }, { $set: { state: decision === 'revoked' ? 'revoked' : 'active', 'appeal.decidedBy': actor, 'appeal.decision': decision, 'appeal.decidedAt': iso() }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (decision === 'revoked' && s.type === 'point_penalty' && s.stageId) await new StructureService(this.ct).sync(s.stageId, requestId);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'sanction.appeal.decide', target: { type: 'sanction', id: s._id }, scope: s.scope.kind === 'platform' ? SITE : { type: s.scope.kind, id: s.scope.id }, outcome: 'success', details: { decision }, requestId });
    return r!;
  }

  async revoke(sanctionId: string, reason: string, actor: string, requestId: string): Promise<SanctionDoc> {
    const s = await this.c.sanctions.findOne({ _id: sanctionId });
    if (!s) throw new DomainError('NOT_FOUND', 'sanction not found');
    if (s.scope.kind === 'platform') await this.ct.acl.require(actor, 'discipline.platform_wide', SITE, requestId);
    else await this.ct.acl.require(actor, 'dispute.decide_first', { type: s.scope.kind, id: s.scope.id }, requestId);
    if (reason.trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'a reason is required');
    const r = await this.c.sanctions.findOneAndUpdate({ _id: s._id, state: { $in: ['active', 'appealed'] } }, { $set: { state: 'revoked' }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('ILLEGAL_TRANSITION', `sanction is ${s.state}`);
    if (s.type === 'point_penalty' && s.stageId) await new StructureService(this.ct).sync(s.stageId, requestId);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'sanction.revoke', target: { type: 'sanction', id: s._id }, scope: s.scope.kind === 'platform' ? SITE : { type: s.scope.kind, id: s.scope.id }, outcome: 'success', details: { reason }, requestId });
    return r;
  }

  /** Active suspensions that bar a principal from a given event (platform-wide or this event). */
  async activeSuspensions(principalIds: string[], eventId: string): Promise<SanctionDoc[]> {
    if (!principalIds.length) return [];
    return this.c.sanctions
      .find({ 'subject.kind': 'principal', 'subject.ref': { $in: principalIds }, type: { $in: ['suspension_temporary', 'suspension_permanent'] }, state: { $in: ['active', 'appealed'] }, $or: [{ 'scope.kind': 'platform' }, { 'scope.kind': 'event', 'scope.id': eventId }], $and: [{ $or: [{ until: null }, { until: { $gt: iso() } }] }] })
      .toArray();
  }

  /** Point penalties per participation for a stage (applied to standings). */
  async penalties(stageId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const s of await this.c.sanctions.find({ type: 'point_penalty', stageId, state: { $in: ['active', 'appealed'] }, 'subject.kind': 'participation' }).toArray()) out[s.subject.ref] = (out[s.subject.ref] ?? 0) + (s.points ?? 0);
    return out;
  }

  async expire(now = new Date()): Promise<number> {
    return (await this.c.sanctions.updateMany({ type: 'suspension_temporary', state: 'active', until: { $lte: now.toISOString() } }, { $set: { state: 'expired' }, $inc: { version: 1 } })).modifiedCount;
  }

  async list(filter: { subjectRef?: string | undefined; eventId?: string | undefined }, actor: string, requestId: string): Promise<SanctionDoc[]> {
    if (filter.eventId) await this.ct.acl.require(actor, 'event.read_private', { type: 'event', id: filter.eventId }, requestId);
    else if (filter.subjectRef !== actor && !(await this.ct.acl.can(actor, 'discipline.platform_wide', SITE))) throw new DomainError('FORBIDDEN', 'not allowed');
    const q: Record<string, unknown> = {};
    if (filter.subjectRef) q['subject.ref'] = filter.subjectRef;
    if (filter.eventId) q['$or'] = [{ 'scope.id': filter.eventId }, { 'scope.kind': 'match', 'scope.id': { $in: (await this.c.matches.find({ eventId: filter.eventId }, { projection: { _id: 1 } }).toArray()).map((m) => m._id) } }];
    return this.c.sanctions.find(q).sort({ createdAt: -1 }).limit(200).toArray();
  }
}

/**
 * INT-001/002/005: integrity reports (cheating, alternate accounts, collusion, sabotage, misconduct) go through a human
 * process: received → triaged → investigating → referred (to a dispute case) or closed with an outcome. No automatic
 * sanction. Recording/demo requirements and anti-cheat can only be required where the game actually supports them.
 */
export class IntegrityService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }

  async report(input: { category: IntegrityReportDoc['category']; eventId: string | null; matchId: string | null; subjects: IntegrityReportDoc['subjects']; description: string; evidenceFileIds: string[] }, actor: string, requestId: string): Promise<IntegrityReportDoc> {
    if (input.description.trim().length < 20) throw new DomainError('VALIDATION_FAILED', 'describe what happened (at least 20 characters)');
    if (!input.subjects.length) throw new DomainError('VALIDATION_FAILED', 'name at least one subject');
    for (const f of input.evidenceFileIds) {
      const file = await this.c.files.findOne({ _id: f });
      if (!file || file.ownerPrincipalId !== actor || file.visibility !== 'private' || file.quarantined) throw new DomainError('VALIDATION_FAILED', 'evidence must be your own clean private files');
    }
    const recent = await this.c.integrityReports.countDocuments({ reporter: actor, createdAt: { $gt: new Date(Date.now() - 3_600_000).toISOString() } });
    if (recent >= 10) throw new DomainError('RATE_LIMITED', 'too many reports in the last hour');
    const doc: IntegrityReportDoc = { _id: newId('irp'), reporter: actor, category: input.category, eventId: input.eventId, matchId: input.matchId, subjects: input.subjects, description: input.description, evidenceFileIds: input.evidenceFileIds, evidenceNote: DEMO_NOTE, state: 'received', assignee: null, outcome: null, linkedCaseId: null, history: [{ at: iso(), by: actor, action: 'received', note: null }], createdAt: iso(), version: 0 };
    await this.c.integrityReports.insertOne(doc);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'integrity.report', target: { type: 'integrity_report', id: doc._id }, scope: input.eventId ? { type: 'event', id: input.eventId } : SITE, outcome: 'success', details: { category: input.category }, requestId });
    return doc;
  }

  private async canHandle(r: IntegrityReportDoc, actor: string): Promise<boolean> {
    if (await this.ct.acl.can(actor, 'discipline.platform_wide', SITE)) return true;
    if (await this.ct.acl.can(actor, 'moderation.act', SITE)) return true;
    return r.eventId ? this.ct.acl.can(actor, 'dispute.decide_first', { type: 'event', id: r.eventId }) : false;
  }

  async step(reportId: string, action: 'triage' | 'investigate' | 'refer' | 'close', note: string, extra: { assignee?: string | null | undefined; caseId?: string | null | undefined; outcome?: string | null | undefined }, actor: string, requestId: string): Promise<IntegrityReportDoc> {
    const r = await this.c.integrityReports.findOne({ _id: reportId });
    if (!r) throw new DomainError('NOT_FOUND', 'report not found');
    if (!(await this.canHandle(r, actor))) {
      await this.ct.acl.require(actor, 'discipline.platform_wide', SITE, requestId); // audits the denial
    }
    if (r.reporter === actor) throw new DomainError('SEPARATION_OF_DUTIES', 'a reporter cannot handle their own report');
    const next: Record<typeof action, { from: IntegrityReportDoc['state'][]; to: IntegrityReportDoc['state'] }> = {
      triage: { from: ['received'], to: 'triaged' },
      investigate: { from: ['triaged'], to: 'investigating' },
      refer: { from: ['triaged', 'investigating'], to: 'referred' },
      close: { from: ['received', 'triaged', 'investigating', 'referred'], to: 'closed' },
    };
    if (action === 'close' && (!extra.outcome || extra.outcome.trim().length < 5)) throw new DomainError('VALIDATION_FAILED', 'closing needs a documented outcome');
    if (action === 'refer' && !extra.caseId) throw new DomainError('VALIDATION_FAILED', 'name the dispute case it is referred to');
    const set: Record<string, unknown> = { state: next[action].to };
    if (extra.assignee !== undefined) set['assignee'] = extra.assignee;
    if (extra.caseId) set['linkedCaseId'] = extra.caseId;
    if (extra.outcome) set['outcome'] = extra.outcome;
    const u = await this.c.integrityReports.findOneAndUpdate({ _id: r._id, state: { $in: next[action].from } }, { $set: set, $push: { history: { at: iso(), by: actor, action, note } }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!u) throw new DomainError('ILLEGAL_TRANSITION', `report is ${r.state}`);
    return u;
  }

  async queue(actor: string, requestId: string, eventId?: string | undefined): Promise<IntegrityReportDoc[]> {
    const platform = (await this.ct.acl.can(actor, 'discipline.platform_wide', SITE)) || (await this.ct.acl.can(actor, 'moderation.act', SITE));
    if (!platform) {
      if (!eventId) throw new DomainError('FORBIDDEN', 'not allowed');
      await this.ct.acl.require(actor, 'dispute.decide_first', { type: 'event', id: eventId }, requestId);
    }
    return this.c.integrityReports.find(eventId ? { eventId } : {}).sort({ createdAt: -1 }).limit(200).toArray();
  }

  /** INT-002: a recording/demo or anti-cheat requirement is accepted only when the game's capability is really supported. */
  async setRequirements(eventId: string, input: { requireDemo: boolean; antiCheat: boolean }, actor: string, requestId: string): Promise<{ requireDemo: boolean; antiCheat: boolean; procedures: string | null }> {
    await this.ct.acl.require(actor, 'event.manage', { type: 'event', id: eventId }, requestId);
    const ds = await this.c.disciplines.find({ eventId }).toArray();
    for (const d of ds) {
      const g = await this.c.games.findOne({ _id: d.gameId }, { projection: { capabilities: 1 } });
      const caps = (g as unknown as { capabilities?: Record<string, { status: string }> } | null)?.capabilities ?? {};
      if (input.requireDemo && caps['replay']?.status !== 'supported') throw new DomainError('PRECONDITION_FAILED', `the game of "${d.name}" has no supported replay/demo capability; it cannot be required`);
      if (input.antiCheat && caps['antiCheat']?.status !== 'supported') throw new DomainError('PRECONDITION_FAILED', `the game of "${d.name}" has no supported anti-cheat integration`);
    }
    const procedures = ds.map((d) => d.rulesSnapshot?.clauses.find((c) => c.key === 'integrity.procedures')?.value).find((v) => typeof v === 'string') as string | undefined;
    await this.c.events.updateOne({ _id: eventId }, { $set: { 'config.integrity': { requireDemo: input.requireDemo, antiCheat: input.antiCheat, procedures: procedures ?? null } }, $inc: { version: 1 } });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'integrity.requirements', target: { type: 'event', id: eventId }, scope: { type: 'event', id: eventId }, outcome: 'success', details: input, requestId });
    return { ...input, procedures: procedures ?? null };
  }
}
