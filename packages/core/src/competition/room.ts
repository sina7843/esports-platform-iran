import { DomainError, matchMachine } from '@esp/contracts';
import type { Container } from '../container.js';
import type { MatchDoc } from '../db/collections.js';
import type { MatchMessageDoc, RefereeCallDoc } from '../db/collections-esp04.js';
import { applyTransition } from '../domain/transition.js';
import { newId } from '../ids.js';

const iso = () => new Date().toISOString();
const LOBBY_STATES = ['ready', 'pre_game_selection', 'live', 'paused'];

/**
 * ROOM-004 / RUN-006: the only shape public endpoints, streams, caches, displays and media exports may use. It never
 * carries lobby data, server connection or passwords, principal ids, private chat or internal notes.
 */
export function publicMatch(m: MatchDoc) {
  return {
    id: m._id, eventId: m.eventId, stageId: m.stageId, kind: m.kind, state: m.state, scheduledAt: m.scheduledAt, estimated: m.estimated,
    slot: m.slot ? { key: m.slot.key, bracket: m.slot.bracket, round: m.slot.round, group: m.slot.group } : null,
    sides: m.sides.map((s) => ({ displayName: s.displayName, roster: s.roster.map((r) => ({ displayName: r.displayName, role: r.role })) })),
    config: m.config ? { bestOf: m.config.bestOf, mode: m.config.mode, gameVersion: m.config.gameVersion, mapPool: m.config.mapPool, override: m.config.source.override } : null,
    outcome: m.state === 'final' ? m.outcome : null,
    provisional: m.state === 'provisional',
    publicNotice: m.room?.publicNotice ?? null,
    stationLabel: null as string | null,
    resultVersion: m.resultVersion, version: m.version,
  };
}

/**
 * ROOM-001..004: match room. Public part for spectators; private part (readiness, chat, referee calls, lobby) for the
 * two sides and the match officials only. Lobby credentials are released only to them, only in the allowed states,
 * and every read is audited.
 */
export class RoomService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private async match(matchId: string): Promise<MatchDoc> {
    const m = await this.c.matches.findOne({ _id: matchId });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    return m;
  }
  sideOf(m: MatchDoc, actor: string): number {
    return m.sides.findIndex((s) => s.roster.some((r) => r.principalId === actor));
  }
  async isOfficial(m: MatchDoc, actor: string): Promise<boolean> {
    return this.ct.acl.can(actor, 'match.read_private', { type: 'match', id: m._id });
  }
  private async member(m: MatchDoc, actor: string): Promise<{ side: number; official: boolean }> {
    const side = this.sideOf(m, actor);
    const official = await this.isOfficial(m, actor);
    if (side < 0 && !official) throw new DomainError('FORBIDDEN', 'only the sides and the officials of this match');
    return { side, official };
  }

  async view(matchId: string, viewer: string | null) {
    const m = await this.match(matchId);
    const stage = await this.c.stages.findOne({ _id: m.stageId }, { projection: { name: 1, format: 1, presence: 1 } });
    const station = m.resources?.stationId ? await this.c.stations.findOne({ _id: m.resources.stationId }, { projection: { label: 1 } }) : null;
    const events = await this.c.matchEvents.find({ matchId, publicText: { $ne: null } }).sort({ seq: 1 }).limit(200).toArray();
    const pub = { ...publicMatch(m), stationLabel: station?.label ?? null, stage: stage ? { name: stage.name, format: stage.format, presence: stage.presence } : null, timeline: events.map((e) => ({ at: e.at, type: e.type, text: e.publicText })), serverTime: iso() };
    if (!viewer) return { public: pub, private: null };
    const side = this.sideOf(m, viewer);
    const official = await this.isOfficial(m, viewer);
    if (side < 0 && !official) return { public: pub, private: null };
    const refs = m.resources?.refereeIds?.length ? await this.c.principals.find({ _id: { $in: m.resources.refereeIds } }, { projection: { displayName: 1 } }).toArray() : [];
    return {
      public: pub,
      private: {
        side, official,
        config: m.config, ready: m.room?.ready ?? [], countdownTo: m.room?.countdownTo ?? null,
        referees: refs.map((r) => r.displayName),
        run: m.run ?? null,
        lobbyAvailable: LOBBY_STATES.includes(m.state) && (!!m.lobby || !!(await this.c.serverAllocations.findOne({ matchId, state: 'active' }, { projection: { _id: 1 } }))),
        calls: await this.c.refereeCalls.find(official ? { matchId } : { matchId, by: viewer }).sort({ createdAt: -1 }).limit(20).toArray(),
        // lineup (AWD-002 presence): own side for a member, every side for officials
        lineup: m.sides.map((s, i) => (official || i === side ? s.roster.map((r) => ({ principalId: r.principalId, displayName: r.displayName, present: !!r.present })) : null)),
        // RES-002: who submitted what and whether this viewer can confirm/contest
        result: m.result ? { deadline: m.result.deadline, policy: m.result.policy, review: m.result.review ?? null, submissions: m.result.submissions.map((x) => ({ side: x.side, source: x.source, outcome: x.outcome, at: x.at })), confirmations: m.result.confirmations.map((x) => ({ side: x.side, at: x.at })) } : null,
        openCaseId: (await this.c.disputes.findOne({ matchId, state: { $in: ['filed', 'assigned', 'defense_received', 'under_review', 'first_decision', 'appeal'] } }, { projection: { _id: 1 } }))?._id ?? null,
      },
    };
  }

  /** Officials open readiness (scheduled → awaiting readiness). */
  async openReadiness(matchId: string, actor: string, requestId: string): Promise<MatchDoc> {
    const m = await this.match(matchId);
    await this.ct.acl.require(actor, 'match.manage', { type: 'match', id: m._id }, requestId);
    const doc = (await applyTransition(matchMachine, this.c.matches, m._id, { transition: 'open_checkin', expectedVersion: m.version, actorRoles: ['event_operator'] })).doc;
    // COM-002: match check-in / readiness is open for the sides
    await this.ct.outbox.append({ type: 'competition.match.readiness_open', aggregate: { type: 'match', id: doc._id }, aggregateVersion: doc.version, actor: { principalId: actor, kind: 'user' }, payload: { matchId: doc._id, eventId: doc.eventId, principals: doc.principalIds ?? [] }, correlationId: requestId });
    return doc;
  }

  /** A side declares itself ready; when both are, the match becomes ready and the rules' countdown (if any) starts. */
  async ready(matchId: string, actor: string, requestId: string): Promise<MatchDoc> {
    const m = await this.match(matchId);
    const side = this.sideOf(m, actor);
    if (side < 0) throw new DomainError('FORBIDDEN', 'only a side of this match can declare readiness');
    if (m.state !== 'awaiting_readiness') throw new DomainError('PRECONDITION_FAILED', `readiness is not open (match is ${m.state})`);
    const r = await this.c.matches.findOneAndUpdate({ _id: m._id, state: 'awaiting_readiness', 'room.ready.side': { $ne: side } }, { $push: { 'room.ready': { side, by: actor, at: iso() } }, $set: { [`sides.${side}.roster.$[me].present`]: true }, $inc: { version: 1 } }, { returnDocument: 'after', arrayFilters: [{ 'me.principalId': actor }] }); // the declaring member is present
    if (!r) throw new DomainError('CONFLICT', 'this side is already ready');
    await this.c.matchEvents.insertOne(await this.event(r, 'ready', side, {}, actor, `side ${side + 1} ready`));
    let out = r;
    if (new Set((r.room?.ready ?? []).map((x) => x.side)).size === r.sides.length) {
      const countdown = m.rulesSnapshot?.clauses.find((c) => c.key === 'match.countdown_seconds')?.value;
      out = (await applyTransition(matchMachine, this.c.matches, r._id, { transition: 'mark_ready', expectedVersion: r.version, actorRoles: ['system'] }, { 'room.countdownTo': typeof countdown === 'number' ? new Date(Date.now() + countdown * 1000).toISOString() : null } as Partial<MatchDoc>)).doc;
    }
    await this.ct.realtime.publish({ channel: `match:${m._id}`, type: 'room.ready', audience: { kind: 'public' }, payload: { matchId: m._id, state: out.state, readySides: (out.room?.ready ?? []).map((x) => x.side), countdownTo: out.room?.countdownTo ?? null } });
    void requestId;
    return out;
  }

  /**
   * AWD-002: lineup presence. A side member sets their side's playing lineup; an official may set any side. Honors use
   * these marks (presence condition), so the lineup is locked once the result is provisional.
   */
  async setLineup(matchId: string, side: number, principalIds: string[], actor: string, requestId: string): Promise<MatchDoc> {
    const m = await this.match(matchId);
    const s = m.sides[side];
    if (!s) throw new DomainError('VALIDATION_FAILED', 'unknown side');
    const official = await this.ct.acl.can(actor, 'match.result.verify', { type: 'match', id: m._id });
    if (!official && this.sideOf(m, actor) !== side) throw new DomainError('FORBIDDEN', 'only that side or an official sets its lineup');
    if (!['awaiting_readiness', 'ready', 'pre_game_selection', 'live', 'paused'].includes(m.state)) throw new DomainError('PRECONDITION_FAILED', `the lineup is locked (match is ${m.state})`);
    const roster = new Set(s.roster.map((r) => r.principalId));
    const unknown = principalIds.filter((p) => !roster.has(p));
    if (unknown.length) throw new DomainError('VALIDATION_FAILED', `not on this side's registered roster: ${unknown.join(', ')}`);
    const r = await this.c.matches.findOneAndUpdate({ _id: m._id, version: m.version }, { $set: { [`sides.${side}.roster`]: s.roster.map((x) => ({ ...x, present: principalIds.includes(x.principalId) })) }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('VERSION_CONFLICT', 'the match changed; reload');
    await this.c.matchEvents.insertOne(await this.event(r, 'lineup', side, { principalIds }, actor, null));
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.match.lineup', target: { type: 'match', id: m._id }, scope: { type: 'match', id: m._id }, outcome: 'success', details: { side, count: principalIds.length }, requestId });
    return r;
  }

  async event(m: MatchDoc, type: string, side: number | null, detail: Record<string, unknown>, by: string, publicText: string | null) {
    const seq = await this.c.counters.findOneAndUpdate({ _id: `mev:${m._id}` }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after' });
    return { _id: newId('mev'), matchId: m._id, eventId: m.eventId, seq: (seq as unknown as { value: number }).value, type, side, detail, by, at: iso(), publicText };
  }

  async chat(matchId: string, text: string, channel: 'private' | 'officials', actor: string): Promise<MatchMessageDoc> {
    const m = await this.match(matchId);
    const { official } = await this.member(m, actor);
    const body = text.trim();
    if (!body || body.length > 1000) throw new DomainError('VALIDATION_FAILED', 'message must be 1–1000 characters');
    const recent = await this.c.matchMessages.countDocuments({ matchId, by: actor, at: { $gt: new Date(Date.now() - 60_000).toISOString() } });
    if (recent >= 20) throw new DomainError('RATE_LIMITED', 'too many messages; wait a minute');
    const doc: MatchMessageDoc = { _id: newId('msg'), matchId, channel, by: actor, text: body, at: iso(), hidden: false };
    await this.c.matchMessages.insertOne(doc);
    const audience = channel === 'officials' && !official ? [actor] : [...new Set([...m.sides.flatMap((s) => s.roster.map((r) => r.principalId)), actor])];
    await this.ct.realtime.publish({ channel: `match:${m._id}:room`, type: 'chat.message', audience: channel === 'officials' ? { kind: 'scope', scope: { type: 'match', id: m._id }, permission: 'match.read_private' } : { kind: 'principals', principalIds: audience }, payload: { id: doc._id, channel, at: doc.at } });
    return doc;
  }
  async messages(matchId: string, actor: string): Promise<MatchMessageDoc[]> {
    const m = await this.match(matchId);
    const { official } = await this.member(m, actor);
    const filter = official ? { matchId } : { matchId, $or: [{ channel: 'private' as const }, { by: actor }], hidden: false };
    return this.c.matchMessages.find(filter).sort({ at: 1 }).limit(500).toArray();
  }
  async hideMessage(messageId: string, actor: string, requestId: string): Promise<void> {
    const msg = await this.c.matchMessages.findOne({ _id: messageId });
    if (!msg) throw new DomainError('NOT_FOUND', 'message not found');
    await this.ct.acl.require(actor, 'match.manage', { type: 'match', id: msg.matchId }, requestId);
    await this.c.matchMessages.updateOne({ _id: messageId }, { $set: { hidden: true } });
  }

  async callReferee(matchId: string, reason: string, actor: string): Promise<RefereeCallDoc> {
    const m = await this.match(matchId);
    if (this.sideOf(m, actor) < 0) throw new DomainError('FORBIDDEN', 'only a side can call the referee');
    if (reason.trim().length < 3) throw new DomainError('VALIDATION_FAILED', 'say why the referee is needed');
    const doc: RefereeCallDoc = { _id: newId('rfc'), matchId, eventId: m.eventId, by: actor, reason: reason.trim(), state: 'open', ackBy: null, createdAt: iso(), closedAt: null };
    await this.c.refereeCalls.insertOne(doc);
    await this.ct.realtime.publish({ channel: `event:${m.eventId}:officials`, type: 'referee.called', audience: { kind: 'scope', scope: { type: 'match', id: m._id }, permission: 'match.result.verify' }, payload: { callId: doc._id, matchId } });
    return doc;
  }
  async updateCall(callId: string, state: 'acknowledged' | 'closed', actor: string, requestId: string): Promise<RefereeCallDoc> {
    const call = await this.c.refereeCalls.findOne({ _id: callId });
    if (!call) throw new DomainError('NOT_FOUND', 'call not found');
    await this.ct.acl.require(actor, 'match.result.verify', { type: 'match', id: call.matchId }, requestId);
    const r = await this.c.refereeCalls.findOneAndUpdate({ _id: callId, state: { $ne: 'closed' } }, { $set: { state, ackBy: actor, ...(state === 'closed' ? { closedAt: iso() } : {}) } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('ILLEGAL_TRANSITION', 'call already closed');
    return r;
  }
  async openCalls(eventId: string, actor: string, requestId: string): Promise<RefereeCallDoc[]> {
    await this.ct.acl.require(actor, 'match.read_private', { type: 'event', id: eventId }, requestId);
    return this.c.refereeCalls.find({ eventId, state: { $ne: 'closed' } }).sort({ createdAt: 1 }).limit(200).toArray();
  }

  /**
   * ROOM-004: lobby host/password for the two sides and match officials only, only while the match is ready, in
   * selection or running. Every read is audited; nothing here ever reaches a public projection.
   */
  async lobby(matchId: string, actor: string, requestId: string): Promise<{ host: string; password: string; source: 'allocation' | 'manual' }> {
    const m = await this.match(matchId);
    const side = this.sideOf(m, actor);
    // outsiders go through acl.require so a denied attempt is audited (ROOM-004, AC-17)
    if (side < 0) await this.ct.acl.require(actor, 'match.lobby.read', { type: 'match', id: m._id }, requestId);
    const official = side < 0 || (await this.ct.acl.can(actor, 'match.lobby.read', { type: 'match', id: m._id }));
    if (!official && !LOBBY_STATES.includes(m.state)) throw new DomainError('PRECONDITION_FAILED', 'lobby data is released when the match is ready');
    const alloc = await this.c.serverAllocations.findOne({ matchId, state: 'active' });
    let out: { host: string; password: string; source: 'allocation' | 'manual' } | null = null;
    if (alloc) {
      const s = await this.c.gameServers.findOne({ _id: alloc.serverId });
      if (s) out = { host: `${s.connection.host}${s.connection.port ? `:${s.connection.port}` : ''}`, password: alloc.password, source: 'allocation' };
    }
    if (!out && m.lobby) out = { host: m.lobby.host, password: m.lobby.password, source: 'manual' };
    if (!out) throw new DomainError('NOT_FOUND', 'no lobby configured');
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'match.lobby.read', target: { type: 'match', id: m._id }, scope: { type: 'match', id: m._id }, outcome: 'success', details: { side, official }, requestId });
    return out;
  }

  /** Manual lobby details by an official (SRV-004 manual path, also when no server registry or integration exists). */
  async setManualLobby(matchId: string, host: string, password: string, actor: string, requestId: string): Promise<void> {
    const m = await this.match(matchId);
    await this.ct.acl.require(actor, 'match.manage', { type: 'match', id: m._id }, requestId);
    if (!host.trim() || password.length < 4) throw new DomainError('VALIDATION_FAILED', 'host and a password of at least 4 characters are required');
    await this.c.matches.updateOne({ _id: m._id }, { $set: { lobby: { host: host.trim(), password, releasedAt: null } }, $inc: { version: 1 } });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'match.lobby.set', target: { type: 'match', id: m._id }, scope: { type: 'match', id: m._id }, outcome: 'success', details: { host: host.trim() }, requestId });
  }
}
