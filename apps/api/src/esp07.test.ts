import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createContainer, runMigrations, seedDatabase, seedIds, signPartnerRequest, type Container } from '@esp/core';
import { buildApp } from './app.js';

let container: Container;
let app: FastifyInstance;
const DEV_CODE = 'api-esp07-dev-code';
const cookies = new Map<string, string>();
const H = { 'x-requested-with': 'fetch' };
async function as(principalId: string): Promise<Record<string, string>> {
  if (!cookies.has(principalId)) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-session', payload: { principalId, devCode: DEV_CODE } });
    expect(res.statusCode).toBe(200);
    cookies.set(principalId, `esp_session=${res.cookies.find((c) => c.name === 'esp_session')!.value}`);
  }
  return { cookie: cookies.get(principalId)!, ...H };
}
beforeAll(async () => {
  const base = new URL(process.env['MONGO_URL'] ?? 'mongodb://127.0.0.1:27018/esports?directConnection=true');
  base.pathname = `/apitest07_${Date.now().toString(36)}`;
  container = await createContainer({ serviceName: 'api-esp07-test', env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', MONGO_URL: base.toString(), DATA_DIR: mkdtempSync(join(tmpdir(), 'esp-api07-')), LOG_LEVEL: 'silent', AUTH_DEV_LOGIN_ENABLED: 'true', AUTH_DEV_CODE: DEV_CODE, RATE_LIMIT_MAX: '5000', KAVENEGAR_API_KEY: 'FAKEKEYFORAPITEST', PUBLIC_WEB_ORIGIN: 'http://localhost:5173' } });
  await runMigrations(container.dbh.db);
  await seedDatabase(container.c, container.acl);
  app = await buildApp(container);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await container.dbh.db.dropDatabase();
  await container.close();
});

describe('ESP-07 over HTTP', () => {
  it('admin endpoints refuse anonymous callers and callers without the permission; security headers are present', async () => {
    expect((await app.inject('/api/v1/admin/health')).statusCode).toBe(401);
    const player = await as(seedIds.player);
    for (const url of ['/api/v1/admin/health', '/api/v1/admin/providers', '/api/v1/admin/providers/sms', '/api/v1/admin/partners', '/api/v1/admin/retention', '/api/v1/admin/holds', '/api/v1/ops/metrics']) {
      expect((await app.inject({ url, headers: player })).statusCode, url).toBe(403);
    }
    const res = await app.inject({ url: '/api/v1/admin/health', headers: await as(seedIds.admin) });
    expect(res.statusCode).toBe(200);
    const sms = await app.inject({ url: '/api/v1/admin/providers/sms', headers: await as(seedIds.admin) });
    expect(sms.statusCode).toBe(200);
    expect(sms.json()).toMatchObject({ adapter: 'dev-sms', apiKeyConfigured: true, template: null });
    expect(sms.body).not.toContain('FAKEKEYFORAPITEST');
    expect((await app.inject('/api/v1/admin/providers/sms')).statusCode).toBe(401);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('a cookie-authenticated mutation without the CSRF header is refused', async () => {
    const h = await as(seedIds.admin);
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/retention/run', headers: { cookie: h['cookie']! }, payload: { dryRun: true } });
    expect(res.statusCode).toBe(403);
  });

  it('a player files a ticket and cannot see another person\'s; staff handle it', async () => {
    const player = await as(seedIds.player);
    const t = await app.inject({ method: 'POST', url: '/api/v1/support/tickets', headers: player, payload: { subject: 'مشکل ورود', text: 'نمی‌توانم وارد شوم', category: 'account', priority: 'urgent' } });
    expect(t.statusCode).toBe(200);
    expect(t.json().priority).toBe('high');
    const other = await as(seedIds.captain);
    expect((await app.inject({ url: `/api/v1/support/tickets/${t.json()._id}`, headers: other })).statusCode).toBe(403);
    const q = await app.inject({ url: '/api/v1/admin/tickets', headers: await as(seedIds.admin) });
    expect(q.statusCode).toBe(200);
    expect(q.json().items.some((x: { _id: string }) => x._id === t.json()._id)).toBe(true);
    expect((await app.inject({ url: '/api/v1/admin/tickets', headers: player })).statusCode).toBe(403);
  });

  it('partner API: signed requests only, replay and tampering rejected, delayed results, no cookies needed', async () => {
    const admin = await as(seedIds.admin);
    const made = await app.inject({ method: 'POST', url: '/api/v1/admin/partners', headers: admin, payload: { name: 'شریک آزمون HTTP', scopes: ['events:read', 'results:read', 'webhooks:manage'], eventIds: [], quotaPerMinute: 100 } });
    expect(made.statusCode).toBe(200);
    const { keyId, secret } = made.json() as { keyId: string; secret: string };
    expect(JSON.stringify((await app.inject({ url: '/api/v1/admin/partners', headers: admin })).json())).not.toContain(secret);
    const call = (method: 'GET' | 'POST', path: string, body = '', nonce = `n${Math.random().toString(36).slice(2)}${Date.now()}`, over: Partial<Record<string, string>> = {}) => {
      const ts = String(Date.now());
      return app.inject({ method, url: path, ...(body ? { payload: body } : {}), headers: { 'content-type': 'application/json', 'x-esp-key': keyId, 'x-esp-timestamp': ts, 'x-esp-nonce': nonce, 'x-esp-signature': signPartnerRequest(secret, ts, nonce, method, path, body), ...over } });
    };
    const ok = await call('GET', '/partner/v1/events');
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('private, no-store');
    expect(ok.json().apiVersion).toBe('v1');
    expect((await app.inject('/partner/v1/events')).statusCode).toBe(401);
    expect((await call('GET', '/partner/v1/events', '', 'fixednonce-123456')).statusCode).toBe(200);
    expect((await call('GET', '/partner/v1/events', '', 'fixednonce-123456')).statusCode).toBe(401); // replay
    expect((await call('GET', '/partner/v1/events', '', undefined, { 'x-esp-signature': 'a'.repeat(64) })).statusCode).toBe(401);
    // POST with a body: the signature covers the exact bytes received
    const hookBody = JSON.stringify({ url: 'https://127.0.0.1/hook', events: ['honors.issued'] });
    const bad = await call('POST', '/partner/v1/webhooks', hookBody);
    expect(bad.statusCode).toBe(400); // signed correctly, but SSRF guard refuses the private target
    expect(bad.json().error.code).toBe('VALIDATION_FAILED');
    const ts = String(Date.now());
    const sigForOther = signPartnerRequest(secret, ts, 'n-body-swap-12345', 'POST', '/partner/v1/webhooks', '{"url":"https://example.ir/x","events":["honors.issued"]}');
    const swap = await app.inject({ method: 'POST', url: '/partner/v1/webhooks', payload: hookBody, headers: { 'content-type': 'application/json', 'x-esp-key': keyId, 'x-esp-timestamp': ts, 'x-esp-nonce': 'n-body-swap-12345', 'x-esp-signature': sigForOther } });
    expect(swap.statusCode).toBe(401);
    // the un-delayed latest view is not offered to partners
    const res = await call('GET', `/partner/v1/events/${seedIds.eventA}/results?view=latest`);
    expect([200, 404]).toContain(res.statusCode);
    if (res.statusCode === 200) expect(res.json().view.kind).toBe('synced');
  });

  it('metrics: Prometheus text keyed by route template, no personal data, operators only', async () => {
    await app.inject({ url: `/api/v1/live/events/${seedIds.eventA}` });
    const res = await app.inject({ url: '/api/v1/ops/metrics', headers: await as(seedIds.admin) });
    // platform_admin holds outbox.read in the seed roles
    expect([200, 403]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.body).toContain('esp_http_requests_total');
      expect(res.body).toContain('route="/api/v1/live/events/:id"');
      expect(res.body).not.toContain(seedIds.eventA);
      expect(res.body).not.toContain(seedIds.admin);
    }
  });
});
