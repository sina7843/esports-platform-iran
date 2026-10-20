import { DomainError, matchMachine } from '@esp/contracts';
import type { Container } from '../container.js';
import type { MatchDoc } from '../db/collections.js';
import type { MatchOutcome } from '../db/collections-esp04.js';
import { applyTransition } from '../domain/transition.js';
import { newId } from '../ids.js';
import { parseDecimal, validatePlacements } from './engine/index.js';

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

  async submit(matchId: string, outcome: MatchOutcome, evidenceFileIds: string[], actor: string, requestId: string): Promise<MatchDoc> {
    const m = await this.load(matchId);
    const side = this.sideOf(m, actor);
    const official = await this.ct.acl.can(actor, 'match.result.verify', { type: 'match', id: m._id });
    if (side < 0 && !official) throw new DomainError('FORBIDDEN', 'only a side of this match or an official can submit a result');
    await this.validate(m, outcome);
    for (const f of evidenceFileIds) {
      const file = await this.c.files.findOne({ _id: f });
      if (!file || file.quarantined) throw new DomainError('VALIDATION_FAILED', 'evidence must be clean uploaded files');
    }
    const roles = official ? await this.rolesOn(actor, m) : (['team_captain'] as const); // a side representative acts as the side's captain
    const { doc } = await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'submit_result', expectedVersion: m.version, actorRoles: roles }, { resultVersion: m.resultVersion + 1 } as Partial<MatchDoc>);
    await this.c.resultVersions.insertOne({ _id: newId('rv'), targetType: 'match', targetId: m._id, version: m.resultVersion + 1, calcVersion: 'submission', data: { final: false, outcome, side: side >= 0 ? side : null }, provenance: { source: official ? 'referee' : 'manual', actorPrincipalId: actor, reason: null, evidenceFileIds }, createdAt: iso() });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.result.submit', target: { type: 'match', id: m._id }, scope: { type: 'match', id: m._id }, outcome: 'success', details: { kind: outcome.kind }, requestId });
    await this.ct.realtime.publish({ channel: `match:${m._id}`, type: 'result.provisional', audience: { kind: 'public' }, payload: { matchId: m._id, state: 'provisional' } });
    return doc;
  }

  /** An official finalises the latest submission (or records an official outcome). Advancement listens for this. */
  async finalize(matchId: string, official: MatchOutcome | null, actor: string, requestId: string): Promise<MatchDoc> {
    const m = await this.load(matchId);
    await this.ct.acl.require(actor, 'match.result.verify', { type: 'match', id: m._id }, requestId);
    let outcome = official;
    if (!outcome) {
      const last = await this.c.resultVersions.find({ targetType: 'match', targetId: m._id }).sort({ version: -1 }).limit(1).next();
      outcome = (last?.data['outcome'] as MatchOutcome | undefined) ?? null;
    }
    if (!outcome) throw new DomainError('PRECONDITION_FAILED', 'no submitted result to finalise');
    await this.validate(m, outcome);
    const { doc } = await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'finalize', expectedVersion: m.version, actorRoles: await this.rolesOn(actor, m) }, { outcome, resultVersion: m.resultVersion + 1, 'run.endedAt': m.run?.endedAt ?? iso() } as Partial<MatchDoc>);
    await this.c.resultVersions.insertOne({ _id: newId('rv'), targetType: 'match', targetId: m._id, version: m.resultVersion + 1, calcVersion: 'official', data: { final: true, outcome }, provenance: { source: 'referee', actorPrincipalId: actor, reason: official ? 'official outcome' : 'submission confirmed', evidenceFileIds: [] }, createdAt: iso() });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.result.finalize', target: { type: 'match', id: m._id }, scope: { type: 'match', id: m._id }, outcome: 'success', details: { kind: outcome.kind }, requestId });
    await this.ct.outbox.append({ type: 'competition.match.finalized', aggregate: { type: 'match', id: m._id }, aggregateVersion: doc.version, actor: { principalId: actor, kind: 'user' }, payload: { matchId: m._id, stageId: m.stageId, eventId: m.eventId }, correlationId: requestId });
    await this.ct.realtime.publish({ channel: `match:${m._id}`, type: 'result.final', audience: { kind: 'public' }, payload: { matchId: m._id, state: 'final' } });
    return doc;
  }
}
