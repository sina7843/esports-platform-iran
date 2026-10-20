import { DomainError, matchMachine, type Scope } from '@esp/contracts';
import type { ClientSession } from 'mongodb';
import type { Container } from '../container.js';
import type { DisciplineDoc, MatchDoc, MatchSide, StageDoc } from '../db/collections.js';
import type { MatchOutcome, StageStructureDoc } from '../db/collections-esp04.js';
import { applyTransition } from '../domain/transition.js';
import { newId } from '../ids.js';
import {
  advanceFromGroups, applyChallenge, eliminationStandings, EngineError, generatePhase, generatePlan, lobbyRound, lobbyStandings, nextLobbyOrder, recordStandings,
  resolveBracket, swissPair, tableStandings, timeTrialStandings, validateChallenge, type FormatId, type MixedPhase, type Plan, type PlayedMatch, type Slot,
  type SlotResult, type SlotState, type StandingRow,
} from './engine/index.js';
import { engineToDomain } from './draws.js';
import { matchConfig, stageRuleValues } from './stageRules.js';

const iso = () => new Date().toISOString();
const ELIM = new Set(['single_elim', 'double_elim']);
const TABLE = new Set(['round_robin', 'groups', 'swiss']);

export function toSlotResult(o: MatchOutcome): SlotResult | null {
  switch (o.kind) {
    case 'win':
      return { kind: 'win', winner: o.winnerSide, scores: o.scores ?? undefined, maps: o.maps ?? undefined, forfeit: o.forfeit };
    case 'draw':
      return { kind: 'draw', scores: o.scores ?? undefined, maps: o.maps ?? undefined };
    case 'double_forfeit':
      return { kind: 'double_forfeit' };
    case 'placements':
      return { kind: 'placements', placements: o.placements };
    default:
      return null;
  }
}

/**
 * Stage structure: generation from the published draw, advancement, standings, Swiss/lobby rounds, mixed phases,
 * ladder challenges, withdrawals and stage transfer (FMT-001..005, DRAW, STG-002, AC-05).
 * Only matches in state `final` are consumed; the finalisation cycle itself (confirmation, disputes, corrections)
 * belongs to ESP-05 and reaches here through the `competition.match.finalized` event.
 */
export class StructureService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private scope(eventId: string): Scope {
    return { type: 'event', id: eventId };
  }
  private async load(stageId: string): Promise<{ stage: StageDoc; discipline: DisciplineDoc }> {
    const stage = await this.c.stages.findOne({ _id: stageId });
    if (!stage) throw new DomainError('NOT_FOUND', 'stage not found');
    const discipline = await this.c.disciplines.findOne({ _id: stage.disciplineId });
    if (!discipline) throw new DomainError('NOT_FOUND', 'discipline not found');
    return { stage, discipline };
  }
  async structure(stageId: string): Promise<StageStructureDoc> {
    const s = await this.c.stageStructures.findOne({ _id: stageId });
    if (!s) throw new DomainError('NOT_FOUND', 'stage structure not generated yet');
    return s;
  }

  // ------------------------------------------------------------------ generation
  async generate(stageId: string, actor: string, requestId: string): Promise<StageStructureDoc> {
    const { stage, discipline } = await this.load(stageId);
    await this.ct.acl.require(actor, 'event.manage', this.scope(stage.eventId), requestId);
    if (stage.state !== 'drawn') throw new DomainError('PRECONDITION_FAILED', `stage is ${stage.state}; publish a draw first`);
    const draw = await this.c.draws.findOne({ stageId, state: 'published' });
    if (!draw) throw new DomainError('PRECONDITION_FAILED', 'no published draw');
    const { values, hash } = await stageRuleValues(this.ct, stage, discipline);
    const order = draw.outcome.order;
    const groups = draw.outcome.groups ?? undefined;
    let plan: Plan;
    try {
      if (stage.format === 'mixed') {
        const phases = (stage.phases ?? []) as MixedPhase[];
        if (phases.length < 2) throw new DomainError('PRECONDITION_FAILED', 'a mixed stage needs at least two phases');
        plan = generatePhase(phases[0]!, 0, groups ? { order, groups } : { order }, values);
      } else {
        plan = generatePlan(stage.format as FormatId, groups ? { order, groups } : { order }, values);
        if (stage.format === 'record' || stage.format === 'time_trial') plan.slots = order.map((id, i) => ({ key: `AT-${i + 1}`, bracket: 'AT', round: 1, order: i + 1, sources: [{ kind: 'participant' as const, id }] }));
      }
    } catch (e) {
      if (e instanceof DomainError) throw e;
      return engineToDomain(e);
    }
    const doc: StageStructureDoc = {
      _id: stageId, eventId: stage.eventId, disciplineId: stage.disciplineId, format: stage.format, drawId: draw._id, rulesHash: hash, ruleValues: values, plan, seeds: order, groups: groups ?? null,
      progress: { round: 1, phase: 0, ladder: stage.format === 'ladder' ? order : null, byes: plan.meta['byes'] ? (plan.meta['byes'] as Record<string, string>) : {}, explanations: (plan.meta['explanations'] as Record<string, string[]>) ?? {} },
      withdrawn: [], state: 'active', standings: null, createdAt: iso(), updatedAt: iso(), version: 0,
    };
    await this.ct.dbh.withTransaction(async (session) => {
      await this.c.stageStructures.insertOne(doc, { session }).catch((err: { code?: number }) => {
        if (err.code === 11000) throw new DomainError('CONFLICT', 'structure already generated');
        throw err;
      });
      await this.createMatches(doc, stage, discipline, plan.slots, session);
      await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.structure.generate', target: { type: 'stage', id: stageId }, scope: this.scope(stage.eventId), outcome: 'success', details: { format: stage.format, slots: plan.slots.length, algorithm: plan.algorithm, engine: plan.engine }, requestId }, session);
    });
    await this.sync(stageId, requestId);
    return this.structure(stageId);
  }

  /** One match per slot that can still be played; bye slots known at generation get no match. Idempotent on (stage, slot). */
  private async createMatches(st: StageStructureDoc, stage: StageDoc, discipline: DisciplineDoc, slots: Slot[], session?: ClientSession) {
    const states = ELIM.has(this.phaseFormat(st, stage)) ? resolveBracket(this.phasePlan(st, stage), this.phaseSeeds(st), {}) : null;
    const kind: MatchDoc['kind'] = ['multi_lobby'].includes(this.phaseFormat(st, stage)) ? 'lobby' : ['record', 'time_trial'].includes(this.phaseFormat(st, stage)) ? 'attempts' : 'head_to_head';
    const now = iso();
    const docs: MatchDoc[] = [];
    for (const s of slots) {
      if (states?.[s.key]?.status === 'auto_advance') continue;
      const m: MatchDoc = {
        _id: newId('mch'), eventId: stage.eventId, disciplineId: stage.disciplineId, stageId: stage._id, kind, sides: [], state: 'awaiting_sides', scheduledAt: null, estimated: true, lobby: null,
        rulesSnapshot: discipline.rulesSnapshot, resultVersion: 0, createdAt: now, updatedAt: now, version: 0,
        slot: { key: s.key, bracket: s.bracket, round: s.round, order: s.order, group: s.group ?? null, leg: s.leg ?? null, conditional: s.conditional ?? null, sources: s.sources },
        participantIds: [], principalIds: [], outcome: null, config: null,
        schedule: { durationMinutes: 0, bufferMinutes: 0, confirmed: false, broadcast: false, history: [] },
        resources: { stationId: null, serverId: null, refereeIds: [] }, room: { ready: [], countdownTo: null, publicNotice: null }, run: { startedAt: null, endedAt: null, pauses: [], disconnect: null }, cancelReason: null,
      };
      m.config = matchConfig(st.ruleValues, stage, discipline, m, st.rulesHash);
      docs.push(m);
    }
    if (!docs.length) return;
    try {
      await this.c.matches.insertMany(docs, session ? { session, ordered: false } : { ordered: false });
    } catch (err) {
      // concurrent generation of the same round: the unique (stage, slot) index keeps one match per slot
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }

  // ------------------------------------------------------------------ phase helpers (mixed stages)
  private phaseFormat(st: StageStructureDoc, stage: StageDoc): string {
    return st.format === 'mixed' ? (stage.phases?.[st.progress.phase]?.format ?? 'mixed') : st.format;
  }
  private phasePrefix(st: StageStructureDoc): string {
    return st.format === 'mixed' ? `P${st.progress.phase + 1}:` : '';
  }
  private phasePlan(st: StageStructureDoc, stage: StageDoc): Plan {
    if (st.format !== 'mixed') return st.plan;
    const p = this.phasePrefix(st);
    return { ...st.plan, format: this.phaseFormat(st, stage) as FormatId, slots: st.plan.slots.filter((s) => s.key.startsWith(p)), meta: (st.plan.meta['phases'] as Record<string, Record<string, unknown>> | undefined)?.[p] ?? st.plan.meta };
  }
  private phaseSeeds(st: StageStructureDoc): string[] {
    return st.format === 'mixed' ? ((st.plan.meta['phaseSeeds'] as Record<string, string[]> | undefined)?.[this.phasePrefix(st)] ?? st.seeds) : st.seeds;
  }

  // ------------------------------------------------------------------ advancement
  /**
   * Recomputes the slot states from final results, assigns sides to newly determined matches (with the origin of each
   * side), cancels slots that turned into byes or an unneeded reset, auto-forfeits withdrawn participants, refreshes
   * standings and completes the stage. Safe to run any number of times (idempotent).
   */
  async sync(stageId: string, requestId: string): Promise<void> {
    const st = await this.c.stageStructures.findOne({ _id: stageId });
    if (!st) return;
    const { stage, discipline } = await this.load(stageId);
    const matches = await this.c.matches.find({ stageId }).toArray();
    const bySlot = new Map(matches.filter((m) => m.slot).map((m) => [m.slot!.key, m]));
    const results: Record<string, SlotResult> = {};
    for (const m of matches) if (m.state === 'final' && m.outcome && m.slot) { const r = toSlotResult(m.outcome); if (r) results[m.slot.key] = r; }
    const format = this.phaseFormat(st, stage);
    const plan = this.phasePlan(st, stage);
    let states: Record<string, SlotState> | null = null;
    if (ELIM.has(format)) {
      try {
        states = resolveBracket(plan, this.phaseSeeds(st), results);
      } catch (e) {
        await this.review(st.eventId, 'rule_missing', stageId, { message: (e as Error).message });
        return;
      }
    }
    const parts = new Map((await this.c.participations.find({ disciplineId: stage.disciplineId }).toArray()).map((p) => [p._id, p]));
    const withdrawn = new Set(st.withdrawn.map((w) => w.participationId));
    for (const slot of plan.slots) {
      const m = bySlot.get(slot.key);
      if (!m) continue;
      const known: string[] | null = states
        ? states[slot.key]!.status === 'ready' ? (states[slot.key]!.participants as string[]) : null
        : slot.sources.every((s) => s.kind === 'participant') ? slot.sources.map((s) => (s as { id: string }).id) : null;
      if (states && m.state === 'awaiting_sides' && (states[slot.key]!.status === 'auto_advance' || states[slot.key]!.status === 'not_needed')) {
        const reason = states[slot.key]!.status === 'not_needed' ? 'grand-final reset not needed' : 'bye: the opponent position is empty';
        await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'cancel', expectedVersion: m.version, actorRoles: ['system'] }, { cancelReason: reason }).catch(() => undefined);
        continue;
      }
      if (known && m.state === 'awaiting_sides') {
        const sides: MatchSide[] = known.map((pid, i) => {
          const p = parts.get(pid);
          const src = slot.sources[i] ?? slot.sources[0]!;
          const origin: MatchSide['origin'] = src.kind === 'winner' || src.kind === 'loser' ? { kind: 'advance', ref: `${src.kind}:${src.slot}` } : src.kind === 'seed' ? { kind: 'seed', ref: String(src.seed) } : { kind: 'seed', ref: `draw:${st.drawId}` };
          return { participationId: pid, displayName: p?.snapshot.displayName ?? pid, origin, roster: (p?.snapshot.roster ?? []).map((r) => ({ ...r, present: false })) };
        });
        const principalIds = [...new Set(sides.flatMap((s) => s.roster.map((r) => r.principalId)))];
        await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'assign_sides', expectedVersion: m.version, actorRoles: ['system'] }, { sides, participantIds: known, principalIds, config: matchConfig(st.ruleValues, stage, discipline, m, st.rulesHash) } as Partial<MatchDoc>).catch(() => undefined);
        const fresh = await this.c.matches.findOne({ _id: m._id });
        const out = known.find((k) => withdrawn.has(k));
        if (fresh && out && fresh.state === 'scheduled' && known.length === 2) await this.recordForfeit(fresh, known.indexOf(out) === 0 ? 1 : 0, `participant withdrew (official decision recorded in stage withdrawals)`, 'system', requestId);
      }
    }
    // stage activity and completion
    const after = await this.c.matches.find({ stageId }).toArray();
    if (stage.state === 'drawn' && after.some((m) => !['awaiting_sides', 'scheduled', 'cancelled'].includes(m.state))) await this.c.stages.updateOne({ _id: stageId, state: 'drawn' }, { $set: { state: 'active' }, $inc: { version: 1 } });
    const standings = await this.computeStandings(st, stage, after);
    const phaseDone = after.filter((m) => m.slot?.key.startsWith(this.phasePrefix(st))).every((m) => m.state === 'final' || m.state === 'cancelled');
    const roundsLeft = (format === 'swiss' && st.progress.round < (st.ruleValues['swiss.rounds'] as number)) || (format === 'multi_lobby' && st.progress.round < (st.ruleValues['lobby.rounds'] as number));
    const lastPhase = st.format !== 'mixed' || st.progress.phase >= (stage.phases?.length ?? 1) - 1;
    const complete = phaseDone && !roundsLeft && lastPhase && format !== 'ladder' && !standings.needsReview;
    await this.c.stageStructures.updateOne({ _id: stageId }, { $set: { standings: { computedAt: iso(), rows: standings.rows, needsReview: standings.needsReview }, state: complete ? 'complete' : 'active', updatedAt: iso() }, $inc: { version: 1 } });
    if (complete && st.state !== 'complete') {
      const last = await this.c.resultVersions.find({ targetType: 'standing', targetId: stageId }).sort({ version: -1 }).limit(1).next();
      await this.c.resultVersions.insertOne({ _id: newId('rv'), targetType: 'standing', targetId: stageId, version: (last?.version ?? 0) + 1, calcVersion: st.plan.engine, data: { final: true, rows: standings.rows, algorithm: st.plan.algorithm, rulesHash: st.rulesHash }, provenance: { source: 'engine', actorPrincipalId: null, reason: 'all matches final', evidenceFileIds: [] }, createdAt: iso() }).catch(() => undefined);
      await this.c.stages.updateOne({ _id: stageId, state: { $in: ['drawn', 'active'] } }, { $set: { state: 'finished' }, $inc: { version: 1 } });
      await this.ct.outbox.append({ type: 'competition.stage.finished', aggregate: { type: 'stage', id: stageId }, aggregateVersion: st.version + 1, actor: { principalId: 'system', kind: 'system' }, payload: { stageId, eventId: st.eventId }, correlationId: requestId });
    }
  }

  private async review(eventId: string, kind: 'rule_missing' | 'tie_unresolved', stageId: string, detail: Record<string, unknown>) {
    const exists = await this.c.reviewItems.findOne({ eventId, kind, 'ref.id': stageId, state: 'open' });
    if (!exists) await this.c.reviewItems.insertOne({ _id: newId('rvw'), eventId, kind, ref: { type: 'stage', id: stageId }, detail, state: 'open', resolution: null, resolvedBy: null, createdAt: iso(), resolvedAt: null });
  }

  /** An official forfeit / walkover / double no-show recorded as a final outcome (RUN-004, FMT-004). */
  async recordForfeit(m: MatchDoc, winnerSide: 0 | 1 | null, reason: string, actor: string, requestId: string): Promise<MatchDoc> {
    const outcome: MatchOutcome = winnerSide === null ? { kind: 'double_forfeit', reason } : { kind: 'win', winnerSide, scores: null, maps: null, forfeit: true, reason };
    const roles = actor === 'system' ? (['system'] as const) : await this.officialRoles(actor, m);
    const { doc } = await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'forfeit', expectedVersion: m.version, actorRoles: roles }, { outcome, resultVersion: m.resultVersion + 1 } as Partial<MatchDoc>);
    await this.c.resultVersions.insertOne({ _id: newId('rv'), targetType: 'match', targetId: m._id, version: m.resultVersion + 1, calcVersion: 'forfeit', data: { final: true, outcome }, provenance: { source: actor === 'system' ? 'system' : 'referee', actorPrincipalId: actor === 'system' ? null : actor, reason, evidenceFileIds: [] }, createdAt: iso() });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.match.forfeit', target: { type: 'match', id: m._id }, scope: { type: 'match', id: m._id }, outcome: 'success', details: { winnerSide, reason }, requestId });
    await this.ct.outbox.append({ type: 'competition.match.finalized', aggregate: { type: 'match', id: m._id }, aggregateVersion: doc.version, actor: { principalId: actor, kind: actor === 'system' ? 'system' : 'user' }, payload: { matchId: m._id, stageId: m.stageId, eventId: m.eventId }, correlationId: requestId });
    return doc;
  }

  private async officialRoles(actor: string, m: MatchDoc) {
    const grants = await this.ct.acl.activeGrants(actor);
    const ctx = await this.ct.acl.resourceContext({ type: 'match', id: m._id });
    const chain = [ctx.scope, ...ctx.ancestors];
    return grants.filter((g) => chain.some((s) => s.type === g.scope.type && s.id === g.scope.id)).map((g) => g.role);
  }

  // ------------------------------------------------------------------ standings
  private async computeStandings(st: StageStructureDoc, stage: StageDoc, matches: MatchDoc[]): Promise<{ rows: StandingRow[]; needsReview: string | null }> {
    const format = this.phaseFormat(st, stage);
    const prefix = this.phasePrefix(st);
    const finals = matches.filter((m) => m.state === 'final' && m.outcome && m.slot?.key.startsWith(prefix));
    const withdrawn = st.withdrawn.map((w) => w.participationId);
    const seeds = this.phaseSeeds(st);
    const seedOf = Object.fromEntries(seeds.map((id, i) => [id, i + 1]));
    try {
      if (ELIM.has(format)) {
        const results: Record<string, SlotResult> = {};
        for (const m of finals) results[m.slot!.key] = toSlotResult(m.outcome!)!;
        return { rows: eliminationStandings(this.phasePlan(st, stage), resolveBracket(this.phasePlan(st, stage), seeds, results)), needsReview: null };
      }
      if (TABLE.has(format)) {
        const played = (list: MatchDoc[]): PlayedMatch[] => list.filter((m) => m.participantIds?.length === 2).map((m) => ({ a: m.participantIds![0]!, b: m.participantIds![1]!, result: toSlotResult(m.outcome!)! }));
        if (format === 'groups') {
          const rows: StandingRow[] = [];
          const groups = (st.format === 'mixed' ? (st.plan.meta['phaseGroups'] as Record<string, Record<string, string[]>> | undefined)?.[prefix] : undefined) ?? st.groups ?? {};
          for (const [g, ids] of Object.entries(groups)) rows.push(...tableStandings(ids, played(finals.filter((m) => m.slot!.group === g)), st.ruleValues, { withdrawn, seedOf }).map((r) => ({ ...r, group: g })));
          return { rows, needsReview: null };
        }
        const byes: PlayedMatch[] = format === 'swiss' ? Object.values(st.progress.byes).map((id) => ({ a: id, b: 'BYE' as const, result: { kind: 'win', winner: 0 } as SlotResult })) : [];
        return { rows: tableStandings(seeds, [...played(finals), ...byes], st.ruleValues, { withdrawn, seedOf }), needsReview: null };
      }
      if (format === 'multi_lobby') {
        const res = finals.filter((m) => m.outcome!.kind === 'placements').map((m) => ({ round: m.slot!.round, lobby: m.slot!.key, members: m.participantIds ?? [], placements: (m.outcome as Extract<MatchOutcome, { kind: 'placements' }>).placements }));
        return { rows: lobbyStandings(seeds, res, st.ruleValues, seedOf), needsReview: null };
      }
      if (format === 'record' || format === 'time_trial') {
        const atts = finals.flatMap((m) => (m.outcome!.kind === 'attempts' ? m.outcome!.attempts.map((a) => ({ ...a, id: m.participantIds![0]! })) : []));
        if (format === 'record') return { rows: recordStandings(seeds, atts.map((a) => ({ id: a.id, attempt: a.attempt, value: a.value ?? '0', at: a.at })), st.ruleValues), needsReview: null };
        return { rows: timeTrialStandings(seeds, atts.map((a) => ({ id: a.id, attempt: a.attempt, timeMs: a.timeMs, penaltyMs: a.penaltyMs, dnf: a.dnf })), st.ruleValues), needsReview: null };
      }
      if (format === 'ladder') return { rows: (st.progress.ladder ?? []).map((id, i) => ({ id, rank: i + 1, metrics: { position: i + 1 }, unresolvedTie: false })), needsReview: null };
      return { rows: [], needsReview: null };
    } catch (e) {
      if (e instanceof EngineError) {
        await this.review(st.eventId, e.code === 'NEEDS_REVIEW' ? 'rule_missing' : 'tie_unresolved', st._id, { message: e.message });
        return { rows: st.standings?.rows ?? [], needsReview: e.message };
      }
      throw e;
    }
  }

  /** Public, paginated standings computed server-side (DRAW-004: large competitions never ship everything). */
  async standings(stageId: string, opts: { group?: string | undefined; offset: number; limit: number }) {
    const st = await this.structure(stageId);
    const rows = (st.standings?.rows ?? []).filter((r) => (opts.group ? r.group === opts.group : true));
    const ids = rows.slice(opts.offset, opts.offset + opts.limit).map((r) => r.id);
    const names = new Map((await this.c.participations.find({ _id: { $in: ids } }, { projection: { 'snapshot.displayName': 1 } }).toArray()).map((p) => [p._id, p.snapshot.displayName]));
    return {
      format: st.format, algorithm: st.plan.algorithm, engine: st.plan.engine, rulesHash: st.rulesHash, needsReview: st.standings?.needsReview ?? null, total: rows.length, offset: opts.offset, limit: opts.limit,
      rows: rows.slice(opts.offset, opts.offset + opts.limit).map((r) => ({ ...r, displayName: names.get(r.id) ?? r.id })),
      provisional: st.state !== 'complete',
    };
  }

  /** Bracket/round view for the UI: slots with resolved participants and their match, filtered by round/bracket and paginated. */
  async view(stageId: string, opts: { bracket?: string | undefined; round?: number | undefined; offset: number; limit: number }) {
    const st = await this.structure(stageId);
    const { stage } = await this.load(stageId);
    const matches = await this.c.matches.find({ stageId }, { projection: { lobby: 0 } }).toArray();
    const bySlot = new Map(matches.filter((m) => m.slot).map((m) => [m.slot!.key, m]));
    const results: Record<string, SlotResult> = {};
    for (const m of matches) if (m.state === 'final' && m.outcome && m.slot) results[m.slot.key] = toSlotResult(m.outcome)!;
    const format = this.phaseFormat(st, stage);
    const states = ELIM.has(format) ? resolveBracket(this.phasePlan(st, stage), this.phaseSeeds(st), results) : null;
    const all = st.plan.slots.filter((s) => (opts.bracket ? s.bracket === opts.bracket : true) && (opts.round !== undefined ? s.round === opts.round : true));
    const page = all.slice(opts.offset, opts.offset + opts.limit);
    const ids = [...new Set(page.flatMap((s) => (states?.[s.key]?.participants ?? bySlot.get(s.key)?.participantIds ?? s.sources.map((x) => (x.kind === 'participant' ? x.id : null))).filter((x): x is string => !!x && x !== 'BYE')))];
    const names = new Map((await this.c.participations.find({ _id: { $in: ids } }, { projection: { 'snapshot.displayName': 1 } }).toArray()).map((p) => [p._id, p.snapshot.displayName]));
    const label = (x: string | null) => (x === 'BYE' ? 'BYE' : x ? (names.get(x) ?? x) : null);
    return {
      format: st.format, phaseFormat: format, total: all.length, offset: opts.offset, limit: opts.limit,
      brackets: [...new Set(st.plan.slots.map((s) => s.bracket))], rounds: [...new Set(st.plan.slots.map((s) => s.round))].sort((a, b) => a - b),
      slots: page.map((s) => {
        const m = bySlot.get(s.key);
        const ps = states?.[s.key]?.participants ?? m?.participantIds ?? s.sources.map((x) => (x.kind === 'participant' ? x.id : null));
        return {
          key: s.key, bracket: s.bracket, round: s.round, order: s.order, group: s.group ?? null, conditional: s.conditional ?? null,
          sources: s.sources, participants: ps.map((p) => ({ id: p === 'BYE' ? null : p, name: label(p) })), status: states?.[s.key]?.status ?? (m ? m.state : 'waiting'),
          winner: states?.[s.key]?.winner ? label(states[s.key]!.winner) : null,
          match: m ? { id: m._id, state: m.state, scheduledAt: m.scheduledAt, estimated: m.estimated, outcome: m.state === 'final' ? m.outcome : null } : null,
        };
      }),
    };
  }

  // ------------------------------------------------------------------ rounds, phases, ladder
  /** Swiss / multi-lobby: next round from the final results of the current round (explanations stored with it). */
  async nextRound(stageId: string, actor: string, requestId: string): Promise<{ round: number; explanations: string[] }> {
    const st = await this.structure(stageId);
    const { stage, discipline } = await this.load(stageId);
    await this.ct.acl.require(actor, 'match.manage', this.scope(st.eventId), requestId);
    const format = this.phaseFormat(st, stage);
    if (format !== 'swiss' && format !== 'multi_lobby') throw new DomainError('PRECONDITION_FAILED', `${format} has no generated rounds`);
    const total = (format === 'swiss' ? st.ruleValues['swiss.rounds'] : st.ruleValues['lobby.rounds']) as number;
    if (st.progress.round >= total) throw new DomainError('PRECONDITION_FAILED', `all ${total} rounds already generated`);
    const current = await this.c.matches.find({ stageId, 'slot.round': st.progress.round }).toArray();
    if (current.some((m) => m.state !== 'final' && m.state !== 'cancelled')) throw new DomainError('PRECONDITION_FAILED', 'the current round is not final yet');
    const round = st.progress.round + 1;
    const withdrawn = new Set(st.withdrawn.map((w) => w.participationId));
    const active = st.seeds.filter((id) => !withdrawn.has(id));
    let slots: Slot[];
    let explanations: string[] = [];
    let bye: string | null = null;
    try {
      if (format === 'swiss') {
        const rows = st.standings?.rows ?? [];
        const points = Object.fromEntries(rows.map((r) => [r.id, r.metrics['points'] ?? 0]));
        const all = await this.c.matches.find({ stageId, state: 'final' }).toArray();
        const r = swissPair({ ids: active, points, played: all.filter((m) => m.participantIds?.length === 2).map((m) => [m.participantIds![0]!, m.participantIds![1]!] as [string, string]), byes: Object.values(st.progress.byes), method: st.ruleValues['swiss.pairing'] as 'dutch' | 'monrad' });
        slots = r.pairs.map(([a, b], i) => ({ key: `SW${round}-${i + 1}`, bracket: 'SW', round, order: i + 1, sources: [{ kind: 'participant', id: a }, { kind: 'participant', id: b }] }));
        explanations = r.explanations;
        bye = r.bye;
      } else {
        const order = nextLobbyOrder(active, st.standings?.rows ?? [], st.ruleValues['lobby.assignment'] as 'snake_by_seed' | 'reseed_by_standings');
        slots = lobbyRound(order, round, st.ruleValues['lobby.size'] as number);
      }
    } catch (e) {
      return engineToDomain(e);
    }
    await this.ct.dbh.withTransaction(async (session) => {
      const upd = await this.c.stageStructures.updateOne(
        { _id: stageId, 'progress.round': st.progress.round },
        { $set: { 'progress.round': round, ...(bye ? { [`progress.byes.${round}`]: bye } : {}), [`progress.explanations.${round}`]: explanations, updatedAt: iso() }, $push: { 'plan.slots': { $each: slots } }, $inc: { version: 1 } },
        { session },
      );
      if (!upd.modifiedCount) throw new DomainError('CONFLICT', 'the next round was generated concurrently');
      await this.createMatches({ ...st, progress: { ...st.progress, round } }, stage, discipline, slots, session);
      await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.round.generate', target: { type: 'stage', id: stageId }, scope: this.scope(st.eventId), outcome: 'success', details: { round, bye, explanations }, requestId }, session);
    });
    await this.sync(stageId, requestId);
    return { round, explanations };
  }

  /** Mixed stage: seeds the next phase from the current phase standings (ties across the line are not decided here). */
  async nextPhase(stageId: string, actor: string, requestId: string): Promise<{ phase: number; entrants: string[] }> {
    const st = await this.structure(stageId);
    const { stage, discipline } = await this.load(stageId);
    await this.ct.acl.require(actor, 'match.manage', this.scope(st.eventId), requestId);
    if (st.format !== 'mixed') throw new DomainError('PRECONDITION_FAILED', 'only a mixed stage has phases');
    const phases = (stage.phases ?? []) as MixedPhase[];
    const cur = phases[st.progress.phase]!;
    const next = phases[st.progress.phase + 1];
    if (!next) throw new DomainError('PRECONDITION_FAILED', 'this is the last phase');
    const pending = await this.c.matches.countDocuments({ stageId, 'slot.key': { $regex: `^P${st.progress.phase + 1}:` }, state: { $nin: ['final', 'cancelled'] } });
    if (pending) throw new DomainError('PRECONDITION_FAILED', `${pending} match(es) of the current phase are not final`);
    if (st.standings?.needsReview) throw new DomainError('PRECONDITION_FAILED', `standings need an official decision: ${st.standings.needsReview}`);
    const rows = st.standings?.rows ?? [];
    let entrants: string[];
    try {
      if (cur.format === 'groups') {
        const tables: Record<string, StandingRow[]> = {};
        for (const r of rows) (tables[r.group ?? '-'] ??= []).push(r);
        entrants = advanceFromGroups(tables, cur.advance?.perGroup ?? 1, cur.advance?.bestRemaining ?? 0);
      } else {
        const top = cur.advance?.top ?? 0;
        const cut = rows[top - 1];
        const after = rows[top];
        if (cut && after && cut.rank === after.rank) throw new EngineError('NEEDS_REVIEW', `complete tie across the qualification line at rank ${cut.rank}`);
        entrants = rows.slice(0, top).map((r) => r.id);
      }
      const phase = st.progress.phase + 1;
      const plan = generatePhase(next, phase, { order: entrants }, st.ruleValues);
      const prefix = `P${phase + 1}:`;
      await this.ct.dbh.withTransaction(async (session) => {
        const upd = await this.c.stageStructures.updateOne(
          { _id: stageId, 'progress.phase': st.progress.phase },
          { $set: { 'progress.phase': phase, 'progress.round': 1, [`plan.meta.phaseSeeds.${prefix}`]: entrants, [`plan.meta.phases.${prefix}`]: plan.meta, state: 'active', updatedAt: iso() }, $push: { 'plan.slots': { $each: plan.slots } }, $inc: { version: 1 } },
          { session },
        );
        if (!upd.modifiedCount) throw new DomainError('CONFLICT', 'the next phase was generated concurrently');
        const fresh = (await this.c.stageStructures.findOne({ _id: stageId }, { session }))!;
        await this.createMatches(fresh, stage, discipline, plan.slots, session);
        await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.phase.generate', target: { type: 'stage', id: stageId }, scope: this.scope(st.eventId), outcome: 'success', details: { phase: phase + 1, entrants }, requestId }, session);
      });
      await this.sync(stageId, requestId);
      return { phase: phase + 1, entrants };
    } catch (e) {
      if (e instanceof DomainError) throw e;
      return engineToDomain(e);
    }
  }

  /** Ladder: a challenge creates a match; the ladder moves only when that match is final. */
  async challenge(stageId: string, challenger: string, defender: string, actor: string, requestId: string): Promise<MatchDoc> {
    const st = await this.structure(stageId);
    const { stage, discipline } = await this.load(stageId);
    if (st.format !== 'ladder') throw new DomainError('PRECONDITION_FAILED', 'not a ladder stage');
    const p = await this.c.participations.findOne({ _id: challenger });
    const mine = p && (p.snapshot.roster.some((r) => r.principalId === actor) || (await this.ct.acl.can(actor, 'match.manage', this.scope(st.eventId))));
    if (!mine) throw new DomainError('FORBIDDEN', 'only the challenger or an official can open a challenge');
    const open = (await this.c.matches.find({ stageId, state: { $nin: ['final', 'cancelled'] } }).toArray()).map((m) => [m.participantIds![0]!, m.participantIds![1]!] as [string, string]);
    try {
      validateChallenge(st.progress.ladder ?? [], challenger, defender, st.ruleValues['ladder.challenge_range'] as number, open);
    } catch (e) {
      return engineToDomain(e);
    }
    const n = (await this.c.matches.countDocuments({ stageId })) + 1;
    const slot: Slot = { key: `LD-${n}`, bracket: 'LD', round: n, order: 1, sources: [{ kind: 'participant', id: challenger }, { kind: 'participant', id: defender }] };
    await this.c.stageStructures.updateOne({ _id: stageId }, { $push: { 'plan.slots': slot }, $inc: { version: 1 } });
    await this.createMatches(st, stage, discipline, [slot]);
    await this.sync(stageId, requestId);
    return (await this.c.matches.findOne({ stageId, 'slot.key': slot.key }))!;
  }

  /** Called on a final ladder match: applies the rules' on-win policy once (guarded by the structure version). */
  async applyLadderResult(m: MatchDoc): Promise<void> {
    const st = await this.c.stageStructures.findOne({ _id: m.stageId });
    if (!st || st.format !== 'ladder' || !m.outcome || m.outcome.kind !== 'win' || !m.slot) return;
    const applied = (st.plan.meta['ladderApplied'] as string[] | undefined) ?? [];
    if (applied.includes(m._id)) return;
    const [challenger, defender] = m.participantIds as [string, string];
    const ladder = applyChallenge(st.progress.ladder ?? [], challenger, defender, m.outcome.winnerSide === 0, st.ruleValues['ladder.on_win'] as 'swap' | 'insert');
    await this.c.stageStructures.updateOne({ _id: st._id, version: st.version }, { $set: { 'progress.ladder': ladder }, $push: { 'plan.meta.ladderApplied': m._id } as never, $inc: { version: 1 } });
  }

  /** FMT-004: an official records a withdrawal; remaining matches become forfeits under the rules, previous results per rule. */
  async withdraw(stageId: string, participationId: string, reason: string, actor: string, requestId: string): Promise<void> {
    if (reason.trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'a reason is required');
    const st = await this.structure(stageId);
    await this.ct.acl.require(actor, 'match.manage', this.scope(st.eventId), requestId);
    if (!st.seeds.includes(participationId)) throw new DomainError('NOT_FOUND', 'participant is not in this stage');
    if (TABLE.has(st.format) && !st.ruleValues['withdrawal.previous_results']) throw new DomainError('PRECONDITION_FAILED', 'the rules do not say what happens to previous results; an official decision is required (15.5)');
    const r = await this.c.stageStructures.updateOne({ _id: stageId, 'withdrawn.participationId': { $ne: participationId } }, { $push: { withdrawn: { participationId, at: iso(), by: actor, reason } }, $inc: { version: 1 } });
    if (!r.modifiedCount) throw new DomainError('CONFLICT', 'already withdrawn');
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.participant.withdraw', target: { type: 'stage', id: stageId }, scope: this.scope(st.eventId), outcome: 'success', details: { participationId, reason }, requestId });
    // open matches with known sides: forfeit to the opponent now
    for (const m of await this.c.matches.find({ stageId, participantIds: participationId, state: { $in: ['scheduled', 'awaiting_readiness', 'ready', 'pre_game_selection'] } }).toArray()) {
      if (m.participantIds?.length === 2) await this.recordForfeit(m, m.participantIds[0] === participationId ? 1 : 0, `withdrawal: ${reason}`, actor, requestId);
    }
    await this.sync(stageId, requestId);
  }

  /**
   * STG-002: transfer the top places of a finished stage into a linked stage. Idempotent (unique stage/participation),
   * never duplicates a participant, and every entry records its origin rank.
   */
  async transfer(fromStageId: string, toStageId: string, actor: string, requestId: string): Promise<{ created: number; existing: number }> {
    const target = await this.c.stages.findOne({ _id: toStageId });
    if (!target) throw new DomainError('NOT_FOUND', 'target stage not found');
    await this.ct.acl.require(actor, 'event.manage', this.scope(target.eventId), requestId);
    const link = target.links.find((l) => l.fromStageId === fromStageId);
    if (!link) throw new DomainError('PRECONDITION_FAILED', 'the target stage has no link from this stage');
    const st = await this.structure(fromStageId);
    const finalRv = await this.c.resultVersions.find({ targetType: 'standing', targetId: fromStageId, 'data.final': true }).sort({ version: -1 }).limit(1).next();
    if (st.state !== 'complete' || !finalRv) throw new DomainError('PRECONDITION_FAILED', 'the source stage has no final standings yet');
    const rows = (finalRv.data['rows'] as StandingRow[]) ?? [];
    const cut = rows[link.slots - 1];
    const after = rows[link.slots];
    if (cut && after && cut.rank === after.rank) throw new DomainError('PRECONDITION_FAILED', `complete tie across the transfer line at rank ${cut.rank}; an official must decide`);
    let created = 0;
    let existing = 0;
    for (const r of rows.slice(0, link.slots)) {
      try {
        await this.c.stageEntries.insertOne({ _id: newId('sen'), stageId: toStageId, participationId: r.id, origin: { kind: 'stage_rank', ref: fromStageId, rank: r.rank }, createdBy: actor, createdAt: iso() });
        created++;
      } catch (e) {
        if ((e as { code?: number }).code === 11000) existing++;
        else throw e;
      }
    }
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.stage.transfer', target: { type: 'stage', id: toStageId }, scope: this.scope(target.eventId), outcome: 'success', details: { fromStageId, created, existing, slots: link.slots }, requestId });
    return { created, existing };
  }
}
