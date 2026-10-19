import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import { normalizeIranMobile } from '@esp/contracts';
import { testContainer, rid } from '../test/harness.js';
import { seedIds } from '../db/seed.js';
import { REDACT_PATHS } from '../logging.js';
import { AccountService, AuthService, assertMfaForRole, base32Decode, hotp, seedIdentityDomain, totpAt, type AuthCtx } from './auth.js';
import { openAccountReview } from './reviews.js';

let t: Awaited<ReturnType<typeof testContainer>>;
let auth: AuthService;
let account: AccountService;
const sms: Array<{ to: string; text: string; kind: string; idempotencyKey: string }> = [];
const mails: Array<{ to: string; text: string }> = [];
let smsMode: 'ok' | 'failed' | 'throw' | 'hang' | 'slow' = 'ok';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ctx = (ip: string | null = null): AuthCtx => ({ ip, requestId: rid(), userAgent: 'vitest' });
const codeOf = (text: string) => /\d{6}/.exec(text)![0];
const lastSms = (to: string) => codeOf([...sms].reverse().find((m) => m.to === to)!.text);
const lastMail = (to: string) => codeOf([...mails].reverse().find((m) => m.to === to)!.text);
let phoneSeq = 0;
const freshPhone = () => `+98912${String(7000000 + ++phoneSeq)}`;

async function login(phone = freshPhone(), ip: string | null = null) {
  await auth.requestLoginOtp(phone, ctx(ip));
  const res = await auth.verifyLoginOtp(phone, lastSms(phone), ctx(ip));
  return { phone, ...res };
}
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code);

beforeAll(async () => {
  t = await testContainer({ seed: true });
  await seedIdentityDomain(t.c);
  const base = { name: 'test-sms', mode: 'development_double' as const, capabilities: [] as string[], health: async () => ({}) as never };
  t.adapters.sms = {
    ...base,
    async send(i) {
      if (smsMode === 'throw') throw new Error('boom');
      if (smsMode === 'failed') return { status: 'failed', providerRef: null };
      if (smsMode === 'hang') await wait(5000);
      if (smsMode === 'slow') await wait(150);
      sms.push(i);
      return { status: 'sent', providerRef: 'x' };
    },
  };
  t.adapters.email = {
    ...base,
    async send(i) {
      mails.push(i);
      return { status: 'sent', providerRef: 'x' };
    },
  };
  auth = new AuthService(t);
  account = new AccountService(t);
});
afterAll(async () => {
  await t.drop();
});
beforeEach(() => {
  smsMode = 'ok';
  t.config.AUTH_OTP_RESEND_SECONDS = 0;
  t.config.AUTH_OTP_PHONE_HOURLY = 50;
  t.config.AUTH_OTP_IP_HOURLY = 500;
  t.config.AUTH_SMS_TIMEOUT_MS = 8000;
  t.config.mfaEnforced = false;
});

describe('mobile OTP login (USR-001/002, SEC-002)', () => {
  it('signs up on first verify, atomically, and logs in again without duplicates; Persian digits equal Latin', async () => {
    expect(normalizeIranMobile('۰۹۱۲۱۲۳۴۵۶۷')).toBe(normalizeIranMobile('09121234567'));
    const phone = normalizeIranMobile('۰۹۱۲۱۲۳۴۵۶۷')!;
    const ch = await auth.requestLoginOtp(phone, ctx());
    const m = sms.find((s) => s.to === phone)!;
    expect(m.kind).toBe('otp');
    expect(m.idempotencyKey).toBe(ch.challengeId);
    const stored = await t.c.otpChallenges.findOne({ _id: ch.challengeId });
    expect(JSON.stringify(stored)).not.toContain(codeOf(m.text)); // salted hash only
    const a = await auth.verifyLoginOtp(phone, codeOf(m.text), ctx());
    expect(a.isNewAccount).toBe(true);
    expect(await t.c.credentials.countDocuments({ phone })).toBe(1);
    expect((await t.c.profiles.findOne({ _id: a.principalId }))?.nickname).toMatch(/^player_/);
    expect((await t.c.grants.find({ principalId: a.principalId }).toArray()).map((g) => g.role)).toEqual(['player']);
    expect(await t.sessions.resolve(a.token)).not.toBeNull();
    const b = await login(phone);
    expect(b.isNewAccount).toBe(false);
    expect(b.principalId).toBe(a.principalId);
  });

  it('answers identically for registered and unknown phones', async () => {
    const known = (await login()).phone;
    const unknown = freshPhone();
    const x = await auth.requestLoginOtp(known, ctx());
    const y = await auth.requestLoginOtp(unknown, ctx());
    expect(Object.keys(x)).toEqual(Object.keys(y));
    expect(x.message).toBe(y.message);
    expect(x.resendAfterSeconds).toBe(y.resendAfterSeconds);
    expect(sms.some((s) => s.to === unknown)).toBe(true);
  });

  it('rejects wrong, expired, consumed codes and kills a challenge after max attempts', async () => {
    const p1 = freshPhone();
    const ch = await auth.requestLoginOtp(p1, ctx());
    await t.c.otpChallenges.updateOne({ _id: ch.challengeId }, { $set: { expiresAt: new Date(Date.now() - 1000).toISOString() } });
    expect(await code(auth.verifyLoginOtp(p1, lastSms(p1), ctx()))).toBe('OTP_INVALID');

    const p2 = freshPhone();
    await login(p2);
    expect(await code(auth.verifyLoginOtp(p2, lastSms(p2), ctx()))).toBe('OTP_INVALID'); // consumed

    const p3 = freshPhone();
    await auth.requestLoginOtp(p3, ctx());
    const good = lastSms(p3);
    const wrong = good === '000000' ? '000001' : '000000';
    for (let i = 0; i < t.config.AUTH_OTP_MAX_ATTEMPTS; i++) expect(await code(auth.verifyLoginOtp(p3, wrong, ctx()))).toBe('OTP_INVALID');
    expect(await code(auth.verifyLoginOtp(p3, good, ctx()))).toBe('OTP_INVALID'); // dead even with the right code
    expect(await t.c.credentials.countDocuments({ phone: p3 })).toBe(0);
  });

  it('enforces resend cooldown, per-phone and per-IP hourly limits', async () => {
    t.config.AUTH_OTP_RESEND_SECONDS = 60;
    const p = freshPhone();
    await auth.requestLoginOtp(p, ctx());
    expect(await code(auth.requestLoginOtp(p, ctx()))).toBe('RATE_LIMITED');

    t.config.AUTH_OTP_RESEND_SECONDS = 0;
    t.config.AUTH_OTP_PHONE_HOURLY = 3;
    const q = freshPhone();
    for (let i = 0; i < 3; i++) await auth.requestLoginOtp(q, ctx());
    expect(await code(auth.requestLoginOtp(q, ctx()))).toBe('RATE_LIMITED');

    t.config.AUTH_OTP_IP_HOURLY = 2;
    await auth.requestLoginOtp(freshPhone(), ctx('10.9.9.9'));
    await auth.requestLoginOtp(freshPhone(), ctx('10.9.9.9'));
    expect(await code(auth.requestLoginOtp(freshPhone(), ctx('10.9.9.9')))).toBe('RATE_LIMITED');
  });

  it('SMS provider failure is never a silent success; slow providers are tolerated, hanging ones time out', async () => {
    const p = freshPhone();
    smsMode = 'failed';
    expect(await code(auth.requestLoginOtp(p, ctx()))).toBe('PROVIDER_UNAVAILABLE');
    smsMode = 'throw';
    expect(await code(auth.requestLoginOtp(p, ctx()))).toBe('PROVIDER_UNAVAILABLE');
    const failed = await t.c.otpChallenges.find({ target: p }).toArray();
    expect(failed.length).toBe(2);
    expect(failed.every((f) => f.deliveryFailedAt)).toBe(true);
    smsMode = 'hang';
    t.config.AUTH_SMS_TIMEOUT_MS = 50;
    expect(await code(auth.requestLoginOtp(p, ctx()))).toBe('PROVIDER_UNAVAILABLE');
    smsMode = 'slow';
    t.config.AUTH_SMS_TIMEOUT_MS = 8000;
    await auth.requestLoginOtp(p, ctx());
    expect((await auth.verifyLoginOtp(p, lastSms(p), ctx())).isNewAccount).toBe(true);
  });

  it('never writes the OTP or the SMS text to logs', async () => {
    const lines: string[] = [];
    const original = t.logger;
    t.logger = pino({ level: 'trace', redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, { write: (s: string) => void lines.push(s) });
    try {
      const p = freshPhone();
      await auth.requestLoginOtp(p, ctx());
      const c = lastSms(p);
      await auth.verifyLoginOtp(p, c, ctx());
      smsMode = 'failed';
      await code(auth.requestLoginOtp(freshPhone(), ctx()));
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join('')).not.toContain(c);
      expect(lines.join('')).not.toContain('کد ورود');
    } finally {
      t.logger = original;
    }
  });

  it('parallel verifies of the same code create exactly one account', async () => {
    const p = freshPhone();
    await auth.requestLoginOtp(p, ctx());
    const c = lastSms(p);
    const res = await Promise.allSettled([auth.verifyLoginOtp(p, c, ctx()), auth.verifyLoginOtp(p, c, ctx())]);
    expect(res.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(await t.c.credentials.countDocuments({ phone: p })).toBe(1);
    expect(await t.c.principals.countDocuments({ _id: (await t.c.credentials.findOne({ phone: p }))!._id })).toBe(1);
  });

  it('opens an account review (no merge) after many signups from one IP', async () => {
    const ip = '10.1.2.3';
    const ids: string[] = [];
    for (let i = 0; i < t.config.AUTH_SIGNUP_IP_REVIEW_THRESHOLD; i++) ids.push((await login(freshPhone(), ip)).principalId);
    const review = await t.c.accountReviews.findOne({ reason: 'many_signups_same_ip', principalIds: ids[0]! });
    expect(review?.state).toBe('open');
    expect(review?.principalIds.sort()).toEqual([...ids].sort());
    expect(JSON.stringify(review)).not.toContain(ip);
    const again = await openAccountReview(t.c, ids, 'many_signups_same_ip', {});
    expect(again._id).toBe(review!._id); // deduplicated
    expect((await t.c.principals.find({ _id: { $in: ids } }).toArray()).every((p) => p.status === 'active')).toBe(true);
  });
});

describe('e-mail + password, lockout, recovery (USR-001/009)', () => {
  it('logs in by e-mail only after verification; locks out after repeated failures', async () => {
    const u = await login();
    const email = 'player1@example.ir';
    const pw = 'correct horse battery';
    await auth.startEmail(u.principalId, u.session._id, email, pw, ctx());
    expect(await code(auth.loginWithEmail(email, pw, undefined, ctx()))).toBe('UNAUTHENTICATED'); // unverified
    expect(await code(auth.verifyEmail(u.principalId, u.session._id, '000000', ctx()))).toBe('OTP_INVALID');
    await auth.verifyEmail(u.principalId, u.session._id, lastMail(email), ctx());
    const ok = await auth.loginWithEmail(email, pw, undefined, ctx());
    expect(ok.principalId).toBe(u.principalId);
    expect((await t.c.credentials.findOne({ _id: u.principalId }))?.passwordHash).toMatch(/^[0-9a-f]{32}\$[0-9a-f]{128}$/);
    for (let i = 0; i < t.config.AUTH_LOGIN_MAX_FAILURES; i++) expect(await code(auth.loginWithEmail(email, 'wrong password!!', undefined, ctx()))).toBe('UNAUTHENTICATED');
    expect(await code(auth.loginWithEmail(email, pw, undefined, ctx()))).toBe('UNAUTHENTICATED'); // locked even with the right password
    await t.c.credentials.updateOne({ _id: u.principalId }, { $set: { lockedUntil: new Date(Date.now() - 1000).toISOString() } });
    expect(await code(auth.loginWithEmail(email, pw, undefined, ctx()))).toBe('ok');
  });

  it('recovers through a verified e-mail code, revoking every older session; unknown e-mails look the same', async () => {
    const u = await login();
    const email = 'recover1@example.ir';
    await auth.startEmail(u.principalId, u.session._id, email, 'another long password', ctx());
    await auth.verifyEmail(u.principalId, u.session._id, lastMail(email), ctx());
    const unknown = await auth.requestRecovery('nobody@example.ir', ctx());
    const real = await auth.requestRecovery(email, ctx());
    expect(Object.keys(unknown)).toEqual(Object.keys(real));
    expect(mails.some((m) => m.to === 'nobody@example.ir')).toBe(false);
    expect(await code(auth.verifyRecovery('nobody@example.ir', '123456', ctx()))).toBe('OTP_INVALID');
    const r = await auth.verifyRecovery(email, lastMail(email), ctx());
    expect(await t.sessions.resolve(u.token)).toBeNull();
    expect(await t.sessions.resolve(r.token)).not.toBeNull();
  });

  it('an e-mail already verified by another account is not claimable (silent decoy + review)', async () => {
    const a = await login();
    const b = await login();
    await auth.startEmail(a.principalId, a.session._id, 'shared@example.ir', 'a long password 1', ctx());
    await auth.verifyEmail(a.principalId, a.session._id, lastMail('shared@example.ir'), ctx());
    const before = mails.length;
    await auth.startEmail(b.principalId, b.session._id, 'shared@example.ir', 'a long password 2', ctx());
    expect(mails.length).toBe(before);
    expect(await t.c.accountReviews.countDocuments({ reason: 'email_collision', principalIds: b.principalId })).toBe(1);
  });
});

describe('phone change, sessions and revocation (USR-009/010, ACL-002)', () => {
  async function liveStream(sessionId: string, principalId: string) {
    let reason = '';
    const channel = `ch:${sessionId}`;
    t.realtime.subscribe({ principalId, sessionId }, { after: 0, channels: [channel], onEvent: () => undefined, onClose: (r) => (reason = r) });
    await wait(30);
    return async () => {
      await t.realtime.publish({ channel, type: 'x', audience: { kind: 'public' }, payload: {} });
      await wait(100);
      return reason;
    };
  }

  it('changes the phone with a code to the NEW number, keeps history, frees the old number and revokes other sessions', async () => {
    const u = await login();
    const other = await t.sessions.create(u.principalId);
    const live = await liveStream(other.session._id, u.principalId);
    const np = freshPhone();
    await auth.requestPhoneChange(u.principalId, u.session._id, np, ctx());
    expect(await code(auth.verifyPhoneChange(u.principalId, u.session._id, np, '000000', ctx()))).toBe('OTP_INVALID');
    await auth.verifyPhoneChange(u.principalId, u.session._id, np, lastSms(np), ctx());
    const cred = (await t.c.credentials.findOne({ _id: u.principalId }))!;
    expect(cred.phone).toBe(np);
    expect(cred.phoneHistory[0]).toMatchObject({ phone: u.phone, reason: 'changed' });
    expect(await t.sessions.resolve(u.token)).not.toBeNull();
    expect(await t.sessions.resolve(other.token)).toBeNull();
    expect(await live()).toBe('session_revoked');
    expect((await login(u.phone)).isNewAccount).toBe(true); // old number is free again
  });

  it('requires a fresh re-verification and never reveals or merges when the new number belongs to someone else', async () => {
    const u = await login();
    const v = await login();
    await t.c.sessions.updateOne({ _id: u.session._id }, { $set: { reauthAt: new Date(Date.now() - 3600_000).toISOString() } });
    expect(await code(auth.requestPhoneChange(u.principalId, u.session._id, freshPhone(), ctx()))).toBe('PRECONDITION_FAILED');
    await auth.requestReauthOtp(u.principalId, ctx());
    await auth.verifyReauthOtp(u.principalId, u.session._id, lastSms(u.phone), ctx());
    const before = sms.length;
    const x = await auth.requestPhoneChange(u.principalId, u.session._id, v.phone, ctx());
    expect(x.message).toBeTruthy();
    expect(sms.length).toBe(before); // nothing sent to the real owner, response identical
    expect(await code(auth.verifyPhoneChange(u.principalId, u.session._id, v.phone, '123456', ctx()))).toBe('OTP_INVALID');
    expect(await t.c.accountReviews.countDocuments({ reason: 'phone_collision', principalIds: { $all: [u.principalId, v.principalId] } })).toBe(1);
    expect((await t.c.credentials.findOne({ _id: v.principalId }))?.phone).toBe(v.phone);
  });

  it('logout-all-others revokes the other sessions and closes their live streams', async () => {
    const u = await login();
    const o = await t.sessions.create(u.principalId);
    const live = await liveStream(o.session._id, u.principalId);
    expect(await auth.logoutOthers(u.principalId, u.session._id, ctx())).toBe(1);
    expect(await live()).toBe('session_revoked');
    expect(await t.sessions.resolve(u.token)).not.toBeNull();
  });
});

describe('TOTP and MFA enforcement (USR-009)', () => {
  it('matches the RFC 6238 test vector and keeps the secret encrypted at rest', async () => {
    expect(hotp(Buffer.from('12345678901234567890'), Math.floor(59 / 30))).toBe('287082');
    const u = await login();
    const s = await auth.totpSetup(u.principalId, 'x', ctx());
    expect(s.otpauthUri).toContain(s.secret);
    expect(JSON.stringify(await t.c.credentials.findOne({ _id: u.principalId }))).not.toContain(s.secret);
    expect(await code(auth.totpConfirm(u.principalId, u.session._id, '000000'.replace(/0/g, '1'), ctx()))).toBe('OTP_INVALID');
    await auth.totpConfirm(u.principalId, u.session._id, totpAt(base32Decode(s.secret)), ctx());
    expect((await t.c.credentials.findOne({ _id: u.principalId }))?.totp.enabled).toBe(true);
    expect(await code(auth.totpSetup(u.principalId, 'x', ctx()))).toBe('CONFLICT');
  });

  it('gates MFA roles: enrolment required, then MFA_REQUIRED, then step-up (TOTP or one-time recovery code) unlocks', async () => {
    t.config.mfaEnforced = true;
    const fin = seedIds.finance;
    const mk = async () => {
      const { token } = await t.sessions.create(fin, { reauthAt: new Date().toISOString() });
      return (await t.sessions.resolve(token))!;
    };
    let s = await mk();
    expect(await code(assertMfaForRole(t, s, 'finance_officer'))).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(await code(assertMfaForRole(t, s, 'player'))).toBe('ok');
    const setup = await auth.totpSetup(fin, 'fin', ctx());
    await auth.totpConfirm(fin, s.session._id, totpAt(base32Decode(setup.secret)), ctx());
    s = await mk();
    expect(await code(assertMfaForRole(t, s, 'finance_officer'))).toBe('MFA_REQUIRED');
    expect(await code(auth.stepUp(fin, s.session._id, '123456', ctx()))).toBe('OTP_INVALID');
    await auth.stepUp(fin, s.session._id, totpAt(base32Decode(setup.secret)), ctx());
    // replay protection: the same TOTP code (same time step) cannot be used twice
    const replaySession = (await t.sessions.resolve((await t.sessions.create(fin)).token))!;
    expect(await code(auth.stepUp(fin, replaySession.session._id, totpAt(base32Decode(setup.secret)), ctx()))).toBe('OTP_INVALID');
    s = (await t.sessions.resolve((await t.sessions.create(fin)).token))!;
    expect(await code(assertMfaForRole(t, s, 'finance_officer'))).toBe('MFA_REQUIRED'); // new session needs its own step-up
    const rc = setup.recoveryCodes[0]!;
    await auth.stepUp(fin, s.session._id, rc, ctx());
    const verified = (await t.c.sessions.findOne({ _id: s.session._id }))!;
    expect(await code(assertMfaForRole(t, { ...s, session: verified }, 'finance_officer'))).toBe('ok');
    expect(await code(auth.stepUp(fin, s.session._id, rc, ctx()))).toBe('OTP_INVALID'); // recovery code is single use
    t.config.mfaEnforced = false;
    expect(await code(assertMfaForRole(t, await mk(), 'finance_officer'))).toBe('ok'); // flag off in dev/test
    await auth.totpDisable(fin, totpAt(base32Decode(setup.secret), Date.now() + 30_000), ctx()); // next step: previous one already used
    expect((await t.c.credentials.findOne({ _id: fin }))?.totp.enabled).toBe(false);
  });

  it('locks second-factor guessing', async () => {
    const u = await login();
    const s = await auth.totpSetup(u.principalId, 'x', ctx());
    await auth.totpConfirm(u.principalId, u.session._id, totpAt(base32Decode(s.secret)), ctx());
    for (let i = 0; i < t.config.AUTH_LOGIN_MAX_FAILURES; i++) await code(auth.stepUp(u.principalId, u.session._id, '000000', ctx()));
    expect(await code(auth.stepUp(u.principalId, u.session._id, totpAt(base32Decode(s.secret)), ctx()))).toBe('RATE_LIMITED');
  });
});

describe('export and deletion (ADM-012, DATA-006)', () => {
  it('export contains own data and no secrets', async () => {
    const u = await login();
    await auth.startEmail(u.principalId, u.session._id, 'exp1@example.ir', 'export password 1', ctx());
    const s = await auth.totpSetup(u.principalId, 'x', ctx());
    const out = JSON.stringify(await account.exportData(u.principalId, ctx()));
    expect(out).toContain(u.phone);
    for (const secret of [(await t.c.credentials.findOne({ _id: u.principalId }))!.passwordHash!, s.secret, s.recoveryCodes[0]!, 'tokenHash', 'secretEnc', 'passwordHash', u.token]) expect(out).not.toContain(secret);
  });

  it('deletion needs fresh re-verification, anonymizes, revokes everything and keeps historical snapshots', async () => {
    const pid = seedIds.player;
    const stale = await t.sessions.create(pid);
    expect(await code(account.deleteAccount(pid, stale.session._id, ctx()))).toBe('PRECONDITION_FAILED');
    await t.c.follows.insertOne({ _id: 'fol_x', followerId: pid, targetType: 'team', targetId: seedIds.teamA, createdAt: new Date().toISOString() });
    const { token, session } = await t.sessions.create(pid, { reauthAt: new Date().toISOString() });
    let closed = '';
    t.realtime.subscribe({ principalId: pid, sessionId: session._id }, { after: 0, channels: ['ch:del'], onEvent: () => undefined, onClose: (r) => (closed = r) });
    await wait(30);
    await account.deleteAccount(pid, session._id, ctx());
    await t.realtime.publish({ channel: 'ch:del', type: 'x', audience: { kind: 'public' }, payload: {} });
    await wait(100);
    expect(closed).toBe('session_revoked');
    expect(await t.sessions.resolve(token)).toBeNull();
    const p = (await t.c.principals.findOne({ _id: pid }))!;
    expect(p).toMatchObject({ displayName: 'کاربر حذف‌شده', status: 'deleted' });
    expect(p.deletedAt && p.anonymizedAt).toBeTruthy();
    const cred = (await t.c.credentials.findOne({ _id: pid }))!;
    expect(cred).toMatchObject({ phone: null, email: null, passwordHash: null });
    expect(JSON.stringify(cred.phoneHistory)).not.toContain('+98');
    expect((await t.c.profiles.findOne({ _id: pid }))?.nickname).toMatch(/^deleted-/);
    expect(await t.c.grants.countDocuments({ principalId: pid, revokedAt: null })).toBe(0);
    expect(await t.c.follows.countDocuments({ followerId: pid })).toBe(0);
    const part = (await t.c.participations.findOne({ _id: seedIds.participationA2 }))!;
    expect(part.snapshot.roster[0]?.displayName).toBe('بازیکن (seed)');
    expect((await t.c.matches.findOne({ _id: seedIds.matchA }))!.sides[1]!.roster[0]!.displayName).toBe('بازیکن (seed)');
    expect(await t.c.audit.countDocuments({ action: 'account.delete', actorPrincipalId: pid })).toBe(1);
    // the number can sign up again as a brand-new account
    const again = await login(normalizeIranMobile('+989000000007')!);
    expect(again.isNewAccount).toBe(true);
    expect(again.principalId).not.toBe(pid);
  });

  it('seedIdentityDomain is idempotent and labelled', async () => {
    await seedIdentityDomain(t.c);
    const admin = await t.c.credentials.findOne({ _id: seedIds.admin });
    expect(admin?.phone).toBe('+989000000001');
    expect((await t.c.profiles.findOne({ _id: seedIds.admin }))?.nickname).toBe('seed_admin');
    expect(JSON.stringify(admin)).toContain('TEST ONLY');
  });
});
