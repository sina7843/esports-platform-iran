import { DomainError, matchMachine } from '@esp/contracts';
import type { Container } from '../container.js';
import type { MatchDoc } from '../db/collections.js';
import type { IncidentDoc, MatchEventDoc } from '../db/collections-esp04.js';
import { applyTransition } from '../domain/transition.js';
import { newId } from '../ids.js';
import { RoomService } from './room.js';
import { ScheduleService } from './schedule.js';
import { StructureService } from './structure.js';

const iso = () => new Date().toISOString();

/**
 * RUN-001..006, AC-08: start/pause/resume/finish with actor and server time, tactical/technical pauses within the
 * rules' count and duration, disconnects with a return deadline, device swaps, surrender/withdraw/expel/forfeit with a
 * type and reason, replay/restore only when the rules define it and an official decides, and event-wide disruption
 * (forced game update, internet outage, infrastructure) that pauses matches, posts a safe public notice and proposes a
 * new schedule for approval. Timers are server deadlines: a client refresh never resets them.
 */
export class RunService {
  private readonly room: RoomService;
  constructor(private readonly ct: Container) {
    this.room = new RoomService(ct);
  }
  private get c() {
    return this.ct.c;
  }
  private async match(matchId: string): Promise<MatchDoc> {
    const m = await this.c.matches.findOne({ _id: matchId });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    return m;
  }
  private async log(m: MatchDoc, type: string, side: number | null, detail: Record<string, unknown>, by: string, publicText: string | null): Promise<MatchEventDoc> {
    const e = await this.room.event(m, type, side, detail, by, publicText);
    await this.c.matchEvents.insertOne(e);
    await this.ct.realtime.publish({ channel: `match:${m._id}`, type: `run.${type}`, audience: { kind: 'public' }, payload: { matchId: m._id, at: e.at, text: publicText } });
    return e;
  }
  private async official(m: MatchDoc, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'match.manage', { type: 'match', id: m._id }, requestId);
  }

  async start(matchId: string, actor: string, requestId: string): Promise<MatchDoc> {
    const m = await this.match(matchId);
    await this.official(m, actor, requestId);
    const sel = await this.c.selections.findOne({ _id: matchId });
    if (m.config?.vetoSequence.length && sel?.state !== 'complete') throw new DomainError('PRECONDITION_FAILED', 'the pre-game selection is not complete');
    const { doc } = await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'start', expectedVersion: m.version, actorRoles: ['event_operator'] }, { 'run.startedAt': iso() } as Partial<MatchDoc>);
    await this.log(doc, 'start', null, {}, actor, 'بازی آغاز شد');
    await this.c.stages.updateOne({ _id: m.stageId, state: 'drawn' }, { $set: { state: 'active' }, $inc: { version: 1 } });
    return doc;
  }

  /** RUN-002: a side calls a tactical pause within its allowance; technical pauses by a side or an official. */
  async pause(matchId: string, kind: 'tactical' | 'technical', side: number | null, reason: string, actor: string, _requestId: string): Promise<MatchDoc> {
    const m = await this.match(matchId);
    const actorSide = this.room.sideOf(m, actor);
    const isOfficial = await this.ct.acl.can(actor, 'match.manage', { type: 'match', id: m._id });
    if (!isOfficial && (actorSide < 0 || (side !== null && side !== actorSide))) throw new DomainError('FORBIDDEN', 'a side can only pause for itself');
    const s = isOfficial ? side : actorSide;
    const limits = m.config?.pauses;
    const perSide = kind === 'tactical' ? limits?.tacticalPerSide : limits?.technicalPerSide;
    const seconds = kind === 'tactical' ? limits?.tacticalSeconds : limits?.technicalSeconds;
    if (!isOfficial && (perSide === null || perSide === undefined)) throw new DomainError('PRECONDITION_FAILED', `the rules do not define ${kind} pauses; ask the referee`);
    const used = (m.run?.pauses ?? []).filter((p) => p.side === s && p.kind === kind).length;
    if (!isOfficial && perSide !== null && perSide !== undefined && used >= perSide) throw new DomainError('PRECONDITION_FAILED', `side ${s} has used all ${perSide} ${kind} pauses (rules)`);
    const until = seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null;
    const { doc } = await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'pause', expectedVersion: m.version, actorRoles: isOfficial ? ['event_operator'] : ['team_captain'] }, { 'run.pauses': [...(m.run?.pauses ?? []), { side: s, kind, at: iso(), until, by: actor }] } as Partial<MatchDoc>);
    await this.log(doc, 'pause', s, { kind, reason, until }, actor, kind === 'tactical' ? 'توقف تاکتیکی' : 'توقف فنی');
    return doc;
  }

  async resume(matchId: string, actor: string, requestId: string): Promise<MatchDoc> {
    const m = await this.match(matchId);
    await this.official(m, actor, requestId);
    if (m.run?.disconnect) throw new DomainError('PRECONDITION_FAILED', 'a disconnect is open; record the reconnect or a decision first');
    const pauses = (m.run?.pauses ?? []).map((p, i, arr) => (i === arr.length - 1 && !p.until ? { ...p, until: iso() } : p));
    const { doc } = await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'resume', expectedVersion: m.version, actorRoles: ['event_operator'] }, { 'run.pauses': pauses } as Partial<MatchDoc>);
    await this.log(doc, 'resume', null, {}, actor, 'بازی ادامه یافت');
    return doc;
  }

  /** AC-08: a disconnect pauses the match (technical) and opens the rules' return deadline. */
  async disconnect(matchId: string, side: number, actor: string, requestId: string): Promise<MatchDoc> {
    let m = await this.match(matchId);
    const actorSide = this.room.sideOf(m, actor);
    const isOfficial = await this.ct.acl.can(actor, 'match.manage', { type: 'match', id: m._id });
    if (!isOfficial && actorSide !== side) throw new DomainError('FORBIDDEN', 'report disconnects of your own side, or ask the referee');
    if (m.run?.disconnect) throw new DomainError('CONFLICT', 'a disconnect is already open');
    if (m.state === 'live') m = await this.pause(matchId, 'technical', side, 'disconnect', actor, requestId).catch(async () => applyTransition(matchMachine, this.c.matches, m._id, { transition: 'pause', expectedVersion: m.version, actorRoles: ['system'] }).then((r) => r.doc));
    if (m.state !== 'paused') throw new DomainError('PRECONDITION_FAILED', `match is ${m.state}`);
    const secs = m.config?.disconnect.returnSeconds;
    const deadline = typeof secs === 'number' ? new Date(Date.now() + secs * 1000).toISOString() : null;
    const r = await this.c.matches.findOneAndUpdate({ _id: m._id, 'run.disconnect': null }, { $set: { 'run.disconnect': { side, at: iso(), deadline: deadline ?? '' } }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('CONFLICT', 'a disconnect is already open');
    await this.log(r, 'disconnect', side, { deadline, onExpiry: m.config?.disconnect.onExpiry ?? null }, actor, 'قطع اتصال؛ بازی متوقف است');
    return r;
  }

  async reconnect(matchId: string, actor: string, requestId: string): Promise<MatchDoc> {
    const m = await this.match(matchId);
    const d = m.run?.disconnect;
    if (!d) throw new DomainError('PRECONDITION_FAILED', 'no open disconnect');
    const actorSide = this.room.sideOf(m, actor);
    if (actorSide !== d.side && !(await this.ct.acl.can(actor, 'match.manage', { type: 'match', id: m._id }))) throw new DomainError('FORBIDDEN', 'only the disconnected side or an official');
    const late = !!d.deadline && Date.parse(d.deadline) < Date.now();
    const r = await this.c.matches.findOneAndUpdate({ _id: m._id, 'run.disconnect.at': d.at }, { $set: { 'run.disconnect': null }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('CONFLICT', 'disconnect changed concurrently');
    await this.log(r, 'reconnect', d.side, { late }, actor, 'اتصال برقرار شد');
    void requestId;
    return r;
  }

  /** The disconnect status with the server clock: expired deadlines show the rules' consequence for the official. */
  async disconnectStatus(matchId: string) {
    const m = await this.match(matchId);
    const d = m.run?.disconnect;
    return { open: !!d, side: d?.side ?? null, deadline: d?.deadline || null, expired: !!d?.deadline && Date.parse(d.deadline) < Date.now(), onExpiry: m.config?.disconnect.onExpiry ?? null, serverTime: iso() };
  }

  /**
   * AC-08/RUN-003: the official's decision after a disconnect or incident. replay/restore require the rules' replay
   * clause; forfeits go through the forfeit transition with type and reason.
   */
  async decide(matchId: string, decision: 'continue' | 'replay' | 'restore' | 'forfeit_map' | 'forfeit_match', reason: string, actor: string, requestId: string): Promise<MatchDoc> {
    const m = await this.match(matchId);
    await this.ct.acl.require(actor, 'match.result.verify', { type: 'match', id: m._id }, requestId);
    if (reason.trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'a decision needs a reason');
    if ((decision === 'replay' || decision === 'restore') && !m.config?.replayRule) throw new DomainError('PRECONDITION_FAILED', 'the rules define no replay/restore procedure (match.replay)');
    const d = m.run?.disconnect;
    await this.log(m, 'decision', d?.side ?? null, { decision, reason, rule: m.config?.disconnect.onExpiry ?? null, replayRule: m.config?.replayRule ?? null }, actor, decision === 'continue' ? 'تصمیم داور: ادامه' : decision.startsWith('forfeit') ? 'تصمیم داور: باخت فنی' : 'تصمیم داور: تکرار/بازیابی');
    await this.c.matches.updateOne({ _id: m._id }, { $set: { 'run.disconnect': null }, $inc: { version: 1 } });
    const cur = (await this.c.matches.findOne({ _id: m._id }))!;
    if (decision === 'forfeit_match') {
      if (!d) throw new DomainError('PRECONDITION_FAILED', 'name the forfeiting side through a disconnect record');
      return new StructureService(this.ct).recordForfeit(cur, d.side === 0 ? 1 : 0, `forfeit after disconnect: ${reason}`, actor, requestId);
    }
    return cur;
  }

  async deviceSwap(matchId: string, side: number, note: string, actor: string, requestId: string): Promise<MatchEventDoc> {
    const m = await this.match(matchId);
    await this.official(m, actor, requestId);
    return this.log(m, 'device_swap', side, { note }, actor, 'تعویض تجهیزات');
  }

  /** RUN-004: a side surrenders (its own decision, recorded with who and why); the opponent wins by forfeit. */
  async surrender(matchId: string, reason: string, actor: string, requestId: string): Promise<MatchDoc> {
    const m = await this.match(matchId);
    const side = this.room.sideOf(m, actor);
    if (side < 0) throw new DomainError('FORBIDDEN', 'only a side can surrender');
    if (!['live', 'paused', 'ready', 'pre_game_selection', 'awaiting_readiness', 'scheduled'].includes(m.state)) throw new DomainError('PRECONDITION_FAILED', `match is ${m.state}`);
    await this.log(m, 'surrender', side, { reason, by: actor }, actor, 'تسلیم');
    return new StructureService(this.ct).recordForfeit(m, side === 0 ? 1 : 0, `surrender by side ${side + 1}: ${reason}`, 'system', requestId);
  }

  /** RUN-004: officials record lateness, expulsion or a forfeit with its type and reason. */
  async sanction(matchId: string, type: 'delay' | 'expel' | 'forfeit' | 'double_forfeit', side: number | null, principalId: string | null, reason: string, actor: string, requestId: string): Promise<MatchDoc> {
    const m = await this.match(matchId);
    await this.ct.acl.require(actor, 'match.result.verify', { type: 'match', id: m._id }, requestId);
    if (reason.trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'a reason is required');
    await this.log(m, type, side, { reason, principalId }, actor, type === 'delay' ? 'تأخیر ثبت شد' : type === 'expel' ? 'اخراج بازیکن' : 'باخت فنی');
    if (type === 'expel' && principalId) {
      await this.c.matches.updateOne({ _id: m._id }, { $set: { sides: m.sides.map((s) => ({ ...s, roster: s.roster.map((r) => (r.principalId === principalId ? { ...r, present: false } : r)) })) }, $inc: { version: 1 } });
    }
    const cur = (await this.c.matches.findOne({ _id: m._id }))!;
    if (type === 'forfeit') {
      if (side !== 0 && side !== 1) throw new DomainError('VALIDATION_FAILED', 'name the forfeiting side');
      return new StructureService(this.ct).recordForfeit(cur, side === 0 ? 1 : 0, reason, actor, requestId);
    }
    if (type === 'double_forfeit') return new StructureService(this.ct).recordForfeit(cur, null, reason, actor, requestId);
    return cur;
  }

  // ------------------------------------------------------------------ RUN-005 disruption
  async openIncident(eventId: string, input: { kind: IncidentDoc['kind']; disciplineIds: string[] | null; publicNotice: string; internalNote: string | null; delayMinutes: number; newGameVersion?: string | null | undefined }, actor: string, requestId: string): Promise<IncidentDoc> {
    await this.ct.acl.require(actor, 'match.manage', { type: 'event', id: eventId }, requestId);
    if (input.publicNotice.trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'a public notice is required');
    const scope = input.disciplineIds?.length ? { disciplineId: { $in: input.disciplineIds } } : {};
    const live = await this.c.matches.find({ eventId, ...scope, state: 'live' }).toArray();
    const paused: string[] = [];
    for (const m of live) {
      try {
        const { doc } = await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'pause', expectedVersion: m.version, actorRoles: ['system'] }, { 'run.pauses': [...(m.run?.pauses ?? []), { side: null, kind: 'technical', at: iso(), until: null, by: actor }], 'room.publicNotice': input.publicNotice } as Partial<MatchDoc>);
        await this.log(doc, 'pause', null, { incident: input.kind }, actor, input.publicNotice);
        paused.push(m._id);
      } catch {
        // a match that changed state meanwhile is left as is
      }
    }
    const affected = await this.c.matches.find({ eventId, ...scope, state: { $in: ['awaiting_sides', 'scheduled', 'awaiting_readiness', 'ready'] }, scheduledAt: { $ne: null } }).sort({ scheduledAt: 1 }).toArray();
    let proposalId: string | null = null;
    if (affected.length && input.delayMinutes > 0) {
      const pr = await new ScheduleService(this.ct).bulkShift(eventId, { matchIds: affected.map((m) => m._id), minutes: input.delayMinutes, reason: `incident ${input.kind}: ${input.publicNotice}` }, actor, requestId);
      await this.c.scheduleProposals.updateOne({ _id: pr._id }, { $set: { kind: 'disruption' } });
      proposalId = pr._id;
    }
    if (input.kind === 'game_update' && input.newGameVersion) {
      const ds = await this.c.disciplines.find({ eventId, ...(input.disciplineIds?.length ? { _id: { $in: input.disciplineIds } } : {}) }).toArray();
      for (const d of ds.filter((x) => x.gameVersion !== input.newGameVersion)) await this.c.reviewItems.insertOne({ _id: newId('rvw'), eventId, kind: 'rule_missing', ref: { type: 'discipline', id: d._id }, detail: { message: `forced game update ${d.gameVersion} → ${input.newGameVersion}: check version and rules compatibility before continuing (15.5)` }, state: 'open', resolution: null, resolvedBy: null, createdAt: iso(), resolvedAt: null });
    }
    const doc: IncidentDoc = { _id: newId('inc'), eventId, kind: input.kind, scope: { disciplineIds: input.disciplineIds, matchIds: [...paused, ...affected.map((m) => m._id)] }, publicNotice: input.publicNotice, internalNote: input.internalNote, state: 'active', pausedMatchIds: paused, proposalId, openedBy: actor, openedAt: iso(), resolvedAt: null };
    await this.c.incidents.insertOne(doc);
    await this.ct.realtime.publish({ channel: `event:${eventId}:public`, type: 'incident.opened', audience: { kind: 'public' }, payload: { id: doc._id, kind: doc.kind, notice: doc.publicNotice } });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'incident.open', target: { type: 'event', id: eventId }, scope: { type: 'event', id: eventId }, outcome: 'success', details: { kind: input.kind, paused: paused.length, proposalId }, requestId });
    return doc;
  }

  /** Resuming after a disruption is an explicit official act; a forced game update needs the compatibility note. */
  async resolveIncident(incidentId: string, resume: boolean, note: string, actor: string, requestId: string): Promise<IncidentDoc> {
    const inc = await this.c.incidents.findOne({ _id: incidentId });
    if (!inc) throw new DomainError('NOT_FOUND', 'incident not found');
    await this.ct.acl.require(actor, 'match.manage', { type: 'event', id: inc.eventId }, requestId);
    if (inc.kind === 'game_update' && note.trim().length < 10) throw new DomainError('VALIDATION_FAILED', 'record how version and rules compatibility was checked before resuming');
    if (resume) {
      for (const id of inc.pausedMatchIds) {
        const m = await this.c.matches.findOne({ _id: id });
        if (m?.state !== 'paused' || m.run?.disconnect) continue;
        const { doc } = await applyTransition(matchMachine, this.c.matches, id, { transition: 'resume', expectedVersion: m.version, actorRoles: ['system'] }, { 'room.publicNotice': null } as Partial<MatchDoc>);
        await this.log(doc, 'resume', null, { incident: incidentId }, actor, 'ادامه پس از رفع اختلال');
      }
    }
    const r = await this.c.incidents.findOneAndUpdate({ _id: incidentId, state: 'active' }, { $set: { state: 'resolved', resolvedAt: iso(), internalNote: [inc.internalNote, note].filter(Boolean).join(' | ') } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('ILLEGAL_TRANSITION', 'incident already resolved');
    await this.ct.realtime.publish({ channel: `event:${inc.eventId}:public`, type: 'incident.resolved', audience: { kind: 'public' }, payload: { id: incidentId } });
    return r;
  }

  async timeline(matchId: string, viewer: string | null) {
    const m = await this.match(matchId);
    const priv = viewer ? (this.room.sideOf(m, viewer) >= 0 || (await this.room.isOfficial(m, viewer))) : false;
    const events = await this.c.matchEvents.find({ matchId }).sort({ seq: 1 }).limit(500).toArray();
    return events.map((e) => (priv ? e : { seq: e.seq, at: e.at, type: e.type, text: e.publicText })).filter((e) => priv || (e as { text: string | null }).text);
  }
}
