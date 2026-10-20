/* eslint-disable @typescript-eslint/no-explicit-any -- manual smoke client reading untyped JSON responses */
/**
 * ESP-06 live smoke (manual, local only), against a running API + worker with AUTH_DEV_LOGIN_ENABLED:
 *   pnpm --filter @esp/api exec tsx scripts/smoke-esp06.ts <apiBase> <devCode> <mongoUrl>
 * TEST ONLY setup through the fixture (published event, 2 players, single elimination), a follower and an editor.
 * Then real HTTP: stream with a 20 s delay → match played → synced live/overlay/news/notification hide the result
 * while the latest view shows it → after the delay all show it → exactly one automatic result post → newsroom
 * reporter→editor flow → gap-free realtime catch-up from the snapshot cursor → private event invisible.
 */
import { createContainer, seedIds } from '@esp/core';
import { clause, competition } from '@esp/core/testing';

const [base = 'http://127.0.0.1:3000/api/v1', devCode = '', mongo = ''] = process.argv.slice(2);
const jar = new Map<string, string>();
const step = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  if (!ok) process.exitCode = 1;
};
async function call(who: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; json: any; headers: Headers }> {
  const headers: Record<string, string> = { 'x-requested-with': 'fetch' };
  if (who) headers['cookie'] = jar.get(who)!;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}
async function login(who: string) {
  const res = await fetch(`${base}/auth/dev-session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ principalId: who, devCode }) });
  jar.set(who, res.headers.getSetCookie().find((x) => x.startsWith('esp_session='))!.split(';')[0]!);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DELAY = 20;

const suffix = Date.now().toString(36);
const fan = `usr_smoke6_fan_${suffix}`;
const ct = await createContainer({ serviceName: 'esp06-smoke', env: { ...process.env, MONGO_URL: mongo, LOG_LEVEL: 'silent' } });
const fx = await competition(ct, { clauses: [clause('elim.third_place', false)], stages: [{ name: 'فینال (TEST ONLY)', format: 'single_elim' }], n: 2 });
const now = new Date().toISOString();
await ct.c.principals.insertOne({ _id: fan, kind: 'user', displayName: 'fan', locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0 });
await ct.c.profiles.insertOne({ _id: fan, nickname: `fan${suffix}`, nicknameLower: `fan${suffix}`, realName: null, bio: null, province: null, city: null, links: [], avatarFileId: null, coverFileId: null, games: [], privacy: {}, notificationPrefs: {}, messagePolicy: 'nobody', lookingForTeam: { active: false, resume: null, gameIds: [], since: null }, createdAt: now, updatedAt: now, version: 0 } as never);
await ct.acl.grant({ principalId: seedIds.reporter, role: 'reporter', scope: { type: 'event', id: fx.eventId }, expiresAt: null, reason: 'smoke' }, { principalId: 'system', requestId: 'smoke6' });
await ct.acl.grant({ principalId: seedIds.organizer, role: 'editor', scope: { type: 'event', id: fx.eventId }, expiresAt: null, reason: 'smoke' }, { principalId: 'system', requestId: 'smoke6' });
await ct.close();
for (const p of [seedIds.organizer, seedIds.reporter, fan, ...fx.principals]) await login(p);
const org = seedIds.organizer;
const stageId = fx.stageIds[0]!;

step('follow the event', (await call(fan, 'POST', `/follows`, { targetType: 'event', targetId: fx.eventId })).status < 300);
const stream = await call(org, 'POST', `/broadcast/events/${fx.eventId}/streams`, { label: 'پخش اصلی', streamKey: 'main', role: 'primary', delaySeconds: DELAY });
step('stream with delay created', stream.status === 200, stream.json?.delaySeconds);
const ov = await call(org, 'POST', `/broadcast/events/${fx.eventId}/overlays`, { streamId: stream.json._id, mode: 'synced', widgets: ['scoreboard'], label: 'OBS', hours: 1 });
step('synced overlay token', ov.status === 200);

// draw + structure + event active
for (const tr of ['close_registration', 'start_preparation']) {
  const ev = await call(org, 'GET', `/events/${fx.eventId}/manage`);
  await call(org, 'POST', `/events/${fx.eventId}/transitions`, { transition: tr, expectedVersion: ev.json.event.version });
}
const d = await call(org, 'POST', `/stages/${stageId}/draws`, { method: 'random' });
for (const s of ['confirm', 'lock', 'publish']) await call(org, 'POST', `/draws/${d.json._id}/${s}`);
await call(org, 'POST', `/stages/${stageId}/structure`);
const evm = await call(org, 'GET', `/events/${fx.eventId}/manage`);
await call(org, 'POST', `/events/${fx.eventId}/transitions`, { transition: 'activate', expectedVersion: evm.json.event.version });

const snap0 = await call(null, 'GET', `/live/events/${fx.eventId}`);
step('synced live centre (cacheable)', snap0.status === 200 && snap0.headers.get('cache-control') === 'public, max-age=5' && snap0.json.view.delaySeconds === DELAY);
step('synced endpoint refuses latest view', (await call(null, 'GET', `/live/events/${fx.eventId}?view=latest`)).status === 400);
const cursor0 = snap0.json.cursor;

// play the match: readiness → start → submit → confirm
const sched = (await call(null, 'GET', `/events/${fx.eventId}/schedule?limit=10`)).json.items as any[];
const m = sched[0];
await call(org, 'POST', `/matches/${m.id}/readiness/open`);
const room = await call(org, 'GET', `/matches/${m.id}/room`);
const lineup = (room.json?.private?.lineup ?? []) as any[];
for (const r of lineup) if (r) await call(r[0].principalId, 'POST', `/matches/${m.id}/ready`);
await call(org, 'POST', `/matches/${m.id}/run/start`);
const [a, b] = lineup.map((r) => r?.[0]?.principalId as string);
await call(a!, 'POST', `/matches/${m.id}/results`, { outcome: { kind: 'win', winnerSide: 0, scores: [2, 1], maps: null } });
const fin = await call(b!, 'POST', `/matches/${m.id}/results/confirm`);
step('match final', fin.json?.state === 'final');
const finalAt = Date.now();
await wait(4000); // worker drains the outbox (automatic post, notifications, live hints)

const synced = await call(null, 'GET', `/live/events/${fx.eventId}`);
const latest = await call(null, 'GET', `/live/events/${fx.eventId}/latest`);
step('latest view shows the result now (no-store)', latest.headers.get('cache-control') === 'no-store' && latest.json.results.some((x: any) => x.id === m.id));
step('synced view hides the result within the delay', !synced.json.results.some((x: any) => x.id === m.id) && !synced.json.timeline.items.some((p: any) => p.kind === 'result'));
const ovs = await call(null, 'GET', `/overlay/${ov.json.token}`);
step('synced overlay hides the score', ovs.status === 200 && (ovs.json.scoreboard === null || ovs.json.scoreboard.outcome === null), ovs.json.scoreboard);
const posts = (await call(null, 'GET', `/news?eventId=${fx.eventId}&limit=50`)).json.items as any[];
step('news list hides the result post within the delay', !posts.some((p) => p.kind === 'result'));
const inbox0 = (await call(fan, 'GET', '/me/notifications')).json;
step('follower end notification not delivered early', !inbox0.items.some((n: any) => n.category === 'follow.end'));
const rt0 = await call(null, 'GET', `/realtime/events?after=${cursor0}&channels=${encodeURIComponent(synced.json.view.channel)}`);
step('synced realtime channel has no result yet', !rt0.json.events.some((e: any) => e.payload?.post?.kind === 'result'));

await wait(Math.max(0, finalAt + (DELAY + 6) * 1000 - Date.now()));
const synced2 = await call(null, 'GET', `/live/events/${fx.eventId}`);
step('after the delay the synced view shows the result', synced2.json.results.some((x: any) => x.id === m.id));
const resultPosts = synced2.json.timeline.items.filter((p: any) => p.kind === 'result');
step('exactly one automatic result post', resultPosts.length === 1 && resultPosts[0].source === 'automatic' && resultPosts[0].result.final === true, resultPosts.length);
step('synced overlay shows the score after the delay', (await call(null, 'GET', `/overlay/${ov.json.token}`)).json.scoreboard?.outcome?.kind === 'win');
const rt1 = await call(null, 'GET', `/realtime/events?after=${cursor0}&channels=${encodeURIComponent(synced.json.view.channel)}`);
step('gap-free catch-up from the snapshot cursor delivers it', rt1.json.events.some((e: any) => e.payload?.post?.kind === 'result'));
const inbox1 = (await call(fan, 'GET', '/me/notifications')).json;
step('follower end notification delivered after the delay', inbox1.items.some((n: any) => n.category === 'follow.end'));

// newsroom: reporter drafts, editor publishes
const draft = await call(seedIds.reporter, 'POST', '/news', { eventId: fx.eventId, kind: 'text', format: 'article', title: 'گزارش پس از فینال', body: 'متن آزمایشی TEST ONLY', spoiler: false });
step('reporter draft', draft.status === 201);
step('reporter cannot publish directly', (await call(seedIds.reporter, 'POST', `/news/${draft.json.post._id}/publish`, { expectedVersion: draft.json.post.version })).status === 403);
const sub = await call(seedIds.reporter, 'POST', `/news/${draft.json.post._id}/submit`, { expectedVersion: draft.json.post.version });
const pub = await call(org, 'POST', `/news/${draft.json.post._id}/publish`, { expectedVersion: sub.json.version });
step('editor publishes', pub.json?.state === 'published');
step('article page and SEO meta', (await call(null, 'GET', `/news/${pub.json.slug}/meta`)).json?.jsonLd?.includes('NewsArticle'));

// private event: invisible
const fx2c = await createContainer({ serviceName: 'esp06-smoke-2', env: { ...process.env, MONGO_URL: mongo, LOG_LEVEL: 'silent' } });
await fx2c.c.events.updateOne({ _id: fx.eventId }, { $set: { visibility: 'private' } });
await fx2c.close();
step('private event live centre is not found', (await call(null, 'GET', `/live/events/${fx.eventId}`)).status === 404);
