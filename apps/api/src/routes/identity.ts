import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AccountDeleteSchema,
  AccountExportSchema,
  DevInboxSmsQuerySchema,
  DomainError,
  EmailLoginSchema,
  EmailRegisterSchema,
  EmailVerifySchema,
  ErrorResponse,
  MfaStatusSchema,
  OtpChallengeResponseSchema,
  OtpCodeSchema,
  OtpRequestSchema,
  OtpVerifySchema,
  PhoneChangeRequestSchema,
  PhoneChangeVerifySchema,
  RecoveryRequestSchema,
  RecoveryVerifySchema,
  TotpCodeSchema,
  TotpSetupResponseSchema,
} from '@esp/contracts';
import { AccountService, AuthService, readDevInbox, safeEqual, type AuthCtx, type Container, type LoginResult } from '@esp/core';
import { setSessionCookie } from '../plugins/auth.js';

const LoginOut = z.object({ isNewAccount: z.boolean(), principalId: z.string(), mfaVerified: z.boolean() });
const strict = { rateLimit: { max: 10, timeWindow: '1 minute' } };
const errs = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 429: ErrorResponse, 503: ErrorResponse };

const ctxOf = (req: FastifyRequest): AuthCtx => ({ ip: req.ip, requestId: req.id, userAgent: req.headers['user-agent'] ?? null });

/** USR-001/002/009/010, ADM-012/DATA-006, SEC-002. Auth service is stateless; built from the container here. */
export function identityRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = new AuthService(container);
  const account = new AccountService(container);

  const startSession = (reply: Parameters<typeof setSessionCookie>[0], res: LoginResult) => {
    setSessionCookie(reply, res.token, container.config.isProduction, container.config.SESSION_TTL_HOURS * 3600);
    return { isNewAccount: res.isNewAccount, principalId: res.principalId, mfaVerified: !!res.session.mfaVerifiedAt };
  };

  // ---- mobile OTP (the same response whether or not the number is registered)
  r.post('/auth/otp/request', { config: strict, schema: { tags: ['auth'], summary: 'Request a login/signup code by SMS', body: OtpRequestSchema, response: { 200: OtpChallengeResponseSchema, ...errs } } }, async (req) => auth.requestLoginOtp(req.body.phone, ctxOf(req)));

  r.post('/auth/otp/verify', { config: strict, schema: { tags: ['auth'], summary: 'Verify the code; creates the account on first login and issues a session', body: OtpVerifySchema, response: { 200: LoginOut, ...errs } } }, async (req, reply) => startSession(reply, await auth.verifyLoginOtp(req.body.phone, req.body.code, ctxOf(req))));

  // ---- e-mail + password (supplementary)
  r.post('/auth/email/login', { config: strict, schema: { tags: ['auth'], summary: 'Log in with a VERIFIED e-mail and password', body: EmailLoginSchema, response: { 200: LoginOut, ...errs } } }, async (req, reply) => startSession(reply, await auth.loginWithEmail(req.body.email, req.body.password, req.body.totpCode, ctxOf(req))));

  r.post('/me/email', { config: strict, schema: { tags: ['auth'], summary: 'Add or change the e-mail and password; confirmed by a code sent to the e-mail', body: EmailRegisterSchema, response: { 200: OtpChallengeResponseSchema, ...errs } } }, async (req) => {
    const ctx = req.requireAuth();
    return auth.startEmail(ctx.principal._id, ctx.session._id, req.body.email, req.body.password, ctxOf(req));
  });

  r.post('/me/email/verify', { config: strict, schema: { tags: ['auth'], body: EmailVerifySchema, response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    const ctx = req.requireAuth();
    await auth.verifyEmail(ctx.principal._id, ctx.session._id, req.body.code, ctxOf(req));
    return reply.status(204).send(null);
  });

  // ---- account recovery by verified e-mail code
  r.post('/auth/recovery/request', { config: strict, schema: { tags: ['auth'], summary: 'Send a recovery code to a verified e-mail (same response for unknown e-mails)', body: RecoveryRequestSchema, response: { 200: OtpChallengeResponseSchema, ...errs } } }, async (req) => auth.requestRecovery(req.body.email, ctxOf(req)));

  r.post('/auth/recovery/verify', { config: strict, schema: { tags: ['auth'], summary: 'Verify the recovery code: new session, all other sessions revoked', body: RecoveryVerifySchema, response: { 200: LoginOut, ...errs } } }, async (req, reply) => startSession(reply, await auth.verifyRecovery(req.body.email, req.body.code, ctxOf(req))));

  // ---- re-verification of the current session
  r.post('/auth/reauth/otp/request', { config: strict, schema: { tags: ['auth'], summary: 'Send a re-verification code to the current phone', response: { 200: OtpChallengeResponseSchema, ...errs } } }, async (req) => {
    const ctx = req.requireAuth();
    return auth.requestReauthOtp(ctx.principal._id, ctxOf(req));
  });

  r.post('/auth/reauth/otp/verify', { config: strict, schema: { tags: ['auth'], body: OtpCodeSchema, response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    const ctx = req.requireAuth();
    await auth.verifyReauthOtp(ctx.principal._id, ctx.session._id, req.body.code, ctxOf(req));
    return reply.status(204).send(null);
  });

  // ---- phone change (USR-010): fresh session verification + code to the NEW number
  r.post('/me/phone/change/request', { config: strict, schema: { tags: ['auth'], body: PhoneChangeRequestSchema, response: { 200: OtpChallengeResponseSchema, 412: ErrorResponse, ...errs } } }, async (req) => {
    const ctx = req.requireAuth();
    return auth.requestPhoneChange(ctx.principal._id, ctx.session._id, req.body.newPhone, ctxOf(req));
  });

  r.post('/me/phone/change/verify', { config: strict, schema: { tags: ['auth'], body: PhoneChangeVerifySchema, response: { 204: z.null(), 412: ErrorResponse, ...errs } } }, async (req, reply) => {
    const ctx = req.requireAuth();
    await auth.verifyPhoneChange(ctx.principal._id, ctx.session._id, req.body.newPhone, req.body.code, ctxOf(req));
    return reply.status(204).send(null);
  });

  // ---- TOTP two-factor (USR-009)
  r.get('/me/mfa', { schema: { tags: ['auth'], response: { 200: MfaStatusSchema, 401: ErrorResponse } } }, async (req) => {
    const ctx = req.requireAuth();
    return auth.mfaStatus(ctx.principal._id, ctx.session);
  });

  r.post('/me/mfa/totp/setup', { config: strict, schema: { tags: ['auth'], summary: 'Start TOTP enrolment; the secret and recovery codes are shown once', response: { 200: TotpSetupResponseSchema, ...errs } } }, async (req) => {
    const ctx = req.requireAuth();
    return auth.totpSetup(ctx.principal._id, ctx.principal.displayName, ctxOf(req));
  });

  r.post('/me/mfa/totp/confirm', { config: strict, schema: { tags: ['auth'], body: TotpCodeSchema, response: { 204: z.null(), 412: ErrorResponse, ...errs } } }, async (req, reply) => {
    const ctx = req.requireAuth();
    await auth.totpConfirm(ctx.principal._id, ctx.session._id, req.body.code, ctxOf(req));
    return reply.status(204).send(null);
  });

  r.post('/me/mfa/totp/disable', { config: strict, schema: { tags: ['auth'], body: TotpCodeSchema, response: { 204: z.null(), 412: ErrorResponse, ...errs } } }, async (req, reply) => {
    const ctx = req.requireAuth();
    await auth.totpDisable(ctx.principal._id, req.body.code, ctxOf(req));
    return reply.status(204).send(null);
  });

  r.post('/auth/mfa/stepup', { config: strict, schema: { tags: ['auth'], summary: 'Prove the second factor on the current session (TOTP or recovery code)', body: TotpCodeSchema, response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    const ctx = req.requireAuth();
    await auth.stepUp(ctx.principal._id, ctx.session._id, req.body.code, ctxOf(req));
    return reply.status(204).send(null);
  });

  // ---- own data: export and anonymizing deletion (ADM-012, DATA-006)
  r.get('/me/export', { config: strict, schema: { tags: ['auth'], summary: 'Export my own data (no secrets)', response: { 200: AccountExportSchema, 401: ErrorResponse } } }, async (req) => {
    const ctx = req.requireAuth();
    return account.exportData(ctx.principal._id, ctxOf(req));
  });

  r.post('/me/delete', { config: strict, schema: { tags: ['auth'], summary: 'Delete (anonymize) my account; needs a re-verification within the last minutes', body: AccountDeleteSchema, response: { 204: z.null(), 412: ErrorResponse, ...errs } } }, async (req, reply) => {
    const ctx = req.requireAuth();
    await account.deleteAccount(ctx.principal._id, ctx.session._id, ctxOf(req));
    reply.clearCookie('esp_session', { path: '/' });
    return reply.status(204).send(null);
  });

  // ---- protected development inbox (never registered in production)
  if (!container.config.isProduction) {
    r.get('/dev/inbox/sms', { config: strict, schema: { tags: ['dev'], summary: 'DEVELOPMENT ONLY: recent SMS sent to a phone (header x-dev-code)', querystring: DevInboxSmsQuerySchema, response: { 200: z.object({ items: z.array(z.object({ at: z.string(), text: z.string(), kind: z.string() })) }), 401: ErrorResponse } } }, async (req) => {
      const expected = container.config.AUTH_DEV_CODE;
      const given = req.headers['x-dev-code'];
      if (!expected || typeof given !== 'string' || !safeEqual(expected, given)) throw new DomainError('UNAUTHENTICATED', 'invalid development code');
      const rows = await readDevInbox(container.config.DATA_DIR, 'sms.jsonl', req.query.phone);
      return { items: rows.map((x) => ({ at: String(x['at']), text: String(x['text']), kind: String(x['kind']) })) };
    });
  }
}
