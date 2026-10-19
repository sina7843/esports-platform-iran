import { DomainError, type FollowTargetTypes } from '@esp/contracts';
import type { Container } from '../container.js';
import type { Collections } from '../db/collections.js';
import type { FollowDoc } from '../db/collections-esp02.js';
import { newId } from '../ids.js';

export * from './reviews.js';

const SITE = { type: 'site', id: 'site' } as const;
export type FollowTargetType = (typeof FollowTargetTypes)[number];

/** True when either principal blocked the other (blocks are symmetric for visibility, follow and messaging). */
export async function isBlockedEither(c: Collections, a: string, b: string): Promise<boolean> {
  return !!(await c.blocks.findOne({ $or: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] }, { projection: { _id: 1 } }));
}

export type MessageDecision = { allowed: boolean; reason: 'self' | 'blocked' | 'unavailable' | 'policy' | null };

/**
 * Message permission helper for ESP-06 (USR-008): block (either direction) always wins, then the recipient's
 * message policy (everyone | followers | teammates | nobody).
 */
export async function canMessage(c: Collections, senderId: string, recipientId: string): Promise<MessageDecision> {
  if (senderId === recipientId) return { allowed: false, reason: 'self' };
  if (await isBlockedEither(c, senderId, recipientId)) return { allowed: false, reason: 'blocked' };
  const [profile, principal] = await Promise.all([c.profiles.findOne({ _id: recipientId }, { projection: { messagePolicy: 1 } }), c.principals.findOne({ _id: recipientId }, { projection: { status: 1 } })]);
  if (!profile || principal?.status !== 'active') return { allowed: false, reason: 'unavailable' };
  switch (profile.messagePolicy) {
    case 'everyone':
      return { allowed: true, reason: null };
    case 'followers': {
      const f = await c.follows.findOne({ followerId: senderId, targetType: 'player', targetId: recipientId }, { projection: { _id: 1 } });
      return f ? { allowed: true, reason: null } : { allowed: false, reason: 'policy' };
    }
    case 'teammates': {
      const mine = await c.teamMemberships.find({ principalId: senderId, to: null }, { projection: { teamId: 1 } }).toArray();
      if (mine.length === 0) return { allowed: false, reason: 'policy' };
      const shared = await c.teamMemberships.findOne({ principalId: recipientId, to: null, teamId: { $in: mine.map((m) => m.teamId) } }, { projection: { _id: 1 } });
      return shared ? { allowed: true, reason: null } : { allowed: false, reason: 'policy' };
    }
    default:
      return { allowed: false, reason: 'policy' };
  }
}

export class SocialService {
  constructor(private readonly ct: Container) {}

  canMessage(senderId: string, recipientId: string): Promise<MessageDecision> {
    return canMessage(this.ct.c, senderId, recipientId);
  }

  private async assertTarget(me: string, type: FollowTargetType, id: string): Promise<void> {
    const { c } = this.ct;
    const nf = new DomainError('NOT_FOUND', 'target not found');
    if (type === 'player') {
      if (id === me) throw new DomainError('VALIDATION_FAILED', 'cannot follow yourself');
      const [p, pr] = await Promise.all([c.profiles.findOne({ _id: id }, { projection: { _id: 1 } }), c.principals.findOne({ _id: id }, { projection: { status: 1 } })]);
      if (!p || pr?.status !== 'active') throw nf;
      if (await isBlockedEither(c, me, id)) throw nf; // blocked users cannot follow, and learn nothing
      return;
    }
    const found =
      type === 'team' ? await c.teams.findOne({ _id: id }, { projection: { _id: 1 } })
      : type === 'game' ? await c.games.findOne({ _id: id }, { projection: { _id: 1 } })
      : type === 'organizer' ? await c.organizations.findOne({ _id: id }, { projection: { _id: 1 } })
      : await c.events.findOne({ _id: id }, { projection: { _id: 1 } });
    if (!found) throw nf;
  }

  /** Idempotent: a repeated follow changes nothing and emits no second event. */
  async follow(me: string, type: FollowTargetType, targetId: string, requestId: string): Promise<{ following: true; followerCount: number }> {
    await this.assertTarget(me, type, targetId);
    const { c, dbh, audit, outbox } = this.ct;
    const doc: FollowDoc = { _id: newId('fol'), followerId: me, targetType: type, targetId, createdAt: new Date().toISOString() };
    await dbh.withTransaction(async (session) => {
      const r = await c.follows.updateOne({ followerId: me, targetType: type, targetId }, { $setOnInsert: doc }, { upsert: true, session });
      if (r.upsertedCount === 0) return;
      await audit.append({ actorPrincipalId: me, action: 'social.follow', target: { type, id: targetId }, scope: SITE, outcome: 'success', requestId }, session);
      await outbox.append({ type: 'social.follow.created', aggregate: { type: 'follow', id: doc._id }, aggregateVersion: 0, actor: { principalId: me, kind: 'user' }, payload: { targetType: type, targetId }, correlationId: requestId }, session);
    });
    return { following: true, followerCount: await this.followerCount(type, targetId) };
  }

  async unfollow(me: string, type: FollowTargetType, targetId: string, requestId: string): Promise<void> {
    const { c, dbh, audit } = this.ct;
    await dbh.withTransaction(async (session) => {
      const r = await c.follows.deleteOne({ followerId: me, targetType: type, targetId }, { session });
      if (r.deletedCount === 1) await audit.append({ actorPrincipalId: me, action: 'social.unfollow', target: { type, id: targetId }, scope: SITE, outcome: 'success', requestId }, session);
    });
  }

  followerCount(type: FollowTargetType, targetId: string): Promise<number> {
    return this.ct.c.follows.countDocuments({ targetType: type, targetId });
  }

  async listFollowing(me: string, type?: FollowTargetType): Promise<Array<{ targetType: FollowTargetType; targetId: string; label: string | null; since: string }>> {
    const { c } = this.ct;
    const rows = await c.follows.find({ followerId: me, ...(type ? { targetType: type } : {}) }).sort({ createdAt: -1 }).limit(500).toArray();
    const ids = (t: FollowTargetType) => rows.filter((r) => r.targetType === t).map((r) => r.targetId);
    const [pl, tm, gm, og, ev] = await Promise.all([
      c.profiles.find({ _id: { $in: ids('player') } }, { projection: { nickname: 1 } }).toArray(),
      c.teams.find({ _id: { $in: ids('team') } }, { projection: { name: 1 } }).toArray(),
      c.games.find({ _id: { $in: ids('game') } }, { projection: { title: 1 } }).toArray(),
      c.organizations.find({ _id: { $in: ids('organizer') } }, { projection: { name: 1 } }).toArray(),
      c.events.find({ _id: { $in: ids('event') } }, { projection: { name: 1 } }).toArray(),
    ]);
    const label = new Map<string, string>([...pl.map((x) => [`player:${x._id}`, x.nickname] as const), ...tm.map((x) => [`team:${x._id}`, x.name] as const), ...gm.map((x) => [`game:${x._id}`, x.title] as const), ...og.map((x) => [`organizer:${x._id}`, x.name] as const), ...ev.map((x) => [`event:${x._id}`, x.name] as const)]);
    return rows.map((r) => ({ targetType: r.targetType, targetId: r.targetId, label: label.get(`${r.targetType}:${r.targetId}`) ?? null, since: r.createdAt }));
  }

  /** Blocking removes follows in both directions (player follows only) and is idempotent. */
  async block(me: string, blockedId: string, requestId: string): Promise<void> {
    if (me === blockedId) throw new DomainError('VALIDATION_FAILED', 'cannot block yourself');
    const { c, dbh, audit, outbox } = this.ct;
    if (!(await c.profiles.findOne({ _id: blockedId }, { projection: { _id: 1 } }))) throw new DomainError('NOT_FOUND', 'player not found');
    const id = newId('blk');
    await dbh.withTransaction(async (session) => {
      const r = await c.blocks.updateOne({ blockerId: me, blockedId }, { $setOnInsert: { _id: id, blockerId: me, blockedId, createdAt: new Date().toISOString() } }, { upsert: true, session });
      await c.follows.deleteMany({ targetType: 'player', $or: [{ followerId: me, targetId: blockedId }, { followerId: blockedId, targetId: me }] }, { session });
      if (r.upsertedCount === 0) return;
      await audit.append({ actorPrincipalId: me, action: 'social.block', target: { type: 'principal', id: blockedId }, scope: SITE, outcome: 'success', requestId }, session);
      await outbox.append({ type: 'social.block.created', aggregate: { type: 'block', id }, aggregateVersion: 0, actor: { principalId: me, kind: 'user' }, payload: { blockedId }, correlationId: requestId }, session);
    });
  }

  async unblock(me: string, blockedId: string, requestId: string): Promise<void> {
    const { c, dbh, audit } = this.ct;
    await dbh.withTransaction(async (session) => {
      const r = await c.blocks.deleteOne({ blockerId: me, blockedId }, { session });
      if (r.deletedCount === 1) await audit.append({ actorPrincipalId: me, action: 'social.unblock', target: { type: 'principal', id: blockedId }, scope: SITE, outcome: 'success', requestId }, session);
    });
  }

  async listBlocks(me: string): Promise<Array<{ principalId: string; nickname: string | null; since: string }>> {
    const { c } = this.ct;
    const rows = await c.blocks.find({ blockerId: me }).sort({ createdAt: -1 }).limit(500).toArray();
    const profiles = await c.profiles.find({ _id: { $in: rows.map((r) => r.blockedId) } }, { projection: { nickname: 1 } }).toArray();
    const nick = new Map(profiles.map((p) => [p._id, p.nickname]));
    return rows.map((r) => ({ principalId: r.blockedId, nickname: nick.get(r.blockedId) ?? null, since: r.createdAt }));
  }
}
