import { createHash, randomBytes } from 'node:crypto';
import { DomainError, type Scope } from '@esp/contracts';
import type { Container } from '../container.js';
import type { GameServerDoc, IntegrationRecordDoc, MatchOutcome, ServerAllocationDoc } from '../db/collections-esp04.js';
import { newId } from '../ids.js';

const iso = () => new Date().toISOString();
const genPassword = () => randomBytes(6).toString('base64url');

/**
 * SRV-001..004: server/lobby resource registry with atomic allocation (a server never exceeds its capacity and a match
 * holds at most one active allocation), health, switching with a recorded reason, password rotation, config templates
 * and audited release. Publisher integration (results/logs/demos) is accepted only when the configured adapter really
 * supports it for that game; raw data and provenance are kept and a disagreement with the manual result goes to review.
 * Without an integration the manual, authorized path stays fully available.
 */
export class ServerService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private scopeFor(eventId: string | null): Scope {
    return eventId ? { type: 'event', id: eventId } : { type: 'site', id: 'site' };
  }

  async create(input: Omit<GameServerDoc, '_id' | 'inUse' | 'health' | 'healthCheckedAt' | 'createdAt' | 'version'>, actor: string, requestId: string): Promise<GameServerDoc> {
    await this.ct.acl.require(actor, 'server.manage', this.scopeFor(input.eventId), requestId);
    if (input.capacity < 1) throw new DomainError('VALIDATION_FAILED', 'capacity must be at least 1');
    const doc: GameServerDoc = { ...input, _id: newId('srv'), inUse: 0, health: 'unknown', healthCheckedAt: null, createdAt: iso(), version: 0 };
    await this.c.gameServers.insertOne(doc);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'server.create', target: { type: 'server', id: doc._id }, scope: this.scopeFor(input.eventId), outcome: 'success', details: { name: doc.name, region: doc.region, capacity: doc.capacity }, requestId });
    return doc;
  }

  /** Staff listing without passwords; connection details only for server managers. */
  async list(eventId: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'match.read_private', { type: 'event', id: eventId }, requestId);
    const manager = await this.ct.acl.can(actor, 'server.manage', { type: 'event', id: eventId });
    const servers = await this.c.gameServers.find({ $or: [{ eventId }, { eventId: null }] }).sort({ name: 1 }).toArray();
    return servers.map((s) => ({ ...s, connection: manager ? s.connection : null }));
  }

  /** SRV-001 health: an operator records it (no probe pretends to know); the integration probe is used only if real. */
  async setHealth(serverId: string, health: GameServerDoc['health'], enabled: boolean, actor: string, requestId: string): Promise<GameServerDoc> {
    const s = await this.c.gameServers.findOne({ _id: serverId });
    if (!s) throw new DomainError('NOT_FOUND', 'server not found');
    await this.ct.acl.require(actor, 'server.manage', this.scopeFor(s.eventId), requestId);
    const r = await this.c.gameServers.findOneAndUpdate({ _id: serverId }, { $set: { health, enabled, healthCheckedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'server.health', target: { type: 'server', id: serverId }, scope: this.scopeFor(s.eventId), outcome: 'success', details: { health, enabled }, requestId });
    return r!;
  }

  /**
   * Atomic allocation: manual (given server) or automatic (healthy, enabled, same game, preferred region, event pool
   * first). Capacity is reserved with a conditional increment; the unique active-allocation index stops double booking.
   */
  async allocate(matchId: string, serverId: string | null, reason: string, actor: string, requestId: string): Promise<ServerAllocationDoc> {
    const m = await this.c.matches.findOne({ _id: matchId });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    await this.ct.acl.require(actor, 'server.manage', { type: 'event', id: m.eventId }, requestId);
    if (['final', 'cancelled'].includes(m.state)) throw new DomainError('PRECONDITION_FAILED', `match is ${m.state}`);
    if (await this.c.serverAllocations.findOne({ matchId, state: 'active' })) throw new DomainError('CONFLICT', 'match already holds a server; use switch');
    const discipline = await this.c.disciplines.findOne({ _id: m.disciplineId }, { projection: { gameId: 1 } });
    const filter = serverId
      ? { _id: serverId }
      : { gameId: discipline?.gameId ?? '', enabled: true, health: 'healthy' as const, $or: [{ eventId: m.eventId }, { eventId: null }], ...(m.config?.serverRegion ? { region: m.config.serverRegion } : {}) };
    const candidates = await this.c.gameServers.find(filter).sort({ eventId: -1, inUse: 1, name: 1 }).toArray();
    for (const s of candidates) {
      if (!s.enabled || s.health === 'down' || (s.health === 'unknown' && !serverId)) continue;
      if (s.eventId && s.eventId !== m.eventId) continue;
      const taken = await this.c.gameServers.findOneAndUpdate({ _id: s._id, enabled: true, $expr: { $lt: ['$inUse', '$capacity'] } }, { $inc: { inUse: 1, version: 1 } }, { returnDocument: 'after' });
      if (!taken) continue;
      const alloc: ServerAllocationDoc = { _id: newId('sal'), serverId: s._id, matchId, eventId: m.eventId, password: genPassword(), state: 'active', reason, by: actor, at: iso(), releasedAt: null };
      try {
        await this.c.serverAllocations.insertOne(alloc);
      } catch (e) {
        await this.c.gameServers.updateOne({ _id: s._id }, { $inc: { inUse: -1 } }); // compensate the reservation
        if ((e as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'match was allocated concurrently');
        throw e;
      }
      await this.c.matches.updateOne({ _id: matchId }, { $set: { 'resources.serverId': s._id }, $inc: { version: 1 } });
      await this.ct.audit.append({ actorPrincipalId: actor, action: 'server.allocate', target: { type: 'match', id: matchId }, scope: { type: 'event', id: m.eventId }, outcome: 'success', details: { serverId: s._id, auto: !serverId, reason }, requestId });
      return alloc;
    }
    throw new DomainError('PRECONDITION_FAILED', serverId ? 'that server is full, disabled or down' : 'no healthy server with free capacity; allocate manually or set lobby details by hand');
  }

  async release(matchId: string, reason: string, actor: string, requestId: string): Promise<boolean> {
    const a = await this.c.serverAllocations.findOneAndUpdate({ matchId, state: 'active' }, { $set: { state: 'released', releasedAt: iso() } }, { returnDocument: 'before' });
    if (!a) return false;
    await this.c.gameServers.updateOne({ _id: a.serverId, inUse: { $gt: 0 } }, { $inc: { inUse: -1, version: 1 } });
    await this.c.matches.updateOne({ _id: matchId }, { $set: { 'resources.serverId': null } });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'server.release', target: { type: 'match', id: matchId }, scope: { type: 'event', id: a.eventId }, outcome: 'success', details: { serverId: a.serverId, reason }, requestId });
    return true;
  }

  /** SRV-002: switch with a recorded reason (old capacity freed exactly once, new one reserved atomically). */
  async switch(matchId: string, toServerId: string | null, reason: string, actor: string, requestId: string): Promise<ServerAllocationDoc> {
    if (reason.trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'a server switch needs a reason');
    const m = await this.c.matches.findOne({ _id: matchId });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    await this.ct.acl.require(actor, 'server.manage', { type: 'event', id: m.eventId }, requestId);
    await this.release(matchId, `switch: ${reason}`, actor, requestId);
    return this.allocate(matchId, toServerId, `switch: ${reason}`, actor, requestId);
  }

  async rotatePassword(matchId: string, actor: string, requestId: string): Promise<void> {
    const a = await this.c.serverAllocations.findOne({ matchId, state: 'active' });
    if (!a) throw new DomainError('NOT_FOUND', 'match has no active server allocation');
    await this.ct.acl.require(actor, 'server.manage', { type: 'event', id: a.eventId }, requestId);
    await this.c.serverAllocations.updateOne({ _id: a._id }, { $set: { password: genPassword() } });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'server.password.rotate', target: { type: 'match', id: matchId }, scope: { type: 'event', id: a.eventId }, outcome: 'success', details: { serverId: a.serverId }, requestId });
  }

  /** The configuration template an operator applies on the game server for this match (no secrets). */
  async template(matchId: string, actor: string, requestId: string): Promise<Record<string, string | number | boolean>> {
    const a = await this.c.serverAllocations.findOne({ matchId, state: 'active' });
    if (!a) throw new DomainError('NOT_FOUND', 'match has no active server allocation');
    await this.ct.acl.require(actor, 'server.manage', { type: 'event', id: a.eventId }, requestId);
    const s = await this.c.gameServers.findOne({ _id: a.serverId });
    const m = await this.c.matches.findOne({ _id: matchId }, { projection: { config: 1 } });
    return { ...(s?.configTemplate ?? {}), mode: m?.config?.mode ?? '', bestOf: m?.config?.bestOf ?? 0, gameVersion: m?.config?.gameVersion ?? '' };
  }

  /** SRV-003: whether results/logs/demos may be ingested for this game (real, permitted capability only). */
  async integrationStatus(gameId: string): Promise<{ enabled: boolean; adapter: string; detail: string }> {
    const p = this.ct.adapters.publisher;
    const av = await p.availability(gameId);
    const enabled = av.status !== 'unavailable' && p.capabilities.includes('results');
    return { enabled, adapter: p.name, detail: enabled ? av.detail : `${av.detail}; manual result entry remains available (SRV-004)` };
  }

  /**
   * Stores raw integration data with its provenance (deduplicated by content hash). A result that disagrees with the
   * manual/official one is never applied automatically — it opens a review item.
   */
  async ingest(matchId: string, kind: IntegrationRecordDoc['kind'], raw: Record<string, unknown>, fileId: string | null, actor: string, requestId: string): Promise<IntegrationRecordDoc> {
    const m = await this.c.matches.findOne({ _id: matchId });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    await this.ct.acl.require(actor, 'server.manage', { type: 'event', id: m.eventId }, requestId);
    const discipline = await this.c.disciplines.findOne({ _id: m.disciplineId }, { projection: { gameId: 1 } });
    const status = await this.integrationStatus(discipline?.gameId ?? '');
    if (!status.enabled) throw new DomainError('PROVIDER_UNAVAILABLE', `integration not available for this game: ${status.detail}`);
    const rawHash = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
    const official = m.state === 'final' ? m.outcome : null;
    const claimed = (raw['outcome'] as MatchOutcome | undefined) ?? null;
    const compared: IntegrationRecordDoc['comparedWithManual'] = !official || !claimed ? 'pending' : JSON.stringify(official) === JSON.stringify(claimed) ? 'match' : 'mismatch';
    const doc: IntegrationRecordDoc = { _id: newId('itg'), matchId, source: status.adapter, kind, raw, rawHash, fileId, receivedAt: iso(), comparedWithManual: compared };
    try {
      await this.c.integrationRecords.insertOne(doc);
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return (await this.c.integrationRecords.findOne({ rawHash }))!;
      throw e;
    }
    if (compared === 'mismatch') await this.c.reviewItems.insertOne({ _id: newId('rvw'), eventId: m.eventId, kind: 'integration_mismatch', ref: { type: 'match', id: matchId }, detail: { integrationRecordId: doc._id, official, claimed }, state: 'open', resolution: null, resolvedBy: null, createdAt: iso(), resolvedAt: null });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'integration.ingest', target: { type: 'match', id: matchId }, scope: { type: 'event', id: m.eventId }, outcome: 'success', details: { kind, compared, rawHash }, requestId });
    return doc;
  }
}
