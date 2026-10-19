import { randomBytes } from 'node:crypto';
import { DomainError } from '@esp/contracts';
import type { Container } from '../container.js';
import { hmacHex } from './crypto.js';
import { AuthService, type AuthCtx } from './auth.js';

const SITE = { type: 'site', id: 'site' } as const;
export const DELETED_DISPLAY_NAME = 'کاربر حذف‌شده';

/**
 * Account export (ADM-012) and anonymizing deletion (DATA-006).
 * Deletion never touches participation, result, audit or finance records: they keep their own historical snapshots.
 */
export class AccountService {
  constructor(private readonly ct: Container) {}

  /** The user's own data. Secrets (password hash, TOTP secret/recovery hashes, token hashes) are never included. */
  async exportData(principalId: string, ctx: AuthCtx): Promise<{ exportedAt: string; data: Record<string, unknown> }> {
    const { c } = this.ct;
    const [principal, cred, profile, gameIdentities, follows, blocks, memberships, grants, sessions] = await Promise.all([
      c.principals.findOne({ _id: principalId }),
      c.credentials.findOne({ _id: principalId }),
      c.profiles.findOne({ _id: principalId }),
      c.gameIdentities.find({ principalId }).toArray(),
      c.follows.find({ followerId: principalId }).toArray(),
      c.blocks.find({ blockerId: principalId }).toArray(),
      c.teamMemberships.find({ principalId }).toArray(),
      c.grants.find({ principalId }).toArray(),
      c.sessions.find({ principalId }).sort({ createdAt: -1 }).limit(200).toArray(),
    ]);
    if (!principal) throw new DomainError('NOT_FOUND', 'account not found');
    const exportedAt = new Date().toISOString();
    await this.ct.audit.append({ actorPrincipalId: principalId, action: 'account.export', target: { type: 'principal', id: principalId }, scope: SITE, outcome: 'success', requestId: ctx.requestId });
    return {
      exportedAt,
      data: {
        principal: { id: principal._id, displayName: principal.displayName, locale: principal.locale, timeZone: principal.timeZone, status: principal.status, createdAt: principal.createdAt },
        credentials: cred && {
          phone: cred.phone,
          phoneVerifiedAt: cred.phoneVerifiedAt,
          email: cred.email,
          emailVerifiedAt: cred.emailVerifiedAt,
          passwordSet: !!cred.passwordHash,
          totpEnabled: cred.totp.enabled,
          phoneHistory: cred.phoneHistory,
          emailHistory: cred.emailHistory,
        },
        profile,
        gameIdentities: gameIdentities.map(({ _id, gameId, platform, value, active, verification, createdAt }) => ({ id: _id, gameId, platform, value, active, verification, createdAt })),
        follows: follows.map(({ targetType, targetId, createdAt }) => ({ targetType, targetId, createdAt })),
        blocks: blocks.map(({ blockedId, createdAt }) => ({ blockedId, createdAt })),
        memberships: memberships.map(({ teamId, role, from, to }) => ({ teamId, role, from, to })),
        grants: grants.map(({ _id, role, scope, grantedAt, expiresAt, revokedAt }) => ({ id: _id, role, scope, grantedAt, expiresAt, revokedAt })),
        sessions: sessions.map(({ _id, createdAt, expiresAt, lastSeenAt, revokedAt, userAgent, ip }) => ({ id: _id, createdAt, expiresAt, lastSeenAt, revokedAt, userAgent, ip })),
      },
    };
  }

  /** Requires a fresh OTP/TOTP re-verification on the calling session. */
  async deleteAccount(principalId: string, sessionId: string, ctx: AuthCtx): Promise<void> {
    await new AuthService(this.ct).requireRecentReauth(sessionId);
    const { c, config } = this.ct;
    const now = new Date().toISOString();
    const cred = await c.credentials.findOne({ _id: principalId });
    const principal = await c.principals.findOne({ _id: principalId });
    if (!principal || principal.status === 'deleted') throw new DomainError('NOT_FOUND', 'account not found');
    const h = (v: string) => hmacHex(config.appSecret, `anon:${v}`);

    await this.ct.dbh.withTransaction(async (session) => {
      const o = { session };
      await c.principals.updateOne({ _id: principalId }, { $set: { displayName: DELETED_DISPLAY_NAME, status: 'deleted', deletedAt: now, anonymizedAt: now, updatedAt: now }, $inc: { version: 1, aclVersion: 1 } }, o);
      if (cred) {
        await c.credentials.updateOne(
          { _id: principalId },
          {
            $set: {
              phone: null,
              phoneVerifiedAt: null,
              email: null,
              emailVerifiedAt: null,
              pendingEmail: null,
              passwordHash: null,
              totp: { enabled: false, secretEnc: null, pendingSecretEnc: null, recoveryCodeHashes: [], enabledAt: null },
              phoneHistory: [...cred.phoneHistory.map((e) => ({ ...e, phone: h(e.phone) })), ...(cred.phone ? [{ phone: h(cred.phone), from: cred.phoneVerifiedAt ?? cred.updatedAt, to: now, reason: 'account_deleted' }] : [])],
              emailHistory: [...cred.emailHistory.map((e) => ({ ...e, email: h(e.email) })), ...(cred.email ? [{ email: h(cred.email), from: cred.emailVerifiedAt ?? cred.updatedAt, to: now }] : [])],
              failedLogins: 0,
              lockedUntil: null,
              updatedAt: now,
            },
            $inc: { version: 1 },
          },
          o,
        );
      }
      const nick = `deleted-${randomBytes(5).toString('hex')}`;
      await c.profiles.updateOne(
        { _id: principalId },
        { $set: { nickname: nick, nicknameLower: nick, realName: null, bio: null, province: null, city: null, links: [], avatarFileId: null, coverFileId: null, games: [], notificationPrefs: {}, messagePolicy: 'nobody', lookingForTeam: { active: false, resume: null, gameIds: [], since: null }, updatedAt: now }, $inc: { version: 1 } },
        o,
      );
      await c.sessions.updateMany({ principalId, revokedAt: null }, { $set: { revokedAt: now, revokedReason: 'account_deleted' } }, o);
      await c.grants.updateMany({ principalId, revokedAt: null }, { $set: { revokedAt: now, revokedBy: principalId, reason: 'account_deleted' } }, o);
      await c.follows.deleteMany({ $or: [{ followerId: principalId }, { targetType: 'player', targetId: principalId }] }, o);
      await c.blocks.deleteMany({ $or: [{ blockerId: principalId }, { blockedId: principalId }] }, o);
      await c.badges.updateMany({ principalId, revokedAt: null }, { $set: { revokedAt: now } }, o);
      await c.gameIdentities.updateMany({ principalId, active: true }, { $set: { active: false, updatedAt: now } }, o);
      await c.otpChallenges.deleteMany({ $or: [{ principalId }, ...(cred?.phone ? [{ target: cred.phone }] : []), ...(cred?.email ? [{ target: cred.email }] : [])] }, o);
      await this.ct.audit.append({ actorPrincipalId: principalId, action: 'account.delete', target: { type: 'principal', id: principalId }, scope: SITE, outcome: 'success', requestId: ctx.requestId }, session);
      await this.ct.outbox.append({ type: 'identity.account.deleted', aggregate: { type: 'principal', id: principalId }, aggregateVersion: principal.version + 1, actor: { principalId, kind: 'user' }, payload: {}, correlationId: ctx.requestId }, session);
    });
  }
}
