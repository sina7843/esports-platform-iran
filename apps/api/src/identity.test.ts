import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { base32Decode, createContainer, runMigrations, seedDatabase, seedIds, seedIdentityDomain, totpAt, type Container } from '@esp/core';
import { buildApp } from './app.js';

let container: Container;
let app: FastifyInstance;
let prodApp: FastifyInstance;
const DEV_CODE = 'api-identity-dev-code';
const H = { 'x-requested-with': 'fetch' };
let seq = 0;
const phone = () => `0912${String(8100000 + ++seq)}`;

async function inbox(p: string): Promise<string> {
  const res = await app.inject({ url: `/api/v1/dev/inbox/sms?phone=${encodeURIComponent(p)}`, headers: { 'x-dev-code': DEV_CODE } });
  expect(res.statusCode).toBe(200);
  return /\d{6}/.exec(res.json().items[0].text)![0];
}
async function otpLogin(p = phone()): Promise<{ cookie: string; phone: string; principalId: string }> {
  const rq = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: p } });
  expect(rq.statusCode).toBe(200);
  const v = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone: p, code: await inbox(p) } });
  expect(v.statusCode).toBe(200);
  const c = v.cookies.find((x) => x.name === 'esp_session')!;
  expect(c.httpOnly).toBe(true);
  expect(c.sameSite).toBe('Strict');
  return { cookie: `esp_session=${c.value}`, phone: p, principalId: v.json().principalId };
}

beforeAll(async () => {
  const base = new URL(process.env['MONGO_URL'] ?? 'mongodb://127.0.0.1:27018/esports?directConnection=true');
  base.pathname = `/apiid_${Date.now().toString(36)}`;
  container = await createContainer({ serviceName: 'api-id-test', env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', MONGO_URL: base.toString(), DATA_DIR: mkdtempSync(join(tmpdir(), 'esp-apiid-')), LOG_LEVEL: 'silent', AUTH_DEV_LOGIN_ENABLED: 'true', AUTH_DEV_CODE: DEV_CODE, RATE_LIMIT_MAX: '1000', AUTH_OTP_RESEND_SECONDS: '0' } });
  await runMigrations(container.dbh.db);
  await seedDatabase(container.c, container.acl);
  await seedIdentityDomain(container.c);
  app = await buildApp(container);
  await app.ready();
  // same container, production flag: the dev inbox must not exist
  prodApp = await buildApp({ ...container, config: { ...container.config, isProduction: true } });
  await prodApp.ready();
});
afterAll(async () => {
  await prodApp.close();
  await app.close();
  await container.dbh.db.dropDatabase();
  await container.close();
});

describe('dev inbox', () => {
  it('needs the dev code and does not exist in production configuration', async () => {
    const q = `/api/v1/dev/inbox/sms?phone=${phone()}`;
    expect((await app.inject(q)).statusCode).toBe(401);
    expect((await app.inject({ url: q, headers: { 'x-dev-code': 'wrong-code-value' } })).statusCode).toBe(401);
    expect((await app.inject({ url: q, headers: { 'x-dev-code': DEV_CODE } })).statusCode).toBe(200);
    expect((await prodApp.inject({ url: q, headers: { 'x-dev-code': DEV_CODE } })).statusCode).toBe(404);
  });
});

describe('OTP login over HTTP', () => {
  it('signs up and logs in with a cookie session; Persian digits are the same number; wrong code is OTP_INVALID', async () => {
    const u = await otpLogin('09121110001');
    const me = await app.inject({ url: '/api/v1/auth/me', headers: { cookie: u.cookie } });
    expect(me.json().grants.map((g: { role: string }) => g.role)).toEqual(['player']);
    const again = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: '۰۹۱۲۱۱۱۰۰۰۱' } });
    expect(again.statusCode).toBe(200);
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone: '+989121110001', code: '000000' === (await inbox('+989121110001')) ? '111111' : '000000' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('OTP_INVALID');
    const ok = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone: '۰۹۱۲۱۱۱۰۰۰۱', code: await inbox('+989121110001') } });
    expect(ok.json().isNewAccount).toBe(false);
    expect(ok.json().principalId).toBe(u.principalId);
  });

  it('returns PROVIDER_UNAVAILABLE when the SMS provider fails', async () => {
    const real = container.adapters.sms;
    container.adapters.sms = { ...real, name: 'broken', mode: real.mode, capabilities: [], health: real.health.bind(real), send: async () => ({ status: 'failed', providerRef: null }) };
    try {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: phone() } });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('PROVIDER_UNAVAILABLE');
    } finally {
      container.adapters.sms = real;
    }
  });

  it('logout-others and phone change revoke the other sessions immediately', async () => {
    const a = await otpLogin();
    const b = await otpLogin(a.phone);
    expect((await app.inject({ url: '/api/v1/auth/me', headers: { cookie: a.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/logout-others', headers: { cookie: b.cookie, ...H } })).json().revoked).toBe(1);
    expect((await app.inject({ url: '/api/v1/auth/me', headers: { cookie: a.cookie } })).statusCode).toBe(401);
    const c = await otpLogin(a.phone);
    const np = phone();
    expect((await app.inject({ method: 'POST', url: '/api/v1/me/phone/change/request', headers: { cookie: b.cookie, ...H }, payload: { newPhone: np } })).statusCode).toBe(200);
    const done = await app.inject({ method: 'POST', url: '/api/v1/me/phone/change/verify', headers: { cookie: b.cookie, ...H }, payload: { newPhone: np, code: await inbox(np.replace(/^0/, '+98')) } });
    expect(done.statusCode).toBe(204);
    expect((await app.inject({ url: '/api/v1/auth/me', headers: { cookie: c.cookie } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/v1/auth/me', headers: { cookie: b.cookie } })).statusCode).toBe(200);
  });
});

describe('MFA enforcement through requirePermission (USR-009)', () => {
  it('blocks a platform_admin session until TOTP step-up when MFA_ENFORCED', async () => {
    const dev = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-session', payload: { principalId: seedIds.admin, devCode: DEV_CODE } });
    const cookie = `esp_session=${dev.cookies.find((c) => c.name === 'esp_session')!.value}`;
    const h = { cookie, ...H };
    const providers = () => app.inject({ url: '/api/v1/ops/providers', headers: h });
    expect((await providers()).statusCode).toBe(200); // flag off in test
    container.config.mfaEnforced = true;
    try {
      expect((await providers()).json().error.code).toBe('MFA_ENROLLMENT_REQUIRED');
      const setup = (await app.inject({ method: 'POST', url: '/api/v1/me/mfa/totp/setup', headers: h })).json();
      const secret = base32Decode(setup.secret);
      expect((await app.inject({ method: 'POST', url: '/api/v1/me/mfa/totp/confirm', headers: h, payload: { code: totpAt(secret) } })).statusCode).toBe(204);
      expect((await providers()).statusCode).toBe(200); // confirming marks this session as MFA-verified
      const dev2 = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-session', payload: { principalId: seedIds.admin, devCode: DEV_CODE } });
      const h2 = { cookie: `esp_session=${dev2.cookies.find((c) => c.name === 'esp_session')!.value}`, ...H };
      const blocked = await app.inject({ url: '/api/v1/ops/providers', headers: h2 });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error.code).toBe('MFA_REQUIRED');
      // session-layer gate: routes whose services call acl.require directly are covered too
      const catalogWrite = await app.inject({ method: 'POST', url: '/api/v1/catalog/games', headers: h2, payload: {} });
      expect(catalogWrite.json().error.code).toBe('MFA_REQUIRED');
      expect((await app.inject({ url: '/api/v1/auth/me', headers: h2 })).statusCode).toBe(200); // auth endpoints stay reachable
      expect((await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/stepup', headers: h2, payload: { code: '123456' } })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/stepup', headers: h2, payload: { code: totpAt(secret) } })).statusCode).toBe(204);
      expect((await app.inject({ url: '/api/v1/ops/providers', headers: h2 })).statusCode).toBe(200);
    } finally {
      container.config.mfaEnforced = false;
    }
  });
});

describe('own data', () => {
  it('exports without secrets and deletes only after re-verification', async () => {
    const u = await otpLogin();
    const h = { cookie: u.cookie, ...H };
    const exp = await app.inject({ url: '/api/v1/me/export', headers: { cookie: u.cookie } });
    expect(exp.statusCode).toBe(200);
    expect(JSON.stringify(exp.json())).not.toMatch(/tokenHash|passwordHash|secretEnc/);
    expect(exp.json().data.credentials.phone).toMatch(/^\+98/);
    await container.c.sessions.updateMany({ principalId: u.principalId }, { $set: { reauthAt: new Date(Date.now() - 3600_000).toISOString() } });
    expect((await app.inject({ method: 'POST', url: '/api/v1/me/delete', headers: h, payload: { confirm: true } })).statusCode).toBe(412);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/reauth/otp/request', headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/reauth/otp/verify', headers: h, payload: { code: await inbox(u.phone.replace(/^0/, '+98')) } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/api/v1/me/delete', headers: h, payload: { confirm: true } })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/v1/auth/me', headers: { cookie: u.cookie } })).statusCode).toBe(401);
    expect((await container.c.principals.findOne({ _id: u.principalId }))?.status).toBe('deleted');
  });
});
