import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createContainer, runMigrations, seedDatabase, seedIds, type Container, type DevGatewayAdapter } from '@esp/core';
import { clause, preparePublishable } from '@esp/core/testing';
import { buildApp } from './app.js';

let container: Container;
let app: FastifyInstance;
const DEV_CODE = 'api-esp03-dev-code';
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
  base.pathname = `/apitest03_${Date.now().toString(36)}`;
  container = await createContainer({ serviceName: 'api-esp03-test', env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', MONGO_URL: base.toString(), DATA_DIR: mkdtempSync(join(tmpdir(), 'esp-api03-')), LOG_LEVEL: 'silent', AUTH_DEV_LOGIN_ENABLED: 'true', AUTH_DEV_CODE: DEV_CODE, RATE_LIMIT_MAX: '5000', PUBLIC_WEB_ORIGIN: 'http://localhost:5173' } });
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

describe('ESP-03 over HTTP', () => {
  it('organizer builds and publishes a paid event; a player registers, pays through the PSP and is confirmed (AC-01/04)', async () => {
    const pkg = await preparePublishable(container, [clause('roster.min', 1)]);
    const org = await as(seedIds.organizer);
    const start = new Date(Date.now() + 3 * 3600_000).toISOString();
    const ev = await app.inject({ method: 'POST', url: '/api/v1/events', headers: org, payload: { organizerOrgId: seedIds.orgA, name: 'جام آزمایشی', slug: `http-${Date.now()}`, startsAt: start, refundPolicy: { beforeDeadlinePercent: 100, afterDeadlinePercent: 50, onEventCancelPercent: 100, onDisqualificationPercent: 0, text: 'TEST ONLY policy' }, cancellationTerms: 'TEST ONLY', disputeTerms: 'TEST ONLY', prizes: [{ key: 'first', title: 'قهرمان', kind: 'cash', amountRial: 5_000_000, responsible: 'organizer' }] } });
    expect(ev.statusCode).toBe(201);
    const eventId = ev.json().id;
    // another organizer can neither edit nor publish it
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/events/${eventId}`, headers: await as(seedIds.organizerB), payload: { name: 'hijacked', expectedVersion: 0 } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/events/${eventId}`, headers: org, payload: { state: 'published', expectedVersion: 0 } })).json().error.code).toBe('ILLEGAL_TRANSITION');
    const d = await app.inject({ method: 'POST', url: `/api/v1/events/${eventId}/disciplines`, headers: org, payload: { name: 'انفرادی', gameId: 'game_seed_synthetic', gameVersion: 'test', platform: 'pc', mode: '5v5', rulesPackageId: pkg, participantKind: 'player', capacity: 8, feeRial: 2_000_000, registrationClosesAt: new Date(Date.now() + 3600_000).toISOString(), autoApprove: true } });
    expect(d.statusCode).toBe(201);
    const disciplineId = d.json().id;
    // the generic transition endpoint cannot bypass the publication gate
    expect((await app.inject({ method: 'POST', url: `/api/v1/events/${eventId}/transitions`, headers: org, payload: { transition: 'publish', expectedVersion: 1 } })).statusCode).toBe(412);
    const check = await app.inject({ url: `/api/v1/events/${eventId}/publish-check`, headers: org });
    expect(check.json().ok).toBe(true);
    const pub = await app.inject({ method: 'POST', url: `/api/v1/events/${eventId}/publish`, headers: org });
    expect(pub.statusCode).toBe(200);
    const open = await app.inject({ method: 'POST', url: `/api/v1/events/${eventId}/transitions`, headers: org, payload: { transition: 'open_registration', expectedVersion: pub.json().version } });
    expect(open.statusCode).toBe(200);

    const detail = await app.inject(`/api/v1/events/${eventId}`);
    expect(detail.statusCode).toBe(200);
    const dd = detail.json().disciplines[0];
    expect(dd.remaining).toBe(8);
    expect(dd.feeRial).toBe(2_000_000);
    expect(detail.json().prizes[0].guaranteed).toBe(false);
    expect(detail.json().event.refundPolicy.beforeDeadlinePercent).toBe(100);

    const player = await as(seedIds.player);
    const reg = await app.inject({ method: 'POST', url: `/api/v1/disciplines/${disciplineId}/registrations`, headers: player, payload: { acceptRulesHash: dd.rules.hash } });
    expect(reg.statusCode).toBe(201);
    expect(reg.json().state).toBe('awaiting_payment');
    const orderId = reg.json().orderId;
    // return URL must stay on our origin
    expect((await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/pay`, headers: player, payload: { returnUrl: 'https://evil.example/x' } })).statusCode).toBe(400);
    const pay = await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/pay`, headers: player, payload: { returnUrl: 'http://localhost:5173/payments/return' } });
    expect(pay.statusCode).toBe(200);
    // another user cannot pay or read the order
    expect((await app.inject({ url: `/api/v1/orders/${orderId}`, headers: await as(seedIds.captain) })).statusCode).toBe(403);
    // the simulated PSP page and settlement redirect back to the web origin
    const ref = new URL(pay.json().redirectUrl).pathname.split('/').pop()!;
    expect((await app.inject(`/api/v1/dev/gateway/${ref}`)).body).toContain('TEST ONLY');
    const settle = await app.inject(`/api/v1/dev/gateway/${ref}/settle?outcome=success`);
    expect(settle.statusCode).toBe(303);
    expect(settle.headers.location).toContain(`http://localhost:5173/payments/return?order=${orderId}`);
    await container.consumer.drain();
    const order = await app.inject({ url: `/api/v1/orders/${orderId}`, headers: player });
    expect(order.json().state).toBe('paid');
    expect(order.json().receiptNo).toMatch(/^RC-/);
    const mine = await app.inject({ url: '/api/v1/me/registrations', headers: player });
    expect(mine.json().items.find((x: { id: string }) => x.id === reg.json().id).state).toBe('confirmed');
    // a forged callback is rejected
    const gw = container.adapters.payment as unknown as DevGatewayAdapter;
    const forged = gw.forged({ gatewayRef: ref, status: 'success', amountRial: 2_000_000, orderId, merchantId: gw.merchantId, ts: Date.now(), signature: 'x'.repeat(64) });
    expect((await app.inject({ method: 'POST', url: '/api/v1/payments/callback', payload: forged })).statusCode).toBe(403);
    // finance views need finance authority; the organizer sees event financials and the ledger stays balanced
    expect((await app.inject({ url: '/api/v1/finance/reconciliation', headers: player })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/v1/finance/reconciliation', headers: await as(seedIds.finance) })).statusCode).toBe(200);
    const fin = await app.inject({ url: `/api/v1/events/${eventId}/financials`, headers: org });
    expect(fin.json().ordersByKind.entry.grossRial).toBe(2_000_000);
    const csv = await app.inject({ url: '/api/v1/finance/ledger.csv', headers: await as(seedIds.finance) });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('payable:organization:org_seed_a');
    // sponsor drafts are visible to event staff only and stay off the public page until approved (FIN-012)
    const sp = await app.inject({ method: 'POST', url: `/api/v1/events/${eventId}/sponsors`, headers: org, payload: { sponsorName: 'TEST ONLY sponsor', placement: 'event_header', label: 'sponsor' } });
    expect(sp.statusCode).toBe(201);
    expect((await app.inject({ url: `/api/v1/events/${eventId}/sponsors`, headers: player })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/v1/events/${eventId}/sponsors`, headers: org })).json().items[0].state).toBe('draft');
    expect((await app.inject(`/api/v1/events/${eventId}`)).json().sponsors).toHaveLength(0);
    // registrations list and export are private to event staff
    expect((await app.inject({ url: `/api/v1/disciplines/${disciplineId}/registrations`, headers: player })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/v1/disciplines/${disciplineId}/registrations`, headers: org })).json().items.length).toBe(1);
  });

  it('link-only events need the token and are never listed (EVT-003)', async () => {
    const pkg = await preparePublishable(container, [clause('roster.min', 1)]);
    const org = await as(seedIds.organizer);
    const ev = await app.inject({ method: 'POST', url: '/api/v1/events', headers: org, payload: { organizerOrgId: seedIds.orgA, name: 'لینکی', slug: `link-${Date.now()}`, visibility: 'link_only', startsAt: new Date(Date.now() + 3 * 3600_000).toISOString(), cancellationTerms: 'TEST ONLY', disputeTerms: 'TEST ONLY' } });
    const eventId = ev.json().id;
    await app.inject({ method: 'POST', url: `/api/v1/events/${eventId}/disciplines`, headers: org, payload: { name: 'X', gameId: 'game_seed_synthetic', gameVersion: 'test', platform: 'pc', mode: '5v5', rulesPackageId: pkg, participantKind: 'player', capacity: 4, registrationClosesAt: new Date(Date.now() + 3600_000).toISOString() } });
    expect((await app.inject({ method: 'POST', url: `/api/v1/events/${eventId}/publish`, headers: org })).statusCode).toBe(200);
    const token = (await app.inject({ url: `/api/v1/events/${eventId}/manage`, headers: org })).json().event.config.linkToken;
    expect((await app.inject(`/api/v1/events/${eventId}`)).statusCode).toBe(404);
    const withToken = await app.inject(`/api/v1/events/${eventId}?t=${token}`);
    expect(withToken.statusCode).toBe(200);
    expect(withToken.json().event.robots).toBe('noindex');
    const list = await app.inject('/api/v1/events?limit=100');
    expect(list.json().items.map((x: { id: string }) => x.id)).not.toContain(eventId);
  });
});
