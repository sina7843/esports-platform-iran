import { DomainError, type PrivacyLevel } from '@esp/contracts';
import type { z } from 'zod';
import type { ProfileUpdateSchema } from '@esp/contracts';
import type { Container } from '../container.js';
import type { Collections, TeamDoc } from '../db/collections.js';
import type { ProfileDoc } from '../db/collections-esp02.js';
import { canMessage, isBlockedEither } from '../social/social.js';
import { activeBadges, publicBadge } from './badges.js';
import { effectiveVerification } from './gameIdentities.js';

export * from './gameIdentities.js';
export * from './badges.js';
export * from './seed.js';
export { createDefaultProfile } from './defaults.js';

const SITE = { type: 'site', id: 'site' } as const;
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;
type Relation = 'self' | 'follower' | 'other';

/** Fail-closed: a missing privacy key is private. */
const canSee = (level: PrivacyLevel | undefined, rel: Relation): boolean => rel === 'self' || level === 'public' || (level === 'followers' && rel === 'follower');

async function relationOf(c: Collections, viewerId: string | null, ownerId: string): Promise<Relation> {
  if (!viewerId) return 'other';
  if (viewerId === ownerId) return 'self';
  return (await c.follows.findOne({ followerId: viewerId, targetType: 'player', targetId: ownerId }, { projection: { _id: 1 } })) ? 'follower' : 'other';
}

/** Name the team carried at instant `t` (TEAM-006): nameHistory entry covering it, else the current name. */
function nameAt(team: TeamDoc, t: string): { name: string; tag: string } {
  const h = team.nameHistory.find((e) => e.from <= t && (e.to === null || e.to > t));
  return h ? { name: h.name, tag: h.tag } : { name: team.name, tag: team.tag };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class ProfileService {
  constructor(private readonly ct: Container) {}

  private async publicFileUrl(fileId: string | null): Promise<string | null> {
    if (!fileId) return null;
    const f = await this.ct.files.get(fileId);
    return f && f.visibility === 'public' && !f.quarantined ? f.publicUrl : null;
  }

  private async assertOwnPublicFile(principalId: string, fileId: string): Promise<void> {
    const f = await this.ct.files.get(fileId);
    if (!f || f.ownerPrincipalId !== principalId) throw new DomainError('VALIDATION_FAILED', 'file must be one of your own uploads');
    if (f.visibility !== 'public' || f.quarantined || !f.mimeType.startsWith('image/')) throw new DomainError('VALIDATION_FAILED', 'avatar/cover must be a public, non-quarantined image');
  }

  /** Full own profile (USR-003). */
  async getOwn(principalId: string) {
    const { c } = this.ct;
    const [p, pr] = await Promise.all([c.profiles.findOne({ _id: principalId }), c.principals.findOne({ _id: principalId }, { projection: { locale: 1, timeZone: 1 } })]);
    if (!p || !pr) throw new DomainError('NOT_FOUND', 'profile not found');
    const { nicknameLower: _n, ...rest } = p;
    return { ...rest, id: p._id, avatarUrl: await this.publicFileUrl(p.avatarFileId), coverUrl: await this.publicFileUrl(p.coverFileId), locale: pr.locale, timeZone: pr.timeZone, essentialNotificationsAlwaysDelivered: true as const };
  }

  async update(principalId: string, input: ProfileUpdate, requestId: string) {
    const { c, dbh, audit, outbox } = this.ct;
    const cur = await c.profiles.findOne({ _id: principalId });
    if (!cur) throw new DomainError('NOT_FOUND', 'profile not found');
    if (cur.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'profile changed since it was loaded', { currentVersion: cur.version });
    const now = new Date().toISOString();
    const set: Record<string, unknown> = {};

    if (input.nickname !== undefined && input.nickname !== cur.nickname) {
      const lower = input.nickname.toLowerCase();
      if (lower !== cur.nicknameLower && (await c.profiles.findOne({ nicknameLower: lower }, { projection: { _id: 1 } }))) throw new DomainError('CONFLICT', 'nickname is taken');
      set['nickname'] = input.nickname;
      set['nicknameLower'] = lower;
    }
    for (const k of ['realName', 'bio', 'province', 'city', 'links'] as const) if (input[k] !== undefined) set[k] = input[k];
    for (const [k, v] of [['avatarFileId', input.avatarFileId], ['coverFileId', input.coverFileId]] as const) {
      if (v === undefined) continue;
      if (v !== null) await this.assertOwnPublicFile(principalId, v);
      set[k] = v;
    }
    if (input.games) {
      const ids = input.games.map((g) => g.gameId);
      if (new Set(ids).size !== ids.length) throw new DomainError('VALIDATION_FAILED', 'duplicate gameId in games');
      // verifiedLevel is staff-set (USR-004) and survives user edits
      set['games'] = input.games.map((g) => ({ ...g, verifiedLevel: cur.games.find((x) => x.gameId === g.gameId)?.verifiedLevel ?? null }));
    }
    if (input.privacy) {
      const privacy: Record<string, PrivacyLevel> = { ...cur.privacy };
      for (const [k, v] of Object.entries(input.privacy)) if (v) privacy[k] = v;
      set['privacy'] = privacy;
    }
    if (input.messagePolicy) set['messagePolicy'] = input.messagePolicy;
    if (input.notificationPrefs) {
      const old = cur.notificationPrefs as { channels?: Record<string, boolean>; quietHours?: unknown; promotional?: boolean; digestFrequent?: boolean };
      const n = input.notificationPrefs;
      const channels = { ...(old.channels ?? {}) };
      for (const [k, v] of Object.entries(n.channels ?? {})) if (v !== undefined) channels[k] = v;
      set['notificationPrefs'] = { ...old, channels, ...(n.quietHours !== undefined ? { quietHours: n.quietHours } : {}), ...(n.promotional !== undefined ? { promotional: n.promotional } : {}), ...(n.digestFrequent !== undefined ? { digestFrequent: n.digestFrequent } : {}) };
    }
    if (input.lookingForTeam) {
      const l = input.lookingForTeam;
      set['lookingForTeam'] = { active: l.active, resume: l.resume, gameIds: l.gameIds, since: l.active ? (cur.lookingForTeam.active ? cur.lookingForTeam.since : now) : null };
    }
    const principalSet: Record<string, unknown> = {};
    if (input.locale) principalSet['locale'] = input.locale;
    if (input.timeZone) principalSet['timeZone'] = input.timeZone;

    const changed = [...Object.keys(set), ...Object.keys(principalSet)];
    if (changed.length === 0) return this.getOwn(principalId);
    try {
      await dbh.withTransaction(async (session) => {
        const r = await c.profiles.updateOne({ _id: principalId, version: cur.version }, { $set: { ...set, updatedAt: now }, $inc: { version: 1 } }, { session });
        if (r.matchedCount === 0) throw new DomainError('VERSION_CONFLICT', 'profile changed since it was loaded');
        if (Object.keys(principalSet).length) await c.principals.updateOne({ _id: principalId }, { $set: { ...principalSet, updatedAt: now }, $inc: { version: 1 } }, { session });
        // field names only: realName and other personal values stay out of the audit trail
        await audit.append({ actorPrincipalId: principalId, action: 'profile.update', target: { type: 'profile', id: principalId }, scope: SITE, outcome: 'success', details: { fields: changed }, requestId }, session);
        await outbox.append({ type: 'profile.profile.updated', aggregate: { type: 'profile', id: principalId }, aggregateVersion: cur.version + 1, actor: { principalId, kind: 'user' }, payload: { fields: changed }, correlationId: requestId }, session);
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'nickname is taken');
      throw err;
    }
    return this.getOwn(principalId);
  }

  /** USR-004: only an issuer (badge.issue, checked by the caller) sets the verified level, recording issuer and date. */
  async setVerifiedLevel(targetId: string, gameId: string, value: string | null, issuerId: string, requestId: string): Promise<ProfileDoc['games'][number]> {
    const { c, dbh, audit, outbox } = this.ct;
    const cur = await c.profiles.findOne({ _id: targetId });
    if (!cur) throw new DomainError('NOT_FOUND', 'player not found');
    const now = new Date().toISOString();
    const verifiedLevel = value === null ? null : { value, issuer: issuerId, at: now };
    const games = cur.games.some((g) => g.gameId === gameId)
      ? cur.games.map((g) => (g.gameId === gameId ? { ...g, verifiedLevel } : g))
      : [...cur.games, { gameId, roles: [], declaredLevel: null, verifiedLevel, equipment: null, activityHours: null }];
    await dbh.withTransaction(async (session) => {
      const r = await c.profiles.updateOne({ _id: targetId, version: cur.version }, { $set: { games, updatedAt: now }, $inc: { version: 1 } }, { session });
      if (r.matchedCount === 0) throw new DomainError('VERSION_CONFLICT', 'profile changed, retry');
      await audit.append({ actorPrincipalId: issuerId, action: 'profile.verified_level', target: { type: 'profile', id: targetId }, scope: SITE, outcome: 'success', details: { gameId, value }, requestId }, session);
      await outbox.append({ type: 'profile.level.verified', aggregate: { type: 'profile', id: targetId }, aggregateVersion: cur.version + 1, actor: { principalId: issuerId, kind: 'user' }, payload: { gameId, value }, correlationId: requestId }, session);
    });
    return games.find((g) => g.gameId === gameId)!;
  }

  /**
   * Public projection (USR-003/006/007): explicit fields only, filtered by privacy and the viewer's relation.
   * Blocked in either direction, unknown, suspended or deleted → NOT_FOUND (no existence leak).
   */
  async publicProfile(nickname: string, viewerId: string | null) {
    const { c } = this.ct;
    const nf = new DomainError('NOT_FOUND', 'player not found');
    const p = await c.profiles.findOne({ nicknameLower: nickname.toLowerCase() });
    if (!p) throw nf;
    const pr = await c.principals.findOne({ _id: p._id }, { projection: { status: 1 } });
    if (pr?.status !== 'active') throw nf;
    if (viewerId && viewerId !== p._id && (await isBlockedEither(c, viewerId, p._id))) throw nf;
    const rel = await relationOf(c, viewerId, p._id);
    const see = (k: string) => canSee(p.privacy[k], rel);
    const now = new Date().toISOString();

    const [avatarUrl, coverUrl, badges, identities, memberships, followerCount] = await Promise.all([
      this.publicFileUrl(p.avatarFileId),
      this.publicFileUrl(p.coverFileId),
      activeBadges(c, p._id, now),
      c.gameIdentities.find({ principalId: p._id, active: true, 'verification.state': { $nin: ['disputed', 'rejected'] } }).toArray(),
      c.teamMemberships.find({ principalId: p._id }).sort({ from: -1 }).limit(100).toArray(),
      c.follows.countDocuments({ targetType: 'player', targetId: p._id }),
    ]);
    const teams = await c.teams.find({ _id: { $in: [...new Set(memberships.map((m) => m.teamId))] } }).toArray();
    const teamById = new Map(teams.map((t) => [t._id, t]));
    const teamRows = memberships.flatMap((m) => {
      const t = teamById.get(m.teamId);
      if (!t) return [];
      const n = m.to === null ? { name: t.name, tag: t.tag } : nameAt(t, new Date(Date.parse(m.to) - 1).toISOString());
      return [{ teamId: t._id, name: n.name, tag: n.tag, role: m.role, from: m.from, to: m.to }];
    });

    return {
      id: p._id,
      nickname: p.nickname,
      avatarUrl,
      coverUrl,
      bio: see('bio') ? p.bio : null,
      realName: see('realName') ? p.realName : null,
      province: see('province') ? p.province : null,
      city: see('city') ? p.city : null,
      links: see('links') ? p.links : [],
      games: see('games')
        ? p.games.map((g) => ({
            gameId: g.gameId,
            roles: g.roles,
            declaredLevel: g.declaredLevel,
            verifiedLevel: g.verifiedLevel ? { value: g.verifiedLevel.value, at: g.verifiedLevel.at } : null,
            equipment: see('equipment') ? g.equipment : null,
            activityHours: see('activityHours') ? g.activityHours : null,
          }))
        : [],
      gameIdentities: identities
        .filter((g) => canSee(g.visibility, rel))
        .map((g) => ({ gameId: g.gameId, platform: g.platform, value: g.value, verified: effectiveVerification(g, now).state === 'verified' })),
      badges: badges.map(publicBadge),
      lookingForTeam: p.lookingForTeam.active ? { active: true as const, resume: p.lookingForTeam.resume, gameIds: p.lookingForTeam.gameIds, since: p.lookingForTeam.since } : { active: false as const, resume: null, gameIds: [], since: null },
      teams: { current: teamRows.filter((t) => t.to === null), past: teamRows.filter((t) => t.to !== null) },
      followerCount,
      viewer: { isSelf: rel === 'self', isFollowing: rel === 'follower', canMessage: viewerId && rel !== 'self' ? (await canMessage(c, viewerId, p._id)).allowed : false },
      // ESP-03/05 will fill these; until then they are honest empty states, never fabricated numbers (USR-006)
      competitiveRecord: { source: 'none_yet' as const, items: [] },
      honors: { source: 'none_yet' as const, items: [] },
      ratingChart: { source: 'none_yet' as const, points: [] },
    };
  }

  /** Search (USR-007). Only public projections; a filter on a field only matches profiles whose privacy for that field is public. */
  async search(q: { q?: string | undefined; gameId?: string | undefined; city?: string | undefined; lookingForTeam?: boolean | undefined; limit: number; cursor?: string | undefined }, viewerId: string | null) {
    const { c } = this.ct;
    const f: Record<string, unknown> = {};
    if (q.q) f['nicknameLower'] = { $regex: `^${escapeRe(q.q.toLowerCase())}` };
    if (q.gameId) Object.assign(f, { 'games.gameId': q.gameId, 'privacy.games': 'public' });
    if (q.city) Object.assign(f, { city: q.city, 'privacy.city': 'public' });
    if (q.lookingForTeam) f['lookingForTeam.active'] = true;
    const exclude: string[] = [];
    if (viewerId) {
      const bl = await c.blocks.find({ $or: [{ blockerId: viewerId }, { blockedId: viewerId }] }).toArray();
      exclude.push(...bl.flatMap((b) => [b.blockerId, b.blockedId]).filter((id) => id !== viewerId));
    }
    if (exclude.length) f['_id'] = { $nin: exclude };
    if (q.cursor) f['nicknameLower'] = { ...((f['nicknameLower'] as object | undefined) ?? {}), $gt: q.cursor };
    const docs = await c.profiles.find(f).sort({ nicknameLower: 1 }).limit(q.limit + 1).toArray();
    const page = docs.slice(0, q.limit);
    // ponytail: inactive accounts are dropped after paging, so a page may be slightly short; move to a denormalized flag if that matters.
    const active = new Set((await c.principals.find({ _id: { $in: page.map((d) => d._id) }, status: 'active' }, { projection: { _id: 1 } }).toArray()).map((x) => x._id));
    const followed = new Set(viewerId ? (await c.follows.find({ followerId: viewerId, targetType: 'player', targetId: { $in: page.map((d) => d._id) } }).toArray()).map((x) => x.targetId) : []);
    const items = await Promise.all(
      page
        .filter((d) => active.has(d._id))
        .map(async (d) => {
          const rel: Relation = d._id === viewerId ? 'self' : followed.has(d._id) ? 'follower' : 'other';
          const see = (k: string) => canSee(d.privacy[k], rel);
          return {
            id: d._id,
            nickname: d.nickname,
            avatarUrl: await this.publicFileUrl(d.avatarFileId),
            city: see('city') ? d.city : null,
            games: see('games') ? d.games.map((g) => ({ gameId: g.gameId, declaredLevel: g.declaredLevel, verifiedLevel: g.verifiedLevel?.value ?? null })) : [],
            lookingForTeam: d.lookingForTeam.active,
          };
        }),
    );
    const last = page[page.length - 1];
    return { items, nextCursor: docs.length > q.limit && last ? last.nicknameLower : null };
  }
}
