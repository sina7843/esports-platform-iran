import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createContainer, runMigrations, seedCatalogDomain, seedDatabase, seedIds, type Container } from '@esp/core';
import { buildApp } from './app.js';

let container: Container;
let app: FastifyInstance;
const DEV_CODE = 'api-catalog-dev-code';
type User = { h: Record<string, string>; id: string };
const U: Record<string, User> = {};

async function login(principalId: string): Promise<User> {
  const v = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-session', payload: { principalId, devCode: DEV_CODE } });
  expect(v.statusCode).toBe(200);
  return { h: { cookie: `esp_session=${v.cookies.find((x) => x.name === 'esp_session')!.value}`, 'x-requested-with': 'fetch' }, id: principalId };
}
async function officer(id: string): Promise<User> {
  const t = new Date().toISOString();
  await container.c.principals.insertOne({ _id: id, kind: 'user', displayName: id, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: t, updatedAt: t, version: 0 });
  await container.acl.grant({ principalId: id, role: 'rules_officer', scope: { type: 'site', id: 'site' }, expiresAt: null, reason: 'test' }, { principalId: seedIds.admin, requestId: 'req_test' });
  return login(id);
}
const api = (u: User | null, method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, ...(u ? { headers: u.h } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });

const clause = (key: string, kind: string, value: unknown, allowed: unknown = null) => ({ key, kind, value, allowed, citation: `§${key}`, textOriginal: null, textFa: null });

beforeAll(async () => {
  const base = new URL(process.env['MONGO_URL'] ?? 'mongodb://127.0.0.1:27018/esports?directConnection=true');
  base.pathname = `/apicatalog_${Date.now().toString(36)}`;
  container = await createContainer({ serviceName: 'api-catalog-test', env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', MONGO_URL: base.toString(), DATA_DIR: mkdtempSync(join(tmpdir(), 'esp-apicat-')), LOG_LEVEL: 'silent', AUTH_DEV_LOGIN_ENABLED: 'true', AUTH_DEV_CODE: DEV_CODE, RATE_LIMIT_MAX: '5000' } });
  await runMigrations(container.dbh.db);
  await seedDatabase(container.c, container.acl);
  await seedCatalogDomain(container.c);
  app = await buildApp(container);
  await app.ready();
  U['admin'] = await login(seedIds.admin);
  U['player'] = await login(seedIds.player);
  U['orgA'] = await login(seedIds.organizer);
  U['orgB'] = await login(seedIds.organizerB);
  U['o1'] = await officer('u_cat_officer_1');
  U['o2'] = await officer('u_cat_officer_2');
});
afterAll(async () => {
  await app.close();
  await container.dbh.db.dropDatabase();
  await container.close();
});

describe('catalog + rules HTTP flows', () => {
  it('modules: list, validation tool, and public honest game views', async () => {
    const mods = await api(null, 'GET', '/catalog/modules');
    expect(mods.statusCode).toBe(200);
    expect(mods.json().items).toHaveLength(6);
    expect((await api(null, 'POST', '/catalog/modules/team/validate', { values: {} })).statusCode).toBe(401);
    const bad = await api(U['player']!, 'POST', '/catalog/modules/head_to_head/validate', { values: { a: 'x', b: 'y', scoreA: 1, scoreB: 2, winner: 'a' } });
    expect(bad.json().ok).toBe(false);
    const good = await api(U['player']!, 'POST', '/catalog/modules/head_to_head/validate', { values: { a: 'x', b: 'y', scoreA: 2, scoreB: 1, winner: 'a' } });
    expect(good.json()).toMatchObject({ ok: true, testOnly: true });
    expect((await api(U['player']!, 'POST', '/catalog/modules/zzz/validate', { values: {} })).statusCode).toBe(404);

    const list = await api(null, 'GET', '/catalog/games');
    expect(list.statusCode).toBe(200);
    const seeded = list.json().items.find((g: { id: string }) => g.id === 'game_seed_synthetic');
    expect(seeded).toMatchObject({ state: 'under_review', standardReady: false });
    expect(seeded.capabilities.api).toMatchObject({ status: 'unknown', promisable: false });
  });

  it('game lifecycle: permissions, ready gate with evidence, rules package and mode readiness', async () => {
    const body = { slug: 'api-game', title: 'بازی API', publisher: 'TEST ONLY', platforms: ['pc'], modes: ['5v5', '1v1'], family: 'team', moduleId: 'team' };
    expect((await api(U['player']!, 'POST', '/catalog/games', body)).statusCode).toBe(403);
    expect((await api(null, 'POST', '/catalog/games', body)).statusCode).toBe(401);
    expect((await api(U['admin']!, 'POST', '/catalog/games', { ...body, moduleId: 'nope' })).statusCode).toBe(400);
    const created = await api(U['admin']!, 'POST', '/catalog/games', body);
    expect(created.statusCode).toBe(201);
    const gid = created.json().id as string;
    expect(created.json().state).toBe('proposed');

    const v = (await api(U['admin']!, 'POST', `/catalog/games/${gid}/transition`, { to: 'under_review', reason: 'go', expectedVersion: 0 })).json().version as number;
    const ev = { referenceUrl: 'https://example.org/ref', reviewedAt: new Date().toISOString() };
    const blocked = await api(U['admin']!, 'POST', `/catalog/games/${gid}/transition`, { to: 'ready', reason: 'go', evidence: ev, expectedVersion: v });
    expect(blocked.statusCode).toBe(412);
    expect(blocked.json().error.details.missing).toEqual(['published_reviewed_rules_package', 'ready_mode']);

    // rules package: author o1 -> review o2 -> publish o2
    const pkg = await api(U['o1']!, 'POST', '/rules', {
      gameId: gid,
      scope: { kind: 'catalog', ref: 'catalog' },
      title: 'API pkg',
      version: '1',
      sourceUrl: 'https://example.org/rules',
      applicability: 'test',
      clauses: [clause('roster.min', 'mandatory', 4), clause('roster.substitutes', 'configurable', 1, { min: 0, max: 2, options: null }), clause('age.minimum', 'human_review', null)],
      testOnly: false,
    });
    expect(pkg.statusCode).toBe(201);
    const pid = pkg.json().id as string;
    expect((await api(U['player']!, 'GET', `/rules/${pid}`)).statusCode).toBe(403);
    expect((await api(null, 'GET', `/rules/${pid}`)).statusCode).toBe(401);
    expect(pkg.json().humanReviewClauses[0]).toMatchObject({ key: 'age.minimum', acknowledged: false });

    const sub = await api(U['o1']!, 'POST', `/rules/${pid}/transition`, { transition: 'submit_for_review', expectedVersion: 0 });
    expect(sub.statusCode).toBe(200);
    const pre = await api(U['o2']!, 'POST', `/rules/${pid}/transition`, { transition: 'publish', expectedVersion: 1 });
    expect(pre.statusCode).toBe(412);
    expect(pre.json().error.details.blockers).toEqual(expect.arrayContaining(['translation_not_reviewed', 'publisher_rights_not_reviewed', 'human_review_not_acknowledged:age.minimum']));
    const rev = await api(U['o2']!, 'POST', `/rules/${pid}/review`, { translationReviewed: true, publisherRights: { reviewed: true, restrictions: null }, acknowledgedClauseKeys: ['age.minimum'], expectedVersion: 1 });
    expect(rev.statusCode).toBe(200);
    expect((await api(U['o1']!, 'POST', `/rules/${pid}/transition`, { transition: 'publish', expectedVersion: 2 })).statusCode).toBe(403); // author
    expect((await api(U['o2']!, 'POST', `/rules/${pid}/transition`, { transition: 'publish', expectedVersion: 2 })).json().state).toBe('published');
    expect((await api(U['o1']!, 'PATCH', `/rules/${pid}`, { title: 'x', expectedVersion: 3 })).statusCode).toBe(409);

    // public view of the published package hides working data
    const pub = await api(null, 'GET', `/rules/${pid}`);
    expect(pub.statusCode).toBe(200);
    expect(pub.json().conflicts).toBeUndefined();
    expect(pub.json().createdBy).toBeUndefined();

    // mode readiness gates ready
    const still = await api(U['admin']!, 'POST', `/catalog/games/${gid}/transition`, { to: 'ready', reason: 'go', evidence: ev, expectedVersion: v });
    expect(still.json().error.details.missing).toEqual(['ready_mode']);
    expect((await api(U['player']!, 'PUT', `/catalog/games/${gid}/readiness`, { version: '1', platform: 'pc', mode: '5v5', state: 'ready', evidence: 'x' })).statusCode).toBe(403);
    expect((await api(U['admin']!, 'PUT', `/catalog/games/${gid}/readiness`, { version: '1', platform: 'pc', mode: '5v5', state: 'ready', evidence: 'checked' })).statusCode).toBe(200);
    const ready = await api(U['admin']!, 'POST', `/catalog/games/${gid}/transition`, { to: 'ready', reason: 'go', evidence: ev, expectedVersion: v });
    expect(ready.statusCode).toBe(200);

    const detail = (await api(null, 'GET', `/catalog/games/api-game`)).json();
    expect(detail).toMatchObject({ state: 'ready', standardReady: true });
    expect(detail.readiness).toEqual([expect.objectContaining({ mode: '5v5', state: 'ready' })]);
    expect((await api(U['admin']!, 'GET', `/catalog/games/${gid}/history`)).json().items).toHaveLength(3);
    expect((await api(U['player']!, 'GET', `/catalog/games/${gid}/history`)).statusCode).toBe(403);

    // settings validation, acceptance idempotency, acceptances listing
    const vs = await api(U['orgA']!, 'POST', `/rules/${pid}/validate-settings`, { settings: { 'roster.substitutes': 7, 'roster.min': 1 } });
    expect(vs.json().ok).toBe(false);
    expect(vs.json().violations.map((x: { key: string; citation: string }) => `${x.key}|${x.citation}`)).toEqual(['roster.substitutes|§roster.substitutes', 'roster.min|§roster.min']);
    expect((await api(U['orgA']!, 'POST', `/rules/${pid}/validate-settings`, { settings: { 'roster.substitutes': 2 } })).json().ok).toBe(true);

    const ctx = { eventId: seedIds.eventA, participationId: null };
    const a1 = await api(U['player']!, 'POST', `/rules/${pid}/accept`, ctx);
    const a2 = await api(U['player']!, 'POST', `/rules/${pid}/accept`, ctx);
    expect([a1.json().created, a2.json().created]).toEqual([true, false]);
    expect(a1.json().clausesHash).toBe(pub.json().clausesHash);
    expect((await api(U['player']!, 'GET', `/rules/${pid}/acceptances?eventId=${seedIds.eventA}`)).statusCode).toBe(403);
    expect((await api(U['orgB']!, 'GET', `/rules/${pid}/acceptances?eventId=${seedIds.eventA}`)).statusCode).toBe(403);
    const acc = await api(U['orgA']!, 'GET', `/rules/${pid}/acceptances?eventId=${seedIds.eventA}`);
    expect(acc.json().items).toHaveLength(1);
    expect((await api(U['player']!, 'GET', `/rules/reacceptance?eventId=${seedIds.eventA}`)).json().needed).toBe(false);

    // amendment over HTTP
    const am = await api(U['o1']!, 'POST', `/rules/${pid}/amendments`, { newVersion: '2', reason: 'roster change', impactAssessment: 'moderate impact', reacceptRequired: true, clauses: [clause('roster.min', 'mandatory', 5)] });
    expect(am.statusCode).toBe(201);
    expect(am.json().supersedes).toBe(pid);
    expect((await api(U['o1']!, 'GET', `/rules?state=draft&gameId=${gid}`)).json().items).toHaveLength(1);
    expect((await api(U['player']!, 'GET', `/rules?state=draft`)).json().items).toHaveLength(0);
    expect((await api(null, 'GET', `/rules?state=draft`)).statusCode).toBe(401);
    expect((await api(null, 'GET', `/rules?gameId=${gid}`)).json().items).toHaveLength(1);
  });

  it('scoped permissions, review reminders and conflicts', async () => {
    const mk = (ref: string) => ({ gameId: 'game_seed_synthetic', scope: { kind: 'organizer', ref }, title: 'org pkg', version: 'org-1', sourceText: 'our own rules', applicability: 'x', clauses: [], testOnly: true });
    expect((await api(U['orgB']!, 'POST', '/rules', mk(seedIds.orgA))).statusCode).toBe(403);
    const ok = await api(U['orgA']!, 'POST', '/rules', mk(seedIds.orgA));
    expect(ok.statusCode).toBe(201);
    const pid = ok.json().id as string;
    expect((await api(U['orgA']!, 'POST', `/rules/${pid}/conflicts`, { description: 'x', expectedVersion: 0 })).statusCode).toBe(403);
    const c = await api(U['o1']!, 'POST', `/rules/${pid}/conflicts`, { description: 'two sources disagree', expectedVersion: 0 });
    expect(c.statusCode).toBe(200);
    expect(c.json().conflicts[0].resolution).toBeNull();
    const cid = c.json().conflicts[0].id as string;
    const r = await api(U['o2']!, 'POST', `/rules/${pid}/conflicts/${cid}/resolve`, { resolution: 'chose newer', expectedVersion: 1 });
    expect(r.json().conflicts[0].resolution).toBe('chose newer');

    expect((await api(U['player']!, 'GET', '/rules/review-reminders')).statusCode).toBe(403);
    expect((await api(U['o1']!, 'GET', '/rules/review-reminders')).statusCode).toBe(200);
  });
});
