import { DomainError, matchMachine } from '@esp/contracts';
import type { Container } from '../container.js';
import type { MatchDoc } from '../db/collections.js';
import type { MatchOutcome } from '../db/collections-esp04.js';
import { applyTransition } from '../domain/transition.js';
import { newId } from '../ids.js';
import { parseDecimal, validatePlacements } from './engine/index.js';
import { getGameModule } from '../catalog/modules/index.js';
import type { GameUnitInput } from '../db/collections-esp05.js';
import { DisputeService } from '../integrity/disputes.js';

const iso = () => new Date().toISOString();

/**
 * Result hook (ROOM-003; full cycle in ESP-05). A side representative or official submits a provisional outcome,
 * validated against the match kind and configuration; an official finalises it. Only `final` outcomes are consumed by
 * advancement and standings. Every step writes an immutable result version.
 */
export class MatchResultService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private async load(matchId: string): Promise<MatchDoc> {
    const m = await this.c.matches.findOne({ _id: matchId });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    return m;
  }
  async rolesOn(actor: string, m: MatchDoc) {
    const grants = await this.ct.acl.activeGrants(actor);
    const ctx = await this.ct.acl.resourceContext({ type: 'match', id: m._id });
    const chain = [ctx.scope, ...ctx.ancestors];
    return grants.filter((g) => chain.some((s) => s.type === g.scope.type && s.id === g.scope.id)).map((g) => g.role);
  }
  sideOf(m: MatchDoc, actor: string): number {
    return m.sides.findIndex((s) => s.roster.some((r) => r.principalId === actor));
  }

  /** Shape and consistency checks; never invents a score (RES-004 base). */
  async validate(m: MatchDoc, o: MatchOutcome): Promise<void> {
    const bad = (msg: string) => {
      throw new DomainError('VALIDATION_FAILED', msg);
    };
    const pair = (v: [number, number] | null) => v && (v.length !== 2 || v.some((x) => !Number.isInteger(x) || x < 0)) && bad('scores must be two whole numbers >= 0');
    if (m.kind === 'head_to_head') {
      if (o.kind !== 'win' && o.kind !== 'draw' && o.kind !== 'double_forfeit') bad('a head-to-head match needs win, draw or double_forfeit');
      if (o.kind === 'win' || o.kind === 'draw') {
        pair(o.scores);
        pair(o.maps);
        const decide = o.maps ?? o.scores;
        if (o.kind === 'draw') {
          if (!m.config?.drawAllowed) bad('draws are not allowed in this match (rules)');
          if (decide && decide[0] !== decide[1]) bad('a draw needs equal scores');
        } else if (decide) {
          const expected = decide[0] > decide[1] ? 0 : decide[1] > decide[0] ? 1 : null;
          if (expected !== o.winnerSide) bad('the winner contradicts the scores');
        }
        if (o.kind === 'win' && o.maps && m.config?.bestOf && Math.max(...o.maps) !== Math.ceil(m.config.bestOf / 2)) bad(`best of ${m.config.bestOf}: the winner must have ${Math.ceil(m.config.bestOf / 2)} maps`);
      }
    } else if (m.kind === 'lobby') {
      if (o.kind !== 'placements') bad('a lobby needs placements');
      const errs = validatePlacements(m.participantIds ?? [], (o as Extract<MatchOutcome, { kind: 'placements' }>).placements);
      if (errs.length) bad(errs.join('; '));
    } else {
      if (o.kind !== 'attempts') bad('an attempts match needs attempts');
      const st = await this.c.stageStructures.findOne({ _id: m.stageId }, { projection: { format: 1, ruleValues: 1 } });
      const atts = (o as Extract<MatchOutcome, { kind: 'attempts' }>).attempts;
      const max = (st?.format === 'record' ? st.ruleValues['record.max_attempts'] : st?.ruleValues['time.max_attempts']) as number | undefined;
      if (new Set(atts.map((a) => a.attempt)).size !== atts.length) bad('attempt numbers must be unique');
      for (const a of atts) {
        if (!Number.isInteger(a.attempt) || a.attempt < 1 || (max && a.attempt > max)) bad(`attempt numbers must be 1..${max ?? '?'}`);
        if (Number.isNaN(Date.parse(a.at))) bad('attempt time must be an ISO instant');
        if (st?.format === 'record') {
          try {
            parseDecimal(a.value ?? '', st.ruleValues['record.precision'] as number);
          } catch (e) {
            bad((e as Error).message);
          }
        } else {
          if (a.dnf ? a.timeMs !== null : a.timeMs === null || !Number.isInteger(a.timeMs) || a.timeMs < 0) bad('time must be whole milliseconds; a DNF has none');
          if (!Number.isInteger(a.penaltyMs) || a.penaltyMs < 0) bad('penalty must be whole milliseconds >= 0');
        }
      }
    }
  }

  /** RES-001/004: each game unit is validated by the discipline's game module (map/set/round/attempt values). */
  async validateUnits(m: MatchDoc, units: GameUnitInput[]): Promise<void> {
    if (!units.length) return;
    if (new Set(units.map((u) => u.order)).size !== units.length || units.some((u) => !Number.isInteger(u.order) || u.order < 1)) throw new DomainError('VALIDATION_FAILED', 'game unit order must be unique whole numbers >= 1');
    const d = await this.c.disciplines.findOne({ _id: m.disciplineId }, { projection: { gameId: 1 } });
    const g = d ? await this.c.games.findOne({ _id: d.gameId }, { projection: { moduleId: 1 } }) : null;
    const mod = g ? getGameModule(g.moduleId) : undefined;
    if (!mod) throw new DomainError('PRECONDITION_FAILED', 'the game has no result module; game units cannot be validated');
    for (const u of units) {
      const r = mod.validateResult(u.values);
      if (!r.ok) throw new DomainError('VALIDATION_FAILED', `unit ${u.order} (${u.label}): ${r.errors.join('; ')}`);
    }
  }
  private clause<T>(m: MatchDoc, key: string): T | undefined {
    return m.rulesSnapshot?.clauses.find((c) => c.key === key)?.value as T | undefined;
  }
  /** RES-002/003: confirmation window and auto-confirm policy come from the frozen rules; absent → an official decides. */
  private resultPolicy(m: MatchDoc): { deadline: string | null; policy: 'on_deadline' | 'never' | null } {
    const min = this.clause<number>(m, 'result.confirm_minutes');
    const auto = this.clause<unknown>(m, 'result.auto_confirm');
    const policy = auto === true || auto === 'on_deadline' ? 'on_deadline' : auto === false || auto === 'never' ? 'never' : null;
    return { deadline: typeof min === 'number' && min > 0 ? new Date(Date.now() + min * 60_000).toISOString() : null, policy };
  }
  private async checkEvidence(ids: string[]) {
    for (const f of ids) {
      const file = await this.c.files.findOne({ _id: f });
      if (!file || file.quarantined) throw new DomainError('VALIDATION_FAILED', 'evidence must be clean uploaded files');
    }
  }
  private disputes() {
    return new DisputeService(this.ct);
  }

  /**
   * RES-001/002: a side (or official) submits a provisional result with game units, evidence and provenance. The first
   * submission moves the match to provisional and starts the confirmation window; a second side's matching submission
   * confirms it, a conflicting one opens a case automatically (AC-09).
   */
  async submit(matchId: string, outcome: MatchOutcome, evidenceFileIds: string[], actor: string, requestId: string, units: GameUnitInput[] = []): Promise<MatchDoc> {
    const m = await this.load(matchId);
    const side = this.sideOf(m, actor);
    const official = await this.ct.acl.can(actor, 'match.result.verify', { type: 'match', id: m._id });
    if (side < 0 && !official) throw new DomainError('FORBIDDEN', 'only a side of this match or an official can submit a result');
    await this.validate(m, outcome);
    await this.validateUnits(m, units);
    await this.checkEvidence(evidenceFileIds);
    const entry = { side: side >= 0 ? side : null, by: actor, outcome, units, evidenceFileIds, source: (side >= 0 ? 'side' : 'referee') as 'side' | 'referee', at: iso() };
    const version = { _id: newId('rv'), targetType: 'match' as const, targetId: m._id, version: m.resultVersion + 1, calcVersion: 'submission', data: { final: false, outcome, units, side: entry.side }, provenance: { source: official && side < 0 ? 'referee' : 'manual', actorPrincipalId: actor, reason: null, evidenceFileIds }, createdAt: iso() };
    let doc: MatchDoc;
    if (m.state === 'live' || m.state === 'paused') {
      const roles = official ? await this.rolesOn(actor, m) : (['team_captain'] as const); // a side representative acts as the side's captain
      ({ doc } = await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'submit_result', expectedVersion: m.version, actorRoles: roles }, { resultVersion: m.resultVersion + 1, result: { ...this.resultPolicy(m), submissions: [entry], confirmations: [], review: null } } as Partial<MatchDoc>));
      await this.c.resultVersions.insertOne(version);
    } else if (m.state === 'provisional') {
      if (m.result?.submissions.some((s) => s.side === entry.side && s.source !== 'integration')) throw new DomainError('CONFLICT', 'this side already submitted; open a case to change it');
      const r = await this.c.matches.findOneAndUpdate({ _id: m._id, version: m.version }, { $push: { 'result.submissions': entry }, $set: { resultVersion: m.resultVersion + 1, updatedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' });
      if (!r) throw new DomainError('CONFLICT', 'the match changed; reload');
      doc = r;
      await this.c.resultVersions.insertOne(version);
      const other = m.result?.submissions.find((s) => s.source !== 'integration' && s.side !== entry.side);
      if (other && sameOutcome(other.outcome, outcome)) {
        if (entry.side !== null) await this.c.matches.updateOne({ _id: m._id }, { $push: { 'result.confirmations': { side: entry.side, by: actor, at: iso() } } });
        if (!(await this.disputes().openFor(m._id))) doc = await this.finalize(m._id, outcome, 'system', requestId, { system: true, reason: 'both submissions agree', units: units.length ? units : other.units });
      } else if (other) {
        await this.disputes().file({ eventId: m.eventId, matchId: m._id, category: 'result', claim: `Conflicting result submissions (side ${other.side ?? 'official'} vs side ${entry.side ?? 'official'})`, evidenceFileIds: [] }, actor, requestId, { system: true });
        doc = await this.load(m._id);
      }
    } else throw new DomainError('ILLEGAL_TRANSITION', `results are submitted once the match is live (match is ${m.state})`);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.result.submit', target: { type: 'match', id: m._id }, scope: { type: 'match', id: m._id }, outcome: 'success', details: { kind: outcome.kind, units: units.length }, requestId });
    await this.ct.realtime.publish({ channel: `match:${m._id}`, type: 'result.provisional', audience: { kind: 'public' }, payload: { matchId: m._id, state: doc.state } });
    return doc;
  }

  /** RES-002: the opposing side confirms the provisional result → finalised by the system. */
  async confirm(matchId: string, actor: string, requestId: string): Promise<MatchDoc> {
    const m = await this.load(matchId);
    if (m.state !== 'provisional') throw new DomainError('ILLEGAL_TRANSITION', `nothing to confirm (match is ${m.state})`);
    const side = this.sideOf(m, actor);
    if (side < 0) throw new DomainError('FORBIDDEN', 'only a side of this match confirms a result');
    const sub = [...(m.result?.submissions ?? [])].reverse().find((s) => s.source !== 'integration' && s.side !== side);
    if (!sub) throw new DomainError('PRECONDITION_FAILED', 'there is no submission from the other side or an official to confirm');
    if (await this.disputes().openFor(m._id)) throw new DomainError('PRECONDITION_FAILED', 'an open case blocks finalisation (AC-09)');
    await this.c.matches.updateOne({ _id: m._id }, { $push: { 'result.confirmations': { side, by: actor, at: iso() } } });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.result.confirm', target: { type: 'match', id: m._id }, scope: { type: 'match', id: m._id }, outcome: 'success', requestId });
    return this.finalize(m._id, sub.outcome, 'system', requestId, { system: true, reason: `confirmed by side ${side}`, units: sub.units });
  }

  /** RES-002: the opposing side contests → a result case; the match becomes disputed. */
  async contest(matchId: string, claim: string, evidenceFileIds: string[], actor: string, requestId: string) {
    const m = await this.load(matchId);
    return this.disputes().file({ eventId: m.eventId, matchId: m._id, category: 'result', claim, evidenceFileIds }, actor, requestId);
  }

  /**
   * RES-005: an integration result is a source, not an authority. It never finalises by itself; a disagreement with the
   * human-submitted result flags the match for review and blocks auto-confirm.
   */
  async ingest(matchId: string, outcome: MatchOutcome, units: GameUnitInput[], sourceRef: string, requestId: string): Promise<MatchDoc> {
    const m = await this.load(matchId);
    if (!['live', 'paused', 'provisional', 'disputed'].includes(m.state)) throw new DomainError('ILLEGAL_TRANSITION', `match is ${m.state}`);
    await this.validate(m, outcome);
    await this.validateUnits(m, units);
    const entry = { side: null, by: `integration:${sourceRef}`, outcome, units, evidenceFileIds: [], source: 'integration' as const, at: iso() };
    const human = m.result?.submissions.filter((s) => s.source !== 'integration') ?? [];
    const mismatch = human.length > 0 && !human.every((s) => sameOutcome(s.outcome, outcome));
    if (m.state === 'live' || m.state === 'paused') {
      await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'submit_result', expectedVersion: m.version, actorRoles: ['system'] }, { resultVersion: m.resultVersion + 1, result: { ...this.resultPolicy(m), submissions: [entry], confirmations: [], review: null } } as Partial<MatchDoc>);
    } else {
      await this.c.matches.updateOne({ _id: m._id }, { $push: { 'result.submissions': entry }, $set: { resultVersion: m.resultVersion + 1, ...(mismatch ? { 'result.review': { reason: 'integration_mismatch', at: iso() } } : {}) }, $inc: { version: 1 } });
    }
    await this.c.resultVersions.insertOne({ _id: newId('rv'), targetType: 'match', targetId: m._id, version: m.resultVersion + 1, calcVersion: 'integration', data: { final: false, outcome, units }, provenance: { source: 'integration', actorPrincipalId: null, reason: sourceRef, evidenceFileIds: [] }, createdAt: iso() });
    if (mismatch) await this.ct.outbox.append({ type: 'competition.result.review_needed', aggregate: { type: 'match', id: m._id }, aggregateVersion: m.version + 1, actor: { principalId: 'system', kind: 'system' }, payload: { matchId: m._id, eventId: m.eventId, reason: 'integration_mismatch', principals: m.resources?.refereeIds ?? [] }, correlationId: requestId });
    return this.load(m._id);
  }

  /** RES-003 job: finalise provisional results whose window passed, only when the rules say so and nothing blocks it. */
  async autoConfirm(now = new Date()): Promise<number> {
    const due = await this.c.matches.find({ state: 'provisional', 'result.policy': 'on_deadline', 'result.deadline': { $ne: null, $lt: now.toISOString() }, 'result.review': null }).limit(200).toArray();
    let n = 0;
    for (const m of due) {
      if (await this.disputes().openFor(m._id)) continue;
      const sub = [...(m.result?.submissions ?? [])].reverse().find((s) => s.source !== 'integration');
      if (!sub) continue;
      try {
        await this.finalize(m._id, sub.outcome, 'system', `auto-confirm:${m._id}`, { system: true, reason: 'confirmation window passed (rules)', units: sub.units });
        n++;
      } catch {
        // concurrent finalisation or a case opened meanwhile — the next run re-evaluates
      }
    }
    return n;
  }

  /**
   * RES-003/AC-09: official result. An open case blocks it unless the call comes from that case's decision. The state
   * transition, result version, game units, audit and outbox event commit in one transaction; a concurrent second
   * finalisation fails on the version check, so advancement/standings/ranking consume exactly one event.
   */
  async finalize(matchId: string, official: MatchOutcome | null, actor: string, requestId: string, opts: { system?: boolean; caseId?: string; reason?: string; units?: GameUnitInput[] } = {}): Promise<MatchDoc> {
    const m = await this.load(matchId);
    if (!opts.system) await this.ct.acl.require(actor, 'match.result.verify', { type: 'match', id: m._id }, requestId);
    const open = await this.disputes().openFor(m._id);
    if (open && open._id !== opts.caseId) throw new DomainError('PRECONDITION_FAILED', `case ${open._id} is open; its decision finalises the result (AC-09)`);
    let outcome = official;
    let units = opts.units ?? [];
    if (!outcome) {
      const sub = [...(m.result?.submissions ?? [])].reverse().find((s) => s.source !== 'integration');
      if (sub) {
        outcome = sub.outcome;
        if (!opts.units) units = sub.units;
      } else {
        const last = await this.c.resultVersions.find({ targetType: 'match', targetId: m._id }).sort({ version: -1 }).limit(1).next();
        outcome = (last?.data['outcome'] as MatchOutcome | undefined) ?? null;
      }
    }
    if (!outcome) throw new DomainError('PRECONDITION_FAILED', 'no submitted result to finalise');
    const final = outcome;
    await this.validate(m, final);
    await this.validateUnits(m, units);
    const roles = opts.system ? (['system'] as const) : await this.rolesOn(actor, m);
    const reason = opts.reason ?? (opts.caseId ? `case ${opts.caseId} decision` : official ? 'official outcome' : 'submission confirmed');
    let doc!: MatchDoc;
    await this.ct.dbh.withTransaction(async (session) => {
      ({ doc } = await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'finalize', expectedVersion: m.version, actorRoles: roles }, { outcome: final, resultVersion: m.resultVersion + 1, 'run.endedAt': m.run?.endedAt ?? iso(), ...(m.result ? { 'result.review': null } : {}) } as Partial<MatchDoc>, session));
      await this.c.resultVersions.insertOne({ _id: newId('rv'), targetType: 'match', targetId: m._id, version: m.resultVersion + 1, calcVersion: 'official', data: { final: true, outcome: final, units, caseId: opts.caseId ?? null }, provenance: { source: opts.system ? 'system' : 'referee', actorPrincipalId: actor, reason, evidenceFileIds: [] }, createdAt: iso() }, { session });
      for (const u of units) {
        await this.c.gameUnits.updateOne({ matchId: m._id, order: u.order }, { $set: { kind: u.kind, label: u.label, state: 'final', values: u.values, provenance: { source: opts.system ? 'manual' : 'referee', actorPrincipalId: actor, evidenceFileIds: [], recordedAt: iso() }, resultVersion: m.resultVersion + 1 }, $setOnInsert: { _id: newId('gu'), matchId: m._id, order: u.order, createdAt: iso(), version: 0 } }, { upsert: true, session });
      }
      await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.result.finalize', target: { type: 'match', id: m._id }, scope: { type: 'match', id: m._id }, outcome: 'success', details: { kind: final.kind, reason }, requestId }, session);
      await this.ct.outbox.append({ type: 'competition.match.finalized', aggregate: { type: 'match', id: m._id }, aggregateVersion: doc.version, actor: { principalId: actor, kind: opts.system ? 'system' : 'user' }, payload: { matchId: m._id, stageId: m.stageId, eventId: m.eventId, resultVersion: m.resultVersion + 1 }, correlationId: requestId }, session);
    });
    await this.ct.realtime.publish({ channel: `match:${m._id}`, type: 'result.final', audience: { kind: 'public' }, payload: { matchId: m._id, state: 'final' } });
    return doc;
  }
}

/** Canonical comparison of two outcomes (key order independent). */
export function sameOutcome(a: MatchOutcome, b: MatchOutcome): boolean {
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}
