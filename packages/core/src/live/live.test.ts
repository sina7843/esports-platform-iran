import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { matchMachine } from '@esp/contracts';
import { testContainer, rid } from '../test/harness.js';
import { clause } from '../test/esp03-fixture.js';
import { competition, drawAndGenerate, win } from '../test/esp04-fixture.js';
import { seedIds } from '../db/seed-ids.js';
import { applyTransition } from '../domain/transition.js';
import { newId } from '../ids.js';
import type { MatchDoc } from '../db/collections.js';
import { MatchResultService } from '../competition/results.js';
import { CorrectionService } from '../integrity/corrections.js';
import { OfficialsService } from '../integrity/officials.js';
import { NewsService } from '../news/news.js';
import { NotificationService } from '../notifications/notifications.js';
import { SocialService } from '../social/social.js';
import { LiveService } from './live.js';
import { BroadcastService } from './broadcast.js';

let t: Awaited<ReturnType<typeof testContainer>>;
let live: LiveService;
let news: NewsService;
let bc: BroadcastService;
beforeAll(async () => {
  t = await testContainer({ seed: true });
  live = new LiveService(t);
  news = new NewsService(t);
  bc = new BroadcastService(t);
});
afterAll(async () => {
  await t.drop();
});
afterEach(() => {
  vi.useRealTimers();
});
/** Only `Date` is faked: the database driver keeps its real timers (controlled clock for the publication policy). */
const at = (ms: number) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ms);
};

async function person(label: string): Promise<string> {
  const id = `usr_${label}_${newId().slice(-8)}`;
  const now = new Date().toISOString();
  await t.c.principals.insertOne({ _id: id, kind: 'user', displayName: label, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0 });
  await t.c.profiles.insertOne({ _id: id, nickname: label, nicknameLower: label.toLowerCase(), realName: null, bio: null, province: null, city: null, links: [], avatarFileId: null, coverFileId: null, games: [], privacy: {}, notificationPrefs: {}, messagePolicy: 'everyone', lookingForTeam: { active: false, resume: null, gameIds: [], since: null }, createdAt: now, updatedAt: now, version: 0 } as never);
  return id;
}
async function se4() {
  const fx = await competition(t, { clauses: [clause('elim.third_place', false), clause('dispute.appeal_minutes', 60)], stages: [{ name: 'SE', format: 'single_elim' }], n: 4 });
  await drawAndGenerate(t, fx.stageIds[0]!, { method: 'manual', attributes: Object.fromEntries(fx.participants.map((id, i) => [id, { seed: i + 1 }])) });
  const stream = await bc.addStream(fx.eventId, { disciplineId: null, stageId: null, language: 'fa', label: 'پخش اصلی', streamKey: 'main', role: 'primary', delaySeconds: 60, nextProgramme: null }, seedIds.organizer, rid());
  return { ...fx, stream };
}
async function play(m: MatchDoc, outcome = win(0)) {
  let cur = (await t.c.matches.findOne({ _id: m._id }))!;
  for (const tr of ['open_checkin', 'mark_ready', 'start']) cur = (await applyTransition(matchMachine, t.c.matches, cur._id, { transition: tr, expectedVersion: cur.version, actorRoles: ['system'] }, tr === 'start' ? ({ 'run.startedAt': new Date().toISOString() } as never) : {})).doc;
  const results = new MatchResultService(t);
  await results.submit(cur._id, outcome, [], cur.sides[0]!.roster[0]!.principalId, rid());
  await results.confirm(cur._id, cur.sides[1]!.roster[0]!.principalId, rid());
  await t.consumer.drain();
  return (await t.c.matches.findOne({ _id: m._id }))!;
}
const scheduled = (stageId: string) => t.c.matches.find({ stageId, state: 'scheduled' }).sort({ 'slot.order': 1 }).toArray();

describe('anti-spoiler publication policy (CAST-005/006/007, AC-16)', () => {
  it('a delayed view hides the result from snapshot, timeline, realtime, overlay, article, search and audience notifications until the delay passes', async () => {
    const fx = await se4();
    const fan = await person('fan');
    await new SocialService(t).follow(fan, 'event', fx.eventId, rid());
    const [s1] = await scheduled(fx.stageIds[0]!);
    const ov = await bc.createOverlay(fx.eventId, { streamId: fx.stream._id, mode: 'synced', widgets: ['scoreboard', 'bracket'], matchId: s1!._id, label: 'OBS', hours: 2 }, seedIds.organizer, rid());
    const ovLatest = await bc.createOverlay(fx.eventId, { streamId: null, mode: 'latest', widgets: ['scoreboard'], matchId: s1!._id, label: 'latest', hours: 2 }, seedIds.organizer, rid());
    const before = await t.realtime.currentCursor();
    const done = await play(s1!);
    const T0 = Date.parse(done.run!.endedAt!);
    const post = (await t.c.newsPosts.findOne({ dedupeKey: `match.final:${s1!._id}` }))!;
    expect(post).toBeTruthy();
    expect(post.spoiler).toBe(true);

    at(T0 + 10_000); // inside the 60 s broadcast delay
    const synced = await live.snapshot(fx.eventId, undefined, {}, null, null);
    expect(synced.view).toMatchObject({ kind: 'synced', delaySeconds: 60 });
    expect(synced.results.find((m) => m.id === s1!._id)).toBeUndefined();
    expect(synced.timeline.items.find((p) => p.id === post._id)).toBeUndefined();
    const final = (await t.c.matches.find({ stageId: fx.stageIds[0]!, 'slot.round': 2 }).toArray())[0]!;
    const finalView = ((await live.section(fx.eventId, undefined, 'bracket', {}, null, null)) as unknown as { items: Array<{ id: string; sides: Array<{ displayName: string }> }> }).items;
    expect(finalView.find((m) => m.id === final._id)?.sides[0]?.displayName ?? '').toMatch(/^برنده /); // advanced side masked
    const rt = await t.realtime.poll({ principalId: null, sessionId: null }, before, [synced.view.channel], 200);
    expect(rt.events.some((e) => (e.payload['post'] as { id?: string } | undefined)?.id === post._id)).toBe(false);
    const o = await bc.overlayState(ov.token);
    expect((o['scoreboard'] as { outcome: unknown }).outcome).toBeNull();
    expect(o['label']).toBe('synced_to_stream');
    await expect(news.bySlug(post.slug)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await news.list({ eventId: fx.eventId, limit: 50 })).some((p) => p.id === post._id)).toBe(false);
    const inbox = await new NotificationService(t).inbox(fan, { limit: 50 });
    expect(inbox.items.some((n) => n.category === 'follow.end')).toBe(false);
    // the explicit latest view is separate and labelled
    const latest = await live.snapshot(fx.eventId, 'latest', {}, null, null);
    expect(latest.view.kind).toBe('latest');
    expect(latest.results.find((m) => m.id === s1!._id)?.outcome).toEqual(win(0));
    expect(((await bc.overlayState(ovLatest.token))['scoreboard'] as { outcome: unknown }).outcome).toEqual(win(0));
    expect((await bc.overlayState(ovLatest.token))['label']).toBe('latest_result');

    at(T0 + 61_000); // the delay has passed: everything appears, nothing private
    const after = await live.snapshot(fx.eventId, undefined, {}, null, null);
    expect(after.results.find((m) => m.id === s1!._id)?.outcome).toEqual(win(0));
    expect(after.timeline.items.find((p) => p.id === post._id)?.result?.final).toBe(true);
    const rt2 = await t.realtime.poll({ principalId: null, sessionId: null }, before, [synced.view.channel], 200);
    expect(rt2.events.some((e) => (e.payload['post'] as { id?: string } | undefined)?.id === post._id)).toBe(true);
    expect(((await bc.overlayState(ov.token))['scoreboard'] as { outcome: unknown }).outcome).toEqual(win(0));
    expect((await news.bySlug(post.slug)).id).toBe(post._id);
    expect((await new NotificationService(t).inbox(fan, { limit: 50 })).items.some((n) => n.category === 'follow.end')).toBe(true);
    expect(JSON.stringify(after)).not.toMatch(/lobby|password|evidence|internalNotes/);
  });
});

describe('automatic posts and corrections (NEWS-005..007, AC-14)', () => {
  it('a match end creates exactly one post even when the event is replayed; a correction marks it and adds one correction post', async () => {
    const fx = await se4();
    const [s1, s2] = await scheduled(fx.stageIds[0]!);
    await play(s1!);
    await play(s2!);
    // replay the official event: no second post
    const ev = (await t.c.outbox.findOne({ type: 'competition.match.finalized', 'payload.matchId': s1!._id }))!;
    // redelivery of the same official event (at-least-once delivery) must not create a second post
    await news.onEvent(ev.type, ev.payload, ev.occurredAt);
    await news.onEvent(ev.type, ev.payload, ev.occurredAt);
    expect(await t.c.newsPosts.countDocuments({ 'relations.matchId': s1!._id, source: 'automatic', kind: 'result' })).toBe(1);
    const p = (await t.c.newsPosts.findOne({ dedupeKey: `match.final:${s1!._id}` }))!;
    expect(p.title.startsWith('نتیجه نهایی')).toBe(true);
    expect(p.relations.participationIds).toHaveLength(2);
    // a reporter cannot rewrite the engine result
    const editor = await person('editor');
    await t.acl.grant({ principalId: editor, role: 'editor', scope: { type: 'event', id: fx.eventId }, expiresAt: null, reason: 'TEST ONLY' }, { principalId: 'system', requestId: rid() });
    await expect(news.edit(p._id, { title: 'fake', body: 'X won', reason: 'x', expectedVersion: p.version }, seedIds.reporter, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // correction of semi 1 (final not started)
    const head = await person('head');
    await new OfficialsService(t).assign({ eventId: fx.eventId, matchId: null, principalId: head, role: 'head_referee' }, seedIds.organizer, rid());
    const apr = await t.approvals.request({ action: 'match.result.correct', scope: { type: 'match', id: s1!._id }, payload: {}, reason: 'TEST ONLY' }, { principalId: head, requestId: rid() });
    await t.approvals.decide(apr._id, { decision: 'approve', reason: 'ok', expectedVersion: apr.version }, { principalId: seedIds.admin, requestId: rid() });
    const cor = await new CorrectionService(t).request(s1!._id, win(1), 'TEST ONLY wrong winner', null, apr._id, head, rid());
    expect(cor.state).toBe('applied');
    await t.consumer.drain();
    const marked = (await t.c.newsPosts.findOne({ _id: p._id }))!;
    expect(marked.state).toBe('corrected');
    expect(marked.correction?.ref).toBe(cor._id);
    expect(await t.c.newsPosts.countDocuments({ dedupeKey: `correction:${cor._id}` })).toBe(1);
    // the re-finalisation after the correction does not create a second "end" post
    expect(await t.c.newsPosts.countDocuments({ dedupeKey: `match.final:${s1!._id}` })).toBe(1);
  });
});

describe('gap-free resume (LIVE-006, AC-15)', () => {
  it('snapshot cursor + catch-up loses nothing, duplicates are harmless, an expired cursor demands resync', async () => {
    const fx = await se4();
    const editor = await person('ed');
    await t.acl.grant({ principalId: editor, role: 'editor', scope: { type: 'event', id: fx.eventId }, expiresAt: null, reason: 'TEST ONLY' }, { principalId: 'system', requestId: rid() });
    const mk = async (title: string) => {
      const { post } = await news.create({ eventId: fx.eventId, kind: 'text', format: 'live', title, body: 'body', spoiler: false }, editor, rid());
      return news.publish(post._id, post.version, editor, rid());
    };
    await mk('before snapshot');
    const snap = await live.snapshot(fx.eventId, 'latest', {}, null, null);
    // published between snapshot and subscribe
    const late = await mk('between snapshot and subscribe');
    const caught = await t.realtime.poll({ principalId: null, sessionId: null }, snap.cursor, [snap.view.channel], 200);
    expect(caught.events.map((e) => (e.payload['post'] as { id: string }).id)).toContain(late._id);
    // a duplicate catch-up (reconnect with an older cursor) returns the same ids again: the client dedupes by id/version
    const again = await t.realtime.poll({ principalId: null, sessionId: null }, snap.cursor, [snap.view.channel], 200);
    expect(again.events.map((e) => e.seq)).toEqual(caught.events.map((e) => e.seq));
    // retention raises the floor; a cursor below it gets an explicit resync
    await t.realtime.prune(0, new Date(Date.now() + 1000));
    const stale = await t.realtime.poll({ principalId: null, sessionId: null }, snap.cursor, [snap.view.channel], 200);
    expect(stale.resync).toBe(true);
    expect((await t.realtime.poll({ principalId: null, sessionId: null }, 0, [snap.view.channel], 200)).resync).toBeUndefined();
  });

  it('a private event is invisible to the public and its live channel is limited to event staff; revoking the grant stops delivery', async () => {
    const fx = await se4();
    await t.c.events.updateOne({ _id: fx.eventId }, { $set: { visibility: 'private' } });
    await expect(live.snapshot(fx.eventId, undefined, {}, null, null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const staff = await person('staff');
    const g = await t.acl.grant({ principalId: staff, role: 'editor', scope: { type: 'event', id: fx.eventId }, expiresAt: null, reason: 'TEST ONLY' }, { principalId: 'system', requestId: rid() });
    const { post } = await news.create({ eventId: fx.eventId, kind: 'text', format: 'live', title: 'staff only', body: 'x', spoiler: false }, staff, rid());
    const before = await t.realtime.currentCursor();
    await news.publish(post._id, post.version, staff, rid());
    const { session } = await t.sessions.create(staff, { userAgent: 'test', ip: null });
    const viewer = { principalId: staff, sessionId: session._id };
    expect((await t.realtime.poll({ principalId: null, sessionId: null }, before, [`live:${fx.eventId}:latest`], 50)).events).toHaveLength(0);
    expect((await t.realtime.poll(viewer, before, [`live:${fx.eventId}:latest`], 50)).events.length).toBeGreaterThan(0);
    await t.acl.revoke(g._id, { principalId: 'system', requestId: rid() }, 'TEST ONLY');
    expect((await t.realtime.poll(viewer, before, [`live:${fx.eventId}:latest`], 50)).events).toHaveLength(0);
  });
});
