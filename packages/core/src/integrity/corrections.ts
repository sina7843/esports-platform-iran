import { DomainError, matchMachine, prizeMachine } from '@esp/contracts';
import type { Container } from '../container.js';
import type { MatchDoc } from '../db/collections.js';
import type { MatchOutcome } from '../db/collections-esp04.js';
import type { PrizeDoc } from '../db/collections-esp03.js';
import type { CorrectionDoc, CorrectionImpact } from '../db/collections-esp05.js';
import { applyTransition } from '../domain/transition.js';
import { newId } from '../ids.js';
import { resolveBracket, type SlotResult } from '../competition/engine/index.js';
import { StructureService, toSlotResult } from '../competition/structure.js';

const iso = () => new Date().toISOString();
const ELIM = new Set(['single_elim', 'double_elim']);
const NOT_STARTED = ['awaiting_sides', 'scheduled', 'awaiting_readiness', 'ready', 'cancelled'];
const RESETTABLE = ['scheduled', 'awaiting_readiness', 'ready'];
/** saga steps in order; each is idempotent and recorded on completion, so a resumed run continues where it stopped */
export const CORRECTION_STEPS = ['freeze', 'reset_dependents', 'result', 'standings', 'transfers', 'ratings', 'honors', 'prizes', 'notify'] as const;
type Step = (typeof CORRECTION_STEPS)[number];
const REOPEN_STEPS: Step[] = ['freeze', 'reset_dependents', 'notify'];

/**
 * RES-006/007/008, AC-11: result correction and reopen. A preview lists every effect (slots, dependents, standings,
 * ratings, honors, prizes, quotas, news). If a dependent match has started, nothing is rewritten automatically: the
 * correction is blocked and a case is opened. Otherwise a saga applies the change under a stage lease; each step is
 * idempotent, so a failure part-way resumes to a consistent state. Paid prizes are never deleted from the ledger —
 * they get a compensation case.
 */
export class CorrectionService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private async match(matchId: string): Promise<MatchDoc> {
    const m = await this.c.matches.findOne({ _id: matchId });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    return m;
  }

  /** Matches whose occupants or pairing depend on this match's result (same stage + downstream stages). */
  async dependents(m: MatchDoc): Promise<{ inStage: MatchDoc[]; downstream: MatchDoc[]; staleEntries: string[] }> {
    const all = await this.c.matches.find({ stageId: m.stageId, _id: { $ne: m._id } }).toArray();
    const st = await this.c.stageStructures.findOne({ _id: m.stageId });
    const key = m.slot?.key;
    const inStage: MatchDoc[] = [];
    if (key) {
      const frontier = [key];
      const seen = new Set<string>([key]);
      while (frontier.length) {
        const k = frontier.pop()!;
        for (const x of all) {
          if (!x.slot || seen.has(x.slot.key)) continue;
          if (x.slot.sources.some((s) => (s.kind === 'winner' || s.kind === 'loser') && s.slot === k)) {
            seen.add(x.slot.key);
            inStage.push(x);
            frontier.push(x.slot.key);
          }
        }
      }
      // standings-paired formats: every later round depends on the table this result feeds
      const format = st?.format === 'mixed' && st.plan.meta ? String((st.plan as { format: string }).format) : st?.format;
      if ((format === 'swiss' || (format === 'multi_lobby' && st?.ruleValues['lobby.assignment'] === 'reseed_by_standings')) && m.slot) {
        for (const x of all) if (x.slot && x.slot.round > m.slot.round && !inStage.includes(x)) inStage.push(x);
      }
    }
    const entries = await this.c.stageEntries.find({ 'origin.ref': m.stageId }).toArray();
    const targets = [...new Set(entries.map((e) => e.stageId))];
    const downstream = targets.length ? await this.c.matches.find({ stageId: { $in: targets } }).toArray() : [];
    const drawnTargets = new Set(downstream.map((x) => x.stageId));
    return { inStage, downstream, staleEntries: entries.filter((e) => !drawnTargets.has(e.stageId)).map((e) => e._id) };
  }

  /** RES-006 impact preview — read only. */
  async preview(matchId: string, to: MatchOutcome | null, actor: string, requestId: string): Promise<CorrectionImpact> {
    const m = await this.match(matchId);
    await this.ct.acl.require(actor, 'match.result.verify', { type: 'match', id: m._id }, requestId);
    return this.impact(m, to);
  }

  private async impact(m: MatchDoc, to: MatchOutcome | null): Promise<CorrectionImpact> {
    if (to) await new (await import('../competition/results.js')).MatchResultService(this.ct).validate(m, to);
    const structure = new StructureService(this.ct);
    const st = await this.c.stageStructures.findOne({ _id: m.stageId });
    const dep = await this.dependents(m);
    const started = [...dep.inStage, ...dep.downstream].filter((x) => !NOT_STARTED.includes(x.state));
    const impact: CorrectionImpact = {
      slots: [], startedDependents: started.map((x) => ({ matchId: x._id, slotKey: x.slot?.key ?? '-', state: x.state })),
      resetMatches: dep.inStage.filter((x) => RESETTABLE.includes(x.state) || x.state === 'awaiting_sides').map((x) => x._id),
      standings: [], ratingEvents: 0, honors: [], prizes: [], quotas: [], newsEvents: ['competition.result.corrected'],
    };
    if (st) {
      const { stage } = await structure.load(m.stageId);
      const matches = await this.c.matches.find({ stageId: m.stageId }).toArray();
      const hypo = matches.map((x) => (x._id === m._id ? { ...x, state: to ? ('final' as const) : ('disputed' as const), outcome: to } : x));
      const format = structure.phaseFormat(st, stage);
      if (ELIM.has(format)) {
        const res = (ms: MatchDoc[]) => {
          const r: Record<string, SlotResult> = {};
          for (const x of ms) if (x.state === 'final' && x.outcome && x.slot) { const s = toSlotResult(x.outcome); if (s) r[x.slot.key] = s; }
          return r;
        };
        try {
          const plan = structure.phasePlan(st, stage);
          const before = resolveBracket(plan, structure.phaseSeeds(st), res(matches));
          const after = resolveBracket(plan, structure.phaseSeeds(st), res(hypo));
          for (const k of Object.keys(before)) {
            const b = (before[k]!.participants ?? []).map((p) => p ?? '-');
            const a = (after[k]?.participants ?? []).map((p) => p ?? '-');
            if (b.join() !== a.join()) impact.slots.push({ key: k, before: b, after: a, winnerBefore: null, winnerAfter: null });
          }
        } catch {
          // a bracket that cannot resolve is reported through standings review below
        }
      }
      const sb = st.standings?.rows ?? [];
      const sa = (await structure.computeStandings(st, stage, hypo)).rows;
      const ids = new Set([...sb.map((r) => r.id), ...sa.map((r) => r.id)]);
      for (const id of ids) {
        const rb = sb.find((r) => r.id === id)?.rank ?? null;
        const ra = sa.find((r) => r.id === id)?.rank ?? null;
        if (rb !== ra) impact.standings.push({ id, rankBefore: rb, rankAfter: ra });
      }
    }
    impact.ratingEvents = await this.c.ratingEvents.countDocuments({ matchId: m._id, voided: false });
    impact.honors = (await this.c.honors.find({ eventId: m.eventId, state: 'active', $or: [{ stageId: m.stageId }, { 'basis.ref': m.stageId }] }).toArray()).map((h) => ({ id: h._id, kind: h.kind, place: h.place }));
    impact.prizes = (await this.c.prizes.find({ eventId: m.eventId, 'resultRef.matchOrStandingId': { $in: [m._id, m.stageId] } }).toArray()).map((p) => ({ id: p._id, title: p.title, state: p.state, amountRial: p.amountRial }));
    impact.quotas = (await this.c.stageEntries.find({ 'origin.ref': m.stageId }).toArray()).map((e) => ({ stageId: e.stageId, participationId: e.participationId }));
    return impact;
  }

  /**
   * Requests a correction of a final result. Outside a case it needs `match.result.correct` and an independent
   * approval (ACL-003); inside a case the decision of the independent official is the authority.
   */
  async request(matchId: string, to: MatchOutcome, reason: string, caseId: string | null, approvalId: string | null, actor: string, requestId: string, opts: { fromCase?: boolean; failAfter?: Step } = {}): Promise<CorrectionDoc> {
    const m = await this.match(matchId);
    if (m.state !== 'final') throw new DomainError('PRECONDITION_FAILED', `only a final result is corrected (match is ${m.state}); decide the open case instead`);
    if (reason.trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'a correction needs a documented reason');
    if (!opts.fromCase) {
      await this.ct.acl.require(actor, 'match.result.correct', { type: 'match', id: m._id }, requestId);
      if (!approvalId) throw new DomainError('PRECONDITION_FAILED', 'a result correction needs an independent approval (ACL-003)', { secondApproval: true });
      await this.ct.approvals.consume(approvalId, 'match.result.correct', { type: 'match', id: m._id }, { principalId: actor, requestId });
    }
    if (await this.c.corrections.findOne({ matchId, state: { $in: ['applying', 'failed'] } })) throw new DomainError('CONFLICT', 'a correction of this match is in progress; resume it first');
    const impact = await this.impact(m, to);
    const blocked = impact.startedDependents.length > 0;
    const doc: CorrectionDoc = { _id: newId('cor'), eventId: m.eventId, stageId: m.stageId, matchId, kind: 'correction', from: m.outcome ?? null, to, reason, caseId, approvalId: opts.fromCase ? `case:${caseId}` : approvalId, requestedBy: actor, impact, state: blocked ? 'blocked_dependency' : 'applying', steps: [], error: null, createdAt: iso(), updatedAt: iso(), version: 0 };
    await this.c.corrections.insertOne(doc);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.result.correction_requested', target: { type: 'match', id: m._id }, scope: { type: 'match', id: m._id }, outcome: 'success', details: { correctionId: doc._id, blocked, caseId }, requestId });
    if (blocked) {
      // AC-11: a started dependent forbids an automatic rewrite of the path; an official decides in a case
      const { DisputeService } = await import('./disputes.js');
      const ds = new DisputeService(this.ct);
      if (!caseId || !(await ds.openFor(m._id))) {
        const kase = await this.c.disputes.insertOne({
          _id: newId('dsp'), eventId: m.eventId, matchId: null, category: 'result', claim: `Correction ${doc._id} of match ${m._id} is blocked: dependent matches already started (${impact.startedDependents.map((d) => d.slotKey).join(', ')}). Officials must decide the path (replay, keep, or manual adjustment).`,
          filedBy: 'system', filedSide: null, parties: m.principalIds ?? [], state: 'filed', deadlines: { defenseBy: null, appealBy: null, fileBy: null }, assignee: null, appealAuthority: null, evidence: [], defense: [], evidenceRequests: [], reports: [], decisions: [], views: [], linkedCorrectionId: doc._id, createdAt: iso(), updatedAt: iso(), version: 0,
        });
        await this.c.corrections.updateOne({ _id: doc._id }, { $set: { caseId: kase.insertedId } });
        doc.caseId = kase.insertedId;
      }
      await this.ct.outbox.append({ type: 'competition.result.correction_blocked', aggregate: { type: 'correction', id: doc._id }, aggregateVersion: 0, actor: { principalId: actor, kind: 'user' }, payload: { correctionId: doc._id, matchId, eventId: m.eventId, caseId: doc.caseId, principals: m.principalIds ?? [] }, correlationId: requestId });
      return doc;
    }
    return this.run(doc._id, actor, requestId, opts.failAfter);
  }

  /** RES-008: reopen a final match into a case (no new result yet). Not after the event is closed — use a correction. */
  async reopen(matchId: string, reason: string, approvalId: string, actor: string, requestId: string): Promise<CorrectionDoc> {
    const m = await this.match(matchId);
    if (m.state !== 'final') throw new DomainError('PRECONDITION_FAILED', `only a final match is reopened (match is ${m.state})`);
    const ev = await this.c.events.findOne({ _id: m.eventId }, { projection: { state: 1 } });
    if (ev && ['closed', 'archived'].includes(ev.state)) throw new DomainError('PRECONDITION_FAILED', 'the event is closed; request a result correction instead');
    await this.ct.acl.require(actor, 'match.result.correct', { type: 'match', id: m._id }, requestId);
    await this.ct.approvals.consume(approvalId, 'match.result.correct', { type: 'match', id: m._id }, { principalId: actor, requestId });
    const impact = await this.impact(m, null);
    const blocked = impact.startedDependents.length > 0;
    const doc: CorrectionDoc = { _id: newId('cor'), eventId: m.eventId, stageId: m.stageId, matchId, kind: 'reopen', from: m.outcome ?? null, to: null, reason, caseId: null, approvalId, requestedBy: actor, impact, state: blocked ? 'blocked_dependency' : 'applying', steps: [], error: null, createdAt: iso(), updatedAt: iso(), version: 0 };
    await this.c.corrections.insertOne(doc);
    if (blocked) return doc;
    const out = await this.run(doc._id, actor, requestId);
    // the reopened match is decided through a case like any disputed result
    const { DisputeService } = await import('./disputes.js');
    const kase = await new DisputeService(this.ct).file({ eventId: m.eventId, matchId: m._id, category: 'result', claim: `Reopened by an official: ${reason}`, evidenceFileIds: [] }, actor, requestId, { system: true });
    await this.c.corrections.updateOne({ _id: doc._id }, { $set: { caseId: kase._id } });
    return { ...out, caseId: kase._id };
  }

  async resume(correctionId: string, actor: string, requestId: string): Promise<CorrectionDoc> {
    const d = await this.c.corrections.findOne({ _id: correctionId });
    if (!d) throw new DomainError('NOT_FOUND', 'correction not found');
    await this.ct.acl.require(actor, 'match.result.correct', { type: 'match', id: d.matchId }, requestId);
    if (d.state !== 'failed' && d.state !== 'applying') throw new DomainError('PRECONDITION_FAILED', `correction is ${d.state}`);
    return this.run(correctionId, actor, requestId);
  }

  private async lease(key: string, owner: string): Promise<void> {
    const now = new Date();
    try {
      await this.c.leases.findOneAndUpdate({ _id: key, $or: [{ owner }, { until: { $lt: now.toISOString() } }] }, { $set: { owner, until: new Date(now.getTime() + 120_000).toISOString() } }, { upsert: true });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'another recalculation holds this stage; retry shortly');
      throw e;
    }
  }

  private async run(correctionId: string, actor: string, requestId: string, failAfter?: Step): Promise<CorrectionDoc> {
    const d = (await this.c.corrections.findOne({ _id: correctionId }))!;
    const leaseKey = `stage:${d.stageId}`;
    await this.lease(leaseKey, d._id);
    await this.c.corrections.updateOne({ _id: d._id }, { $set: { state: 'applying', error: null, updatedAt: iso() }, $inc: { version: 1 } });
    const steps = d.kind === 'reopen' ? REOPEN_STEPS : [...CORRECTION_STEPS];
    try {
      for (const step of steps) {
        const cur = (await this.c.corrections.findOne({ _id: d._id }))!;
        if (cur.steps.includes(step)) continue;
        await this.step(cur, step, actor, requestId);
        await this.c.corrections.updateOne({ _id: d._id }, { $addToSet: { steps: step }, $set: { updatedAt: iso() }, $inc: { version: 1 } });
        if (failAfter === step) throw new Error(`injected failure after ${step}`);
      }
      await this.c.corrections.updateOne({ _id: d._id }, { $set: { state: 'applied', updatedAt: iso() }, $inc: { version: 1 } });
    } catch (e) {
      await this.c.corrections.updateOne({ _id: d._id }, { $set: { state: 'failed', error: (e as Error).message, updatedAt: iso() }, $inc: { version: 1 } });
      await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.result.correction_failed', target: { type: 'correction', id: d._id }, scope: { type: 'match', id: d.matchId }, outcome: 'failed', details: { error: (e as Error).message }, requestId });
    } finally {
      await this.c.leases.deleteOne({ _id: leaseKey, owner: d._id });
    }
    return (await this.c.corrections.findOne({ _id: d._id }))!;
  }

  private async step(d: CorrectionDoc, step: Step, actor: string, requestId: string): Promise<void> {
    const structure = new StructureService(this.ct);
    switch (step) {
      case 'freeze': {
        const m = await this.match(d.matchId);
        if (m.state !== 'final') return; // already reopened by an earlier attempt
        await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'reopen', expectedVersion: m.version, actorRoles: ['head_referee'], ...(d.approvalId ? { approvalId: d.approvalId } : {}) }, { resultVersion: m.resultVersion + 1 } as Partial<MatchDoc>);
        await this.c.resultVersions.insertOne({ _id: newId('rv'), targetType: 'match', targetId: m._id, version: m.resultVersion + 1, calcVersion: 'reopen', data: { final: false, outcome: m.outcome, correctionId: d._id }, provenance: { source: 'referee', actorPrincipalId: actor, reason: d.reason, evidenceFileIds: [] }, createdAt: iso() });
        return;
      }
      case 'reset_dependents': {
        for (const id of d.impact.resetMatches) {
          const x = await this.c.matches.findOne({ _id: id });
          if (!x || !RESETTABLE.includes(x.state)) continue;
          await applyTransition(matchMachine, this.c.matches, x._id, { transition: 'reset_sides', expectedVersion: x.version, actorRoles: ['system'] }, { sides: [], participantIds: [], principalIds: [], room: { ready: [], countdownTo: null, publicNotice: `occupants changed by correction ${d._id}` } } as unknown as Partial<MatchDoc>);
        }
        return;
      }
      case 'result': {
        const m = await this.match(d.matchId);
        if (m.state === 'final') return;
        const { MatchResultService } = await import('../competition/results.js');
        await new MatchResultService(this.ct).finalize(m._id, d.to, actor, requestId, { system: true, ...(d.caseId ? { caseId: d.caseId } : {}), reason: `correction ${d._id}: ${d.reason}` });
        return;
      }
      case 'standings': {
        await structure.sync(d.stageId, requestId);
        const st = await this.c.stageStructures.findOne({ _id: d.stageId });
        if (st?.state === 'complete') {
          const last = await this.c.resultVersions.find({ targetType: 'standing', targetId: d.stageId }).sort({ version: -1 }).limit(1).next();
          if (last?.data['correctionId'] !== d._id) await this.c.resultVersions.insertOne({ _id: newId('rv'), targetType: 'standing', targetId: d.stageId, version: (last?.version ?? 0) + 1, calcVersion: st.plan.engine, data: { final: true, rows: st.standings?.rows ?? [], algorithm: st.plan.algorithm, rulesHash: st.rulesHash, correctionId: d._id }, provenance: { source: 'engine', actorPrincipalId: actor, reason: `correction ${d._id}`, evidenceFileIds: [] }, createdAt: iso() });
        }
        return;
      }
      case 'transfers': {
        const dep = await this.dependents(await this.match(d.matchId));
        if (dep.staleEntries.length) await this.c.stageEntries.deleteMany({ _id: { $in: dep.staleEntries } }); // not drawn yet: the official re-runs the transfer from corrected standings
        return;
      }
      case 'ratings': {
        const { RatingService } = await import('../ranking/ratings.js');
        await new RatingService(this.ct).rebuildForEvent(d.eventId, `correction ${d._id}`);
        return;
      }
      case 'honors': {
        const { HonorService } = await import('../honors/honors.js');
        await new HonorService(this.ct).reconcile(d.eventId, `correction ${d._id}`, actor, requestId);
        return;
      }
      case 'prizes': {
        for (const p of await this.c.prizes.find({ eventId: d.eventId, 'resultRef.matchOrStandingId': { $in: [d.matchId, d.stageId] } }).toArray()) {
          if (p.state === 'paid' || p.state === 'paying') {
            // never rewrite the ledger: a compensation case decides recovery or a supplementary payment
            const exists = await this.c.disputes.findOne({ linkedCorrectionId: d._id, claim: { $regex: p._id } });
            if (!exists) await this.c.disputes.insertOne({ _id: newId('dsp'), eventId: d.eventId, matchId: null, category: 'other', claim: `Prize ${p._id} (${p.title}) was ${p.state} before correction ${d._id}; finance must decide a compensating entry.`, filedBy: 'system', filedSide: null, parties: p.recipient ? [p.recipient.payeePrincipalId] : [], state: 'filed', deadlines: { defenseBy: null, appealBy: null, fileBy: null }, assignee: null, appealAuthority: null, evidence: [], defense: [], evidenceRequests: [], reports: [], decisions: [], views: [], linkedCorrectionId: d._id, createdAt: iso(), updatedAt: iso(), version: 0 });
          } else if (['defined', 'recipient_verified', 'ready_to_pay'].includes(p.state)) {
            await applyTransition(prizeMachine, this.c.prizes, p._id, { transition: 'dispute', expectedVersion: p.version, actorRoles: ['head_referee'] }, { history: [...p.history, { at: iso(), by: actor, transition: 'dispute', note: `frozen by correction ${d._id}` }] } as Partial<PrizeDoc>);
          }
        }
        return;
      }
      case 'notify': {
        const m = await this.match(d.matchId);
        if (await this.c.outbox.findOne({ type: d.kind === 'reopen' ? 'competition.match.reopened' : 'competition.result.corrected', 'payload.correctionId': d._id })) return;
        await this.ct.outbox.append({ type: d.kind === 'reopen' ? 'competition.match.reopened' : 'competition.result.corrected', aggregate: { type: 'match', id: m._id }, aggregateVersion: m.version, actor: { principalId: actor, kind: 'user' }, payload: { correctionId: d._id, matchId: m._id, eventId: d.eventId, stageId: d.stageId, from: d.from, to: d.to, reason: d.reason, principals: m.principalIds ?? [] }, correlationId: requestId });
        return;
      }
    }
  }

  async list(eventId: string, actor: string, requestId: string): Promise<CorrectionDoc[]> {
    await this.ct.acl.require(actor, 'match.result.verify', { type: 'event', id: eventId }, requestId);
    return this.c.corrections.find({ eventId }).sort({ createdAt: -1 }).limit(200).toArray();
  }
  async get(id: string, actor: string, requestId: string): Promise<CorrectionDoc> {
    const d = await this.c.corrections.findOne({ _id: id });
    if (!d) throw new DomainError('NOT_FOUND', 'correction not found');
    await this.ct.acl.require(actor, 'match.result.verify', { type: 'match', id: d.matchId }, requestId);
    return d;
  }
}
