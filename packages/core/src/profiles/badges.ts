import { DomainError } from '@esp/contracts';
import type { Container } from '../container.js';
import type { Collections } from '../db/collections.js';
import type { BadgeDoc } from '../db/collections-esp02.js';
import { newId } from '../ids.js';

const SITE = { type: 'site', id: 'site' } as const;

export type BadgeIssueInput =
  | { kind: 'identity'; principalId: string; referenceText: string; expiresAt: string | null }
  | { kind: 'org_position'; principalId: string; organizationId: string; position: string; expiresAt: string | null };

/** Active = not revoked and not expired. Only these are ever shown publicly (USR-011). */
export function activeBadges(c: Collections, principalId: string, now = new Date().toISOString()): Promise<BadgeDoc[]> {
  return c.badges.find({ principalId, revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }).sort({ issuedAt: -1 }).toArray();
}

/** Public badge projection: no issuer id, no staff reference text. */
export function publicBadge(b: BadgeDoc) {
  const ref: Record<string, string> = {};
  if (b.kind === 'game_identity') Object.assign(ref, { gameId: String(b.ref['gameId'] ?? ''), platform: String(b.ref['platform'] ?? '') });
  if (b.kind === 'org_position') Object.assign(ref, { organizationId: String(b.ref['organizationId'] ?? ''), position: String(b.ref['position'] ?? '') });
  return { kind: b.kind, issuedAt: b.issuedAt, expiresAt: b.expiresAt, ref };
}

/**
 * Badge issue/revoke (USR-011). `badge.issue` (site scope) is checked by the caller. Identity badges store only issuer
 * and a short reference text: identity DOCUMENTS are never stored (retention policy not approved, OPS-002).
 * game_identity badges are issued through GameIdentityService.verify.
 */
export class BadgeService {
  constructor(private readonly ct: Container) {}

  async issue(input: BadgeIssueInput, issuerId: string, requestId: string): Promise<BadgeDoc> {
    const { c, dbh, audit, outbox } = this.ct;
    const now = new Date().toISOString();
    if (input.expiresAt && input.expiresAt <= now) throw new DomainError('VALIDATION_FAILED', 'expiresAt must be in the future');
    const [pr, prof] = await Promise.all([c.principals.findOne({ _id: input.principalId }, { projection: { status: 1 } }), c.profiles.findOne({ _id: input.principalId }, { projection: { _id: 1 } })]);
    if (!pr || pr.status !== 'active' || !prof) throw new DomainError('NOT_FOUND', 'player not found');
    let ref: Record<string, unknown>;
    if (input.kind === 'identity') {
      if (await activeBadges(c, input.principalId, now).then((l) => l.some((b) => b.kind === 'identity'))) throw new DomainError('CONFLICT', 'an active identity badge already exists');
      ref = { referenceText: input.referenceText };
    } else {
      if (!(await c.organizations.findOne({ _id: input.organizationId }, { projection: { _id: 1 } }))) throw new DomainError('NOT_FOUND', 'organization not found');
      ref = { organizationId: input.organizationId, position: input.position };
    }
    const doc: BadgeDoc = { _id: newId('bdg'), principalId: input.principalId, kind: input.kind, issuer: issuerId, issuedAt: now, expiresAt: input.expiresAt, revokedAt: null, ref };
    await dbh.withTransaction(async (session) => {
      await c.badges.insertOne(doc, { session });
      await audit.append({ actorPrincipalId: issuerId, action: 'badge.issue', target: { type: 'badge', id: doc._id }, scope: SITE, outcome: 'success', details: { kind: doc.kind, principalId: doc.principalId }, requestId }, session);
      await outbox.append({ type: 'profile.badge.issued', aggregate: { type: 'badge', id: doc._id }, aggregateVersion: 0, actor: { principalId: issuerId, kind: 'user' }, payload: { kind: doc.kind, principalId: doc.principalId }, correlationId: requestId }, session);
    });
    return doc;
  }

  async revoke(badgeId: string, reason: string, issuerId: string, requestId: string): Promise<BadgeDoc> {
    const { c, dbh, audit, outbox } = this.ct;
    const b = await c.badges.findOne({ _id: badgeId });
    if (!b) throw new DomainError('NOT_FOUND', 'badge not found');
    if (b.revokedAt) return b; // idempotent
    const now = new Date().toISOString();
    return dbh.withTransaction(async (session) => {
      const upd = await c.badges.findOneAndUpdate({ _id: badgeId, revokedAt: null }, { $set: { revokedAt: now, revokedBy: issuerId, revokedReason: reason } }, { returnDocument: 'after', session });
      if (!upd) return b;
      if (b.kind === 'game_identity') {
        await c.gameIdentities.updateOne({ _id: String(b.ref['gameIdentityId']), 'verification.state': 'verified' }, { $set: { 'verification.state': 'unverified', 'verification.issuer': null, 'verification.verifiedAt': null, 'verification.expiresAt': null, updatedAt: now }, $inc: { version: 1 } }, { session });
      }
      await audit.append({ actorPrincipalId: issuerId, action: 'badge.revoke', target: { type: 'badge', id: badgeId }, scope: SITE, outcome: 'success', details: { kind: b.kind, principalId: b.principalId, reason }, requestId }, session);
      await outbox.append({ type: 'profile.badge.revoked', aggregate: { type: 'badge', id: badgeId }, aggregateVersion: 0, actor: { principalId: issuerId, kind: 'user' }, payload: { kind: b.kind, principalId: b.principalId }, correlationId: requestId }, session);
      return upd;
    });
  }

  /** Staff view: every badge incl. revoked/expired, with issuer. */
  listAll(principalId: string): Promise<BadgeDoc[]> {
    return this.ct.c.badges.find({ principalId }).sort({ issuedAt: -1 }).limit(200).toArray();
  }
}
