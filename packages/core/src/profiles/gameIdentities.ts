import { DomainError, normalizeDigits, type PrivacyLevel } from '@esp/contracts';
import type { ClientSession } from 'mongodb';
import type { Container } from '../container.js';
import type { BadgeDoc, GameIdentityDoc } from '../db/collections-esp02.js';
import { newId } from '../ids.js';
import { openAccountReview } from '../identity/reviews.js';

const SITE = { type: 'site', id: 'site' } as const;

/** Case, spacing, Persian/Arabic digits and Arabic letter forms must not create a "different" in-game id. */
export function normalizeIdentityValue(v: string): string {
  return normalizeDigits(v).normalize('NFKC').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A verification that has passed its expiry no longer counts as verified. */
export function effectiveVerification(g: Pick<GameIdentityDoc, 'verification'>, now = new Date().toISOString()): { state: GameIdentityDoc['verification']['state']; expired: boolean } {
  const v = g.verification;
  if (v.state === 'verified' && v.expiresAt && v.expiresAt <= now) return { state: 'unverified', expired: true };
  return { state: v.state, expired: false };
}

export function ownIdentityView(g: GameIdentityDoc) {
  const eff = effectiveVerification(g);
  return {
    id: g._id,
    gameId: g.gameId,
    platform: g.platform,
    value: g.value,
    active: g.active,
    visibility: g.visibility ?? 'private',
    verification: { state: eff.state, expired: eff.expired, method: g.verification.method, verifiedAt: g.verification.verifiedAt, expiresAt: g.verification.expiresAt },
    valueHistory: g.valueHistory,
    ownershipHistory: g.ownershipHistory.map((o) => ({ from: o.from, to: o.to })),
    createdAt: g.createdAt,
    version: g.version,
  };
}

/**
 * Game identities (USR-005). Manual only: the publisher connection method answers PROVIDER_NOT_CONFIGURED
 * (publisher adapter is `none`). A value already ACTIVE on another account is never merged or transferred: the
 * new identity is created `disputed` and an account review is opened for a human (USR-010).
 */
export class GameIdentityService {
  constructor(private readonly ct: Container) {}

  list(principalId: string): Promise<GameIdentityDoc[]> {
    return this.ct.c.gameIdentities.find({ principalId }).sort({ createdAt: -1 }).limit(200).toArray();
  }

  /** Staff view (badge.issue); optional filters. */
  adminList(f: { state?: string | undefined; principalId?: string | undefined }): Promise<GameIdentityDoc[]> {
    const q: Record<string, unknown> = {};
    if (f.state) q['verification.state'] = f.state;
    if (f.principalId) q['principalId'] = f.principalId;
    return this.ct.c.gameIdentities.find(q).sort({ createdAt: -1 }).limit(200).toArray();
  }

  private async otherActiveHolders(gameId: string, platform: string, valueNormalized: string, except: string): Promise<string[]> {
    const rows = await this.ct.c.gameIdentities.find({ gameId, platform, valueNormalized, active: true, principalId: { $ne: except } }, { projection: { principalId: 1 } }).toArray();
    return [...new Set(rows.map((r) => r.principalId))];
  }

  async add(principalId: string, input: { gameId: string; platform: string; value: string; method: 'manual' | 'publisher'; visibility: PrivacyLevel }, requestId: string): Promise<GameIdentityDoc> {
    if (input.method === 'publisher') throw new DomainError('PROVIDER_NOT_CONFIGURED', 'publisher account connection is not configured (publisher adapter: none); use manual entry');
    const { c, dbh, audit, outbox } = this.ct;
    const value = input.value.trim();
    const valueNormalized = normalizeIdentityValue(value);
    if (!valueNormalized) throw new DomainError('VALIDATION_FAILED', 'empty identity value');
    if (await c.gameIdentities.findOne({ principalId, gameId: input.gameId, platform: input.platform, active: true }, { projection: { _id: 1 } })) {
      throw new DomainError('CONFLICT', 'an active identity already exists for this game and platform; change its value or deactivate it');
    }
    // ponytail: check-then-insert is not atomic across principals; a concurrent identical claim is caught by the next add/change or by staff review.
    const others = await this.otherActiveHolders(input.gameId, input.platform, valueNormalized, principalId);
    const disputed = others.length > 0;
    const now = new Date().toISOString();
    const doc: GameIdentityDoc = {
      _id: newId('gid'),
      principalId,
      gameId: input.gameId,
      platform: input.platform,
      value,
      valueNormalized,
      active: true,
      visibility: input.visibility,
      verification: { state: disputed ? 'disputed' : 'unverified', method: 'manual', issuer: null, verifiedAt: null, expiresAt: null, note: null },
      ownershipHistory: [{ principalId, from: now, to: null, by: principalId }],
      valueHistory: [{ value, from: now, to: null }],
      createdAt: now,
      updatedAt: now,
      version: 0,
    };
    await dbh.withTransaction(async (session) => {
      await c.gameIdentities.insertOne(doc, { session });
      if (disputed) await openAccountReview(c, [principalId, ...others], 'duplicate_game_identity', { gameId: input.gameId, platform: input.platform, valueNormalized, identityId: doc._id }, { audit, requestId, session });
      await audit.append({ actorPrincipalId: principalId, action: 'game_identity.add', target: { type: 'game_identity', id: doc._id }, scope: SITE, outcome: 'success', details: { gameId: input.gameId, platform: input.platform, disputed }, requestId }, session);
      await outbox.append({ type: 'profile.game_identity.added', aggregate: { type: 'game_identity', id: doc._id }, aggregateVersion: 0, actor: { principalId, kind: 'user' }, payload: { gameId: input.gameId, platform: input.platform, disputed }, correlationId: requestId }, session);
    });
    return doc;
  }

  private async own(principalId: string, id: string): Promise<GameIdentityDoc> {
    const g = await this.ct.c.gameIdentities.findOne({ _id: id, principalId });
    if (!g) throw new DomainError('NOT_FOUND', 'game identity not found');
    return g;
  }

  /** Revokes active game_identity badges bound to an identity whose value/ownership changed. */
  private async revokeBadgesOf(identityId: string, by: string, reason: string, now: string, session: ClientSession): Promise<void> {
    await this.ct.c.badges.updateMany({ kind: 'game_identity', 'ref.gameIdentityId': identityId, revokedAt: null }, { $set: { revokedAt: now, revokedBy: by, revokedReason: reason } }, { session });
  }

  async update(principalId: string, id: string, input: { value?: string | undefined; visibility?: PrivacyLevel | undefined; expectedVersion: number }, requestId: string): Promise<GameIdentityDoc> {
    const { c, dbh, audit, outbox } = this.ct;
    const g = await this.own(principalId, id);
    if (!g.active) throw new DomainError('ILLEGAL_TRANSITION', 'identity is deactivated');
    if (g.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'identity changed');
    const now = new Date().toISOString();
    const set: Record<string, unknown> = { updatedAt: now };
    let disputedWith: string[] = [];
    const valueChanged = input.value !== undefined && input.value.trim() !== g.value;
    if (input.visibility) set['visibility'] = input.visibility;
    if (valueChanged) {
      const value = input.value!.trim();
      const valueNormalized = normalizeIdentityValue(value);
      if (!valueNormalized) throw new DomainError('VALIDATION_FAILED', 'empty identity value');
      disputedWith = await this.otherActiveHolders(g.gameId, g.platform, valueNormalized, principalId);
      const valueHistory = [...g.valueHistory.map((h) => (h.to === null ? { ...h, to: now } : h)), { value, from: now, to: null }];
      Object.assign(set, {
        value,
        valueNormalized,
        valueHistory,
        // a changed value is a different account: any earlier verification no longer applies
        verification: { state: disputedWith.length ? 'disputed' : 'unverified', method: 'manual', issuer: null, verifiedAt: null, expiresAt: null, note: null },
      });
    }
    return dbh.withTransaction(async (session) => {
      const upd = await c.gameIdentities.findOneAndUpdate({ _id: id, principalId, version: g.version }, { $set: set, $inc: { version: 1 } }, { returnDocument: 'after', session });
      if (!upd) throw new DomainError('VERSION_CONFLICT', 'identity changed');
      if (valueChanged) {
        await this.revokeBadgesOf(id, principalId, 'value_changed', now, session);
        if (disputedWith.length) await openAccountReview(c, [principalId, ...disputedWith], 'duplicate_game_identity', { gameId: g.gameId, platform: g.platform, valueNormalized: upd.valueNormalized, identityId: id }, { audit, requestId, session });
      }
      await audit.append({ actorPrincipalId: principalId, action: 'game_identity.update', target: { type: 'game_identity', id }, scope: SITE, outcome: 'success', details: { valueChanged, disputed: disputedWith.length > 0 }, requestId }, session);
      await outbox.append({ type: 'profile.game_identity.updated', aggregate: { type: 'game_identity', id }, aggregateVersion: upd.version, actor: { principalId, kind: 'user' }, payload: { valueChanged }, correlationId: requestId }, session);
      return upd;
    });
  }

  async deactivate(principalId: string, id: string, requestId: string): Promise<GameIdentityDoc> {
    const { c, dbh, audit, outbox } = this.ct;
    const g = await this.own(principalId, id);
    if (!g.active) return g; // idempotent
    const now = new Date().toISOString();
    return dbh.withTransaction(async (session) => {
      const upd = await c.gameIdentities.findOneAndUpdate(
        { _id: id, principalId, active: true },
        {
          $set: {
            active: false,
            updatedAt: now,
            ownershipHistory: g.ownershipHistory.map((o) => (o.to === null ? { ...o, to: now } : o)),
            valueHistory: g.valueHistory.map((h) => (h.to === null ? { ...h, to: now } : h)),
          },
          $inc: { version: 1 },
        },
        { returnDocument: 'after', session },
      );
      if (!upd) return g;
      await this.revokeBadgesOf(id, principalId, 'identity_deactivated', now, session);
      await audit.append({ actorPrincipalId: principalId, action: 'game_identity.deactivate', target: { type: 'game_identity', id }, scope: SITE, outcome: 'success', requestId }, session);
      await outbox.append({ type: 'profile.game_identity.deactivated', aggregate: { type: 'game_identity', id }, aggregateVersion: upd.version, actor: { principalId, kind: 'user' }, payload: {}, correlationId: requestId }, session);
      return upd;
    });
  }

  /** Staff verification (permission `badge.issue` is enforced by the caller). Issues a `game_identity` badge. */
  async verify(identityId: string, input: { expiresAt: string | null; note: string | null }, issuerId: string, requestId: string): Promise<{ identity: GameIdentityDoc; badge: BadgeDoc }> {
    const { c, dbh, audit, outbox } = this.ct;
    const g = await c.gameIdentities.findOne({ _id: identityId });
    if (!g) throw new DomainError('NOT_FOUND', 'game identity not found');
    if (!g.active) throw new DomainError('ILLEGAL_TRANSITION', 'identity is deactivated');
    if (g.verification.state === 'disputed') throw new DomainError('PRECONDITION_FAILED', 'identity is disputed; resolve the account review first');
    const now = new Date().toISOString();
    if (input.expiresAt && input.expiresAt <= now) throw new DomainError('VALIDATION_FAILED', 'expiresAt must be in the future');
    const badge: BadgeDoc = { _id: newId('bdg'), principalId: g.principalId, kind: 'game_identity', issuer: issuerId, issuedAt: now, expiresAt: input.expiresAt, revokedAt: null, ref: { gameIdentityId: g._id, gameId: g.gameId, platform: g.platform } };
    return dbh.withTransaction(async (session) => {
      const upd = await c.gameIdentities.findOneAndUpdate(
        { _id: identityId, version: g.version, active: true },
        { $set: { verification: { state: 'verified', method: 'manual', issuer: issuerId, verifiedAt: now, expiresAt: input.expiresAt, note: input.note }, updatedAt: now }, $inc: { version: 1 } },
        { returnDocument: 'after', session },
      );
      if (!upd) throw new DomainError('VERSION_CONFLICT', 'identity changed');
      await c.badges.updateMany({ kind: 'game_identity', 'ref.gameIdentityId': identityId, revokedAt: null }, { $set: { revokedAt: now, revokedBy: issuerId, revokedReason: 'superseded' } }, { session });
      await c.badges.insertOne(badge, { session });
      await audit.append({ actorPrincipalId: issuerId, action: 'game_identity.verify', target: { type: 'game_identity', id: identityId }, scope: SITE, outcome: 'success', details: { badgeId: badge._id, expiresAt: input.expiresAt }, requestId }, session);
      await outbox.append({ type: 'profile.badge.issued', aggregate: { type: 'badge', id: badge._id }, aggregateVersion: 0, actor: { principalId: issuerId, kind: 'user' }, payload: { kind: 'game_identity', principalId: g.principalId }, correlationId: requestId }, session);
      return { identity: upd, badge };
    });
  }
}
