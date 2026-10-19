import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createContainer, runMigrations, seedDatabase, seedIds, type Container } from '@esp/core';
import { buildApp } from './app.js';

let container: Container;
let app: FastifyInstance;
const DEV_CODE = 'api-test-dev-code';

async function login(principalId: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-session', payload: { principalId, devCode: DEV_CODE } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === 'esp_session');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Strict');
  return `esp_session=${cookie!.value}`;
}

beforeAll(async () => {
  const base = new URL(process.env['MONGO_URL'] ?? 'mongodb://127.0.0.1:27018/esports?directConnection=true');
  base.pathname = `/apitest_${Date.now().toString(36)}`;
  container = await createContainer({ serviceName: 'api-test', env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', MONGO_URL: base.toString(), DATA_DIR: mkdtempSync(join(tmpdir(), 'esp-api-')), LOG_LEVEL: 'silent', AUTH_DEV_LOGIN_ENABLED: 'true', AUTH_DEV_CODE: DEV_CODE, RATE_LIMIT_MAX: '1000' } });
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

describe('health and contract', () => {
  it('serves liveness, readiness and the full health report', async () => {
    expect((await app.inject('/api/v1/health/live')).statusCode).toBe(200);
    expect((await app.inject('/api/v1/health/ready')).statusCode).toBe(200);
    const h = (await app.inject('/api/v1/health')).json();
    expect(h.checks.mongo.status).toBe('ok');
    expect(h.checks['provider:payment'].detail).toContain('development_double');
  });
  it('exposes OpenAPI and uses the uniform error envelope for unknown routes and validation', async () => {
    const spec = app.swagger() as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).toContain('/auth/me'); // paths are relative to the /api/v1 server url
    const nf = await app.inject('/api/v1/nope');
    expect(nf.statusCode).toBe(404);
    expect(nf.json().error).toMatchObject({ code: 'NOT_FOUND' });
    expect(typeof nf.json().error.requestId).toBe('string');
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-session', payload: { principalId: 123 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(bad.json())).not.toMatch(/at .*\.ts:\d+/); // no stack traces
  });
});

describe('sessions', () => {
  it('rejects anonymous access and wrong dev codes', async () => {
    expect((await app.inject('/api/v1/auth/me')).json().error.code).toBe('UNAUTHENTICATED');
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-session', payload: { principalId: seedIds.admin, devCode: 'wrong' } });
    expect(res.statusCode).toBe(401);
  });
  it('issues a cookie session, lists it, and revocation is immediate', async () => {
    const cookie = await login(seedIds.player);
    const me = await app.inject({ url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.json().principal.id).toBe(seedIds.player);
    expect(me.json().grants.map((g: { role: string }) => g.role)).toEqual(['player']);
    const list = await app.inject({ url: '/api/v1/auth/sessions', headers: { cookie } });
    const current = list.json().items.find((s: { current: boolean }) => s.current);
    // CSRF: cookie-authenticated mutation without the header is refused
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/auth/sessions/${current.id}`, headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/auth/sessions/${current.id}`, headers: { cookie, 'x-requested-with': 'fetch' } })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/v1/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('cross-context access (AC-17 foundation)', () => {
  it('referee of event A reads lobby A, is denied lobby B (audited), and the public projection never leaks the lobby', async () => {
    const cookie = await login(seedIds.referee);
    const ok = await app.inject({ url: `/api/v1/matches/${seedIds.matchA}/lobby`, headers: { cookie } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().password).toBe('seed-secret-lobby-password');
    const denied = await app.inject({ url: `/api/v1/matches/${seedIds.matchB}/lobby`, headers: { cookie } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('FORBIDDEN');
    expect(await container.c.audit.countDocuments({ requestId: denied.json().error.requestId, outcome: 'denied' })).toBe(1);
    const pub = await app.inject(`/api/v1/matches/${seedIds.matchA}`);
    expect(pub.statusCode).toBe(200);
    expect(JSON.stringify(pub.json())).not.toContain('seed-secret');
    expect(JSON.stringify(pub.json())).not.toContain('usr_seed');
    // private event B is invisible to anonymous and to organizer A (no existence leak)
    expect((await app.inject(`/api/v1/events/${seedIds.eventB}`)).statusCode).toBe(404);
    const orgA = await login(seedIds.organizer);
    expect((await app.inject({ url: `/api/v1/events/${seedIds.eventB}`, headers: { cookie: orgA } })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/v1/events/${seedIds.eventB}`, headers: { cookie: await login(seedIds.organizerB) } })).statusCode).toBe(200);
  });

  it('revoking a grant takes effect on the very next request (AC-23)', async () => {
    const admin = await login(seedIds.admin);
    const ref = await login(seedIds.referee);
    expect((await app.inject({ url: `/api/v1/matches/${seedIds.matchA}/lobby`, headers: { cookie: ref } })).statusCode).toBe(200);
    const grants = (await app.inject({ url: `/api/v1/acl/grants?scopeType=event&scopeId=${seedIds.eventA}`, headers: { cookie: admin } })).json().items;
    const refGrant = grants.find((g: { principalId: string }) => g.principalId === seedIds.referee);
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/acl/grants/${refGrant.id}`, headers: { cookie: admin, 'x-requested-with': 'fetch' }, payload: { reason: 'test' } });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ url: `/api/v1/matches/${seedIds.matchA}/lobby`, headers: { cookie: ref } })).statusCode).toBe(403);
    // re-grant for later tests
    const re = await app.inject({ method: 'POST', url: '/api/v1/acl/grants', headers: { cookie: admin, 'x-requested-with': 'fetch' }, payload: { principalId: seedIds.referee, role: 'referee', scope: { type: 'event', id: seedIds.eventA }, expiresAt: null, reason: 're-grant' } });
    expect(re.statusCode).toBe(201);
  });

  it('organizer B cannot grant inside organization A; platform_admin grants need an approval', async () => {
    const orgB = await login(seedIds.organizerB);
    const res = await app.inject({ method: 'POST', url: '/api/v1/acl/grants', headers: { cookie: orgB, 'x-requested-with': 'fetch' }, payload: { principalId: seedIds.player, role: 'event_operator', scope: { type: 'event', id: seedIds.eventA }, expiresAt: null, reason: null } });
    expect(res.statusCode).toBe(403);
    const admin = await login(seedIds.admin);
    const pa = await app.inject({ method: 'POST', url: '/api/v1/acl/grants', headers: { cookie: admin, 'x-requested-with': 'fetch' }, payload: { principalId: seedIds.player, role: 'platform_admin', scope: { type: 'site', id: 'site' }, expiresAt: null, reason: null } });
    expect(pa.statusCode).toBe(412);
  });
});

describe('state transitions over HTTP (chapter 15)', () => {
  it('rejects direct status writes and unknown/illegal transitions, applies named transitions with version checks', async () => {
    const org = await login(seedIds.organizer);
    const direct = await app.inject({ method: 'PATCH', url: `/api/v1/events/${seedIds.eventA}`, headers: { cookie: org, 'x-requested-with': 'fetch' }, payload: { state: 'closed', expectedVersion: 0 } });
    expect(direct.json().error.code).toBe('ILLEGAL_TRANSITION');
    const bad = await app.inject({ method: 'POST', url: `/api/v1/events/${seedIds.eventA}/transitions`, headers: { cookie: org, 'x-requested-with': 'fetch' }, payload: { transition: 'finish', expectedVersion: 0 } });
    expect(bad.statusCode).toBe(409); // published → finish is illegal
    expect(bad.json().error.code).toBe('ILLEGAL_TRANSITION');
    const ok = await app.inject({ method: 'POST', url: `/api/v1/events/${seedIds.eventA}/transitions`, headers: { cookie: org, 'x-requested-with': 'fetch' }, payload: { transition: 'open_registration', expectedVersion: 0 } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().state).toBe('registration_open');
    expect(ok.json().version).toBe(1);
    const stale = await app.inject({ method: 'POST', url: `/api/v1/events/${seedIds.eventA}/transitions`, headers: { cookie: org, 'x-requested-with': 'fetch' }, payload: { transition: 'close_registration', expectedVersion: 0 } });
    expect(stale.json().error.code).toBe('VERSION_CONFLICT');
    // reporter has no event.manage
    const rep = await login(seedIds.reporter);
    expect((await app.inject({ method: 'POST', url: `/api/v1/events/${seedIds.eventA}/transitions`, headers: { cookie: rep, 'x-requested-with': 'fetch' }, payload: { transition: 'close_registration', expectedVersion: 1 } })).statusCode).toBe(403);
    // outbox + audit recorded atomically with the change
    expect(await container.c.outbox.countDocuments({ type: 'competition.event.open_registration', 'aggregate.id': seedIds.eventA })).toBe(1);
    expect(await container.c.audit.countDocuments({ action: 'event.open_registration' })).toBe(1);
  });

  it('a captain (interested party) cannot drive match transitions as a judge', async () => {
    const admin = await login(seedIds.admin);
    await app.inject({ method: 'POST', url: '/api/v1/acl/grants', headers: { cookie: admin, 'x-requested-with': 'fetch' }, payload: { principalId: seedIds.captain, role: 'referee', scope: { type: 'match', id: seedIds.matchA }, expiresAt: null, reason: 'conflict test' } });
    const cap = await login(seedIds.captain);
    const res = await app.inject({ method: 'POST', url: `/api/v1/matches/${seedIds.matchA}/transitions`, headers: { cookie: cap, 'x-requested-with': 'fetch' }, payload: { transition: 'open_checkin', expectedVersion: 0 } });
    expect(res.json().error.code).toBe('CONFLICT_OF_INTEREST');
  });
});

describe('realtime over HTTP', () => {
  it('polling respects audience and cursor', async () => {
    await container.realtime.publish({ channel: 'event:x', type: 'ping', audience: { kind: 'public' }, payload: { n: 1 } });
    const r1 = await app.inject('/api/v1/realtime/events?after=0&channels=event:x');
    expect(r1.json().events.length).toBe(1);
    const r2 = await app.inject(`/api/v1/realtime/events?after=${r1.json().cursor}&channels=event:x`);
    expect(r2.json().events).toEqual([]);
  });
  it('SSE stream delivers events and closes when the session is revoked', async () => {
    const cookie = await login(seedIds.player);
    const sessionId = (await app.inject({ url: '/api/v1/auth/me', headers: { cookie } })).json().session.id;
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const ctrl = new AbortController();
    const res = await fetch(`${address}/api/v1/realtime/stream?after=0&channels=sse:test`, { headers: { cookie }, signal: ctrl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const readUntil = async (pred: (s: string) => boolean) => {
      const deadline = Date.now() + 5000;
      while (!pred(buf) && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
      }
    };
    await readUntil((s) => s.includes(': connected'));
    await container.realtime.publish({ channel: 'sse:test', type: 'hello', audience: { kind: 'principals', principalIds: [seedIds.player] }, payload: { ok: true } });
    await readUntil((s) => s.includes('event: hello'));
    expect(buf).toContain('event: hello');
    await container.sessions.revoke(sessionId, 'test');
    await container.realtime.publish({ channel: 'sse:test', type: 'after-revoke', audience: { kind: 'public' }, payload: {} });
    await readUntil((s) => s.includes('event: close'));
    expect(buf).toContain('session_revoked');
    expect(buf).not.toContain('after-revoke');
    ctrl.abort();
  });
});

describe('files over HTTP', () => {
  it('uploads a private file as referee, denies the link to a reporter, serves it through the signed link', async () => {
    const ref = await login(seedIds.referee);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
    const boundary = 'xxBOUNDARYxx';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="visibility"\r\n\r\nprivate\r\n--${boundary}\r\nContent-Disposition: form-data; name="scopeType"\r\n\r\nevent\r\n--${boundary}\r\nContent-Disposition: form-data; name="scopeId"\r\n\r\n${seedIds.eventA}\r\n--${boundary}\r\nContent-Disposition: form-data; name="retentionClass"\r\n\r\ndispute_evidence\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="proof.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await app.inject({ method: 'POST', url: '/api/v1/files', headers: { cookie: ref, 'x-requested-with': 'fetch', 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(up.statusCode).toBe(201);
    const id = up.json().id;
    const rep = await login(seedIds.reporter);
    expect((await app.inject({ method: 'POST', url: `/api/v1/files/${id}/link`, headers: { cookie: rep, 'x-requested-with': 'fetch' } })).statusCode).toBe(403);
    const link = await app.inject({ method: 'POST', url: `/api/v1/files/${id}/link`, headers: { cookie: ref, 'x-requested-with': 'fetch' } });
    expect(link.statusCode).toBe(200);
    const path = new URL(link.json().url).pathname + new URL(link.json().url).search;
    const got = await app.inject(path);
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.rawPayload.equals(png)).toBe(true);
  });
});
