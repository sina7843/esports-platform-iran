import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createContainer, createDefaultProfile, runMigrations, seedDatabase, seedIds, seedTeamsDomain, type Container } from '@esp/core';
import { buildApp } from './app.js';

let container: Container;
let app: FastifyInstance;
const DEV_CODE = 'api-teams-dev-code';
const H = { 'x-requested-with': 'fetch' };
type User = { h: Record<string, string>; id: string };

async function login(principalId: string): Promise<User> {
  const v = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-session', payload: { principalId, devCode: DEV_CODE } });
  expect(v.statusCode).toBe(200);
  return { h: { cookie: `esp_session=${v.cookies.find((x) => x.name === 'esp_session')!.value}`, ...H }, id: principalId };
}
async function newUser(id: string): Promise<User> {
  const t = new Date().toISOString();
  await container.c.principals.insertOne({ _id: id, kind: 'user', displayName: id, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: t, updatedAt: t, version: 0 });
  await container.c.profiles.insertOne(createDefaultProfile(id, `nick_${id}`));
  return login(id);
}
const api = (u: User | null, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, ...(u ? { headers: u.h } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });

beforeAll(async () => {
  const base = new URL(process.env['MONGO_URL'] ?? 'mongodb://127.0.0.1:27018/esports?directConnection=true');
  base.pathname = `/apiteams_${Date.now().toString(36)}`;
  container = await createContainer({ serviceName: 'api-teams-test', env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', MONGO_URL: base.toString(), DATA_DIR: mkdtempSync(join(tmpdir(), 'esp-apiteams-')), LOG_LEVEL: 'silent', AUTH_DEV_LOGIN_ENABLED: 'true', AUTH_DEV_CODE: DEV_CODE, RATE_LIMIT_MAX: '5000' } });
  await runMigrations(container.dbh.db);
  await seedDatabase(container.c, container.acl);
  await seedTeamsDomain(container.c, container.acl);
  app = await buildApp(container);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await container.dbh.db.dropDatabase();
  await container.close();
});

describe('teams HTTP flows', () => {
  it('create team, invite, accept, kick, role change, rename and public page', async () => {
    const owner = await newUser('u_api_owner');
    const pl = await newUser('u_api_pl');
    const out = await newUser('u_api_out');
    const body = { name: 'تیم API', tag: 'API', gameId: 'game_seed_synthetic' };

    // CSRF header is required for cookie mutations
    const noHeader = await app.inject({ method: 'POST', url: '/api/v1/teams', headers: { cookie: owner.h['cookie']! }, payload: body });
    expect(noHeader.statusCode).toBe(403);
    expect((await api(null, 'POST', '/teams', body)).statusCode).toBe(401);

    const created = await api(owner, 'POST', '/teams', body);
    expect(created.statusCode).toBe(201);
    const teamId = created.json().id as string;

    const inv = await api(owner, 'POST', `/teams/${teamId}/invitations`, { principalId: pl.id, role: 'captain' });
    expect(inv.statusCode).toBe(201);
    expect((await api(out, 'POST', `/teams/${teamId}/invitations`, { principalId: pl.id, role: 'player' })).statusCode).toBe(403);
    expect((await api(out, 'POST', `/team-invitations/${inv.json().id}/accept`)).statusCode).toBe(404);
    expect((await api(pl, 'GET', '/me/team-invitations')).json().items).toHaveLength(1);
    expect((await api(pl, 'POST', `/team-invitations/${inv.json().id}/accept`)).json().state).toBe('accepted');
    expect((await api(pl, 'POST', `/team-invitations/${inv.json().id}/accept`)).statusCode).toBe(409);
    expect((await api(pl, 'GET', `/teams/${teamId}/members`)).json().items).toHaveLength(2);
    expect((await api(out, 'GET', `/teams/${teamId}/members`)).statusCode).toBe(403);

    // role change then kick: access is gone on the very next request
    expect((await api(owner, 'PATCH', `/teams/${teamId}/members/${pl.id}`, { role: 'player' })).statusCode).toBe(204);
    expect((await api(pl, 'GET', `/teams/${teamId}/invitations`)).statusCode).toBe(403);
    expect((await api(owner, 'PATCH', `/teams/${teamId}/members/${pl.id}`, { role: 'captain' })).statusCode).toBe(204);
    expect((await api(pl, 'GET', `/teams/${teamId}/invitations`)).statusCode).toBe(200);
    expect((await api(owner, 'POST', `/teams/${teamId}/members/${pl.id}/kick`, { reason: 'test' })).statusCode).toBe(204);
    expect((await api(pl, 'GET', `/teams/${teamId}/invitations`)).statusCode).toBe(403);

    // rename keeps the id and history
    const upd = await api(owner, 'PATCH', `/teams/${teamId}`, { name: 'نام تازه', expectedVersion: 0 });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().id).toBe(teamId);
    expect((await api(owner, 'PATCH', `/teams/${teamId}`, { name: 'x1', expectedVersion: 0 })).json().error.code).toBe('VERSION_CONFLICT');
    const pub = await api(null, 'GET', `/teams/${teamId}/profile`);
    expect(pub.statusCode).toBe(200);
    expect(pub.json().nameHistory.map((h: { name: string }) => h.name)).toEqual(['تیم API', 'نام تازه']);
    expect(pub.json().pastMembers).toHaveLength(1);
    expect(pub.json().record.source).toBe('none_yet');
    expect(pub.body).not.toMatch(/endedBy|endedReason/);

    const at = await api(owner, 'GET', `/teams/${teamId}/membership-at?at=${encodeURIComponent(new Date().toISOString())}`);
    expect(at.json().items.map((m: { principalId: string }) => m.principalId)).toEqual([owner.id]);
  });

  it('join request, ownership transfer and calendar over HTTP', async () => {
    const owner = await newUser('u_api_owner2');
    const pl = await newUser('u_api_pl2');
    const teamId = (await api(owner, 'POST', '/teams', { name: 'تیم دو', tag: 'AP2', gameId: 'game_seed_synthetic' })).json().id as string;
    const jr = await api(pl, 'POST', `/teams/${teamId}/join-requests`, { role: 'player' });
    expect(jr.statusCode).toBe(201);
    expect((await api(pl, 'POST', `/team-join-requests/${jr.json().id}/accept`)).statusCode).toBe(403);
    expect((await api(owner, 'POST', `/team-join-requests/${jr.json().id}/accept`)).json().state).toBe('accepted');

    const ev = { kind: 'practice', title: 'تمرین', startsAt: '2031-01-01T10:00:00Z', endsAt: '2031-01-01T11:00:00Z' };
    expect((await api(pl, 'POST', `/teams/${teamId}/calendar`, ev)).statusCode).toBe(403);
    expect((await api(owner, 'POST', `/teams/${teamId}/calendar`, ev)).statusCode).toBe(201);
    expect((await api(pl, 'GET', `/teams/${teamId}/calendar`)).json().items).toHaveLength(1);

    expect((await api(pl, 'POST', `/teams/${teamId}/ownership-transfers`, { toPrincipalId: owner.id })).statusCode).toBe(403);
    const tr = await api(owner, 'POST', `/teams/${teamId}/ownership-transfers`, { toPrincipalId: pl.id });
    expect(tr.statusCode).toBe(201);
    expect(tr.json().responsibilities).toMatchObject({ activeRegistrations: 0, openObligations: 0 });
    expect((await api(pl, 'POST', `/ownership-transfers/${tr.json().id}/accept`, { acceptResponsibilities: false })).statusCode).toBe(400);
    expect((await api(owner, 'POST', `/ownership-transfers/${tr.json().id}/accept`, { acceptResponsibilities: true })).statusCode).toBe(403);
    expect((await api(pl, 'POST', `/ownership-transfers/${tr.json().id}/accept`, { acceptResponsibilities: true })).json().state).toBe('accepted');
    expect((await api(pl, 'POST', `/teams/${teamId}/ownership-transfers`, { toPrincipalId: owner.id })).statusCode).toBe(201);
  });

  it('organizations: create, public page lists its teams', async () => {
    const owner = await newUser('u_api_orgowner');
    const org = await api(owner, 'POST', '/organizations', { name: 'سازمان API', slug: 'api-org' });
    expect(org.statusCode).toBe(201);
    expect((await api(owner, 'POST', '/organizations', { name: 'again', slug: 'api-org' })).statusCode).toBe(409);
    const t = await api(owner, 'POST', '/teams', { name: 'تیم سازمان', tag: 'ORG', gameId: 'game_seed_synthetic', organizationId: org.json().id });
    expect(t.statusCode).toBe(201);
    const pub = await api(null, 'GET', '/organizations/api-org');
    expect(pub.statusCode).toBe(200);
    expect(pub.json().teams.map((x: { id: string }) => x.id)).toEqual([t.json().id]);
    expect(pub.body).not.toContain('ownerPrincipalId');
    expect((await api(null, 'GET', '/organizations/nope-org')).statusCode).toBe(404);
  });
});

describe('recruitment and scrims HTTP flows', () => {
  it('ad -> apply -> accept creates an invitation; looking-for-team list; scrim flow with friendly result', async () => {
    const owner = await login(seedIds.organizer); // owner of seed team A
    const other = await login(seedIds.player); // owner of seed team B
    const cand = await newUser('u_api_cand');

    const ad = await api(owner, 'POST', `/teams/${seedIds.teamA}/recruitment/ads`, { kind: 'player', gameId: 'game_seed_synthetic', description: 'آگهی', city: 'تهران' });
    expect(ad.statusCode).toBe(201);
    expect((await api(other, 'POST', `/teams/${seedIds.teamA}/recruitment/ads`, { kind: 'player', gameId: 'game_seed_synthetic', description: 'x' })).statusCode).toBe(403);
    const list = await api(null, 'GET', '/recruitment/ads?gameId=game_seed_synthetic&city=%D8%AA%D9%87%D8%B1%D8%A7%D9%86&limit=1');
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);
    expect(list.body).not.toContain('createdBy');

    const app1 = await api(cand, 'POST', `/recruitment/ads/${ad.json().id}/applications`, { message: 'سلام' });
    expect(app1.statusCode).toBe(201);
    expect((await api(cand, 'POST', `/recruitment/ads/${ad.json().id}/applications`, {})).statusCode).toBe(409);
    expect((await api(cand, 'GET', `/recruitment/ads/${ad.json().id}/applications`)).statusCode).toBe(403);
    const dec = await api(owner, 'POST', `/recruitment/applications/${app1.json().id}/decision`, { action: 'accept', expectedVersion: 0 });
    expect(dec.statusCode).toBe(200);
    expect(dec.json().invitationId).toBeTruthy();
    expect((await api(cand, 'GET', '/me/team-invitations')).json().items[0].state).toBe('pending');
    expect((await api(owner, 'POST', `/recruitment/applications/${app1.json().id}/decision`, { action: 'accept', expectedVersion: 0 })).json().error.code).toBe('VERSION_CONFLICT');

    await container.c.profiles.updateOne({ _id: cand.id }, { $set: { lookingForTeam: { active: true, resume: 'رزومه', gameIds: ['game_seed_synthetic'], since: new Date().toISOString() } } });
    const lft = await api(null, 'GET', '/recruitment/players?gameId=game_seed_synthetic');
    expect(lft.json().items.map((i: { id: string }) => i.id)).toContain(cand.id);
    expect(lft.body).not.toMatch(/realName|phone|email/);

    const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString();
    const sc = await api(other, 'POST', `/teams/${seedIds.teamB}/scrims`, { gameId: 'game_seed_synthetic', windowStart: day(2), windowEnd: day(3), level: 'pro' });
    expect(sc.statusCode).toBe(201);
    expect((await api(null, 'GET', '/scrims?gameId=game_seed_synthetic&level=pro')).json().items.map((i: { id: string }) => i.id)).toContain(sc.json().id);
    const prop = await api(owner, 'POST', `/scrims/${sc.json().id}/propose`, { teamId: seedIds.teamA, proposedAt: day(2.5) });
    expect(prop.json().state).toBe('proposed');
    expect((await api(owner, 'POST', `/scrims/${sc.json().id}/accept`)).statusCode).toBe(403);
    const acc = await api(other, 'POST', `/scrims/${sc.json().id}/accept`);
    expect(acc.json().state).toBe('accepted');
    const res = await api(owner, 'POST', `/scrims/${sc.json().id}/result`, { teamId: seedIds.teamA, expectedVersion: acc.json().version, scores: [{ teamId: seedIds.teamA, score: 3 }, { teamId: seedIds.teamB, score: 0 }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ label: 'friendly', countsForRating: false });
  });
});
