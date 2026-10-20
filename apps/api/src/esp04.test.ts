import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createContainer, runMigrations, seedDatabase, seedIds, type Container } from '@esp/core';
import { clause, competition } from '@esp/core/testing';
import { buildApp } from './app.js';

let container: Container;
let app: FastifyInstance;
const DEV_CODE = 'api-esp04-dev-code';
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
  base.pathname = `/apitest04_${Date.now().toString(36)}`;
  container = await createContainer({ serviceName: 'api-esp04-test', env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', MONGO_URL: base.toString(), DATA_DIR: mkdtempSync(join(tmpdir(), 'esp-api04-')), LOG_LEVEL: 'silent', AUTH_DEV_LOGIN_ENABLED: 'true', AUTH_DEV_CODE: DEV_CODE, RATE_LIMIT_MAX: '5000', PUBLIC_WEB_ORIGIN: 'http://localhost:5173' } });
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

describe('ESP-04 over HTTP', () => {
  it('draw → bracket → schedule → room → result → advancement, with public views that never leak private data', async () => {
    const fx = await competition(container, { clauses: [clause('elim.third_place', false), clause('match.bo', 1)], stages: [{ name: 'SE', format: 'single_elim', presence: 'offline' }], n: 4 });
    const org = await as(seedIds.organizer);
    const stageId = fx.stageIds[0]!;
    const attributes = Object.fromEntries(fx.participants.map((id, i) => [id, { seed: i + 1 }]));
    const d = await app.inject({ method: 'POST', url: `/api/v1/stages/${stageId}/draws`, headers: org, payload: { method: 'manual', attributes } });
    expect(d.statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: `/api/v1/stages/${stageId}/draws`, headers: await as(fx.principals[0]!), payload: { method: 'random' } })).statusCode).toBe(403);
    for (const s of ['confirm', 'lock', 'publish']) expect((await app.inject({ method: 'POST', url: `/api/v1/draws/${d.json()._id}/${s}`, headers: org })).statusCode).toBe(200);
    expect((await app.inject(`/api/v1/draws/${d.json()._id}/verify`)).json()).toEqual({ reproducible: true });
    expect((await app.inject({ method: 'POST', url: `/api/v1/stages/${stageId}/structure`, headers: org })).statusCode).toBe(201);
    const bracket = await app.inject(`/api/v1/stages/${stageId}/bracket?round=1&limit=10`);
    expect(bracket.statusCode).toBe(200);
    expect(bracket.json().slots).toHaveLength(2);
    expect(bracket.json().slots[0].participants.map((p: { name: string }) => p.name)).toEqual(['بازیکن 1', 'بازیکن 4']);

    // schedule
    const from = '2027-05-01T06:30:00.000Z';
    expect((await app.inject({ method: 'PUT', url: `/api/v1/events/${fx.eventId}/schedule-config`, headers: org, payload: { windows: [{ from, to: '2027-05-01T18:30:00.000Z' }], defaultDurationMinutes: 40, bufferMinutes: 5, minRestMinutes: 10, broadcastWindows: [], unavailable: [] } })).statusCode).toBe(200);
    const pr = await app.inject({ method: 'POST', url: `/api/v1/events/${fx.eventId}/schedule/auto`, headers: org, payload: { from, reason: 'day plan' } });
    expect(pr.statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: `/api/v1/schedule-proposals/${pr.json()._id}/apply`, headers: org, payload: { confirm: true } })).statusCode).toBe(200);
    const sched = await app.inject(`/api/v1/events/${fx.eventId}/schedule`);
    expect(sched.json().items.every((m: { scheduledAt: string | null }) => m.scheduledAt)).toBe(true);
    const p0 = fx.principals[0]!;
    const ics = await app.inject({ url: '/api/v1/me/calendar.ics', headers: await as(p0) });
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.body).toContain('BEGIN:VEVENT');

    // room: public vs private, readiness, lobby only to the sides
    const m = (await container.c.matches.findOne({ stageId, 'slot.key': 'W1-1' }))!;
    const pubRoom = await app.inject(`/api/v1/matches/${m._id}/room`);
    expect(pubRoom.json().private).toBeNull();
    expect(JSON.stringify(pubRoom.json())).not.toContain(p0);
    expect((await app.inject({ method: 'POST', url: `/api/v1/matches/${m._id}/readiness/open`, headers: org })).statusCode).toBe(200);
    const sideA = await as(m.sides[0]!.roster[0]!.principalId);
    const sideB = await as(m.sides[1]!.roster[0]!.principalId);
    await app.inject({ method: 'PUT', url: `/api/v1/matches/${m._id}/lobby`, headers: org, payload: { host: 'lan-host-7', password: 'hush-1234' } });
    expect((await app.inject({ url: `/api/v1/matches/${m._id}/lobby`, headers: sideA })).statusCode).toBe(412);
    await app.inject({ method: 'POST', url: `/api/v1/matches/${m._id}/ready`, headers: sideA });
    expect((await app.inject({ method: 'POST', url: `/api/v1/matches/${m._id}/ready`, headers: sideB })).json().state).toBe('ready');
    expect((await app.inject({ url: `/api/v1/matches/${m._id}/lobby`, headers: sideA })).json().password).toBe('hush-1234');
    expect((await app.inject({ url: `/api/v1/matches/${m._id}/lobby`, headers: await as(fx.principals.find((x) => !m.principalIds!.includes(x))!) })).statusCode).toBe(403);
    expect(JSON.stringify((await app.inject(`/api/v1/events/${fx.eventId}/hall`)).json())).not.toContain('hush-1234');

    // run + result through HTTP, advancement visible in the public bracket
    expect((await app.inject({ method: 'POST', url: `/api/v1/matches/${m._id}/run/start`, headers: org })).json().state).toBe('live');
    expect((await app.inject({ method: 'POST', url: `/api/v1/matches/${m._id}/results`, headers: sideA, payload: { outcome: { kind: 'win', winnerSide: 0, maps: [1, 0] } } })).json().state).toBe('provisional');
    expect((await app.inject({ method: 'POST', url: `/api/v1/matches/${m._id}/finalize`, headers: sideA, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/matches/${m._id}/finalize`, headers: await as(seedIds.referee), payload: {} })).json().state).toBe('final');
    await container.consumer.drain();
    const r2 = await app.inject(`/api/v1/stages/${stageId}/bracket?round=2`);
    expect(r2.json().slots[0].participants[0].name).toBe('بازیکن 1');
    const standings = await app.inject(`/api/v1/stages/${stageId}/standings?limit=2`);
    expect(standings.json()).toMatchObject({ provisional: true, limit: 2 });
  });

  it('servers, integration fallback and LAN admission over HTTP', async () => {
    const fx = await competition(container, { clauses: [clause('elim.third_place', false)], stages: [{ name: 'LAN', format: 'single_elim', presence: 'offline' }], n: 2 });
    const org = await as(seedIds.organizer);
    const srv = await app.inject({ method: 'POST', url: `/api/v1/events/${fx.eventId}/servers`, headers: org, payload: { gameId: 'game_seed_synthetic', name: 'lan-1', region: 'tehran', kind: 'lan_host', connection: { host: '192.168.1.10', port: 7777 }, capacity: 2 } });
    expect(srv.statusCode).toBe(201);
    expect(srv.json().connection).toBeNull();
    expect((await app.inject(`/api/v1/games/game_seed_synthetic/integration`)).json().enabled).toBe(false);
    const venue = await app.inject({ method: 'POST', url: `/api/v1/events/${fx.eventId}/venues`, headers: org, payload: { name: 'سالن آزمون', addressText: 'تهران، خیابان آزمون ۱', areas: [{ key: 'hall', name: 'سالن', kind: 'hall', capacity: 100 }] } });
    expect(venue.statusCode).toBe(201);
    expect((await app.inject(`/api/v1/events/${fx.eventId}/venues`)).json().items[0].addressText).toContain('تهران');
    const player = fx.principals[0]!;
    expect((await app.inject({ method: 'POST', url: `/api/v1/events/${fx.eventId}/credentials`, headers: org, payload: { principalId: player, role: 'player' } })).statusCode).toBe(201);
    const qr = (await app.inject({ url: `/api/v1/events/${fx.eventId}/my-qr`, headers: await as(player) })).json().items[0].qr;
    const ok = await app.inject({ method: 'POST', url: `/api/v1/events/${fx.eventId}/admissions`, headers: org, payload: { qr, gate: 'G1', area: 'hall' } });
    expect(ok.json()).toMatchObject({ admitted: true, role: 'player' });
    expect((await app.inject({ method: 'POST', url: `/api/v1/events/${fx.eventId}/admissions`, headers: org, payload: { qr, gate: 'G1', area: 'hall' } })).statusCode).toBe(403);
    // emergency import (multipart)
    const boundary = '----esp04';
    const csv = 'credentialId,principalId,gate,area,at\n,' + player + ',G2,hall,2027-05-01T08:00:00.000Z\n';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="procedureNo"\r\n\r\nEP-02\r\n--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nattendance\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`;
    const imp = await app.inject({ method: 'POST', url: `/api/v1/events/${fx.eventId}/offline-imports`, headers: { ...org, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(imp.statusCode).toBe(201);
    expect(imp.json().rows[0].status).toBe('pending');
  });
});
