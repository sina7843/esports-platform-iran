import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createContainer, runMigrations, seedDatabase, seedIds, type Container } from '@esp/core';
import { clause, competition, drawAndGenerate, toLive, win } from '@esp/core/testing';
import { buildApp } from './app.js';

let container: Container;
let app: FastifyInstance;
const DEV_CODE = 'api-esp05-dev-code';
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
  base.pathname = `/apitest05_${Date.now().toString(36)}`;
  container = await createContainer({ serviceName: 'api-esp05-test', env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', MONGO_URL: base.toString(), DATA_DIR: mkdtempSync(join(tmpdir(), 'esp-api05-')), LOG_LEVEL: 'silent', AUTH_DEV_LOGIN_ENABLED: 'true', AUTH_DEV_CODE: DEV_CODE, RATE_LIMIT_MAX: '5000', PUBLIC_WEB_ORIGIN: 'http://localhost:5173' } });
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

const RULES = [clause('elim.third_place', false), clause('dispute.appeal_minutes', 60), clause('result.decision', 'TEST ONLY: referee decides')];

describe('ESP-05 over HTTP', () => {
  it('result confirm/contest, case flow with role projections, public decisions, guarded generic transitions', async () => {
    const fx = await competition(container, { clauses: RULES, stages: [{ name: 'SE', format: 'single_elim' }], n: 4 });
    await drawAndGenerate(container, fx.stageIds[0]!, { method: 'manual', attributes: Object.fromEntries(fx.participants.map((id, i) => [id, { seed: i + 1 }])) });
    const org = await as(seedIds.organizer);
    const [m1, m2] = await container.c.matches.find({ stageId: fx.stageIds[0]!, state: 'scheduled' }).sort({ 'slot.order': 1 }).toArray();
    const l1 = await toLive(container, m1!);
    const p0 = l1.sides[0]!.roster[0]!.principalId;
    const p1 = l1.sides[1]!.roster[0]!.principalId;
    // the generic transition endpoint cannot finalise or reopen
    const gen = await app.inject({ method: 'POST', url: `/api/v1/matches/${l1._id}/transitions`, headers: await as(seedIds.referee), payload: { transition: 'finalize', expectedVersion: l1.version } });
    expect(gen.statusCode).toBe(412);
    expect((await app.inject({ method: 'POST', url: `/api/v1/events/${fx.eventId}/transitions`, headers: org, payload: { transition: 'close', expectedVersion: 0 } })).statusCode).toBe(412);
    // submit (with a validated unit) → confirm by the opponent → final
    const sub = await app.inject({ method: 'POST', url: `/api/v1/matches/${l1._id}/results`, headers: await as(p0), payload: { outcome: win(0), units: [{ order: 1, kind: 'map', label: 'Map 1', values: { a: 'x', b: 'y', mapsA: 2, mapsB: 0, scoreA: 30, scoreB: 10, winner: 'a' } }] } });
    expect(sub.statusCode).toBe(200);
    expect(sub.json().state).toBe('provisional');
    expect((await app.inject({ method: 'POST', url: `/api/v1/matches/${l1._id}/results/confirm`, headers: await as(p0) })).statusCode).toBe(412);
    const conf = await app.inject({ method: 'POST', url: `/api/v1/matches/${l1._id}/results/confirm`, headers: await as(p1) });
    expect(conf.statusCode).toBe(200);
    expect(conf.json().state).toBe('final');
    // contest on the second match → case; finalize refused while it is open
    const l2 = await toLive(container, m2!);
    const q0 = l2.sides[0]!.roster[0]!.principalId;
    const q1 = l2.sides[1]!.roster[0]!.principalId;
    await app.inject({ method: 'POST', url: `/api/v1/matches/${l2._id}/results`, headers: await as(q0), payload: { outcome: win(0) } });
    const contest = await app.inject({ method: 'POST', url: `/api/v1/matches/${l2._id}/results/contest`, headers: await as(q1), payload: { claim: 'Side one entered a wrong score here' } });
    expect(contest.statusCode).toBe(200);
    const caseId = contest.json()._id as string;
    expect(contest.json().role).toBe('party');
    expect((await app.inject({ method: 'POST', url: `/api/v1/matches/${l2._id}/finalize`, headers: await as(seedIds.referee), payload: { outcome: win(0) } })).statusCode).toBe(412);
    // officials: organizer appoints a head referee and an appeal authority (both created as principals)
    const now = new Date().toISOString();
    for (const id of ['usr_api05_head', 'usr_api05_appeal']) await container.c.principals.insertOne({ _id: id, kind: 'user', displayName: id, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0 });
    expect((await app.inject({ method: 'POST', url: `/api/v1/events/${fx.eventId}/officials`, headers: org, payload: { principalId: 'usr_api05_head', role: 'head_referee' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/events/${fx.eventId}/officials`, headers: org, payload: { principalId: 'usr_api05_appeal', role: 'appeal_authority' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/events/${fx.eventId}/officials`, headers: await as(q0), payload: { principalId: 'usr_api05_head', role: 'referee' } })).statusCode).toBe(403);
    const head = await as('usr_api05_head');
    const ref = await as(seedIds.referee);
    expect((await app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/assign`, headers: head, payload: { assignee: seedIds.referee } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/defense`, headers: await as(q0), payload: { text: 'Our result is correct and logged' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/review`, headers: ref })).statusCode).toBe(200);
    const dec = await app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/decision`, headers: ref, payload: { clauseKey: 'result.decision', publicSummary: 'Side one result confirmed', reasoning: 'PRIVATE: server log reviewed', effect: { kind: 'result_change', outcome: win(0) } } });
    expect(dec.statusCode).toBe(200);
    // party sees no reasoning; outsiders get 403; public decisions never show reasoning or names
    const pv = await app.inject({ url: `/api/v1/cases/${caseId}`, headers: await as(q1) });
    expect(pv.json().role).toBe('party');
    expect(pv.body).not.toContain('PRIVATE');
    expect((await app.inject({ url: `/api/v1/cases/${caseId}`, headers: await as(p0) })).statusCode).toBe(403);
    const off = await app.inject({ url: `/api/v1/cases/${caseId}`, headers: ref });
    expect(off.json().role).toBe('official');
    const pub = await app.inject(`/api/v1/events/${fx.eventId}/decisions`);
    expect(pub.statusCode).toBe(200);
    expect(pub.body).not.toContain('PRIVATE');
    expect(pub.body).not.toContain(q1);
    // appeal → independent authority decides
    const ap = await app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/appeal`, headers: await as(q1), payload: { text: 'The decision ignored our evidence' } });
    expect(ap.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/appeal-decision`, headers: ref, payload: { clauseKey: 'result.decision', publicSummary: 'Upheld on appeal review', reasoning: 'Same evidence applies here', effect: { kind: 'none' } } })).statusCode).toBe(403);
    const fin = await app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/appeal-decision`, headers: await as('usr_api05_appeal'), payload: { clauseKey: 'result.decision', publicSummary: 'Upheld on appeal review', reasoning: 'Same evidence applies here', effect: { kind: 'none' } } });
    expect(fin.statusCode).toBe(200);
    expect(fin.json().state).toBe('closed');
    // correction preview is read-only and needs authority
    expect((await app.inject({ method: 'POST', url: `/api/v1/matches/${l1._id}/corrections/preview`, headers: await as(p0), payload: { outcome: win(1) } })).statusCode).toBe(403);
    const prev = await app.inject({ method: 'POST', url: `/api/v1/matches/${l1._id}/corrections/preview`, headers: head, payload: { outcome: win(1) } });
    expect(prev.statusCode).toBe(200);
    expect(prev.json().resetMatches.length).toBe(1);
    expect((await app.inject({ method: 'POST', url: `/api/v1/matches/${l1._id}/corrections`, headers: head, payload: { outcome: win(1), reason: 'TEST ONLY', approvalId: 'apr_missing' } })).statusCode).toBe(404);
    // finish is refused while the final is unplayed
    const ev = (await container.c.events.findOne({ _id: fx.eventId }))!;
    expect((await app.inject({ method: 'POST', url: `/api/v1/events/${fx.eventId}/finish`, headers: org, payload: { expectedVersion: ev.version } })).statusCode).toBe(412);
    const bl = await app.inject({ url: `/api/v1/events/${fx.eventId}/close-blockers`, headers: org });
    expect(bl.json().canFinish).toBe(false);
  });

  it('ranking and honors public reads; verification and share card are safe', async () => {
    const sys = await app.inject({ method: 'POST', url: '/api/v1/ratings/systems', headers: await as(seedIds.admin), payload: { gameId: 'game_seed_synthetic', mode: '5v5', platform: 'pc', subject: 'player', model: 'glicko2', params: { initialRating: 1500, initialRd: 350, initialVolatility: 0.06, tau: 0.5, periodDays: 7 }, carry: { kind: 'reset', factor: null }, inactivityDays: 180, tiebreak: [], regionBasis: 'TEST ONLY', eventWeights: { standard: 1 }, eligibility: 'TEST ONLY rated events' } });
    expect(sys.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/ratings/systems', headers: await as(seedIds.player), payload: { gameId: 'game_seed_synthetic', mode: '5v5', subject: 'player', model: 'glicko2', params: { initialRating: 1500, initialRd: 350, initialVolatility: 0.06, tau: 0.5, periodDays: 7 }, carry: { kind: 'reset', factor: null }, inactivityDays: 180, tiebreak: [], regionBasis: 'x x x', eventWeights: {}, eligibility: 'x x x' } })).statusCode).toBe(403);
    expect((await app.inject(`/api/v1/ratings/systems/${sys.json().id}/leaderboard`)).statusCode).toBe(404); // draft
    expect((await app.inject({ method: 'POST', url: `/api/v1/ratings/systems/${sys.json().id}/publish`, headers: await as(seedIds.admin) })).statusCode).toBe(200);
    const lb = await app.inject(`/api/v1/ratings/systems/${sys.json().id}/leaderboard?province=${encodeURIComponent('تهران')}`);
    expect(lb.statusCode).toBe(200);
    expect(lb.json().label).toMatchObject({ official: false, text: 'internal_unapproved' });
    expect((await app.inject('/api/v1/ratings/systems')).json().items.length).toBeGreaterThan(0);
    expect((await app.inject('/api/v1/verify/not-a-code')).statusCode).toBe(400);
    expect((await app.inject('/api/v1/verify/ABCDEF123456')).statusCode).toBe(404);
    expect((await app.inject(`/api/v1/careers/players/${seedIds.player}`)).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/declared-achievements', headers: await as(seedIds.player), payload: { owner: { kind: 'principal', ref: seedIds.player }, title: 'قهرمان جام محلی', eventName: 'TEST ONLY cup' } })).statusCode).toBe(200);
    const prof = await app.inject(`/api/v1/players/${seedIds.player}/honors`);
    expect(prof.json().declared[0].label).toBe('declared_unverified');
    expect(prof.json().verified).toEqual([]);
    expect((await app.inject({ method: 'POST', url: '/api/v1/integrity-reports', headers: await as(seedIds.player), payload: { category: 'cheating', subjects: [{ kind: 'principal', ref: seedIds.captain }], description: 'Suspicious aim pattern in the final' } })).json()).not.toHaveProperty('subjects');
  });
});
