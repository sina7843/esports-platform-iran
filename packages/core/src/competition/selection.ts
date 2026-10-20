import { DomainError, matchMachine } from '@esp/contracts';
import type { Container } from '../container.js';
import type { MatchDoc } from '../db/collections.js';
import type { SelectionDoc } from '../db/collections-esp04.js';
import { applyTransition } from '../domain/transition.js';

const iso = () => new Date().toISOString();

/**
 * CFG-003/004: turn-based pre-game selection (map ban/pick/decider, side choice, character ban/pick) with a server-side
 * timer. Tokens: `ban:<side>`, `pick:<side>`, `side:<side>`, `cban:<side>`, `cpick:<side>`, `decider`.
 * Every action names the step it answers; a conditional update on that step makes two concurrent submissions produce
 * exactly one effect. A timeout applies only the rule's action (first/last remaining in the published pool order) or
 * hands the turn to the referee — never a random pick, never an arbitrary forfeit.
 */
export class SelectionService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private async match(matchId: string): Promise<MatchDoc> {
    const m = await this.c.matches.findOne({ _id: matchId });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    return m;
  }
  private static parse(token: string): { kind: string; side: number | null } {
    const [kind, side] = token.split(':');
    return { kind: kind!, side: side === undefined ? null : Number(side) };
  }
  private options(m: MatchDoc, sel: SelectionDoc, kind: string): string[] {
    if (kind === 'ban' || kind === 'pick' || kind === 'decider') {
      const used = new Set(sel.actions.filter((a) => ['ban', 'pick', 'decider'].includes(a.kind)).map((a) => a.value));
      return sel.pool.filter((x) => !used.has(x));
    }
    if (kind === 'cban' || kind === 'cpick') {
      const used = new Set(sel.actions.filter((a) => a.kind === 'cban' || a.kind === 'cpick').map((a) => a.value));
      const pool = ((m.rulesSnapshot?.clauses.find((c) => c.key === 'characters.pool')?.value as string[] | undefined) ?? []).map(String);
      return pool.filter((x) => !used.has(x));
    }
    if (kind === 'side') return ((m.rulesSnapshot?.clauses.find((c) => c.key === 'side.options')?.value as string[] | undefined) ?? []).map(String);
    return [];
  }

  async start(matchId: string, actor: string, requestId: string): Promise<SelectionDoc> {
    const m = await this.match(matchId);
    await this.ct.acl.require(actor, 'match.manage', { type: 'match', id: m._id }, requestId);
    const cfg = m.config;
    if (!cfg || !cfg.vetoSequence.length) throw new DomainError('PRECONDITION_FAILED', 'the rules define no pre-game selection for this match');
    const undecided = cfg.undecided.filter((k) => k.startsWith('veto.') || k === 'maps.pool');
    if (undecided.length) throw new DomainError('PRECONDITION_FAILED', `the rules lack ${undecided.join(', ')}; an official must decide before the selection`);
    const mapTokens = cfg.vetoSequence.filter((t) => ['ban', 'pick', 'decider'].includes(SelectionService.parse(t).kind)).length;
    if (mapTokens !== cfg.mapPool.length) throw new DomainError('PRECONDITION_FAILED', `veto sequence uses ${mapTokens} maps but the pool has ${cfg.mapPool.length}`);
    for (const t of cfg.vetoSequence) {
      const { kind, side } = SelectionService.parse(t);
      if (!['ban', 'pick', 'side', 'cban', 'cpick', 'decider'].includes(kind) || (kind !== 'decider' && side !== 0 && side !== 1)) throw new DomainError('PRECONDITION_FAILED', `invalid veto token ${t}`);
    }
    await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'start_selection', expectedVersion: m.version, actorRoles: ['system'] });
    const doc: SelectionDoc = { _id: m._id, matchId: m._id, sequence: cfg.vetoSequence, pool: cfg.mapPool, step: 0, actions: [], turnDeadline: new Date(Date.now() + cfg.turnSeconds! * 1000).toISOString(), timeoutAction: cfg.timeoutAction, state: 'active', createdAt: iso(), version: 0 };
    await this.c.selections.insertOne(doc).catch((e: { code?: number }) => {
      if (e.code === 11000) throw new DomainError('CONFLICT', 'selection already started');
      throw e;
    });
    await this.autoSteps(m, doc);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'match.selection.start', target: { type: 'match', id: m._id }, scope: { type: 'match', id: m._id }, outcome: 'success', details: { sequence: cfg.vetoSequence }, requestId });
    return (await this.c.selections.findOne({ _id: m._id }))!;
  }

  /** A side (or an official intervening) answers the current step. `step` must equal the server's step. */
  async act(matchId: string, step: number, value: string, actor: string, requestId: string): Promise<SelectionDoc> {
    const m = await this.match(matchId);
    await this.processTimeout(matchId);
    const sel = await this.c.selections.findOne({ _id: matchId });
    if (!sel) throw new DomainError('NOT_FOUND', 'no selection for this match');
    if (sel.state === 'complete') throw new DomainError('PRECONDITION_FAILED', 'selection is complete');
    if (sel.step !== step) throw new DomainError('CONFLICT', `step ${step} was already answered (current step ${sel.step})`);
    const { kind, side } = SelectionService.parse(sel.sequence[step]!);
    const actorSide = m.sides.findIndex((s) => s.roster.some((r) => r.principalId === actor));
    const official = await this.ct.acl.can(actor, 'match.result.verify', { type: 'match', id: m._id });
    if (sel.state === 'waiting_referee' && !official) throw new DomainError('FORBIDDEN', 'the turn timed out; the referee decides this step (rules)');
    if (!official && actorSide !== side) throw new DomainError('FORBIDDEN', `it is side ${side}'s turn`);
    if (!this.options(m, sel, kind).includes(value)) throw new DomainError('VALIDATION_FAILED', `"${value}" is not available for ${kind}`);
    await this.apply(m, sel, value, actor, official && actorSide !== side ? 'referee' : 'player');
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'match.selection.act', target: { type: 'match', id: m._id }, scope: { type: 'match', id: m._id }, outcome: 'success', details: { step, kind, value }, requestId });
    return (await this.c.selections.findOne({ _id: matchId }))!;
  }

  private async apply(m: MatchDoc, sel: SelectionDoc, value: string, by: string, via: 'player' | 'timeout' | 'referee'): Promise<void> {
    const { kind, side } = SelectionService.parse(sel.sequence[sel.step]!);
    const next = sel.step + 1;
    const done = next >= sel.sequence.length;
    const r = await this.c.selections.findOneAndUpdate(
      { _id: sel._id, step: sel.step, state: { $in: ['active', 'waiting_referee'] } },
      { $push: { actions: { step: sel.step, kind, side, value, by, at: iso(), via } }, $set: { step: next, state: done ? 'complete' : 'active', turnDeadline: done ? null : new Date(Date.now() + (m.config?.turnSeconds ?? 0) * 1000).toISOString() }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    );
    if (!r) throw new DomainError('CONFLICT', 'this step was answered concurrently');
    await this.ct.realtime.publish({ channel: `match:${m._id}`, type: 'selection.updated', audience: { kind: 'public' }, payload: { matchId: m._id, step: r.step, last: { kind, side, value, via }, state: r.state, turnDeadline: r.turnDeadline } });
    await this.autoSteps(m, r);
  }

  /** The decider needs no player: the single remaining map is recorded. */
  private async autoSteps(m: MatchDoc, sel: SelectionDoc): Promise<void> {
    if (sel.state === 'complete') return;
    const { kind } = SelectionService.parse(sel.sequence[sel.step]!);
    if (kind !== 'decider') return;
    const left = this.options(m, sel, 'decider');
    if (left.length !== 1) throw new DomainError('PRECONDITION_FAILED', 'decider requires exactly one remaining map');
    await this.apply(m, sel, left[0]!, 'system', 'timeout');
  }

  /**
   * Applies the rule's timeout action once the server deadline passed. Idempotent: guarded by the step. Called by the
   * worker and lazily on every read, so a refresh never resets or skips a timer.
   */
  async processTimeout(matchId: string, now = new Date()): Promise<SelectionDoc | null> {
    const sel = await this.c.selections.findOne({ _id: matchId });
    if (!sel || sel.state !== 'active' || !sel.turnDeadline || Date.parse(sel.turnDeadline) > now.getTime()) return sel;
    const m = await this.match(matchId);
    const { kind } = SelectionService.parse(sel.sequence[sel.step]!);
    const opts = this.options(m, sel, kind);
    if (sel.timeoutAction === 'referee' || !sel.timeoutAction || !opts.length) {
      await this.c.selections.updateOne({ _id: sel._id, step: sel.step, state: 'active' }, { $set: { state: 'waiting_referee', turnDeadline: null }, $inc: { version: 1 } });
      await this.c.refereeCalls.insertOne({ _id: `rfc_${sel._id}_${sel.step}`, matchId, eventId: m.eventId, by: 'system', reason: `selection step ${sel.step} timed out; the rules hand it to the referee`, state: 'open', ackBy: null, createdAt: iso(), closedAt: null }).catch(() => undefined);
    } else {
      const value = sel.timeoutAction === 'pool_order_first' ? opts[0]! : opts[opts.length - 1]!;
      await this.apply(m, sel, value, 'system', 'timeout').catch((e) => {
        if (!(e instanceof DomainError && e.code === 'CONFLICT')) throw e; // someone answered at the deadline: their action stands
      });
    }
    return this.c.selections.findOne({ _id: matchId });
  }

  async view(matchId: string): Promise<(SelectionDoc & { serverTime: string; options: string[] }) | null> {
    const sel = await this.processTimeout(matchId);
    if (!sel) return null;
    const m = await this.match(matchId);
    const cur = sel.state === 'complete' ? null : SelectionService.parse(sel.sequence[sel.step]!);
    return { ...sel, serverTime: iso(), options: cur ? this.options(m, sel, cur.kind) : [] };
  }

  /** Worker sweep for expired turns. */
  async sweep(now = new Date()): Promise<number> {
    const due = await this.c.selections.find({ state: 'active', turnDeadline: { $lte: now.toISOString() } }).limit(200).toArray();
    for (const s of due) await this.processTimeout(s._id, now);
    return due.length;
  }
}
