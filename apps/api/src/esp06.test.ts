import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createContainer, runMigrations, seedDatabase, seedIds, type Container } from '@esp/core';
import { clause, competition, drawAndGenerate } from '@esp/core/testing';
import { buildApp } from './app.js';

let container: Container;
let app: FastifyInstance;
const DEV_CODE = 'api-esp06-dev-code';
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
  base.pathname = `/apitest06_${Date.now().toString(36)}`;
  container = await createContainer({ serviceName: 'api-esp06-test', env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', MONGO_URL: base.toString(), DATA_DIR: mkdtempSync(join(tmpdir(), 'esp-api06-')), LOG_LEVEL: 'silent', AUTH_DEV_LOGIN_ENABLED: 'true', AUTH_DEV_CODE: DEV_CODE, RATE_LIMIT_MAX: '5000', PUBLIC_WEB_ORIGIN: 'http://localhost:5173' } });
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

describe('ESP-06 over HTTP', () => {
  it('live centre: synced and latest are separate endpoints with distinct cache policies; overlays work only by token', async () => {
    const fx = await competition(container, { clauses: [clause('elim.third_place', false)], stages: [{ name: 'SE', format: 'single_elim' }], n: 4 });
    await drawAndGenerate(container, fx.stageIds[0]!);
    const org = await as(seedIds.organizer);
    const st = await app.inject({ method: 'POST', url: `/api/v1/broadcast/events/${fx.eventId}/streams`, headers: org, payload: { label: 'اصلی', streamKey: 'k', role: 'primary', delaySeconds: 45 } });
    expect(st.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/broadcast/events/${fx.eventId}/streams`, headers: await as(fx.principals[0]!), payload: { label: 'x', streamKey: 'k', role: 'primary', delaySeconds: 0 } })).statusCode).toBe(403);
    const synced = await app.inject(`/api/v1/live/events/${fx.eventId}`);
    expect(synced.statusCode).toBe(200);
    expect(synced.headers['cache-control']).toBe('public, max-age=5');
    expect(synced.json().view).toMatchObject({ kind: 'synced', delaySeconds: 45 });
    expect(synced.json().streams[0].provider.configured).toBe(false); // no streaming provider selected: shown honestly
    expect((await app.inject(`/api/v1/live/events/${fx.eventId}?view=latest`)).statusCode).toBe(400);
    const latest = await app.inject(`/api/v1/live/events/${fx.eventId}/latest`);
    expect(latest.headers['cache-control']).toBe('no-store');
    expect(latest.json().view.kind).toBe('latest');
    for (const tab of ['schedule', 'bracket', 'stats', 'gallery', 'video', 'timeline']) expect((await app.inject(`/api/v1/live/events/${fx.eventId}/tabs/${tab}`)).statusCode).toBe(200);
    const ov = await app.inject({ method: 'POST', url: `/api/v1/broadcast/events/${fx.eventId}/overlays`, headers: org, payload: { streamId: st.json()._id, mode: 'synced', widgets: ['scoreboard', 'sponsor'], label: 'OBS', hours: 2 } });
    expect(ov.statusCode).toBe(200);
    const state = await app.inject(`/api/v1/overlay/${ov.json().token}`);
    expect(state.statusCode).toBe(200);
    expect(state.json().label).toBe('synced_to_stream');
    expect((await app.inject(`/api/v1/overlay/${'x'.repeat(32)}`)).statusCode).toBe(404);
    expect(JSON.stringify((await app.inject({ url: `/api/v1/broadcast/events/${fx.eventId}/overlays`, headers: org })).json())).not.toContain(ov.json().token);
    await app.inject({ method: 'DELETE', url: `/api/v1/broadcast/overlays/${ov.json().overlay._id}`, headers: org });
    expect((await app.inject(`/api/v1/overlay/${ov.json().token}`)).statusCode).toBe(404);
  });

  it('newsroom: reporter drafts, editor publishes; public lists, article meta and share card; comments/reactions; notifications; search; home', async () => {
    const fx = await competition(container, { clauses: [clause('elim.third_place', false)], stages: [{ name: 'SE', format: 'single_elim' }], n: 2 });
    await container.acl.grant({ principalId: seedIds.reporter, role: 'reporter', scope: { type: 'event', id: fx.eventId }, expiresAt: null, reason: 'TEST ONLY' }, { principalId: 'system', requestId: 'r' });
    const rep = await as(seedIds.reporter);
    expect((await app.inject({ method: 'POST', url: '/api/v1/news', headers: await as(seedIds.player), payload: { eventId: fx.eventId, kind: 'text', title: 'خبر', body: 'x' } })).statusCode).toBe(403);
    const created = await app.inject({ method: 'POST', url: '/api/v1/news', headers: rep, payload: { eventId: fx.eventId, kind: 'text', format: 'article', title: 'افتتاحیه رقابت‌ها', body: '<script>alert(1)</script> متن خبر', spoiler: false, seo: { description: 'توضیح کوتاه' } } });
    expect(created.statusCode).toBe(201);
    const post = created.json().post;
    expect((await app.inject({ method: 'POST', url: `/api/v1/news/${post._id}/publish`, headers: rep, payload: { expectedVersion: post.version } })).statusCode).toBe(403); // direct publish is an editor right
    const sub = await app.inject({ method: 'POST', url: `/api/v1/news/${post._id}/submit`, headers: rep, payload: { expectedVersion: post.version } });
    expect(sub.json().state).toBe('in_review');
    const pub = await app.inject({ method: 'POST', url: `/api/v1/news/${post._id}/publish`, headers: await as(seedIds.organizer), payload: { expectedVersion: sub.json().version } });
    expect(pub.statusCode).toBe(403); // organizer of org A has no news.publish
    await container.acl.grant({ principalId: seedIds.organizer, role: 'editor', scope: { type: 'event', id: fx.eventId }, expiresAt: null, reason: 'TEST ONLY' }, { principalId: 'system', requestId: 'r' });
    expect((await app.inject({ method: 'POST', url: `/api/v1/news/${post._id}/publish`, headers: await as(seedIds.organizer), payload: { expectedVersion: sub.json().version } })).json().state).toBe('published');
    const article = await app.inject(`/api/v1/news/${post.slug}`);
    expect(article.statusCode).toBe(200);
    expect(article.json().body).toContain('<script>'); // stored as plain text; rendered as text, never HTML
    const meta = (await app.inject(`/api/v1/news/${post.slug}/meta`)).json();
    expect(meta.canonical).toBe(`http://localhost:5173/news/${encodeURIComponent(post.slug)}`);
    expect(meta.jsonLd).not.toContain('<');
    const card = await app.inject(`/api/v1/news/${post.slug}/card.svg`);
    expect(card.headers['content-type']).toContain('image/svg+xml');
    expect(card.body).not.toContain('<script>');
    expect((await app.inject('/api/v1/news?q=افتتاحیه')).json().items).toHaveLength(1);
    const u = await as(seedIds.player);
    expect((await app.inject({ method: 'POST', url: `/api/v1/news/${post._id}/reactions`, headers: u, payload: { emoji: '🔥' } })).json()).toEqual({ '🔥': 1 });
    expect((await app.inject({ method: 'POST', url: `/api/v1/news/${post._id}/comments`, headers: u, payload: { text: 'عالی' } })).statusCode).toBe(200);
    expect((await app.inject(`/api/v1/news/${post._id}/comments`)).json().items[0].text).toBe('عالی');
    // notifications: official message with acknowledgement
    const msg = await app.inject({ method: 'POST', url: `/api/v1/events/${fx.eventId}/official-messages`, headers: await as(seedIds.organizer), payload: { audience: 'participants', title: 'جلسه توجیهی', body: 'ساعت ۱۸ در سالن', requiresAck: true } });
    expect(msg.statusCode).toBe(200);
    const inbox = (await app.inject({ url: '/api/v1/me/notifications', headers: await as(fx.principals[0]!) })).json();
    expect(inbox.items[0]).toMatchObject({ title: 'جلسه توجیهی', ackRequired: true, ackAt: null });
    expect((await app.inject({ method: 'POST', url: `/api/v1/me/notifications/${inbox.items[0].id}/ack`, headers: await as(fx.principals[0]!) })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/v1/official-messages/${msg.json()._id}/report`, headers: await as(seedIds.organizer) })).json().totals.acknowledged).toBe(1);
    const prefs = await app.inject({ method: 'PATCH', url: '/api/v1/me/notification-prefs', headers: u, payload: { quietHours: { from: '23:00', to: '07:00' }, categories: { 'follow.start': false } } });
    expect(prefs.json().quietHours).toEqual({ from: '23:00', to: '07:00' });
    expect(prefs.json()).not.toHaveProperty('unsubscribeToken');
    expect((await app.inject({ method: 'POST', url: '/api/v1/notifications/unsubscribe', payload: { token: 'not-a-real-token-123456' } })).statusCode).toBe(404);
    // search, home, spectator chat
    expect((await app.inject('/api/v1/search?q=Team')).statusCode).toBe(200);
    expect((await app.inject('/api/v1/home')).json().personal).toBe(false);
    expect((await app.inject({ url: '/api/v1/home', headers: u })).json().personal).toBe(true);
    expect((await app.inject({ method: 'POST', url: `/api/v1/events/${fx.eventId}/spectator-chat`, payload: { text: 'سلام' }, headers: H })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `/api/v1/events/${fx.eventId}/spectator-chat`, headers: u, payload: { text: 'سلام' } })).statusCode).toBe(200);
    expect((await app.inject(`/api/v1/events/${fx.eventId}/spectator-chat`)).json().items[0].text).toBe('سلام');
  });

  it('a private event live centre and its news are invisible to the public', async () => {
    const fx = await competition(container, { clauses: [clause('elim.third_place', false)], stages: [{ name: 'SE', format: 'single_elim' }], n: 2 });
    await container.c.events.updateOne({ _id: fx.eventId }, { $set: { visibility: 'private' } });
    expect((await app.inject(`/api/v1/live/events/${fx.eventId}`)).statusCode).toBe(404);
    expect((await app.inject(`/api/v1/live/events/${fx.eventId}/latest`)).statusCode).toBe(404);
    expect((await app.inject(`/api/v1/events/${fx.eventId}/spectator-chat`)).statusCode).toBe(404);
  });
});
