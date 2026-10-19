import { randomBytes } from 'node:crypto';
import { DomainError, MfaRequiredRoles, type Role } from '@esp/contracts';
import type { Container } from '../container.js';
import type { GrantDoc, PrincipalDoc, SessionDoc } from '../db/collections.js';
import type { CredentialDoc, OtpChallengeDoc } from '../db/collections-esp02.js';
import { newId } from '../ids.js';
import { createDefaultProfile } from '../profiles/defaults.js';
import { base32Decode, hashPassword, hmacHex, newOtpCode, newRecoveryCodes, newTotpSecret, otpauthUri, safeEqual, seal, unseal, verifyPassword, verifyTotp, totpMatchStep } from './crypto.js';
import { openAccountReview } from './reviews.js';
import type { SessionContext } from './sessions.js';

export * from './crypto.js';
export * from './reviews.js';
export * from './account.js';
export * from './seed.js';
export { readDevInbox } from '../adapters/dev.js';

/** Request context passed from the API boundary. */
export interface AuthCtx {
  ip: string | null;
  requestId: string;
  userAgent?: string | null;
}
export interface ChallengeInfo {
  challengeId: string;
  expiresAt: string;
  message: string;
  resendAfterSeconds: number;
}
export interface LoginResult {
  token: string;
  session: SessionDoc;
  principalId: string;
  isNewAccount: boolean;
}

const SITE = { type: 'site', id: 'site' } as const;
const OTP_FAIL = 'invalid or expired code';
const isDup = (e: unknown) => (e as { code?: number }).code === 11000;
const iso = (ms = Date.now()) => new Date(ms).toISOString();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/**
 * Enforces the second factor for MFA-gated roles (USR-009). Called from `requirePermission` with the grant that
 * authorized the action. Services that call `acl.require` directly do not pass through it.
 */
export async function assertMfaForRole(ct: Container, ctx: SessionContext, role: Role): Promise<void> {
  if (!ct.config.mfaEnforced || !(MfaRequiredRoles as readonly string[]).includes(role) || ctx.session.mfaVerifiedAt) return;
  const cred = await ct.c.credentials.findOne({ _id: ctx.principal._id }, { projection: { 'totp.enabled': 1 } });
  if (cred?.totp.enabled) throw new DomainError('MFA_REQUIRED', 'second factor required for this role', { role });
  throw new DomainError('MFA_ENROLLMENT_REQUIRED', 'enroll a second factor to use this role', { role });
}

export class AuthService {
  constructor(private readonly ct: Container) {}

  private get cfg() {
    return this.ct.config;
  }

  private audit(actor: string, action: string, targetId: string, requestId: string, details?: Record<string, unknown>, outcome: 'success' | 'denied' | 'failed' = 'success') {
    return this.ct.audit.append({ actorPrincipalId: actor, action, target: { type: 'principal', id: targetId }, scope: SITE, outcome, requestId, ...(details ? { details } : {}) });
  }

  // ------------------------------------------------------------------ challenges (OTP)

  /**
   * Creates a challenge and delivers it. `deliver === null` stores an undeliverable decoy so unknown targets
   * are indistinguishable from real ones (cooldowns, limits and responses are identical: no enumeration).
   * Codes and SMS/e-mail text are never logged.
   */
  private async issueChallenge(p: { purpose: OtpChallengeDoc['purpose']; target: string; principalId: string | null; ctx: AuthCtx; deliver: ((code: string, challengeId: string) => Promise<{ status: string }>) | null }): Promise<ChallengeInfo> {
    const { c } = this.ct;
    const cfg = this.cfg;
    const now = Date.now();
    const last = await c.otpChallenges.find({ target: p.target, purpose: p.purpose }).sort({ createdAt: -1 }).limit(1).next();
    if (last && now - Date.parse(last.createdAt) < cfg.AUTH_OTP_RESEND_SECONDS * 1000) {
      throw new DomainError('RATE_LIMITED', 'please wait before requesting another code', { retryAfterSeconds: Math.ceil(cfg.AUTH_OTP_RESEND_SECONDS - (now - Date.parse(last.createdAt)) / 1000) });
    }
    const since = iso(now - 3600_000);
    if ((await c.otpChallenges.countDocuments({ target: p.target, createdAt: { $gte: since } })) >= cfg.AUTH_OTP_PHONE_HOURLY) throw new DomainError('RATE_LIMITED', 'too many codes requested for this target; try later');
    if (p.ctx.ip && (await c.otpChallenges.countDocuments({ ip: p.ctx.ip, createdAt: { $gte: since } })) >= cfg.AUTH_OTP_IP_HOURLY) throw new DomainError('RATE_LIMITED', 'too many codes requested from this address; try later');

    const id = newId('otp');
    const salt = randomBytes(16).toString('hex');
    const code = newOtpCode();
    const doc: OtpChallengeDoc = {
      _id: id,
      purpose: p.purpose,
      target: p.target,
      codeHash: hmacHex(cfg.appSecret, `${id}:${salt}:${p.deliver ? code : randomBytes(8).toString('hex')}`),
      salt,
      expiresAt: iso(now + cfg.AUTH_OTP_TTL_SECONDS * 1000),
      attempts: 0,
      maxAttempts: cfg.AUTH_OTP_MAX_ATTEMPTS,
      consumedAt: null,
      principalId: p.principalId,
      ip: p.ctx.ip,
      createdAt: iso(now),
      deliveryFailedAt: null,
    };
    await c.otpChallenges.insertOne(doc);
    if (p.deliver) {
      try {
        const r = await withTimeout(p.deliver(code, id), cfg.AUTH_SMS_TIMEOUT_MS);
        if (r.status === 'failed') throw new Error('provider reported failure');
      } catch (err) {
        await c.otpChallenges.updateOne({ _id: id }, { $set: { deliveryFailedAt: iso() } });
        this.ct.logger.warn({ challengeId: id, purpose: p.purpose, reason: err instanceof Error ? err.message : 'unknown' }, 'otp delivery failed');
        await this.audit(p.principalId ?? 'system:identity', 'auth.otp.delivery_failed', p.principalId ?? id, p.ctx.requestId, { purpose: p.purpose, challengeId: id }, 'failed');
        if (err instanceof DomainError && err.code === 'PROVIDER_NOT_CONFIGURED') throw err;
        throw new DomainError('PROVIDER_UNAVAILABLE', 'the message provider is unavailable; try again later');
      }
      // a slow provider must not eat the user's validity window
      doc.expiresAt = iso(Date.now() + cfg.AUTH_OTP_TTL_SECONDS * 1000);
      await c.otpChallenges.updateOne({ _id: id }, { $set: { expiresAt: doc.expiresAt } });
    }
    this.ct.logger.info({ challengeId: id, purpose: p.purpose }, 'otp issued');
    return { challengeId: id, expiresAt: doc.expiresAt, message: 'کد تأیید ارسال شد.', resendAfterSeconds: cfg.AUTH_OTP_RESEND_SECONDS };
  }

  /** Verifies the newest live challenge. Every guess burns an attempt atomically; success consumes it exactly once. */
  private async consumeChallenge(purpose: OtpChallengeDoc['purpose'], target: string, code: string, principalId?: string): Promise<OtpChallengeDoc> {
    const { c } = this.ct;
    const ch = await c.otpChallenges.find({ target, purpose, consumedAt: null, deliveryFailedAt: null, ...(principalId ? { principalId } : {}) }).sort({ createdAt: -1 }).limit(1).next();
    if (!ch) throw new DomainError('OTP_INVALID', OTP_FAIL);
    const bumped = await c.otpChallenges.findOneAndUpdate({ _id: ch._id, consumedAt: null, attempts: { $lt: ch.maxAttempts }, expiresAt: { $gt: iso() } }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
    if (!bumped) throw new DomainError('OTP_INVALID', OTP_FAIL);
    if (!safeEqual(hmacHex(this.cfg.appSecret, `${bumped._id}:${bumped.salt}:${code}`), bumped.codeHash)) throw new DomainError('OTP_INVALID', OTP_FAIL);
    const r = await c.otpChallenges.updateOne({ _id: bumped._id, consumedAt: null }, { $set: { consumedAt: iso() } });
    if (r.modifiedCount !== 1) throw new DomainError('OTP_INVALID', OTP_FAIL); // lost a parallel verify
    return bumped;
  }

  private sms(to: string, text: (code: string) => string) {
    return (code: string, challengeId: string) => this.ct.adapters.sms.send({ to, text: text(code), kind: 'otp', idempotencyKey: challengeId });
  }

  // ------------------------------------------------------------------ mobile OTP login / signup (USR-001/002)

  async requestLoginOtp(phone: string, ctx: AuthCtx): Promise<ChallengeInfo> {
    // The same path runs whether or not the phone is registered.
    return this.issueChallenge({ purpose: 'login', target: phone, principalId: null, ctx, deliver: this.sms(phone, (code) => `کد ورود شما به پلتفرم: ${code}`) });
  }

  async verifyLoginOtp(phone: string, code: string, ctx: AuthCtx): Promise<LoginResult> {
    const ch = await this.consumeChallenge('login', phone, code);
    let cred = await this.ct.c.credentials.findOne({ phone });
    let isNew = false;
    if (!cred) {
      try {
        cred = await this.createAccount(phone, ch._id, ctx);
        isNew = true;
      } catch (err) {
        if (!isDup(err)) throw err;
        cred = await this.ct.c.credentials.findOne({ phone }); // parallel verify created it first
        if (!cred) throw err;
      }
    }
    const principal = await this.ct.c.principals.findOne({ _id: cred._id });
    if (!principal || principal.status !== 'active') throw new DomainError('FORBIDDEN', 'account is not available');
    const now = iso();
    const { token, session } = await this.ct.sessions.create(principal._id, { userAgent: ctx.userAgent ?? null, ip: ctx.ip, reauthAt: now });
    await this.audit(principal._id, 'auth.login.otp', session._id, ctx.requestId, { isNewAccount: isNew });
    if (isNew) await this.signupSignals(principal._id, ctx);
    return { token, session, principalId: principal._id, isNewAccount: isNew };
  }

  /** principal + credentials + default profile + player grant in ONE transaction; the unique phone index is the final guard. */
  private async createAccount(phone: string, challengeId: string, ctx: AuthCtx): Promise<CredentialDoc> {
    const id = newId('usr');
    const now = iso();
    const nickname = `player_${randomBytes(5).toString('hex')}`;
    const principal: PrincipalDoc = { _id: id, kind: 'user', displayName: nickname, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 1, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0 };
    const cred: CredentialDoc = { _id: id, phone, phoneVerifiedAt: now, email: null, emailVerifiedAt: null, pendingEmail: null, passwordHash: null, totp: { enabled: false, secretEnc: null, pendingSecretEnc: null, recoveryCodeHashes: [], enabledAt: null }, phoneHistory: [], emailHistory: [], failedLogins: 0, lockedUntil: null, updatedAt: now, version: 0 };
    const grant: GrantDoc = { _id: newId('grt'), principalId: id, role: 'player', scope: SITE, grantedBy: 'system:signup', grantedAt: now, expiresAt: null, revokedAt: null, revokedBy: null, reason: 'signup' };
    const { c } = this.ct;
    await this.ct.dbh.withTransaction(async (session) => {
      await c.principals.insertOne(principal, { session });
      await c.credentials.insertOne(cred, { session });
      await c.profiles.insertOne(createDefaultProfile(id, nickname), { session });
      await c.grants.insertOne(grant, { session });
      await c.otpChallenges.updateOne({ _id: challengeId }, { $set: { principalId: id } }, { session });
      await this.ct.audit.append({ actorPrincipalId: id, action: 'identity.account.create', target: { type: 'principal', id }, scope: SITE, outcome: 'success', requestId: ctx.requestId }, session);
      await this.ct.outbox.append({ type: 'identity.account.created', aggregate: { type: 'principal', id }, aggregateVersion: 0, actor: { principalId: id, kind: 'user' }, payload: { method: 'phone_otp' }, correlationId: ctx.requestId }, session);
    });
    return cred;
  }

  /** USR-010: many signups from one address in a day open a review; nothing is merged or blocked automatically. */
  private async signupSignals(principalId: string, ctx: AuthCtx): Promise<void> {
    if (!ctx.ip) return;
    const since = iso(Date.now() - 24 * 3600_000);
    const rows = await this.ct.c.otpChallenges.find({ purpose: 'login', ip: ctx.ip, principalId: { $ne: null }, createdAt: { $gte: since } }, { projection: { principalId: 1 } }).toArray();
    const ids = [...new Set(rows.map((r) => r.principalId!))];
    if (ids.length >= this.cfg.AUTH_SIGNUP_IP_REVIEW_THRESHOLD && ids.includes(principalId)) {
      await openAccountReview(this.ct.c, ids, 'many_signups_same_ip', { ipHash: hmacHex(this.cfg.appSecret, ctx.ip), windowHours: 24, count: ids.length }, { audit: this.ct.audit, requestId: ctx.requestId });
    }
  }

  // ------------------------------------------------------------------ re-verification (sensitive actions)

  async requireRecentReauth(sessionId: string): Promise<void> {
    const s = await this.ct.c.sessions.findOne({ _id: sessionId }, { projection: { reauthAt: 1 } });
    if (!s?.reauthAt || Date.parse(s.reauthAt) < Date.now() - this.cfg.AUTH_REAUTH_MINUTES * 60_000) throw new DomainError('PRECONDITION_FAILED', 'recent re-verification required', { reauth: true });
  }

  async requestReauthOtp(principalId: string, ctx: AuthCtx): Promise<ChallengeInfo> {
    const cred = await this.cred(principalId);
    if (!cred.phone) throw new DomainError('PRECONDITION_FAILED', 'no phone on this account');
    return this.issueChallenge({ purpose: 'reauth', target: cred.phone, principalId, ctx, deliver: this.sms(cred.phone, (code) => `کد تأیید هویت شما: ${code}`) });
  }

  async verifyReauthOtp(principalId: string, sessionId: string, code: string, ctx: AuthCtx): Promise<void> {
    const cred = await this.cred(principalId);
    if (!cred.phone) throw new DomainError('OTP_INVALID', OTP_FAIL);
    await this.consumeChallenge('reauth', cred.phone, code, principalId);
    await this.ct.sessions.stamp(sessionId, { reauth: true });
    await this.audit(principalId, 'auth.reauth.otp', sessionId, ctx.requestId);
  }

  // ------------------------------------------------------------------ e-mail + password (supplementary)

  private async cred(principalId: string): Promise<CredentialDoc> {
    const cred = await this.ct.c.credentials.findOne({ _id: principalId });
    if (!cred) throw new DomainError('NOT_FOUND', 'credentials not found');
    return cred;
  }

  private emailDeliver(to: string, text: (code: string) => string) {
    return (code: string, challengeId: string) => this.ct.adapters.email.send({ to, subject: 'کد تأیید', text: text(code), idempotencyKey: challengeId });
  }

  /** Adds or changes the e-mail (+ password). Becomes login-capable only after the code is confirmed. Changing a verified e-mail needs recent re-verification. */
  async startEmail(principalId: string, sessionId: string, email: string, password: string, ctx: AuthCtx): Promise<ChallengeInfo> {
    const cred = await this.cred(principalId);
    if (cred.email) await this.requireRecentReauth(sessionId);
    const owner = await this.ct.c.credentials.findOne({ email, _id: { $ne: principalId } }, { projection: { _id: 1 } });
    if (owner) {
      await openAccountReview(this.ct.c, [principalId, owner._id], 'email_collision', { kind: 'email' }, { audit: this.ct.audit, requestId: ctx.requestId });
    } else {
      await this.ct.c.credentials.updateOne({ _id: principalId }, { $set: { pendingEmail: email, passwordHash: hashPassword(password), updatedAt: iso() }, $inc: { version: 1 } });
    }
    await this.audit(principalId, 'auth.email.start', principalId, ctx.requestId);
    return this.issueChallenge({ purpose: 'email_verify', target: email, principalId, ctx, deliver: owner ? null : this.emailDeliver(email, (code) => `کد تأیید ایمیل شما: ${code}`) });
  }

  async verifyEmail(principalId: string, sessionId: string, code: string, ctx: AuthCtx): Promise<void> {
    const cred = await this.cred(principalId);
    if (!cred.pendingEmail) throw new DomainError('OTP_INVALID', OTP_FAIL);
    await this.consumeChallenge('email_verify', cred.pendingEmail, code, principalId);
    const now = iso();
    try {
      await this.ct.dbh.withTransaction(async (session) => {
        await this.ct.c.credentials.updateOne(
          { _id: principalId },
          {
            $set: { email: cred.pendingEmail!, emailVerifiedAt: now, pendingEmail: null, updatedAt: now },
            ...(cred.email ? { $push: { emailHistory: { email: cred.email, from: cred.emailVerifiedAt ?? cred.updatedAt, to: now } } } : {}),
            $inc: { version: 1 },
          },
          { session },
        );
        await this.ct.audit.append({ actorPrincipalId: principalId, action: cred.email ? 'auth.email.change' : 'auth.email.verify', target: { type: 'principal', id: principalId }, scope: SITE, outcome: 'success', requestId: ctx.requestId }, session);
      });
    } catch (err) {
      if (isDup(err)) throw new DomainError('CONFLICT', 'this e-mail cannot be used');
      throw err;
    }
    if (cred.email) await this.ct.sessions.revokeAllForPrincipal(principalId, 'email_changed', sessionId);
  }

  async loginWithEmail(email: string, password: string, totpCode: string | undefined, ctx: AuthCtx): Promise<LoginResult> {
    const bad = () => new DomainError('UNAUTHENTICATED', 'invalid credentials');
    const cred = await this.ct.c.credentials.findOne({ email, emailVerifiedAt: { $ne: null } });
    const locked = !!cred?.lockedUntil && cred.lockedUntil > iso();
    const ok = verifyPassword(password, cred?.passwordHash ?? null);
    if (!cred || locked || !ok) {
      if (cred && !locked) await this.registerFailure(cred._id, ctx.requestId);
      throw bad();
    }
    const principal = await this.ct.c.principals.findOne({ _id: cred._id });
    if (!principal || principal.status !== 'active') throw bad();
    let mfa = false;
    if (cred.totp.enabled) {
      if (!totpCode) throw new DomainError('MFA_REQUIRED', 'second factor code required');
      if (!(await this.checkSecondFactor(cred, totpCode))) {
        await this.registerFailure(cred._id, ctx.requestId);
        throw bad();
      }
      mfa = true;
    }
    await this.ct.c.credentials.updateOne({ _id: cred._id }, { $set: { failedLogins: 0, lockedUntil: null } });
    const now = iso();
    const { token, session } = await this.ct.sessions.create(principal._id, { userAgent: ctx.userAgent ?? null, ip: ctx.ip, reauthAt: now, ...(mfa ? { mfaVerifiedAt: now } : {}) });
    await this.audit(principal._id, 'auth.login.email', session._id, ctx.requestId);
    return { token, session, principalId: principal._id, isNewAccount: false };
  }

  /** Counts a failed password/second-factor attempt and locks the account after the configured number (SEC-002). */
  private async registerFailure(principalId: string, requestId: string): Promise<void> {
    const after = await this.ct.c.credentials.findOneAndUpdate({ _id: principalId }, { $inc: { failedLogins: 1 } }, { returnDocument: 'after' });
    if (after && after.failedLogins >= this.cfg.AUTH_LOGIN_MAX_FAILURES) {
      await this.ct.c.credentials.updateOne({ _id: principalId }, { $set: { failedLogins: 0, lockedUntil: iso(Date.now() + this.cfg.AUTH_LOCKOUT_MINUTES * 60_000) } });
      await this.audit(principalId, 'auth.lockout', principalId, requestId, { minutes: this.cfg.AUTH_LOCKOUT_MINUTES }, 'denied');
    }
  }

  // ------------------------------------------------------------------ recovery (verified e-mail code)

  async requestRecovery(email: string, ctx: AuthCtx): Promise<ChallengeInfo> {
    const cred = await this.ct.c.credentials.findOne({ email, emailVerifiedAt: { $ne: null } }, { projection: { _id: 1 } });
    return this.issueChallenge({ purpose: 'recovery', target: email, principalId: cred?._id ?? null, ctx, deliver: cred ? this.emailDeliver(email, (code) => `کد بازیابی حساب: ${code}`) : null });
  }

  async verifyRecovery(email: string, code: string, ctx: AuthCtx): Promise<LoginResult> {
    const ch = await this.consumeChallenge('recovery', email, code);
    if (!ch.principalId) throw new DomainError('OTP_INVALID', OTP_FAIL);
    const principal = await this.ct.c.principals.findOne({ _id: ch.principalId });
    if (!principal || principal.status !== 'active') throw new DomainError('OTP_INVALID', OTP_FAIL);
    await this.ct.sessions.revokeAllForPrincipal(principal._id, 'account_recovery');
    await this.ct.c.credentials.updateOne({ _id: principal._id }, { $set: { failedLogins: 0, lockedUntil: null } });
    const { token, session } = await this.ct.sessions.create(principal._id, { userAgent: ctx.userAgent ?? null, ip: ctx.ip, reauthAt: iso() });
    await this.audit(principal._id, 'auth.recovery', session._id, ctx.requestId);
    return { token, session, principalId: principal._id, isNewAccount: false };
  }

  // ------------------------------------------------------------------ phone change (USR-010)

  async requestPhoneChange(principalId: string, sessionId: string, newPhone: string, ctx: AuthCtx): Promise<ChallengeInfo> {
    await this.requireRecentReauth(sessionId);
    const cred = await this.cred(principalId);
    if (cred.phone === newPhone) throw new DomainError('VALIDATION_FAILED', 'this is already your number');
    const owner = await this.ct.c.credentials.findOne({ phone: newPhone }, { projection: { _id: 1 } });
    if (owner) await openAccountReview(this.ct.c, [principalId, owner._id], 'phone_collision', { kind: 'phone_change' }, { audit: this.ct.audit, requestId: ctx.requestId });
    await this.audit(principalId, 'auth.phone_change.request', principalId, ctx.requestId);
    return this.issueChallenge({ purpose: 'phone_change', target: newPhone, principalId, ctx, deliver: owner ? null : this.sms(newPhone, (code) => `کد تأیید شماره جدید: ${code}`) });
  }

  async verifyPhoneChange(principalId: string, sessionId: string, newPhone: string, code: string, ctx: AuthCtx): Promise<void> {
    await this.requireRecentReauth(sessionId);
    await this.consumeChallenge('phone_change', newPhone, code, principalId);
    const cred = await this.cred(principalId);
    const now = iso();
    try {
      await this.ct.dbh.withTransaction(async (session) => {
        await this.ct.c.credentials.updateOne(
          { _id: principalId },
          {
            $set: { phone: newPhone, phoneVerifiedAt: now, updatedAt: now },
            ...(cred.phone ? { $push: { phoneHistory: { phone: cred.phone, from: cred.phoneVerifiedAt ?? cred.updatedAt, to: now, reason: 'changed' } } } : {}),
            $inc: { version: 1 },
          },
          { session },
        );
        await this.ct.audit.append({ actorPrincipalId: principalId, action: 'auth.phone_change', target: { type: 'principal', id: principalId }, scope: SITE, outcome: 'success', requestId: ctx.requestId }, session);
        await this.ct.outbox.append({ type: 'identity.phone.changed', aggregate: { type: 'principal', id: principalId }, aggregateVersion: cred.version + 1, actor: { principalId, kind: 'user' }, payload: {}, correlationId: ctx.requestId }, session);
      });
    } catch (err) {
      if (isDup(err)) throw new DomainError('CONFLICT', 'this number cannot be used');
      throw err;
    }
    await this.ct.sessions.revokeAllForPrincipal(principalId, 'phone_changed', sessionId);
  }

  // ------------------------------------------------------------------ sessions

  async logoutOthers(principalId: string, currentSessionId: string, ctx: AuthCtx): Promise<number> {
    const n = await this.ct.sessions.revokeAllForPrincipal(principalId, 'logout_others', currentSessionId);
    await this.audit(principalId, 'session.revoke_others', currentSessionId, ctx.requestId, { count: n });
    return n;
  }

  // ------------------------------------------------------------------ TOTP 2FA (RFC 6238)

  async totpSetup(principalId: string, label: string, ctx: AuthCtx): Promise<{ secret: string; otpauthUri: string; recoveryCodes: string[] }> {
    const cred = await this.cred(principalId);
    if (cred.totp.enabled) throw new DomainError('CONFLICT', 'two-factor authentication is already enabled');
    const secret = newTotpSecret();
    const recoveryCodes = newRecoveryCodes();
    await this.ct.c.credentials.updateOne({ _id: principalId }, { $set: { 'totp.pendingSecretEnc': seal(this.cfg.appSecret, secret), 'totp.recoveryCodeHashes': recoveryCodes.map((r) => this.rcHash(r)), updatedAt: iso() }, $inc: { version: 1 } });
    await this.audit(principalId, 'auth.totp.setup', principalId, ctx.requestId);
    return { secret, otpauthUri: otpauthUri(secret, label), recoveryCodes };
  }

  async totpConfirm(principalId: string, sessionId: string, code: string, ctx: AuthCtx): Promise<void> {
    const cred = await this.cred(principalId);
    this.guardLocked(cred);
    if (cred.totp.enabled || !cred.totp.pendingSecretEnc) throw new DomainError('PRECONDITION_FAILED', 'no pending two-factor setup');
    if (!verifyTotp(base32Decode(unseal(this.cfg.appSecret, cred.totp.pendingSecretEnc)), code)) {
      await this.registerFailure(principalId, ctx.requestId);
      throw new DomainError('OTP_INVALID', 'invalid code');
    }
    const now = iso();
    await this.ct.c.credentials.updateOne({ _id: principalId }, { $set: { 'totp.enabled': true, 'totp.secretEnc': cred.totp.pendingSecretEnc, 'totp.pendingSecretEnc': null, 'totp.enabledAt': now, failedLogins: 0, updatedAt: now }, $inc: { version: 1 } });
    await this.ct.sessions.stamp(sessionId, { mfa: true, reauth: true });
    await this.audit(principalId, 'auth.totp.enable', principalId, ctx.requestId);
  }

  async totpDisable(principalId: string, code: string, ctx: AuthCtx): Promise<void> {
    const cred = await this.cred(principalId);
    this.guardLocked(cred);
    if (!cred.totp.enabled) throw new DomainError('PRECONDITION_FAILED', 'two-factor authentication is not enabled');
    if (!(await this.checkSecondFactor(cred, code))) {
      await this.registerFailure(principalId, ctx.requestId);
      throw new DomainError('OTP_INVALID', 'invalid code');
    }
    await this.ct.c.credentials.updateOne({ _id: principalId }, { $set: { totp: { enabled: false, secretEnc: null, pendingSecretEnc: null, recoveryCodeHashes: [], enabledAt: null }, failedLogins: 0, updatedAt: iso() }, $inc: { version: 1 } });
    await this.ct.c.sessions.updateMany({ principalId }, { $set: { mfaVerifiedAt: null } });
    await this.audit(principalId, 'auth.totp.disable', principalId, ctx.requestId);
  }

  /** Step-up: proves the second factor on an existing session so MFA-gated roles apply. */
  async stepUp(principalId: string, sessionId: string, code: string, ctx: AuthCtx): Promise<void> {
    const cred = await this.cred(principalId);
    if (!cred.totp.enabled) throw new DomainError('MFA_ENROLLMENT_REQUIRED', 'enroll a second factor first');
    this.guardLocked(cred);
    if (!(await this.checkSecondFactor(cred, code))) {
      await this.registerFailure(principalId, ctx.requestId);
      await this.audit(principalId, 'auth.stepup', sessionId, ctx.requestId, undefined, 'denied');
      throw new DomainError('OTP_INVALID', 'invalid code');
    }
    await this.ct.sessions.stamp(sessionId, { mfa: true, reauth: true });
    await this.ct.c.credentials.updateOne({ _id: principalId }, { $set: { failedLogins: 0 } });
    await this.audit(principalId, 'auth.stepup', sessionId, ctx.requestId);
  }

  async mfaStatus(principalId: string, session: SessionDoc) {
    const cred = await this.cred(principalId);
    const grants = await this.ct.acl.activeGrants(principalId);
    return { enabled: cred.totp.enabled, enabledAt: cred.totp.enabledAt, sessionVerified: !!session.mfaVerifiedAt, requiredByRole: grants.some((g) => (MfaRequiredRoles as readonly string[]).includes(g.role)), enforced: this.cfg.mfaEnforced };
  }

  private rcHash(code: string) {
    return hmacHex(this.cfg.appSecret, `rc:${code.trim().toLowerCase()}`);
  }

  private guardLocked(cred: CredentialDoc): void {
    if (cred.lockedUntil && cred.lockedUntil > iso()) throw new DomainError('RATE_LIMITED', 'too many failed attempts; try later');
  }

  /** TOTP code or a one-time recovery code (consumed atomically). */
  private async checkSecondFactor(cred: CredentialDoc, code: string): Promise<boolean> {
    if (!cred.totp.enabled || !cred.totp.secretEnc) return false;
    if (/^\d{6}$/.test(code)) {
      const step = totpMatchStep(base32Decode(unseal(this.cfg.appSecret, cred.totp.secretEnc)), code);
      if (step === null) return false;
      // replay protection: a step is usable once; conditional update makes concurrent reuse lose
      const r = await this.ct.c.credentials.updateOne({ _id: cred._id, $or: [{ 'totp.lastUsedStep': { $exists: false } }, { 'totp.lastUsedStep': { $lt: step } }] }, { $set: { 'totp.lastUsedStep': step } });
      return r.modifiedCount === 1;
    }
    const h = this.rcHash(code);
    const r = await this.ct.c.credentials.updateOne({ _id: cred._id, 'totp.recoveryCodeHashes': h }, { $pull: { 'totp.recoveryCodeHashes': h } });
    return r.modifiedCount === 1;
  }
}
