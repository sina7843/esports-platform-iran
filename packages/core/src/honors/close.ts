import { DomainError, eventMachine, type Role } from '@esp/contracts';
import type { Container } from '../container.js';
import type { EventDoc } from '../db/collections.js';
import type { DisputeDoc, EventArchiveDoc, FeedbackDoc } from '../db/collections-esp05.js';
import { applyTransition } from '../domain/transition.js';
import { newId } from '../ids.js';
import { RatingService } from '../ranking/ratings.js';
import { HonorService } from './honors.js';

const iso = () => new Date().toISOString();
const OPEN_CASE: DisputeDoc['state'][] = ['filed', 'assigned', 'defense_received', 'under_review', 'first_decision', 'appeal'];

/**
 * END-001..007: finishing and closing an event are gated, and the close side effects (honors, certificates,
 * ratings, season quotas, prize entitlements, archive) are each idempotent, so a retried or replayed close applies
 * them exactly once. A close that crashed after the state change is completed by calling close again.
 */
export class EventCloseService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private async event(eventId: string): Promise<EventDoc> {
    const e = await this.c.events.findOne({ _id: eventId });
    if (!e) throw new DomainError('NOT_FOUND', 'event not found');
    return e;
  }
  private async roles(actor: string, eventId: string): Promise<Role[]> {
    const grants = await this.ct.acl.activeGrants(actor);
    const ctx = await this.ct.acl.resourceContext({ type: 'event', id: eventId });
    const chain = [ctx.scope, ...ctx.ancestors];
    return grants.filter((g) => chain.some((s) => s.type === g.scope.type && s.id === g.scope.id)).map((g) => g.role);
  }

  /** What still blocks finish / close (shown to the organizer before they try). */
  async blockers(eventId: string) {
    const stages = await this.c.stages.find({ eventId }).toArray();
    const unfinishedStages = stages.filter((s) => !['finished', 'cancelled'].includes(s.state)).map((s) => ({ id: s._id, name: s.name, state: s.state }));
    const openMatches = (await this.c.matches.find({ eventId, state: { $nin: ['final', 'cancelled'] } }, { projection: { _id: 1, state: 1, slot: 1 } }).limit(100).toArray()).map((m) => ({ id: m._id, slot: m.slot?.key ?? null, state: m.state }));
    const openCases = (await this.c.disputes.find({ eventId, state: { $in: OPEN_CASE } }, { projection: { _id: 1, state: 1, category: 1 } }).toArray()).map((d) => ({ id: d._id, state: d.state, category: d.category }));
    const corrections = (await this.c.corrections.find({ eventId, state: { $in: ['applying', 'failed', 'blocked_dependency'] } }, { projection: { _id: 1, state: 1 } }).toArray()).map((x) => ({ id: x._id, state: x.state }));
    const prizes = await this.c.prizes.find({ eventId }).toArray();
    const openObligationsRial = prizes.filter((p) => !['paid', 'cancelled'].includes(p.state)).reduce((t, p) => t + p.amountRial, 0);
    return { unfinishedStages, openMatches, openCases, corrections, openObligationsRial, canFinish: !unfinishedStages.length && !openMatches.length, canClose: !openCases.length && !corrections.length };
  }

  async finish(eventId: string, expectedVersion: number, actor: string, requestId: string): Promise<EventDoc> {
    const e = await this.event(eventId);
    await this.ct.acl.require(actor, 'event.manage', { type: 'event', id: eventId }, requestId);
    const b = await this.blockers(eventId);
    if (!b.canFinish) throw new DomainError('PRECONDITION_FAILED', 'stages or matches are not final yet (END-001)', { unfinishedStages: b.unfinishedStages, openMatches: b.openMatches });
    const doc = await this.ct.dbh.withTransaction(async (session) => {
      const { doc } = await applyTransition(eventMachine, this.c.events, e._id, { transition: 'finish', expectedVersion, actorRoles: await this.roles(actor, eventId) }, {}, session);
      await this.ct.audit.append({ actorPrincipalId: actor, action: 'event.finish', target: { type: 'event', id: e._id }, scope: { type: 'event', id: e._id }, outcome: 'success', requestId }, session);
      await this.ct.outbox.append({ type: 'competition.event.finished', aggregate: { type: 'event', id: e._id }, aggregateVersion: doc.version, actor: { principalId: actor, kind: 'user' }, payload: { eventId: e._id, name: e.name, dedupeKey: `event.finished:${e._id}` }, correlationId: requestId }, session);
      return doc;
    });
    return doc;
  }

  /** END-006 close: no open case or correction. Then the exactly-once effects. */
  async close(eventId: string, expectedVersion: number, approvalId: string | null, actor: string, requestId: string): Promise<{ event: EventDoc; effects: Record<string, unknown> }> {
    let e = await this.event(eventId);
    if (e.state === 'finished') {
      const roles = await this.roles(actor, eventId);
      if (!(await this.ct.acl.can(actor, 'event.manage', { type: 'event', id: eventId })) && !(await this.ct.acl.can(actor, 'finance.read', { type: 'event', id: eventId }))) await this.ct.acl.require(actor, 'event.manage', { type: 'event', id: eventId }, requestId);
      const b = await this.blockers(eventId);
      if (!b.canClose) throw new DomainError('PRECONDITION_FAILED', 'open cases or corrections block the close (END-006)', { openCases: b.openCases, corrections: b.corrections });
      // closing applies honors, ratings and prize entitlements: an independent second approval (ACL-003)
      if (!approvalId) throw new DomainError('PRECONDITION_FAILED', 'closing an event needs an independent approval', { secondApproval: true });
      await this.ct.approvals.consume(approvalId, 'event.close', { type: 'event', id: eventId }, { principalId: actor, requestId });
      e = await this.ct.dbh.withTransaction(async (session) => {
        const { doc } = await applyTransition(eventMachine, this.c.events, e._id, { transition: 'close', expectedVersion, actorRoles: roles, approvalId }, {}, session);
        await this.ct.audit.append({ actorPrincipalId: actor, action: 'event.close', target: { type: 'event', id: e._id }, scope: { type: 'event', id: e._id }, outcome: 'success', details: { openObligationsRial: b.openObligationsRial }, requestId }, session);
        return doc;
      });
    } else if (e.state === 'closed') {
      await this.ct.acl.require(actor, 'event.manage', { type: 'event', id: eventId }, requestId); // resume an interrupted close
    } else throw new DomainError('ILLEGAL_TRANSITION', `event cannot close from ${e.state}`);
    const effects = await this.effects(e, actor, requestId);
    return { event: e, effects };
  }

  private async effects(e: EventDoc, actor: string, requestId: string) {
    const honors = await new HonorService(this.ct).issueForEvent(e._id, requestId);
    const ratingSystems = e.config.rated ? await new RatingService(this.ct).rebuildForEvent(e._id, 'event closed') : 0;
    // season quotas (END-004): the season's next-event quotas go to the top of this event's final standings
    const quotas: Array<{ targetEventId: string; participationId: string }> = [];
    if (e.config.seasonId) {
      const season = await this.c.seasons.findOne({ _id: e.config.seasonId });
      const champs = await this.c.honors.find({ eventId: e._id, state: 'active', 'basis.kind': 'standing' }).sort({ place: 1 }).toArray();
      for (const q of season?.nextEventQuotas ?? []) {
        for (const h of champs.slice(0, q.slots)) {
          if (!h.participationId) continue;
          await this.c.counters.updateOne({ _id: `quota:${e._id}:${q.targetEventId}:${h.participationId}` }, { $setOnInsert: { value: 1 } }, { upsert: true });
          quotas.push({ targetEventId: q.targetEventId, participationId: h.participationId });
        }
      }
    }
    // prize entitlements: bind each unbound prize to the discipline's final standing version (END-002); payout stays finance's
    let prizesBound = 0;
    for (const p of await this.c.prizes.find({ eventId: e._id, resultRef: null, state: { $in: ['defined', 'recipient_verified'] } }).toArray()) {
      const stage = await this.c.stages.find({ eventId: e._id, ...(p.disciplineId ? { disciplineId: p.disciplineId } : {}), state: 'finished' }).sort({ order: -1 }).limit(1).next();
      const rv = stage ? await this.c.resultVersions.find({ targetType: 'standing', targetId: stage._id, 'data.final': true }).sort({ version: -1 }).limit(1).next() : null;
      if (!rv || !stage) continue;
      const r = await this.c.prizes.updateOne({ _id: p._id, resultRef: null }, { $set: { resultRef: { matchOrStandingId: stage._id, resultVersion: rv.version, final: true } }, $inc: { version: 1 } });
      prizesBound += r.modifiedCount;
    }
    const archive = await this.archive(e, actor);
    if (!(await this.c.outbox.findOne({ type: 'competition.event.closed', 'aggregate.id': e._id }))) {
      await this.ct.outbox.append({ type: 'competition.event.closed', aggregate: { type: 'event', id: e._id }, aggregateVersion: e.version, actor: { principalId: actor, kind: 'user' }, payload: { eventId: e._id, name: e.name, honors: honors.issued, quotas, dedupeKey: `event.closed:${e._id}` }, correlationId: requestId });
    }
    return { honors, ratingSystems, quotas, prizesBound, archived: !!archive };
  }

  /** END-007 archive snapshot (immutable; first write wins). */
  private async archive(e: EventDoc, actor: string): Promise<EventArchiveDoc> {
    const existing = await this.c.eventArchives.findOne({ _id: e._id });
    if (existing) return existing;
    const discs = await this.c.disciplines.find({ eventId: e._id }).toArray();
    const parts = await this.c.participations.find({ eventId: e._id, registrationState: 'confirmed' }).toArray();
    const stages = await this.c.stages.find({ eventId: e._id }).toArray();
    const standings = [];
    for (const s of stages) {
      const rv = await this.c.resultVersions.find({ targetType: 'standing', targetId: s._id, 'data.final': true }).sort({ version: -1 }).limit(1).next();
      if (rv) standings.push({ stageId: s._id, resultVersion: rv.version, rows: (rv.data['rows'] as unknown[]) ?? [] });
    }
    const prizes = await this.c.prizes.find({ eventId: e._id }).toArray();
    const doc: EventArchiveDoc = {
      _id: e._id, eventName: e.name, closedAt: iso(), closedBy: actor,
      rules: discs.filter((d) => d.rulesSnapshot).map((d) => ({ disciplineId: d._id, packageId: d.rulesSnapshot!.packageId, version: d.rulesSnapshot!.version, hash: d.rulesSnapshot!.hash })),
      rosters: parts.map((p) => ({ participationId: p._id, displayName: p.snapshot.displayName, teamId: p.snapshot.teamId, roster: p.snapshot.roster })),
      standings, honors: (await this.c.honors.find({ eventId: e._id, state: 'active' }, { projection: { _id: 1 } }).toArray()).map((h) => h._id),
      prizes: prizes.map((p) => ({ id: p._id, title: p.title, amountRial: p.amountRial, state: p.state, open: !['paid', 'cancelled'].includes(p.state) })),
      openObligationsRial: prizes.filter((p) => !['paid', 'cancelled'].includes(p.state)).reduce((t, p) => t + p.amountRial, 0),
      media: (await this.c.files.find({ 'scope.type': 'event', 'scope.id': e._id, visibility: 'public' } as never, { projection: { _id: 1, kind: 1 } }).limit(200).toArray()).map((f) => ({ kind: String((f as { kind?: string }).kind ?? 'file'), ref: f._id })),
      outboxEvents: await this.c.outbox.countDocuments({ 'payload.eventId': e._id }),
    };
    try {
      await this.c.eventArchives.insertOne(doc);
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
    return (await this.c.eventArchives.findOne({ _id: e._id }))!;
  }

  async archiveEvent(eventId: string, expectedVersion: number, actor: string, requestId: string): Promise<EventDoc> {
    const e = await this.event(eventId);
    await this.ct.acl.require(actor, 'event.manage', { type: 'event', id: eventId }, requestId);
    if (e.state === 'closed' && !(await this.c.eventArchives.findOne({ _id: e._id }))) throw new DomainError('PRECONDITION_FAILED', 'complete the close first (archive snapshot missing)');
    return (await applyTransition(eventMachine, this.c.events, e._id, { transition: 'archive', expectedVersion, actorRoles: await this.roles(actor, eventId) })).doc;
  }
  async getArchive(eventId: string) {
    const a = await this.c.eventArchives.findOne({ _id: eventId });
    if (!a) throw new DomainError('NOT_FOUND', 'no archive for this event yet');
    const e = await this.event(eventId);
    if (e.visibility !== 'public') throw new DomainError('NOT_FOUND', 'no archive for this event yet');
    return { ...a, rosters: a.rosters.map((r) => ({ ...r, roster: r.roster.map((x) => ({ principalId: x.principalId, displayName: x.displayName, role: x.role })) })) };
  }

  // ------------------------------------------------------------------ END-007 feedback and report
  async feedback(eventId: string, score: number, comment: string | null, actor: string): Promise<FeedbackDoc> {
    const e = await this.event(eventId);
    if (!['finished', 'closed', 'archived'].includes(e.state)) throw new DomainError('PRECONDITION_FAILED', 'feedback opens when the event finishes');
    if (!Number.isInteger(score) || score < 1 || score > 5) throw new DomainError('VALIDATION_FAILED', 'score is 1..5');
    if (comment && comment.length > 2000) throw new DomainError('VALIDATION_FAILED', 'comment is too long');
    if (!(await this.c.participations.findOne({ eventId, 'snapshot.roster.principalId': actor }))) throw new DomainError('FORBIDDEN', 'only participants give feedback');
    const doc: FeedbackDoc = { _id: newId('fbk'), eventId, principalId: actor, score, comment: comment?.trim() || null, createdAt: iso() };
    try {
      await this.c.feedback.insertOne(doc);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'you already gave feedback for this event');
      throw err;
    }
    return doc;
  }
  /** Organizer / sponsor report: only facts the platform recorded (no invented audience numbers). */
  async report(eventId: string, actor: string, requestId: string) {
    const e = await this.event(eventId);
    await this.ct.acl.require(actor, 'event.manage', { type: 'event', id: eventId }, requestId);
    const [participants, matches, finalMatches, cases, sanctions, fb, prizes] = await Promise.all([
      this.c.participations.countDocuments({ eventId, registrationState: 'confirmed' }),
      this.c.matches.countDocuments({ eventId }),
      this.c.matches.countDocuments({ eventId, state: 'final' }),
      this.c.disputes.aggregate<{ _id: string; n: number }>([{ $match: { eventId } }, { $group: { _id: '$category', n: { $sum: 1 } } }]).toArray(),
      this.c.sanctions.countDocuments({ 'scope.kind': 'event', 'scope.id': eventId }),
      this.c.feedback.find({ eventId }).toArray(),
      this.c.prizes.find({ eventId }).toArray(),
    ]);
    return {
      event: { id: e._id, name: e.name, state: e.state, startsAt: e.startsAt, endsAt: e.endsAt },
      participants, matches, finalMatches, casesByCategory: Object.fromEntries(cases.map((c) => [c._id, c.n])), sanctions,
      feedback: { count: fb.length, average: fb.length ? Math.round((fb.reduce((t, f) => t + f.score, 0) / fb.length) * 10) / 10 : null, comments: fb.filter((f) => f.comment).slice(0, 50).map((f) => f.comment) },
      prizes: { totalRial: prizes.reduce((t, p) => t + p.amountRial, 0), paidRial: prizes.filter((p) => p.state === 'paid').reduce((t, p) => t + p.amountRial, 0), openRial: prizes.filter((p) => !['paid', 'cancelled'].includes(p.state)).reduce((t, p) => t + p.amountRial, 0) },
      sponsors: e.config.affiliation?.state === 'verified' ? [e.config.affiliation.body] : [],
      honors: (await new HonorService(this.ct).forEvent(eventId)).filter((h) => h.state === 'active').map((h) => ({ label: h.label, place: h.place, team: h.team?.nameAtTime ?? null })),
    };
  }
}
