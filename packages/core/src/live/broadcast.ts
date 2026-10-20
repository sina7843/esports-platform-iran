import { createHash, randomBytes } from 'node:crypto';
import { DomainError, type Role } from '@esp/contracts';
import type { Container } from '../container.js';
import type { BroadcastStreamDoc, CrewAssignmentDoc, MediaItemDoc, OverlayTokenDoc } from '../db/collections-esp06.js';
import { newId } from '../ids.js';
import { clean } from '../news/news.js';
import { cutoffOf, liveAudience, projectMatches, type View } from './policy.js';

const iso = () => new Date().toISOString();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const httpsUrl = (u: string) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * CAST-001..008: streams per discipline/stage/language with primary/fallback, status and next programme; crew
 * appointments; VOD/highlight/interview archive tied to matches; and broadcast graphics through limited, hashed,
 * expiring overlay tokens. An overlay is either "synced to stream" (server cutoff = now − stream delay) or
 * explicitly "latest result"; both carry that label. Private data (lobby, roster ids, evidence) never enters it.
 */
export class BroadcastService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private scope(eventId: string) {
    return { type: 'event' as const, id: eventId };
  }

  async addStream(eventId: string, input: { disciplineId: string | null; stageId: string | null; language: string; label: string; streamKey: string; role: BroadcastStreamDoc['role']; delaySeconds: number; nextProgramme: BroadcastStreamDoc['nextProgramme'] }, actor: string, requestId: string): Promise<BroadcastStreamDoc> {
    await this.ct.acl.require(actor, 'broadcast.manage', this.scope(eventId), requestId);
    if (!Number.isInteger(input.delaySeconds) || input.delaySeconds < 0 || input.delaySeconds > 3600) throw new DomainError('VALIDATION_FAILED', 'delay is 0..3600 seconds');
    if (input.disciplineId && !(await this.c.disciplines.findOne({ _id: input.disciplineId, eventId }))) throw new DomainError('VALIDATION_FAILED', 'discipline is not part of this event');
    const doc: BroadcastStreamDoc = { _id: newId('stm'), eventId, disciplineId: input.disciplineId, stageId: input.stageId, language: clean(input.language, 10) || 'fa', label: clean(input.label, 80), provider: this.ct.adapters.video.name, streamKey: clean(input.streamKey, 200), role: input.role, status: 'scheduled', delaySeconds: input.delaySeconds, nextProgramme: input.nextProgramme, createdBy: actor, createdAt: iso(), updatedAt: iso(), version: 0 };
    await this.c.broadcastStreams.insertOne(doc);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'broadcast.stream.add', target: { type: 'stream', id: doc._id }, scope: this.scope(eventId), outcome: 'success', details: { delaySeconds: doc.delaySeconds, role: doc.role }, requestId });
    return doc;
  }
  /** Status, next programme and delay changes; a delay change is audited because it moves every synced view. */
  async updateStream(id: string, input: { status?: BroadcastStreamDoc['status'] | undefined; nextProgramme?: BroadcastStreamDoc['nextProgramme'] | undefined; delaySeconds?: number | undefined; label?: string | undefined; expectedVersion: number }, actor: string, requestId: string): Promise<BroadcastStreamDoc> {
    const s = await this.c.broadcastStreams.findOne({ _id: id });
    if (!s) throw new DomainError('NOT_FOUND', 'stream not found');
    await this.ct.acl.require(actor, 'broadcast.manage', this.scope(s.eventId), requestId);
    if (input.delaySeconds !== undefined && (!Number.isInteger(input.delaySeconds) || input.delaySeconds < 0 || input.delaySeconds > 3600)) throw new DomainError('VALIDATION_FAILED', 'delay is 0..3600 seconds');
    const set: Partial<BroadcastStreamDoc> = { updatedAt: iso() };
    if (input.status) set.status = input.status;
    if (input.nextProgramme !== undefined) set.nextProgramme = input.nextProgramme;
    if (input.delaySeconds !== undefined) set.delaySeconds = input.delaySeconds;
    if (input.label) set.label = clean(input.label, 80);
    const r = await this.c.broadcastStreams.findOneAndUpdate({ _id: id, version: input.expectedVersion }, { $set: set, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('VERSION_CONFLICT', 'the stream changed; reload');
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'broadcast.stream.update', target: { type: 'stream', id }, scope: this.scope(s.eventId), outcome: 'success', details: { ...input }, requestId });
    const audience = await liveAudience(this.c, s.eventId);
    await this.ct.realtime.publish({ channel: `live:${s.eventId}:latest`, type: 'streams.changed', audience, payload: { streamId: id, status: r.status } });
    for (const d of new Set([0, s.delaySeconds, r.delaySeconds])) await this.ct.realtime.publish({ channel: `live:${s.eventId}:d${d}`, type: 'streams.changed', audience, payload: { streamId: id, status: r.status } });
    return r;
  }
  async streams(eventId: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'broadcast.read', this.scope(eventId), requestId).catch(async () => this.ct.acl.require(actor, 'broadcast.manage', this.scope(eventId), requestId));
    return this.c.broadcastStreams.find({ eventId }).toArray();
  }

  async assignCrew(eventId: string, input: { principalId: string; role: CrewAssignmentDoc['role']; matchId: string | null; streamId: string | null }, actor: string, requestId: string): Promise<CrewAssignmentDoc> {
    await this.ct.acl.require(actor, 'broadcast.manage', this.scope(eventId), requestId);
    if (!(await this.c.principals.findOne({ _id: input.principalId, status: 'active' }))) throw new DomainError('NOT_FOUND', 'principal not found');
    if (input.matchId && !(await this.c.matches.findOne({ _id: input.matchId, eventId }))) throw new DomainError('VALIDATION_FAILED', 'match is not part of this event');
    const grant = await this.ct.acl.grant({ principalId: input.principalId, role: 'broadcast_crew' as Role, scope: this.scope(eventId), expiresAt: null, reason: `broadcast crew: ${input.role}` }, { principalId: actor, requestId });
    const doc: CrewAssignmentDoc = { _id: newId('crw'), eventId, matchId: input.matchId, streamId: input.streamId, principalId: input.principalId, role: input.role, grantId: grant._id, active: true, createdBy: actor, createdAt: iso() };
    try {
      await this.c.crewAssignments.insertOne(doc);
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'already assigned in this role');
      throw e;
    }
    return doc;
  }
  async endCrew(id: string, actor: string, requestId: string) {
    const a = await this.c.crewAssignments.findOne({ _id: id, active: true });
    if (!a) throw new DomainError('NOT_FOUND', 'assignment not found');
    await this.ct.acl.require(actor, 'broadcast.manage', this.scope(a.eventId), requestId);
    await this.c.crewAssignments.updateOne({ _id: id }, { $set: { active: false } });
    if (a.grantId && !(await this.c.crewAssignments.findOne({ principalId: a.principalId, eventId: a.eventId, active: true }))) await this.ct.acl.revoke(a.grantId, { principalId: actor, requestId }, 'crew assignment ended').catch(() => undefined);
  }
  async crew(eventId: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'broadcast.read', this.scope(eventId), requestId).catch(async () => this.ct.acl.require(actor, 'broadcast.manage', this.scope(eventId), requestId));
    return this.c.crewAssignments.find({ eventId, active: true }).toArray();
  }

  /** CAST-008: archive items tied to a match and a time; spoiler items wait for the synced cutoff. */
  async addMedia(eventId: string, input: { kind: MediaItemDoc['kind']; title: string; url: string | null; fileId: string | null; matchId: string | null; streamId: string | null; offsetSeconds: number | null; occurredAt: string | null; spoiler: boolean }, actor: string, requestId: string): Promise<MediaItemDoc> {
    if (!(await this.ct.acl.can(actor, 'broadcast.manage', this.scope(eventId)))) await this.ct.acl.require(actor, 'news.publish', this.scope(eventId), requestId);
    if (!input.url && !input.fileId) throw new DomainError('VALIDATION_FAILED', 'a video item needs a provider URL or a file');
    if (input.url && !httpsUrl(input.url)) throw new DomainError('VALIDATION_FAILED', 'video URL must be https on an approved provider');
    const m = input.matchId ? await this.c.matches.findOne({ _id: input.matchId, eventId }) : null;
    if (input.matchId && !m) throw new DomainError('VALIDATION_FAILED', 'match is not part of this event');
    const doc: MediaItemDoc = { _id: newId('vid'), eventId, matchId: input.matchId, streamId: input.streamId, kind: input.kind, title: clean(input.title, 200), url: input.url, fileId: input.fileId, offsetSeconds: input.offsetSeconds, occurredAt: input.occurredAt ?? m?.run?.endedAt ?? iso(), spoiler: input.spoiler, createdBy: actor, createdAt: iso() };
    await this.c.mediaItems.insertOne(doc);
    return doc;
  }

  // ------------------------------------------------------------------ overlays (CAST-004..006)
  async createOverlay(eventId: string, input: { streamId: string | null; mode: OverlayTokenDoc['mode']; widgets: OverlayTokenDoc['widgets']; matchId: string | null; label: string; hours: number }, actor: string, requestId: string): Promise<{ token: string; overlay: Omit<OverlayTokenDoc, 'tokenHash'> }> {
    await this.ct.acl.require(actor, 'broadcast.manage', this.scope(eventId), requestId);
    if (input.mode === 'synced' && !input.streamId) throw new DomainError('VALIDATION_FAILED', 'a synced overlay follows one stream');
    if (input.streamId && !(await this.c.broadcastStreams.findOne({ _id: input.streamId, eventId }))) throw new DomainError('NOT_FOUND', 'stream not found');
    if (!(input.hours >= 1 && input.hours <= 168)) throw new DomainError('VALIDATION_FAILED', 'an overlay token lives 1..168 hours');
    const token = randomBytes(24).toString('base64url');
    const doc: OverlayTokenDoc = { _id: newId('ovl'), eventId, streamId: input.streamId, mode: input.mode, widgets: [...new Set(input.widgets)], matchId: input.matchId, label: clean(input.label, 80), tokenHash: sha(token), expiresAt: new Date(Date.now() + input.hours * 3600_000).toISOString(), revokedAt: null, createdBy: actor, createdAt: iso() };
    await this.c.overlayTokens.insertOne(doc);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'broadcast.overlay.create', target: { type: 'overlay', id: doc._id }, scope: this.scope(eventId), outcome: 'success', details: { mode: doc.mode, widgets: doc.widgets }, requestId });
    const { tokenHash: _h, ...overlay } = doc;
    return { token, overlay };
  }
  async revokeOverlay(id: string, actor: string, requestId: string) {
    const o = await this.c.overlayTokens.findOne({ _id: id });
    if (!o) throw new DomainError('NOT_FOUND', 'overlay not found');
    await this.ct.acl.require(actor, 'broadcast.manage', this.scope(o.eventId), requestId);
    await this.c.overlayTokens.updateOne({ _id: id, revokedAt: null }, { $set: { revokedAt: iso() } });
  }
  async overlays(eventId: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'broadcast.manage', this.scope(eventId), requestId);
    return (await this.c.overlayTokens.find({ eventId }).sort({ createdAt: -1 }).toArray()).map(({ tokenHash: _h, ...o }) => o);
  }

  /** The overlay data as visible in its mode now. The token is the only credential; it grants nothing else. */
  async overlayState(token: string, now = new Date()) {
    const o = await this.c.overlayTokens.findOne({ tokenHash: sha(token) });
    if (!o || o.revokedAt || Date.parse(o.expiresAt) < now.getTime()) throw new DomainError('NOT_FOUND', 'overlay not found');
    const s = o.streamId ? await this.c.broadcastStreams.findOne({ _id: o.streamId }) : null;
    const v: View = o.mode === 'latest' ? { kind: 'latest', streamId: null, delaySeconds: 0 } : { kind: 'synced', streamId: o.streamId, delaySeconds: s?.delaySeconds ?? 0 };
    const cutoff = cutoffOf(v, now);
    const e = (await this.c.events.findOne({ _id: o.eventId }))!;
    let match = o.matchId ? await this.c.matches.findOne({ _id: o.matchId }) : null;
    if (!match) {
      // current match in this view: started by the cutoff, newest first
      match = await this.c.matches.findOne({ eventId: o.eventId, 'run.startedAt': { $ne: null, $lte: cutoff } }, { sort: { 'run.startedAt': -1 } });
    }
    const [pm] = match ? await projectMatches(this.c, [match], v, now) : [];
    const out: Record<string, unknown> = { label: o.mode === 'latest' ? 'latest_result' : 'synced_to_stream', delaySeconds: v.delaySeconds, serverTime: now.toISOString(), event: { name: e.name } };
    if (o.widgets.includes('scoreboard')) out['scoreboard'] = pm ? { sides: pm.sides.map((x) => x.displayName), state: pm.state, outcome: pm.outcome, provisional: pm.provisional } : null;
    if (o.widgets.includes('lineup') && match && pm) out['lineup'] = match.sides.map((sd, i) => (pm.sides[i]?.participationId ? { name: sd.displayName, players: sd.roster.map((r) => r.displayName) } : null));
    if (o.widgets.includes('veto') && match) {
      const sel = await this.c.selections.findOne({ _id: match._id });
      out['veto'] = sel ? sel.actions.filter((a) => a.at <= cutoff).map((a) => ({ kind: a.kind, side: a.side, value: a.value })) : [];
    }
    if (o.widgets.includes('bracket') && match) out['bracket'] = (await projectMatches(this.c, await this.c.matches.find({ stageId: match.stageId }).sort({ 'slot.round': 1, 'slot.order': 1 }).toArray(), v, now)).map((m) => ({ slot: m.slot, sides: m.sides.map((x) => x.displayName), state: m.state, outcome: m.outcome }));
    if (o.widgets.includes('sponsor') || o.widgets.includes('logo')) {
      const org = await this.c.organizations.findOne({ _id: e.organizerOrgId }, { projection: { name: 1, sponsors: 1, logoFileId: 1 } });
      const fileIds = [org?.logoFileId, e.config.posterFileId, ...(org?.sponsors ?? []).map((x) => x.logoFileId)].filter((x): x is string => !!x);
      const urls = new Map((await this.c.files.find({ _id: { $in: fileIds }, visibility: 'public' }, { projection: { publicUrl: 1 } }).toArray()).map((f) => [f._id, f.publicUrl]));
      if (o.widgets.includes('logo')) out['logo'] = { organizer: org?.name ?? null, logoUrl: org?.logoFileId ? (urls.get(org.logoFileId) ?? null) : null, posterUrl: e.config.posterFileId ? (urls.get(e.config.posterFileId) ?? null) : null };
      if (o.widgets.includes('sponsor')) out['sponsors'] = (org?.sponsors ?? []).map((x) => ({ name: x.name, logoUrl: x.logoFileId ? (urls.get(x.logoFileId) ?? null) : null, label: 'sponsor' }));
    }
    return out;
  }
}
