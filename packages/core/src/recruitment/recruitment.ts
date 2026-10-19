import type { ClientSession } from 'mongodb';
import { decodeCursor, DomainError, encodeCursor, type Scope } from '@esp/contracts';
import { z } from 'zod';
import type { Container } from '../container.js';
import type { RecruitmentAdDoc, RecruitmentApplicationDoc, ScrimDoc } from '../db/collections-esp02.js';
import type { TeamDoc } from '../db/collections.js';
import { newId } from '../ids.js';
import { isBlockedEither } from '../social/social.js';
import { TeamService } from '../teams/teams.js';

/** REC-001..005: recruitment ads, applications, looking-for-team list, scrim requests and friendly results. */

const teamScope = (id: string): Scope => ({ type: 'team', id });
const now = () => new Date().toISOString();
const KIND_ROLE = { player: 'player', coach: 'coach', analyst: 'analyst', manager: 'manager' } as const;

const DECISIONS = {
  invite_tryout: { from: ['applied', 'under_review'], to: 'tryout_invited' },
  start_review: { from: ['applied', 'tryout_invited'], to: 'under_review' },
  accept: { from: ['applied', 'tryout_invited', 'under_review'], to: 'accepted' },
  reject: { from: ['applied', 'tryout_invited', 'under_review'], to: 'rejected' },
} as const;

const AdCursor = z.object({ c: z.string(), i: z.string() });
const ScrimCursor = z.object({ w: z.string(), i: z.string() });
const LftCursor = z.object({ i: z.string() });

function iso(v: string, what: string): string {
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new DomainError('VALIDATION_FAILED', `${what} must be an ISO instant`);
  return new Date(t).toISOString();
}

export class RecruitmentService {
  private readonly teams: TeamService;
  constructor(private readonly ct: Container) {
    this.teams = new TeamService(ct);
  }
  private get c() {
    return this.ct.c;
  }
  private async au(s: ClientSession, actor: string, action: string, target: { type: string; id: string }, scope: Scope, details: Record<string, unknown>, rid: string) {
    await this.ct.audit.append({ actorPrincipalId: actor, action, target, scope, outcome: 'success', details, requestId: rid }, s);
  }
  private async ev(s: ClientSession, type: string, aggregate: { type: string; id: string }, version: number, actor: string, payload: Record<string, unknown>, rid: string) {
    await this.ct.outbox.append({ type, aggregate, aggregateVersion: version, actor: { principalId: actor, kind: 'user' }, payload, correlationId: rid }, s);
  }
  private async fileUrl(fileId: string | null): Promise<string | null> {
    if (!fileId) return null;
    const f = await this.ct.files.get(fileId);
    return f && f.visibility === 'public' && !f.quarantined ? f.publicUrl : null;
  }
  private async teamCard(t: TeamDoc) {
    return { id: t._id, name: t.name, tag: t.tag, logoUrl: await this.fileUrl(t.logoFileId) };
  }

  // ---------------------------------------------------------------- ads (REC-001)
  async adView(a: RecruitmentAdDoc) {
    const team = await this.c.teams.findOne({ _id: a.teamId });
    return { id: a._id, team: team ? await this.teamCard(team) : null, kind: a.kind, gameId: a.gameId, role: a.role, level: a.level, city: a.city, activityHours: a.activityHours, description: a.description, state: a.state, createdAt: a.createdAt, closedAt: a.closedAt, version: a.version };
  }

  async createAd(me: string, teamId: string, input: Omit<RecruitmentAdDoc, '_id' | 'teamId' | 'state' | 'createdBy' | 'createdAt' | 'closedAt' | 'version'>, rid: string) {
    await this.ct.acl.require(me, 'recruitment.manage', teamScope(teamId), rid);
    const team = await this.teams.getTeam(teamId);
    if (team.gameId !== input.gameId) throw new DomainError('VALIDATION_FAILED', 'the ad game must match the team game');
    const doc: RecruitmentAdDoc = { _id: newId('rad'), teamId, ...input, state: 'open', createdBy: me, createdAt: now(), closedAt: null, version: 0 };
    await this.ct.dbh.withTransaction(async (s) => {
      await this.c.recruitmentAds.insertOne(doc, { session: s });
      await this.au(s, me, 'recruitment.ad.create', { type: 'recruitment_ad', id: doc._id }, teamScope(teamId), { kind: doc.kind, gameId: doc.gameId }, rid);
      await this.ev(s, 'recruitment.ad.created', { type: 'recruitment_ad', id: doc._id }, 0, me, { teamId, kind: doc.kind, gameId: doc.gameId }, rid);
    });
    return doc;
  }

  async closeAd(me: string, adId: string, rid: string) {
    const ad = await this.c.recruitmentAds.findOne({ _id: adId });
    if (!ad) throw new DomainError('NOT_FOUND', 'ad not found');
    await this.ct.acl.require(me, 'recruitment.manage', teamScope(ad.teamId), rid);
    return this.ct.dbh.withTransaction(async (s) => {
      // pending applications are intentionally left untouched and stay visible to the team
      const r = await this.c.recruitmentAds.findOneAndUpdate({ _id: adId, state: 'open' }, { $set: { state: 'closed', closedAt: now() }, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
      if (!r) throw new DomainError('CONFLICT', 'ad is already closed');
      await this.au(s, me, 'recruitment.ad.close', { type: 'recruitment_ad', id: adId }, teamScope(ad.teamId), {}, rid);
      await this.ev(s, 'recruitment.ad.closed', { type: 'recruitment_ad', id: adId }, r.version, me, { teamId: ad.teamId }, rid);
      return r;
    });
  }

  async getAd(adId: string) {
    const ad = await this.c.recruitmentAds.findOne({ _id: adId });
    if (!ad) throw new DomainError('NOT_FOUND', 'ad not found');
    return this.adView(ad);
  }

  async listAds(f: { gameId?: string | undefined; kind?: string | undefined; role?: string | undefined; level?: string | undefined; city?: string | undefined; limit: number; cursor?: string | undefined }) {
    const q: Record<string, unknown> = { state: 'open' };
    for (const k of ['gameId', 'kind', 'role', 'level', 'city'] as const) if (f[k]) q[k] = f[k];
    const cur = decodeCursor(f.cursor, AdCursor);
    if (f.cursor && !cur) throw new DomainError('VALIDATION_FAILED', 'invalid cursor');
    if (cur) q['$or'] = [{ createdAt: { $lt: cur.c } }, { createdAt: cur.c, _id: { $lt: cur.i } }];
    const rows = await this.c.recruitmentAds.find(q).sort({ createdAt: -1, _id: -1 }).limit(f.limit + 1).toArray();
    const page = rows.slice(0, f.limit);
    const last = page[page.length - 1];
    return { items: await Promise.all(page.map((a) => this.adView(a))), nextCursor: rows.length > f.limit && last ? encodeCursor({ c: last.createdAt, i: last._id }) : null };
  }

  async teamAds(me: string, teamId: string, rid: string) {
    await this.ct.acl.require(me, 'recruitment.manage', teamScope(teamId), rid);
    const rows = await this.c.recruitmentAds.find({ teamId }).sort({ createdAt: -1 }).limit(200).toArray();
    return Promise.all(rows.map((a) => this.adView(a)));
  }

  // ---------------------------------------------------------------- applications (REC-002)
  appView(a: RecruitmentApplicationDoc, nickname?: string | null) {
    return { id: a._id, adId: a.adId, teamId: a.teamId, principalId: a.principalId, nickname: nickname ?? null, message: a.message, state: a.state, history: a.history, createdAt: a.createdAt, version: a.version };
  }

  async apply(me: string, adId: string, message: string | null, rid: string) {
    const ad = await this.c.recruitmentAds.findOne({ _id: adId });
    if (!ad || (await isBlockedEither(this.c, me, ad.createdBy))) throw new DomainError('NOT_FOUND', 'ad not found');
    if (ad.state !== 'open') throw new DomainError('PRECONDITION_FAILED', 'this ad is closed');
    if (await this.c.teamMemberships.findOne({ teamId: ad.teamId, principalId: me, to: null }, { projection: { _id: 1 } })) throw new DomainError('CONFLICT', 'you are already a member of this team');
    const t = now();
    const doc: RecruitmentApplicationDoc = { _id: newId('rap'), adId, teamId: ad.teamId, principalId: me, message, state: 'applied', history: [{ state: 'applied', by: me, at: t, note: null }], createdAt: t, version: 0 };
    try {
      await this.ct.dbh.withTransaction(async (s) => {
        await this.c.recruitmentApplications.insertOne(doc, { session: s });
        await this.au(s, me, 'recruitment.application.create', { type: 'recruitment_ad', id: adId }, teamScope(ad.teamId), { applicationId: doc._id }, rid);
        await this.ev(s, 'recruitment.application.created', { type: 'recruitment_application', id: doc._id }, 0, me, { adId, teamId: ad.teamId }, rid);
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'you already applied to this ad');
      throw err;
    }
    return doc;
  }

  async withdraw(me: string, appId: string, rid: string) {
    const a = await this.c.recruitmentApplications.findOne({ _id: appId });
    if (!a || a.principalId !== me) throw new DomainError('NOT_FOUND', 'application not found');
    if (['accepted', 'rejected', 'withdrawn'].includes(a.state)) throw new DomainError('ILLEGAL_TRANSITION', `application is ${a.state}`);
    return this.ct.dbh.withTransaction(async (s) => {
      const r = await this.c.recruitmentApplications.findOneAndUpdate({ _id: appId, state: a.state }, { $set: { state: 'withdrawn' }, $push: { history: { state: 'withdrawn', by: me, at: now(), note: null } }, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
      if (!r) throw new DomainError('VERSION_CONFLICT', 'application was modified');
      await this.au(s, me, 'recruitment.application.withdraw', { type: 'recruitment_ad', id: a.adId }, teamScope(a.teamId), { applicationId: appId }, rid);
      return r;
    });
  }

  async myApplications(me: string) {
    return (await this.c.recruitmentApplications.find({ principalId: me }).sort({ createdAt: -1 }).limit(100).toArray()).map((a) => this.appView(a));
  }

  async listApplications(me: string, adId: string, rid: string) {
    const ad = await this.c.recruitmentAds.findOne({ _id: adId });
    if (!ad) throw new DomainError('NOT_FOUND', 'ad not found');
    await this.ct.acl.require(me, 'recruitment.manage', teamScope(ad.teamId), rid);
    const rows = await this.c.recruitmentApplications.find({ adId }).sort({ createdAt: 1 }).toArray();
    const profiles = await this.c.profiles.find({ _id: { $in: rows.map((r) => r.principalId) } }, { projection: { nickname: 1 } }).toArray();
    return { adState: ad.state, items: rows.map((r) => this.appView(r, profiles.find((p) => p._id === r.principalId)?.nickname)) };
  }

  /** accept = create a team invitation the player must still accept; it never adds the member directly. */
  async decide(me: string, appId: string, input: { action: keyof typeof DECISIONS; note: string | null; expectedVersion: number }, rid: string) {
    const a = await this.c.recruitmentApplications.findOne({ _id: appId });
    if (!a) throw new DomainError('NOT_FOUND', 'application not found');
    await this.ct.acl.require(me, 'recruitment.manage', teamScope(a.teamId), rid);
    const rule = DECISIONS[input.action];
    if (a.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'application was modified', { currentVersion: a.version });
    if (!(rule.from as readonly string[]).includes(a.state)) throw new DomainError('ILLEGAL_TRANSITION', `cannot ${input.action} an application that is ${a.state}`);
    const ad = await this.c.recruitmentAds.findOne({ _id: a.adId });
    return this.ct.dbh.withTransaction(async (s) => {
      const r = await this.c.recruitmentApplications.findOneAndUpdate({ _id: appId, version: input.expectedVersion }, { $set: { state: rule.to }, $push: { history: { state: rule.to, by: me, at: now(), note: input.note } }, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
      if (!r) throw new DomainError('VERSION_CONFLICT', 'application was modified');
      let invitationId: string | null = null;
      if (input.action === 'accept') {
        const inv = await this.teams.createInvitation(me, a.teamId, { principalId: a.principalId, role: KIND_ROLE[ad?.kind ?? 'player'], message: input.note }, rid, s);
        invitationId = inv._id;
      }
      await this.au(s, me, `recruitment.application.${input.action}`, { type: 'recruitment_ad', id: a.adId }, teamScope(a.teamId), { applicationId: appId, invitationId }, rid);
      await this.ev(s, 'recruitment.application.decided', { type: 'recruitment_application', id: appId }, r.version, me, { adId: a.adId, teamId: a.teamId, principalId: a.principalId, state: rule.to, invitationId }, rid);
      return { application: r, invitationId };
    });
  }

  // ---------------------------------------------------------------- looking for team (REC-003)
  /** Public projection only: no real name, phone, e-mail or fields the player kept private. */
  async lookingForTeam(f: { gameId?: string | undefined; city?: string | undefined; limit: number; cursor?: string | undefined }, viewerId: string | null) {
    const q: Record<string, unknown> = { 'lookingForTeam.active': true };
    if (f.gameId) q['lookingForTeam.gameIds'] = f.gameId;
    if (f.city) q['city'] = f.city;
    const cur = decodeCursor(f.cursor, LftCursor);
    if (f.cursor && !cur) throw new DomainError('VALIDATION_FAILED', 'invalid cursor');
    if (cur) q['_id'] = { $gt: cur.i };
    const rows = await this.c.profiles.find(q).sort({ _id: 1 }).limit(f.limit + 1).toArray();
    const page = rows.slice(0, f.limit);
    const active = new Set((await this.c.principals.find({ _id: { $in: page.map((p) => p._id) }, status: 'active' }, { projection: { _id: 1 } }).toArray()).map((p) => p._id));
    const items = [];
    for (const p of page) {
      if (!active.has(p._id)) continue;
      if (viewerId && viewerId !== p._id && (await isBlockedEither(this.c, viewerId, p._id))) continue;
      const pub = (k: string) => p.privacy[k] === 'public';
      items.push({
        id: p._id,
        nickname: p.nickname,
        avatarUrl: await this.fileUrl(p.avatarFileId),
        city: pub('city') ? p.city : null,
        resume: p.lookingForTeam.resume,
        gameIds: p.lookingForTeam.gameIds,
        since: p.lookingForTeam.since,
        games: pub('games') ? p.games.map((g) => ({ gameId: g.gameId, roles: g.roles, declaredLevel: g.declaredLevel, verifiedLevel: g.verifiedLevel?.value ?? null })) : [],
      });
    }
    const last = page[page.length - 1];
    return { items, nextCursor: rows.length > f.limit && last ? encodeCursor({ i: last._id }) : null };
  }

  // ---------------------------------------------------------------- scrims (REC-004/005)
  async scrimView(sc: ScrimDoc) {
    const ids = [sc.requesterTeamId, ...(sc.proposal ? [sc.proposal.teamId] : [])];
    const teams = await this.c.teams.find({ _id: { $in: ids } }).toArray();
    const card = async (id: string) => {
      const t = teams.find((x) => x._id === id);
      return t ? this.teamCard(t) : null;
    };
    return {
      id: sc._id,
      requester: await card(sc.requesterTeamId),
      gameId: sc.gameId,
      level: sc.level,
      windowStart: sc.windowStart,
      windowEnd: sc.windowEnd,
      server: sc.server,
      conditions: sc.conditions,
      state: sc.state,
      proposal: sc.proposal ? { team: await card(sc.proposal.teamId), proposedAt: sc.proposal.proposedAt, server: sc.proposal.server, note: sc.proposal.note } : null,
      result: sc.result ? { label: sc.result.label, countsForRating: sc.result.countsForRating, scores: sc.result.scores, reportedAt: sc.result.reportedAt, note: sc.result.note } : null,
      createdAt: sc.createdAt,
      version: sc.version,
    };
  }

  private async getScrim(id: string): Promise<ScrimDoc> {
    const sc = await this.c.scrims.findOne({ _id: id });
    if (!sc) throw new DomainError('NOT_FOUND', 'scrim not found');
    return sc;
  }

  async createScrim(me: string, teamId: string, input: { gameId: string; level: string | null; windowStart: string; windowEnd: string; server: string | null; conditions: string | null }, rid: string) {
    await this.ct.acl.require(me, 'scrim.manage', teamScope(teamId), rid);
    const team = await this.teams.getTeam(teamId);
    if (team.gameId !== input.gameId) throw new DomainError('VALIDATION_FAILED', 'the scrim game must match the team game');
    const windowStart = iso(input.windowStart, 'windowStart');
    const windowEnd = iso(input.windowEnd, 'windowEnd');
    if (windowEnd <= windowStart || windowEnd <= now()) throw new DomainError('VALIDATION_FAILED', 'the window must end after it starts and lie in the future');
    const doc: ScrimDoc = { _id: newId('scr'), requesterTeamId: teamId, gameId: input.gameId, level: input.level, windowStart, windowEnd, server: input.server, conditions: input.conditions, state: 'open', proposal: null, result: null, createdBy: me, createdAt: now(), version: 0 };
    await this.ct.dbh.withTransaction(async (s) => {
      await this.c.scrims.insertOne(doc, { session: s });
      await this.au(s, me, 'scrim.create', { type: 'scrim', id: doc._id }, teamScope(teamId), { gameId: doc.gameId }, rid);
      await this.ev(s, 'scrim.created', { type: 'scrim', id: doc._id }, 0, me, { teamId, gameId: doc.gameId }, rid);
    });
    return doc;
  }

  async searchScrims(f: { gameId?: string | undefined; level?: string | undefined; from?: string | undefined; to?: string | undefined; limit: number; cursor?: string | undefined }) {
    const n = now();
    const q: Record<string, unknown> = { state: 'open', windowEnd: { $gt: f.from ? iso(f.from, 'from') : n } };
    if (f.gameId) q['gameId'] = f.gameId;
    if (f.level) q['level'] = f.level;
    if (f.to) q['windowStart'] = { $lt: iso(f.to, 'to') };
    const cur = decodeCursor(f.cursor, ScrimCursor);
    if (f.cursor && !cur) throw new DomainError('VALIDATION_FAILED', 'invalid cursor');
    if (cur) q['$and'] = [{ $or: [{ windowStart: { $gt: cur.w } }, { windowStart: cur.w, _id: { $gt: cur.i } }] }];
    const rows = await this.c.scrims.find(q).sort({ windowStart: 1, _id: 1 }).limit(f.limit + 1).toArray();
    const page = rows.slice(0, f.limit);
    const last = page[page.length - 1];
    return { items: await Promise.all(page.map((x) => this.scrimView(x))), nextCursor: rows.length > f.limit && last ? encodeCursor({ w: last.windowStart, i: last._id }) : null };
  }

  async teamScrims(me: string, teamId: string, rid: string) {
    await this.ct.acl.require(me, 'team.read_private', teamScope(teamId), rid);
    const rows = await this.c.scrims.find({ $or: [{ requesterTeamId: teamId }, { 'proposal.teamId': teamId }] }).sort({ createdAt: -1 }).limit(100).toArray();
    return Promise.all(rows.map((x) => this.scrimView(x)));
  }

  private async mutate(scrimId: string, from: ScrimDoc['state'][], set: Record<string, unknown>, expectedVersion: number | null, s: ClientSession): Promise<ScrimDoc> {
    const r = await this.c.scrims.findOneAndUpdate({ _id: scrimId, state: { $in: from }, ...(expectedVersion === null ? {} : { version: expectedVersion }) }, { $set: set, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
    if (!r) throw new DomainError('ILLEGAL_TRANSITION', 'the scrim is not in a state that allows this action');
    return r;
  }

  async propose(me: string, scrimId: string, teamId: string, input: { proposedAt: string; server: string | null; note: string | null }, rid: string) {
    await this.ct.acl.require(me, 'scrim.manage', teamScope(teamId), rid);
    const [sc, team] = await Promise.all([this.getScrim(scrimId), this.teams.getTeam(teamId)]);
    if (sc.requesterTeamId === teamId) throw new DomainError('VALIDATION_FAILED', 'a team cannot propose to its own scrim');
    if (team.gameId !== sc.gameId) throw new DomainError('VALIDATION_FAILED', 'the game of your team does not match this scrim');
    const proposedAt = iso(input.proposedAt, 'proposedAt');
    if (proposedAt < sc.windowStart || proposedAt > sc.windowEnd) throw new DomainError('VALIDATION_FAILED', 'proposedAt must lie inside the requested window');
    return this.ct.dbh.withTransaction(async (s) => {
      const r = await this.mutate(scrimId, ['open'], { state: 'proposed', proposal: { teamId, proposedAt, server: input.server ?? sc.server, note: input.note, by: me } }, null, s);
      await this.au(s, me, 'scrim.propose', { type: 'scrim', id: scrimId }, teamScope(teamId), { proposedAt }, rid);
      await this.ev(s, 'scrim.proposed', { type: 'scrim', id: scrimId }, r.version, me, { requesterTeamId: sc.requesterTeamId, teamId, proposedAt }, rid);
      return r;
    });
  }

  /** accept confirms the proposal; decline reopens the scrim for other teams (the proposal stays in the audit log). */
  async answer(me: string, scrimId: string, decision: 'accept' | 'decline', rid: string) {
    const sc = await this.getScrim(scrimId);
    await this.ct.acl.require(me, 'scrim.manage', teamScope(sc.requesterTeamId), rid);
    return this.ct.dbh.withTransaction(async (s) => {
      const r = decision === 'accept' ? await this.mutate(scrimId, ['proposed'], { state: 'accepted' }, null, s) : await this.mutate(scrimId, ['proposed'], { state: 'open', proposal: null }, null, s);
      await this.au(s, me, `scrim.${decision}`, { type: 'scrim', id: scrimId }, teamScope(sc.requesterTeamId), { proposal: sc.proposal }, rid);
      await this.ev(s, `scrim.${decision === 'accept' ? 'accepted' : 'declined'}`, { type: 'scrim', id: scrimId }, r.version, me, { requesterTeamId: sc.requesterTeamId, proposalTeamId: sc.proposal?.teamId ?? null }, rid);
      return r;
    });
  }

  async cancelScrim(me: string, scrimId: string, rid: string) {
    const sc = await this.getScrim(scrimId);
    await this.ct.acl.require(me, 'scrim.manage', teamScope(sc.requesterTeamId), rid);
    return this.ct.dbh.withTransaction(async (s) => {
      const r = await this.mutate(scrimId, ['open', 'proposed', 'accepted'], { state: 'cancelled' }, null, s);
      await this.au(s, me, 'scrim.cancel', { type: 'scrim', id: scrimId }, teamScope(sc.requesterTeamId), {}, rid);
      await this.ev(s, 'scrim.cancelled', { type: 'scrim', id: scrimId }, r.version, me, { requesterTeamId: sc.requesterTeamId }, rid);
      return r;
    });
  }

  /** REC-005: always labeled friendly; never counts for official rating. */
  async reportResult(me: string, scrimId: string, teamId: string, input: { scores: Array<{ teamId: string; score: number }>; note: string | null; expectedVersion: number }, rid: string) {
    await this.ct.acl.require(me, 'scrim.manage', teamScope(teamId), rid);
    const sc = await this.getScrim(scrimId);
    const sides = sc.proposal ? [sc.requesterTeamId, sc.proposal.teamId] : [];
    if (!sides.includes(teamId)) throw new DomainError('FORBIDDEN', 'only the two scrim teams can report the result');
    if (sc.state !== 'accepted') throw new DomainError('ILLEGAL_TRANSITION', 'only an accepted scrim can have a result');
    const given = input.scores.map((x) => x.teamId).sort();
    if (given[0] !== [...sides].sort()[0] || given[1] !== [...sides].sort()[1]) throw new DomainError('VALIDATION_FAILED', 'scores must name exactly the two scrim teams');
    if (sc.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'scrim was modified', { currentVersion: sc.version });
    return this.ct.dbh.withTransaction(async (s) => {
      const result: NonNullable<ScrimDoc['result']> = { label: 'friendly', countsForRating: false, scores: input.scores, reportedBy: me, reportedAt: now(), note: input.note };
      const r = await this.mutate(scrimId, ['accepted'], { state: 'played', result }, input.expectedVersion, s);
      await this.au(s, me, 'scrim.result', { type: 'scrim', id: scrimId }, teamScope(teamId), { scores: input.scores }, rid);
      await this.ev(s, 'scrim.played', { type: 'scrim', id: scrimId }, r.version, me, { teamIds: sides, label: 'friendly', countsForRating: false }, rid);
      return r;
    });
  }
}
