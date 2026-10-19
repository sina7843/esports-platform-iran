import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createContainer, createDefaultProfile, defaultEventConfig, runMigrations, seedDatabase, seedIds, seedOrganizerDomain, type Container } from '@esp/core';
import { buildApp } from './app.js';

let container: Container;
let app: FastifyInstance;
const DEV_CODE = 'api-organizer-dev-code';
type User = { h: Record<string, string>; id: string };

async function login(principalId: string): Promise<User> {
  const v = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-session', payload: { principalId, devCode: DEV_CODE } });
  expect(v.statusCode).toBe(200);
  return { h: { cookie: `esp_session=${v.cookies.find((x) => x.name === 'esp_session')!.value}`, 'x-requested-with': 'fetch' }, id: principalId };
}
async function newUser(id: string): Promise<User> {
  const t = new Date().toISOString();
  await container.c.principals.insertOne({ _id: id, kind: 'user', displayName: id, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: t, updatedAt: t, version: 0 });
  await container.c.profiles.insertOne(createDefaultProfile(id, `nick_${id}`));
  return login(id);
}
const api = (u: User | null, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, ...(u ? { headers: u.h } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });

beforeAll(async () => {
  const base = new URL(process.env['MONGO_URL'] ?? 'mongodb://127.0.0.1:27018/esports?directConnection=true');
  base.pathname = `/apiorganizer_${Date.now().toString(36)}`;
  container = await createContainer({ serviceName: 'api-organizer-test', env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', MONGO_URL: base.toString(), DATA_DIR: mkdtempSync(join(tmpdir(), 'esp-apiorg-')), LOG_LEVEL: 'silent', AUTH_DEV_LOGIN_ENABLED: 'true', AUTH_DEV_CODE: DEV_CODE, RATE_LIMIT_MAX: '5000' } });
  await runMigrations(container.dbh.db);
  await seedDatabase(container.c, container.acl);
  await seedOrganizerDomain(container.c, container.acl);
  app = await buildApp(container);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await container.dbh.db.dropDatabase();
  await container.close();
});

describe('organizer HTTP flows', () => {
  it('apply, needs_info, resubmit, approve, public page, rating and moderation', async () => {
    const admin = await login(seedIds.admin);
    const owner = await newUser('u_ao_owner');
    const stranger = await newUser('u_ao_stranger');
    const player = await newUser('u_ao_player');

    const org = await api(owner, 'POST', '/organizations', { name: 'سازمان API', slug: 'api-org', description: null, city: 'مشهد', links: [], sponsors: [], logoFileId: null });
    expect(org.statusCode).toBe(201);
    const orgId = org.json().id as string;
    const body = { organizationId: orgId, description: 'برگزارکننده مسابقات دانشجویی با تجربه', experience: null, contactPhone: null, documentFileIds: [] };

    expect((await api(null, 'POST', '/organizers/applications', body)).statusCode).toBe(401);
    expect((await api(stranger, 'POST', '/organizers/applications', body)).statusCode).toBe(403);
    const sub = await api(owner, 'POST', '/organizers/applications', body);
    expect(sub.statusCode).toBe(201);
    const appId = sub.json().id as string;
    expect((await api(owner, 'POST', '/organizers/applications', body)).statusCode).toBe(409);

    // only reviewers see the queue / review
    expect((await api(owner, 'GET', '/organizers/applications')).statusCode).toBe(403);
    expect((await api(owner, 'POST', `/organizers/applications/${appId}/review`, { action: 'approve', note: 'x', expectedVersion: 0 })).statusCode).toBe(403);
    const queue = await api(admin, 'GET', '/organizers/applications');
    expect(queue.statusCode).toBe(200);
    expect(queue.json().items.some((a: { id: string }) => a.id === appId)).toBe(true);

    const ni = await api(admin, 'POST', `/organizers/applications/${appId}/review`, { action: 'request_info', note: 'مدرک بیشتر', expectedVersion: 0 });
    expect(ni.statusCode).toBe(200);
    expect(ni.json().state).toBe('needs_info');
    const re = await api(owner, 'PATCH', `/organizers/applications/${appId}`, { note: 'اضافه شد', expectedVersion: 1 });
    expect(re.statusCode).toBe(200);
    const ur = await api(admin, 'POST', `/organizers/applications/${appId}/review`, { action: 'start_review', note: 'شروع', expectedVersion: 2 });
    expect(ur.statusCode).toBe(200);
    // approve without level/limits is rejected
    expect((await api(admin, 'POST', `/organizers/applications/${appId}/review`, { action: 'approve', note: 'ok', expectedVersion: 3 })).statusCode).toBe(400);
    const ap = await api(admin, 'POST', `/organizers/applications/${appId}/review`, { action: 'approve', note: 'تأیید', level: 'basic', limits: { maxActiveEvents: 2, maxCapacityPerEvent: 32, paidEventsAllowed: false }, expectedVersion: 3 });
    expect(ap.statusCode).toBe(200);

    // profile edit: owner (organizer grant) yes, stranger no
    const prof = await api(owner, 'GET', `/organizers/${orgId}/profile`);
    expect(prof.statusCode).toBe(200);
    const patch = { intro: 'معرفی سازمان', venue: 'سالن', venueAddressText: 'مشهد، بلوار نمونه', expectedVersion: prof.json().version };
    expect((await api(stranger, 'PATCH', `/organizers/${orgId}/profile`, patch)).statusCode).toBe(403);
    expect((await api(owner, 'PATCH', `/organizers/${orgId}/profile`, patch)).statusCode).toBe(200);

    // public page is anonymous and carries the disclaimer
    const pub = await api(null, 'GET', '/organizers/api-org');
    expect(pub.statusCode).toBe(200);
    expect(pub.json().verification).toMatchObject({ verified: true, prizeGuarantee: false });
    expect(pub.json().verification.disclaimerFa).toContain('ضمانت');
    expect(pub.body).not.toContain('documentFileIds');
    expect((await api(null, 'GET', '/organizers/nope-nope')).statusCode).toBe(404);
    expect((await api(null, 'GET', '/organizers?city=مشهد&level=basic')).json().items.map((o: { slug: string }) => o.slug)).toContain('api-org');

    // ratings
    const t = new Date().toISOString();
    await container.c.events.insertOne({ _id: 'evt_ao1', slug: 'evt-ao1', name: 'پایان‌یافته', organizerOrgId: orgId, visibility: 'public', state: 'finished', timeZone: 'Asia/Tehran', startsAt: t, endsAt: null, rulesSnapshot: null, config: defaultEventConfig(), createdBy: owner.id, createdAt: t, updatedAt: t, version: 0 });
    await container.c.participations.insertOne({ _id: 'ptc_ao1', eventId: 'evt_ao1', disciplineId: 'd', kind: 'team', snapshot: { displayName: 'T', teamId: null, roster: [{ principalId: player.id, displayName: 'p', role: 'player' }] }, acceptedRules: null, registrationState: 'confirmed', createdAt: t, updatedAt: t, version: 0 });
    expect((await api(stranger, 'POST', `/organizers/${orgId}/ratings`, { eventId: 'evt_ao1', score: 5 })).statusCode).toBe(403);
    const rate = await api(player, 'POST', `/organizers/${orgId}/ratings`, { eventId: 'evt_ao1', score: 2, comment: 'ضعیف' });
    expect(rate.statusCode).toBe(201);
    expect((await api(player, 'POST', `/organizers/${orgId}/ratings`, { eventId: 'evt_ao1', score: 3 })).statusCode).toBe(409);
    const rid = rate.json().id as string;
    expect((await api(owner, 'PATCH', `/organizer-ratings/${rid}/moderation`, { action: 'hide', reason: 'نمی‌پسندم' })).statusCode).toBe(403);
    expect((await api(admin, 'PATCH', `/organizer-ratings/${rid}/moderation`, { action: 'hide', reason: 'x' })).statusCode).toBe(400);
    expect((await api(admin, 'PATCH', `/organizer-ratings/${rid}/moderation`, { action: 'hide', reason: 'محتوای نامناسب' })).statusCode).toBe(200);
    expect((await api(null, 'GET', '/organizers/api-org')).json().ratingSummary.count).toBe(0);

    // revoke: reason required, then the owner loses organizer access
    expect((await api(owner, 'POST', `/organizers/${orgId}/verification/revoke`, { reason: 'تلافی' })).statusCode).toBe(403);
    expect((await api(admin, 'POST', `/organizers/${orgId}/verification/revoke`, { reason: 'x' })).statusCode).toBe(400);
    expect((await api(admin, 'POST', `/organizers/${orgId}/verification/revoke`, { reason: 'تخلف تأییدشده' })).statusCode).toBe(200);
    expect((await api(owner, 'GET', `/organizers/${orgId}/profile`)).statusCode).toBe(403);
    expect((await api(null, 'GET', '/organizers/api-org')).json().verification.verified).toBe(false);
  });
});
