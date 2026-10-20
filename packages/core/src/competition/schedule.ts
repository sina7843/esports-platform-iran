import { DomainError, type Scope } from '@esp/contracts';
import type { Container } from '../container.js';
import type { MatchDoc } from '../db/collections.js';
import type { RescheduleRequestDoc, ScheduleConfigDoc, ScheduleProposalDoc } from '../db/collections-esp04.js';
import { newId } from '../ids.js';

const iso = () => new Date().toISOString();
const MIN = 60_000;
export interface Conflict {
  matchId: string;
  kind: 'participant' | 'player' | 'referee' | 'station' | 'server' | 'dependency' | 'stage_dependency' | 'window' | 'availability' | 'broadcast' | 'unscheduled_feeder';
  hard: boolean;
  detail: string;
}
type Change = ScheduleProposalDoc['changes'][number] & { version: number };
interface Placement {
  at: number;
  duration: number;
  buffer: number;
  stationId: string | null;
  serverId: string | null;
  refereeIds: string[];
}

/**
 * SCH-001..006, AC-07: manual, automatic and mixed scheduling with hard/soft constraints. Hard conflicts (same
 * participant, player across disciplines, referee, station, server, bracket dependency, stage dependency, outside
 * the allowed windows) are refused unless someone holding `schedule.override` gives a reason; soft ones (availability,
 * broadcast slot, unscheduled feeder) are warnings. Automatic, bulk and delay changes are proposals that only an
 * official can apply — nothing is published on its own.
 */
export class ScheduleService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private scope(eventId: string): Scope {
    return { type: 'event', id: eventId };
  }

  async config(eventId: string): Promise<ScheduleConfigDoc> {
    return (await this.c.scheduleConfigs.findOne({ _id: eventId })) ?? { _id: eventId, windows: [], defaultDurationMinutes: 0, bufferMinutes: 0, minRestMinutes: 0, broadcastWindows: [], unavailable: [], updatedBy: 'none', updatedAt: iso(), version: 0 };
  }
  async setConfig(eventId: string, input: Omit<ScheduleConfigDoc, '_id' | 'updatedBy' | 'updatedAt' | 'version'>, actor: string, requestId: string): Promise<ScheduleConfigDoc> {
    await this.ct.acl.require(actor, 'match.manage', this.scope(eventId), requestId);
    for (const w of [...input.windows, ...input.broadcastWindows, ...input.unavailable]) if (Date.parse(w.from) >= Date.parse(w.to)) throw new DomainError('VALIDATION_FAILED', 'every window must end after it starts');
    if (input.defaultDurationMinutes < 1) throw new DomainError('VALIDATION_FAILED', 'an approximate match duration is required');
    const r = await this.c.scheduleConfigs.findOneAndUpdate({ _id: eventId }, { $set: { ...input, updatedBy: actor, updatedAt: iso() }, $inc: { version: 1 } }, { upsert: true, returnDocument: 'after' });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'schedule.config', target: { type: 'event', id: eventId }, scope: this.scope(eventId), outcome: 'success', details: { windows: input.windows.length }, requestId });
    return r!;
  }

  private place(m: MatchDoc, cfg: ScheduleConfigDoc): Placement | null {
    if (!m.scheduledAt) return null;
    return { at: Date.parse(m.scheduledAt), duration: (m.schedule?.durationMinutes || cfg.defaultDurationMinutes) * MIN, buffer: (m.schedule?.bufferMinutes || cfg.bufferMinutes) * MIN, stationId: m.resources?.stationId ?? null, serverId: m.resources?.serverId ?? null, refereeIds: m.resources?.refereeIds ?? [] };
  }

  /** Conflicts of placing `m` at `p` against the other matches (with their current or proposed placements). */
  conflicts(m: MatchDoc, p: Placement, others: Array<{ m: MatchDoc; p: Placement | null }>, cfg: ScheduleConfigDoc, stageInfo: { deps: Array<{ end: number | null }>; exception: boolean }): Conflict[] {
    const out: Conflict[] = [];
    const end = p.at + p.duration + p.buffer;
    const overlap = (q: Placement) => q.at < end && p.at < q.at + q.duration + q.buffer;
    const add = (kind: Conflict['kind'], hard: boolean, detail: string) => out.push({ matchId: m._id, kind, hard, detail });
    for (const o of others) {
      if (o.m._id === m._id || !o.p || ['final', 'cancelled'].includes(o.m.state)) continue;
      if (overlap(o.p)) {
        const shared = (m.participantIds ?? []).filter((x) => o.m.participantIds?.includes(x));
        if (shared.length) add('participant', true, `participant also plays ${o.m._id}`);
        else if ((m.principalIds ?? []).some((x) => o.m.principalIds?.includes(x))) add('player', true, `a player is also in ${o.m._id} (other discipline/event)`);
        if (p.refereeIds.some((r) => o.p!.refereeIds.includes(r))) add('referee', true, `referee also assigned to ${o.m._id}`);
        if (p.stationId && p.stationId === o.p.stationId) add('station', true, `station busy with ${o.m._id}`);
        if (p.serverId && p.serverId === o.p.serverId) add('server', true, `server busy with ${o.m._id}`);
      }
      // bracket dependency in both directions
      const feeds = (a: MatchDoc, b: MatchDoc) => a.stageId === b.stageId && !!a.slot && !!b.slot && b.slot.sources.some((s) => (s.kind === 'winner' || s.kind === 'loser') && s.slot === a.slot!.key);
      if (feeds(o.m, m) && o.p.at + o.p.duration + o.p.buffer + cfg.minRestMinutes * MIN > p.at) add('dependency', true, `starts before feeder ${o.m._id} ends (+${cfg.minRestMinutes} min rest)`);
      if (feeds(m, o.m) && end + cfg.minRestMinutes * MIN > o.p.at) add('dependency', true, `dependent match ${o.m._id} would start before this one ends`);
    }
    for (const s of m.slot?.sources ?? []) {
      if (s.kind !== 'winner' && s.kind !== 'loser') continue;
      const f = others.find((o) => o.m.stageId === m.stageId && o.m.slot?.key === s.slot);
      if (f && !f.p && !['final', 'cancelled'].includes(f.m.state)) add('unscheduled_feeder', false, `feeder ${f.m._id} has no time yet`);
    }
    if (!stageInfo.exception && stageInfo.deps.some((d) => d.end !== null && d.end > p.at)) add('stage_dependency', true, 'a stage this one depends on is still scheduled to run (STG-006)');
    if (cfg.windows.length && !cfg.windows.some((w) => Date.parse(w.from) <= p.at && end <= Date.parse(w.to))) add('window', true, 'outside the allowed scheduling windows');
    for (const u of cfg.unavailable) if ((m.participantIds ?? []).includes(u.participationId) && Date.parse(u.from) < end && p.at < Date.parse(u.to)) add('availability', false, `participant declared unavailable: ${u.reason}`);
    if (m.schedule?.broadcast && cfg.broadcastWindows.length && !cfg.broadcastWindows.some((w) => Date.parse(w.from) <= p.at && end <= Date.parse(w.to))) add('broadcast', false, 'broadcast match outside the broadcast windows');
    return out;
  }

  private async context(eventId: string) {
    const cfg = await this.config(eventId);
    const matches = await this.c.matches.find({ eventId, state: { $nin: ['final', 'cancelled'] } }, { projection: { lobby: 0 } }).toArray();
    const stages = await this.c.stages.find({ eventId }).toArray();
    return { cfg, matches, stages };
  }
  /** Players also active in other events: their placed matches count for the "player" conflict. */
  private async external(principalIds: string[], eventId: string, cfg: ScheduleConfigDoc) {
    if (!principalIds.length) return [];
    const ms = await this.c.matches.find({ principalIds: { $in: principalIds }, eventId: { $ne: eventId }, scheduledAt: { $ne: null }, state: { $nin: ['final', 'cancelled'] } }, { projection: { lobby: 0 } }).toArray();
    return ms.map((m) => ({ m, p: this.place(m, cfg) }));
  }
  private stageInfo(m: MatchDoc, stages: Array<{ _id: string; dependsOnStageIds: string[]; startException: unknown }>, placed: Array<{ m: MatchDoc; p: Placement | null }>) {
    const st = stages.find((s) => s._id === m.stageId);
    const deps = (st?.dependsOnStageIds ?? []).map((d) => {
      const ends = placed.filter((x) => x.m.stageId === d && x.p).map((x) => x.p!.at + x.p!.duration + x.p!.buffer);
      return { end: ends.length ? Math.max(...ends) : null };
    });
    return { deps, exception: !!st?.startException };
  }

  /** Manual time (and resources). Hard conflicts need `schedule.override` and a reason; every change is in the history. */
  async setTime(matchId: string, input: { at: string; durationMinutes?: number | undefined; stationId?: string | null | undefined; serverId?: string | null | undefined; refereeIds?: string[] | undefined; confirmed: boolean; broadcast?: boolean | undefined; reason: string; override?: boolean | undefined }, actor: string, requestId: string): Promise<{ match: MatchDoc; conflicts: Conflict[] }> {
    const m = await this.c.matches.findOne({ _id: matchId });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    await this.ct.acl.require(actor, 'match.manage', this.scope(m.eventId), requestId);
    if (['live', 'paused', 'provisional', 'disputed', 'final', 'cancelled'].includes(m.state)) throw new DomainError('PRECONDITION_FAILED', `a ${m.state} match cannot be rescheduled here`);
    if (Number.isNaN(Date.parse(input.at))) throw new DomainError('VALIDATION_FAILED', 'time must be an ISO instant');
    const { cfg, matches, stages } = await this.context(m.eventId);
    const draft: MatchDoc = { ...m, schedule: { ...(m.schedule ?? { durationMinutes: 0, bufferMinutes: 0, confirmed: false, broadcast: false, history: [] }), ...(input.durationMinutes ? { durationMinutes: input.durationMinutes } : {}), ...(input.broadcast !== undefined ? { broadcast: input.broadcast } : {}) } };
    const p: Placement = { at: Date.parse(input.at), duration: (draft.schedule!.durationMinutes || cfg.defaultDurationMinutes) * MIN, buffer: (draft.schedule!.bufferMinutes || cfg.bufferMinutes) * MIN, stationId: input.stationId !== undefined ? input.stationId : (m.resources?.stationId ?? null), serverId: input.serverId !== undefined ? input.serverId : (m.resources?.serverId ?? null), refereeIds: input.refereeIds ?? m.resources?.refereeIds ?? [] };
    if (p.duration <= 0) throw new DomainError('PRECONDITION_FAILED', 'set an approximate duration (schedule config or this match) first');
    const placed = [...matches.map((x) => ({ m: x, p: this.place(x, cfg) })), ...(await this.external(m.principalIds ?? [], m.eventId, cfg))];
    const conflicts = this.conflicts(draft, p, placed, cfg, this.stageInfo(m, stages, placed));
    const hard = conflicts.filter((c) => c.hard);
    if (hard.length) {
      if (!input.override) throw new DomainError('CONFLICT', 'hard scheduling conflicts', { conflicts });
      await this.ct.acl.require(actor, 'schedule.override', this.scope(m.eventId), requestId);
      if (input.reason.trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'an override needs a reason');
    }
    const confirmed = input.confirmed && (m.participantIds?.length ?? 0) > 0; // a time is "confirmed" only once both sides are known (SCH-005)
    const r = await this.c.matches.findOneAndUpdate(
      { _id: m._id, version: m.version },
      {
        $set: { scheduledAt: new Date(p.at).toISOString(), estimated: !confirmed, 'schedule.durationMinutes': draft.schedule!.durationMinutes, 'schedule.bufferMinutes': draft.schedule!.bufferMinutes, 'schedule.confirmed': confirmed, 'schedule.broadcast': draft.schedule!.broadcast, resources: { stationId: p.stationId, serverId: p.serverId, refereeIds: p.refereeIds }, updatedAt: iso() },
        $push: { 'schedule.history': { at: iso(), by: actor, from: m.scheduledAt, to: new Date(p.at).toISOString(), reason: hard.length ? `OVERRIDE: ${input.reason}` : input.reason } },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!r) throw new DomainError('VERSION_CONFLICT', 'match changed concurrently');
    await this.ct.audit.append({ actorPrincipalId: actor, action: hard.length ? 'schedule.set.override' : 'schedule.set', target: { type: 'match', id: m._id }, scope: this.scope(m.eventId), outcome: 'success', details: { at: r.scheduledAt, conflicts: conflicts.map((c) => c.kind), reason: input.reason }, requestId });
    await this.notify([r], 'schedule.changed');
    return { match: r, conflicts };
  }

  private async notify(ms: MatchDoc[], type: string) {
    // COM-002 / NEWS-006: an official time change feeds notifications and the automatic "time changed" post
    for (const m of ms) {
      if (m.scheduledAt) await this.ct.outbox.append({ type: 'competition.match.rescheduled', aggregate: { type: 'match', id: m._id }, aggregateVersion: m.version, actor: { principalId: 'system', kind: 'system' }, payload: { matchId: m._id, eventId: m.eventId, scheduledAt: m.scheduledAt, estimated: m.estimated ?? false, principals: m.principalIds ?? [] }, correlationId: `schedule:${m._id}:${m.scheduledAt}` });
    }
    const principals = [...new Set(ms.flatMap((m) => m.principalIds ?? []))];
    if (principals.length) await this.ct.realtime.publish({ channel: 'notifications', type, audience: { kind: 'principals', principalIds: principals }, payload: { matches: ms.map((m) => ({ id: m._id, scheduledAt: m.scheduledAt, estimated: m.estimated })) } });
    for (const eventId of new Set(ms.map((m) => m.eventId))) await this.ct.realtime.publish({ channel: `event:${eventId}:public`, type: 'schedule.updated', audience: { kind: 'public' }, payload: { matches: ms.filter((m) => m.eventId === eventId).map((m) => ({ id: m._id, scheduledAt: m.scheduledAt, estimated: m.estimated })) } });
  }

  /**
   * SCH-001 automatic scheduling (greedy, deterministic): matches in stage → round → slot order get the earliest start
   * after their feeders (+ rest) that is inside a window and free of hard conflicts; offline stages also get a free
   * station. The result is a draft proposal with the remaining conflicts listed.
   */
  async autoPropose(eventId: string, opts: { stageId?: string | undefined; from: string; reason: string }, actor: string, requestId: string): Promise<ScheduleProposalDoc> {
    await this.ct.acl.require(actor, 'match.manage', this.scope(eventId), requestId);
    const { cfg, matches, stages } = await this.context(eventId);
    if (cfg.defaultDurationMinutes < 1) throw new DomainError('PRECONDITION_FAILED', 'set the schedule configuration (approximate duration, windows) first');
    const stageOrder = new Map(stages.map((s) => [s._id, s.order]));
    const presence = new Map(stages.map((s) => [s._id, s.presence]));
    const stations = await this.c.stations.find({ eventId, state: { $in: ['ready', 'in_use'] } }).sort({ label: 1 }).toArray();
    const todo = matches.filter((m) => (!opts.stageId || m.stageId === opts.stageId) && !m.scheduledAt && ['awaiting_sides', 'scheduled'].includes(m.state));
    todo.sort((a, b) => (stageOrder.get(a.stageId) ?? 0) - (stageOrder.get(b.stageId) ?? 0) || (a.slot?.round ?? 0) - (b.slot?.round ?? 0) || (a.slot?.bracket ?? '').localeCompare(b.slot?.bracket ?? '') || (a.slot?.order ?? 0) - (b.slot?.order ?? 0));
    const placed = new Map(matches.map((m) => [m._id, this.place(m, cfg)]));
    const externals = await this.external([...new Set(todo.flatMap((m) => m.principalIds ?? []))], eventId, cfg);
    const changes: Change[] = [];
    const conflicts: Conflict[] = [];
    const start0 = Math.max(Date.parse(opts.from), cfg.windows.length ? Math.min(...cfg.windows.map((w) => Date.parse(w.from))) : 0);
    for (const m of todo) {
      const all = () => [...matches.map((x) => ({ m: x, p: placed.get(x._id) ?? null })), ...externals];
      const dur = (m.schedule?.durationMinutes || cfg.defaultDurationMinutes) * MIN;
      const buf = (m.schedule?.bufferMinutes || cfg.bufferMinutes) * MIN;
      let at = start0;
      let chosen: Placement | null = null;
      for (let guard = 0; guard < 2000 && !chosen; guard++) {
        const station = presence.get(m.stageId) === 'online' ? null : (stations.find((s) => !all().some((o) => o.p && o.p.stationId === s._id && o.p.at < at + dur + buf && at < o.p.at + o.p.duration + o.p.buffer))?._id ?? null);
        const p: Placement = { at, duration: dur, buffer: buf, stationId: station, serverId: m.resources?.serverId ?? null, refereeIds: m.resources?.refereeIds ?? [] };
        const cs = this.conflicts(m, p, all(), cfg, this.stageInfo(m, stages, all())).filter((c) => c.hard);
        if (!cs.length && (presence.get(m.stageId) === 'online' || !stations.length || station)) {
          chosen = p;
          break;
        }
        // jump past the earliest blocking end, or to the next window
        const blockers = all().filter((o) => o.p && o.p.at + o.p.duration + o.p.buffer > at).map((o) => o.p!.at + o.p!.duration + o.p!.buffer + cfg.minRestMinutes * MIN);
        const nextWindow = cfg.windows.map((w) => Date.parse(w.from)).filter((x) => x > at);
        const candidates = [...blockers, ...nextWindow].filter((x) => x > at);
        at = candidates.length ? Math.min(...candidates) : at + 5 * MIN;
      }
      if (!chosen) {
        conflicts.push({ matchId: m._id, kind: 'window', hard: true, detail: 'no conflict-free time found inside the windows' });
        continue;
      }
      placed.set(m._id, chosen);
      changes.push({ matchId: m._id, from: m.scheduledAt, to: new Date(chosen.at).toISOString(), stationId: chosen.stationId, serverId: chosen.serverId, refereeIds: chosen.refereeIds, version: m.version });
      conflicts.push(...this.conflicts(m, chosen, [...matches.map((x) => ({ m: x, p: placed.get(x._id) ?? null })), ...externals], cfg, this.stageInfo(m, stages, [...matches.map((x) => ({ m: x, p: placed.get(x._id) ?? null }))])).filter((c) => !c.hard));
    }
    return this.saveProposal(eventId, 'auto', opts.reason, changes, conflicts, actor, requestId);
  }

  private async saveProposal(eventId: string, kind: ScheduleProposalDoc['kind'], reason: string, changes: Change[], conflicts: Conflict[], actor: string, requestId: string): Promise<ScheduleProposalDoc> {
    const doc: ScheduleProposalDoc = { _id: newId('spr'), eventId, kind, reason, changes, conflicts, state: 'draft', createdBy: actor, createdAt: iso(), decidedBy: null, decidedAt: null, version: 0 };
    await this.c.scheduleProposals.insertOne(doc);
    await this.ct.audit.append({ actorPrincipalId: actor, action: `schedule.proposal.${kind}`, target: { type: 'event', id: eventId }, scope: this.scope(eventId), outcome: 'success', details: { proposalId: doc._id, changes: changes.length, hard: conflicts.filter((c) => c.hard).length }, requestId });
    return doc;
  }

  /** SCH-004: bulk shift preview (e.g. a whole round by +30 minutes). */
  async bulkShift(eventId: string, input: { matchIds: string[]; minutes: number; reason: string }, actor: string, requestId: string): Promise<ScheduleProposalDoc> {
    await this.ct.acl.require(actor, 'match.manage', this.scope(eventId), requestId);
    if (!Number.isInteger(input.minutes) || input.minutes === 0) throw new DomainError('VALIDATION_FAILED', 'shift by a whole, non-zero number of minutes');
    return this.shiftProposal(eventId, 'bulk_shift', input.matchIds.map((id) => [id, input.minutes * MIN] as const), input.reason, actor, requestId);
  }

  private async shiftProposal(eventId: string, kind: ScheduleProposalDoc['kind'], shifts: ReadonlyArray<readonly [string, number]>, reason: string, actor: string, requestId: string) {
    const { cfg, matches, stages } = await this.context(eventId);
    const placed = new Map(matches.map((m) => [m._id, this.place(m, cfg)]));
    const changes: Change[] = [];
    for (const [id, delta] of shifts) {
      const m = matches.find((x) => x._id === id);
      const p = placed.get(id);
      if (!m || !p) continue;
      placed.set(id, { ...p, at: p.at + delta });
      changes.push({ matchId: id, from: m.scheduledAt, to: new Date(p.at + delta).toISOString(), stationId: p.stationId, serverId: p.serverId, refereeIds: p.refereeIds, version: m.version });
    }
    const all = matches.map((x) => ({ m: x, p: placed.get(x._id) ?? null }));
    const conflicts = changes.flatMap((c) => {
      const m = matches.find((x) => x._id === c.matchId)!;
      return this.conflicts(m, placed.get(m._id)!, all, cfg, this.stageInfo(m, stages, all));
    });
    return this.saveProposal(eventId, kind, reason, changes, conflicts, actor, requestId);
  }

  /**
   * SCH-006, AC-07: a delay of one match proposes new times for everything that depends on it — bracket successors and
   * later matches sharing a participant, player, referee, station or server — transitively. Draft only.
   */
  async proposeDelay(matchId: string, minutes: number, reason: string, actor: string, requestId: string, kind: ScheduleProposalDoc['kind'] = 'delay'): Promise<ScheduleProposalDoc> {
    const m = await this.c.matches.findOne({ _id: matchId });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    await this.ct.acl.require(actor, 'match.manage', this.scope(m.eventId), requestId);
    if (!Number.isInteger(minutes) || minutes <= 0) throw new DomainError('VALIDATION_FAILED', 'a delay is a positive number of minutes');
    const { cfg, matches } = await this.context(m.eventId);
    const place = new Map(matches.map((x) => [x._id, this.place(x, cfg)]));
    const origin = place.get(m._id) ?? (m.run?.startedAt ? { at: Date.parse(m.run.startedAt), duration: (m.schedule?.durationMinutes || cfg.defaultDurationMinutes) * MIN, buffer: (m.schedule?.bufferMinutes || cfg.bufferMinutes) * MIN, stationId: m.resources?.stationId ?? null, serverId: m.resources?.serverId ?? null, refereeIds: m.resources?.refereeIds ?? [] } : null);
    if (!origin) throw new DomainError('PRECONDITION_FAILED', 'the delayed match has no time');
    const shifted = new Map<string, number>([[m._id, minutes * MIN]]);
    const queue = [m._id];
    const related = (a: MatchDoc, b: MatchDoc) =>
      (a.stageId === b.stageId && b.slot?.sources.some((s) => (s.kind === 'winner' || s.kind === 'loser') && s.slot === a.slot?.key)) ||
      (a.participantIds ?? []).some((x) => b.participantIds?.includes(x)) || (a.principalIds ?? []).some((x) => b.principalIds?.includes(x)) ||
      (!!a.resources?.stationId && a.resources.stationId === b.resources?.stationId) || (!!a.resources?.serverId && a.resources.serverId === b.resources?.serverId) || (a.resources?.refereeIds ?? []).some((r) => b.resources?.refereeIds.includes(r));
    while (queue.length) {
      const id = queue.shift()!;
      const a = id === m._id ? m : matches.find((x) => x._id === id)!;
      const pa = id === m._id ? origin : place.get(id)!;
      const newEnd = pa.at + (shifted.get(id) ?? 0) + pa.duration + pa.buffer + cfg.minRestMinutes * MIN;
      for (const b of matches) {
        const pb = place.get(b._id);
        if (b._id === a._id || !pb || pb.at < pa.at || !related(a, b)) continue;
        const need = newEnd - (pb.at + (shifted.get(b._id) ?? 0));
        if (need > 0) {
          shifted.set(b._id, (shifted.get(b._id) ?? 0) + need);
          queue.push(b._id);
        }
      }
    }
    const shifts = [...shifted].filter(([id]) => place.get(id)).map(([id, d]) => [id, d] as const);
    return this.shiftProposal(m.eventId, kind, shifts, reason, actor, requestId);
  }

  /** Applying a proposal is all-or-nothing; any match changed since the proposal was made supersedes it. */
  async applyProposal(proposalId: string, opts: { confirm: boolean; override?: boolean | undefined; reason?: string | undefined }, actor: string, requestId: string): Promise<ScheduleProposalDoc> {
    const pr = await this.c.scheduleProposals.findOne({ _id: proposalId });
    if (!pr) throw new DomainError('NOT_FOUND', 'proposal not found');
    await this.ct.acl.require(actor, 'match.manage', this.scope(pr.eventId), requestId);
    if (pr.state !== 'draft') throw new DomainError('ILLEGAL_TRANSITION', `proposal is ${pr.state}`);
    if (pr.conflicts.some((c) => c.hard)) {
      if (!opts.override) throw new DomainError('CONFLICT', 'the proposal still has hard conflicts', { conflicts: pr.conflicts.filter((c) => c.hard) });
      await this.ct.acl.require(actor, 'schedule.override', this.scope(pr.eventId), requestId);
      if ((opts.reason ?? '').trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'an override needs a reason');
    }
    const changed: MatchDoc[] = [];
    try {
      await this.ct.dbh.withTransaction(async (session) => {
        for (const ch of pr.changes as Change[]) {
          const cur = await this.c.matches.findOne({ _id: ch.matchId }, { session });
          const confirmed = opts.confirm && (cur?.participantIds?.length ?? 0) > 0;
          const r = await this.c.matches.findOneAndUpdate(
            { _id: ch.matchId, version: ch.version },
            { $set: { scheduledAt: ch.to, estimated: !confirmed, 'schedule.confirmed': confirmed, resources: { stationId: ch.stationId ?? null, serverId: ch.serverId ?? null, refereeIds: ch.refereeIds ?? [] }, updatedAt: iso() }, $push: { 'schedule.history': { at: iso(), by: actor, from: ch.from, to: ch.to, reason: `${pr.kind}: ${pr.reason}` } }, $inc: { version: 1 } },
            { returnDocument: 'after', session },
          );
          if (!r) throw new DomainError('VERSION_CONFLICT', `match ${ch.matchId} changed since the proposal`);
          changed.push(r);
        }
        await this.c.scheduleProposals.updateOne({ _id: pr._id, state: 'draft' }, { $set: { state: 'applied', decidedBy: actor, decidedAt: iso() }, $inc: { version: 1 } }, { session });
        await this.ct.audit.append({ actorPrincipalId: actor, action: 'schedule.proposal.apply', target: { type: 'event', id: pr.eventId }, scope: this.scope(pr.eventId), outcome: 'success', details: { proposalId, changes: pr.changes.length, override: !!opts.override }, requestId }, session);
      });
    } catch (e) {
      if (e instanceof DomainError && e.code === 'VERSION_CONFLICT') await this.c.scheduleProposals.updateOne({ _id: pr._id, state: 'draft' }, { $set: { state: 'superseded' } });
      throw e;
    }
    await this.notify(changed, 'schedule.changed');
    return (await this.c.scheduleProposals.findOne({ _id: proposalId }))!;
  }

  async rejectProposal(proposalId: string, actor: string, requestId: string): Promise<void> {
    const pr = await this.c.scheduleProposals.findOne({ _id: proposalId });
    if (!pr) throw new DomainError('NOT_FOUND', 'proposal not found');
    await this.ct.acl.require(actor, 'match.manage', this.scope(pr.eventId), requestId);
    await this.c.scheduleProposals.updateOne({ _id: pr._id, state: 'draft' }, { $set: { state: 'rejected', decidedBy: actor, decidedAt: iso() }, $inc: { version: 1 } });
  }

  // ------------------------------------------------------------------ reschedule requests (SCH-004)
  async request(matchId: string, proposedAt: string, reason: string, actor: string): Promise<RescheduleRequestDoc> {
    const m = await this.c.matches.findOne({ _id: matchId });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    const side = m.sides.findIndex((s) => s.roster.some((r) => r.principalId === actor));
    if (side < 0) throw new DomainError('FORBIDDEN', 'only a side of this match can ask to reschedule');
    if (Number.isNaN(Date.parse(proposedAt)) || reason.trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'a valid time and a reason are required');
    const doc: RescheduleRequestDoc = { _id: newId('rsr'), matchId, eventId: m.eventId, requestedBy: actor, requestedSide: side, proposedAt, reason, opponentAgreed: null, state: 'open', decidedBy: null, note: null, createdAt: iso(), version: 0 };
    try {
      await this.c.rescheduleRequests.insertOne(doc);
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'this match already has an open reschedule request');
      throw e;
    }
    await this.notify([m], 'schedule.reschedule_requested');
    return doc;
  }
  async agree(requestId: string, actor: string): Promise<RescheduleRequestDoc> {
    const r = await this.c.rescheduleRequests.findOne({ _id: requestId });
    if (!r) throw new DomainError('NOT_FOUND', 'request not found');
    const m = (await this.c.matches.findOne({ _id: r.matchId }))!;
    const side = m.sides.findIndex((s) => s.roster.some((x) => x.principalId === actor));
    if (side < 0 || side === r.requestedSide) throw new DomainError('FORBIDDEN', 'only the opponent can agree');
    const u = await this.c.rescheduleRequests.findOneAndUpdate({ _id: r._id, state: 'open' }, { $set: { state: 'agreed', opponentAgreed: { by: actor, at: iso() } }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!u) throw new DomainError('ILLEGAL_TRANSITION', `request is ${r.state}`);
    return u;
  }
  /** The official decides; approval applies the time through the same conflict checks as a manual change. */
  async decide(requestId: string, approve: boolean, note: string, actor: string, rid: string): Promise<RescheduleRequestDoc> {
    const r = await this.c.rescheduleRequests.findOne({ _id: requestId });
    if (!r) throw new DomainError('NOT_FOUND', 'request not found');
    await this.ct.acl.require(actor, 'match.manage', this.scope(r.eventId), rid);
    if (!['open', 'agreed'].includes(r.state)) throw new DomainError('ILLEGAL_TRANSITION', `request is ${r.state}`);
    if (approve) {
      if (r.state !== 'agreed') throw new DomainError('PRECONDITION_FAILED', 'the opponent has not agreed');
      await this.setTime(r.matchId, { at: r.proposedAt, confirmed: true, reason: `reschedule request ${r._id}: ${r.reason}` }, actor, rid);
    }
    return (await this.c.rescheduleRequests.findOneAndUpdate({ _id: r._id }, { $set: { state: approve ? 'approved' : 'rejected', decidedBy: actor, note }, $inc: { version: 1 } }, { returnDocument: 'after' }))!;
  }

  // ------------------------------------------------------------------ personal calendar (SCH-005)
  async calendar(principalId: string): Promise<Array<{ matchId: string; eventId: string; stageId: string; scheduledAt: string; estimated: boolean; durationMinutes: number; sides: string[]; state: string }>> {
    const ms = await this.c.matches.find({ principalIds: principalId, scheduledAt: { $ne: null }, state: { $ne: 'cancelled' } }, { projection: { lobby: 0 } }).sort({ scheduledAt: 1 }).limit(500).toArray();
    return ms.map((m) => ({ matchId: m._id, eventId: m.eventId, stageId: m.stageId, scheduledAt: m.scheduledAt!, estimated: m.estimated, durationMinutes: m.schedule?.durationMinutes ?? 0, sides: m.sides.map((s) => s.displayName), state: m.state }));
  }
  async ics(principalId: string): Promise<string> {
    const items = await this.calendar(principalId);
    const fmt = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//esp//schedule//FA', 'CALSCALE:GREGORIAN'];
    for (const i of items) {
      const start = Date.parse(i.scheduledAt);
      lines.push('BEGIN:VEVENT', `UID:${i.matchId}@esp`, `DTSTAMP:${fmt(Date.now())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(start + Math.max(i.durationMinutes, 30) * MIN)}`, `SUMMARY:${esc(i.sides.join(' vs '))}`, `STATUS:${i.estimated ? 'TENTATIVE' : 'CONFIRMED'}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }
}
