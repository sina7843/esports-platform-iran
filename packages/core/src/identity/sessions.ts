import { createHash, randomBytes } from 'node:crypto';
import type { Collections, PrincipalDoc, SessionDoc } from '../db/collections.js';
import { newId } from '../ids.js';

/**
 * Opaque session tokens (no JWT claims cache): every request resolves the session AND the principal's current
 * grants from the database, so revocation is immediate (ACL-002). The raw token is only ever returned once;
 * the store keeps its sha256.
 */
export interface SessionContext {
  session: SessionDoc;
  principal: PrincipalDoc;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class Sessions {
  constructor(
    private readonly c: Collections,
    private readonly ttlHours: number,
  ) {}

  async create(principalId: string, meta: { userAgent?: string | null; ip?: string | null } = {}): Promise<{ token: string; session: SessionDoc }> {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const session: SessionDoc = {
      _id: newId('ses'),
      principalId,
      tokenHash: hashToken(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlHours * 3600_000).toISOString(),
      lastSeenAt: now.toISOString(),
      revokedAt: null,
      revokedReason: null,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    };
    await this.c.sessions.insertOne(session);
    return { token, session };
  }

  /** Returns null for unknown, expired, revoked sessions or inactive principals. */
  async resolve(token: string): Promise<SessionContext | null> {
    if (!token || token.length > 256) return null;
    const session = await this.c.sessions.findOne({ tokenHash: hashToken(token) });
    if (!session || session.revokedAt || session.expiresAt <= new Date().toISOString()) return null;
    const principal = await this.c.principals.findOne({ _id: session.principalId });
    if (!principal || principal.status !== 'active') return null;
    // touch at most once a minute to avoid write amplification
    if (Date.parse(session.lastSeenAt) < Date.now() - 60_000) {
      await this.c.sessions.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date().toISOString() } });
    }
    return { session, principal };
  }

  /** Re-validates an already-resolved session (used by long-lived SSE/WS connections on every push). */
  async isStillValid(sessionId: string): Promise<boolean> {
    const s = await this.c.sessions.findOne({ _id: sessionId }, { projection: { revokedAt: 1, expiresAt: 1 } });
    return !!s && !s.revokedAt && s.expiresAt > new Date().toISOString();
  }

  async revoke(sessionId: string, reason: string): Promise<boolean> {
    const r = await this.c.sessions.updateOne({ _id: sessionId, revokedAt: null }, { $set: { revokedAt: new Date().toISOString(), revokedReason: reason } });
    return r.modifiedCount === 1;
  }

  async revokeAllForPrincipal(principalId: string, reason: string, exceptSessionId?: string): Promise<number> {
    const filter: Record<string, unknown> = { principalId, revokedAt: null };
    if (exceptSessionId) filter['_id'] = { $ne: exceptSessionId };
    const r = await this.c.sessions.updateMany(filter, { $set: { revokedAt: new Date().toISOString(), revokedReason: reason } });
    return r.modifiedCount;
  }

  async listForPrincipal(principalId: string): Promise<SessionDoc[]> {
    return this.c.sessions.find({ principalId, revokedAt: null, expiresAt: { $gt: new Date().toISOString() } }).sort({ createdAt: -1 }).toArray();
  }
}
