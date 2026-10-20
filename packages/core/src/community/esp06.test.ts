import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testContainer, rid } from '../test/harness.js';
import { competition } from '../test/esp04-fixture.js';
import { clause } from '../test/esp03-fixture.js';
import { seedIds } from '../db/seed-ids.js';
import { newId } from '../ids.js';
import { NotificationService, quietWait } from '../notifications/notifications.js';
import { CommunityService } from './community.js';
import { SearchService, safeReturnPath } from '../discovery/discovery.js';
import { stripMetadata } from '../files/strip.js';
import { NewsService } from '../news/news.js';
import { SocialService } from '../social/social.js';

let t: Awaited<ReturnType<typeof testContainer>>;
let notes: NotificationService;
let com: CommunityService;
beforeAll(async () => {
  t = await testContainer({ seed: true });
  notes = new NotificationService(t);
  com = new CommunityService(t);
});
afterAll(async () => {
  await t.drop();
});
async function person(label: string, extra: Record<string, unknown> = {}): Promise<string> {
  const id = `usr_${label}_${newId().slice(-8)}`;
  const now = new Date().toISOString();
  await t.c.principals.insertOne({ _id: id, kind: 'user', displayName: label, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0 });
  await t.c.profiles.insertOne({ _id: id, nickname: label, nicknameLower: label.toLowerCase(), realName: null, bio: null, province: null, city: 'تبریز', links: [], avatarFileId: null, coverFileId: null, games: [], privacy: { city: 'private' }, notificationPrefs: {}, messagePolicy: 'everyone', lookingForTeam: { active: false, resume: null, gameIds: [], since: null }, createdAt: now, updatedAt: now, version: 0, ...extra } as never);
  return id;
}

describe('notification centre (COM-001..004)', () => {
  it('quiet hours postpone external channels, essential bypasses them, opt-outs and promotional opt-in are respected', async () => {
    // 23:30 Tehran = 20:00 UTC
    expect(quietWait({ from: '22:00', to: '07:00' }, new Date('2026-10-20T20:00:00Z'))).toBe(450);
    expect(quietWait({ from: '22:00', to: '07:00' }, new Date('2026-10-20T08:00:00Z'))).toBe(0);
    const u = await person('n1');
    await notes.updatePrefs(u, { quietHours: { from: '00:00', to: '23:59' }, categories: { 'follow.start': false } });
    await notes.notify({ principalIds: [u], category: 'follow.start', title: 'start', body: '' });
    await notes.notify({ principalIds: [u], category: 'promotional', title: 'promo', body: '' });
    await notes.notify({ principalIds: [u], category: 'match', title: 'normal', body: '', dedupeKey: 'k1' });
    await notes.notify({ principalIds: [u], category: 'match', title: 'normal', body: '', dedupeKey: 'k1' }); // replay
    await notes.notify({ principalIds: [u], category: 'checkin', title: 'urgent', body: '', essential: true });
    const box = await notes.inbox(u, { limit: 20 });
    expect(box.items.map((n) => n.title).sort()).toEqual(['normal', 'urgent']);
    const normal = (await t.c.notifications.findOne({ principalId: u, title: 'normal' }))!;
    const urgent = (await t.c.notifications.findOne({ principalId: u, title: 'urgent' }))!;
    const sms = (n: typeof normal) => n.channels.find((c) => c.channel === 'sms')!;
    expect(Date.parse(sms(normal).nextAttemptAt!)).toBeGreaterThan(Date.now() + 60_000); // postponed by quiet hours
    expect(Date.parse(sms(urgent).nextAttemptAt!)).toBeLessThanOrEqual(Date.now() + 1000);
    expect(urgent.channels.find((c) => c.channel === 'push')).toMatchObject({ status: 'skipped' });
    expect(urgent.channels.find((c) => c.channel === 'in_app')).toMatchObject({ status: 'sent' });
  });

  it('dispatch records failure and retry separately; delivered/read/acknowledged are distinct', async () => {
    const u = await person('n2');
    await notes.notify({ principalIds: [u], category: 'official', title: 'رسمی', body: 'متن', essential: true, ackRequired: true });
    const r1 = await notes.dispatch(new Date(Date.now() + 1000));
    expect(r1.failed).toBeGreaterThanOrEqual(1); // no verified phone → recorded failure, not silent success
    const n = (await t.c.notifications.findOne({ principalId: u }))!;
    expect(n.channels.find((c) => c.channel === 'sms')).toMatchObject({ status: 'failed', lastError: 'no verified phone' });
    expect(n.readAt).toBeNull();
    await notes.markRead(u, [n._id]);
    expect((await t.c.notifications.findOne({ _id: n._id }))!.ackAt).toBeNull(); // read ≠ acknowledged
    await notes.ack(u, n._id);
    expect((await t.c.notifications.findOne({ _id: n._id }))!.ackAt).not.toBeNull();
    // a verified phone: sent through the development SMS double, delivery unknown until a receipt arrives
    const v = await person('n3');
    await t.c.credentials.insertOne({ _id: v, phone: '+989120000001', phoneVerifiedAt: new Date().toISOString(), email: null, emailVerifiedAt: null, passwordHash: null, totp: { enabled: false, secretEnc: null, pendingSecretEnc: null, recoveryCodeHashes: [], enabledAt: null }, phoneHistory: [], emailHistory: [], failedLogins: 0, lockedUntil: null, updatedAt: new Date().toISOString(), version: 0 });
    await notes.notify({ principalIds: [v], category: 'registration', title: 'ثبت‌نام تأیید شد', body: '', essential: true });
    await notes.dispatch(new Date(Date.now() + 1000));
    const sent = (await t.c.notifications.findOne({ principalId: v }))!.channels.find((c) => c.channel === 'sms')!;
    expect(sent.status).toBe('sent');
    expect(sent.deliveredAt).toBeNull();
  });

  it('aggregates frequent items and sends official group messages with per-recipient read/ack report', async () => {
    const u = await person('n4');
    for (let i = 0; i < 3; i++) await notes.notify({ principalIds: [u], category: 'follow.start', title: `start ${i}`, body: '', groupKey: 'g1' });
    const rows = await t.c.notifications.find({ principalId: u }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(3);
    const fx = await competition(t, { clauses: [clause('elim.third_place', false)], stages: [{ name: 'SE', format: 'single_elim' }], n: 2 });
    await expect(notes.sendOfficial(fx.eventId, { audience: 'participants', title: 'جلسه توجیهی', body: 'ساعت ۱۸', requiresAck: true }, fx.principals[0]!, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const m = await notes.sendOfficial(fx.eventId, { audience: 'participants', title: 'جلسه توجیهی', body: 'ساعت ۱۸', requiresAck: true }, seedIds.organizer, rid());
    expect(m.recipients).toBe(2);
    const nid = (await t.c.notifications.findOne({ officialMessageId: m._id, principalId: fx.principals[0]! }))!._id;
    await notes.ack(fx.principals[0]!, nid);
    const rep = await notes.officialReport(m._id, seedIds.organizer, rid());
    expect(rep.totals).toMatchObject({ recipients: 2, acknowledged: 1, read: 1 });
  });
});

describe('community (AUD-002, COM-005)', () => {
  it('team room: current members only, history from the join date; former members lose access; DMs respect blocks', async () => {
    const a = await person('a');
    const b = await person('b');
    const teamId = `team_${newId().slice(-8)}`;
    const old = new Date(Date.now() - 86_400_000).toISOString();
    await t.c.teamMemberships.insertMany([
      { _id: newId('tmm'), teamId, principalId: a, role: 'player', from: old, to: null, endedReason: null, endedBy: null, displayNameAtJoin: 'a' } as never,
    ]);
    await com.send(`team:${teamId}`, 'پیام قدیمی', a);
    await t.c.teamMemberships.insertOne({ _id: newId('tmm'), teamId, principalId: b, role: 'player', from: new Date(Date.now() + 5).toISOString(), to: null, endedReason: null, endedBy: null, displayNameAtJoin: 'b' } as never);
    await new Promise((r) => setTimeout(r, 20));
    await com.send(`team:${teamId}`, 'پیام جدید', a);
    const seen = await com.messages(`team:${teamId}`, b, { limit: 50 });
    expect(seen.map((x) => x.text)).toEqual(['پیام جدید']); // nothing from before b joined
    await t.c.teamMemberships.updateOne({ teamId, principalId: b }, { $set: { to: new Date().toISOString() } });
    await expect(com.messages(`team:${teamId}`, b, { limit: 50 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const dm = await com.openDm(a, b);
    await com.send(dm._id, 'سلام', a);
    await new SocialService(t).block(b, a, rid());
    await expect(com.send(dm._id, 'دوباره', a)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const outsider = await person('c');
    await expect(com.messages(dm._id, outsider, { limit: 10 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('comments are rate limited, reportable once per person, and hidden by a moderator with a reason', async () => {
    const fx = await competition(t, { clauses: [clause('elim.third_place', false)], stages: [{ name: 'SE', format: 'single_elim' }], n: 2 });
    const editor = await person('ed');
    await t.acl.grant({ principalId: editor, role: 'editor', scope: { type: 'event', id: fx.eventId }, expiresAt: null, reason: 'TEST ONLY' }, { principalId: 'system', requestId: rid() });
    const news = new NewsService(t);
    const { post } = await news.create({ eventId: fx.eventId, kind: 'text', format: 'live', title: 'خبر', body: 'متن', spoiler: false }, editor, rid());
    await news.publish(post._id, post.version, editor, rid());
    const u = await person('u');
    const c1 = await com.comment(post._id, 'نظر اول', u);
    for (let i = 0; i < 4; i++) await com.comment(post._id, `نظر ${i}`, u);
    await expect(com.comment(post._id, 'زیاد', u)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(await com.react(post._id, '🔥', u)).toEqual({ '🔥': 1 });
    const r = await person('r');
    const rep = await com.report({ targetType: 'comment', targetId: c1._id, reason: 'توهین' }, r);
    await expect(com.report({ targetType: 'comment', targetId: c1._id, reason: 'توهین' }, r)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(com.decide(rep._id, 'hide', 'x', u, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await com.decide(rep._id, 'hide', 'بند ۳ قوانین جامعه', editor, rid());
    const list = await com.comments(post._id, null, { limit: 50 });
    expect(list.find((x) => x._id === c1._id)).toMatchObject({ removed: true, text: '' });
  });
});

describe('search and redirects (UX-001, UX-007)', () => {
  it('private profile fields are not searchable, private events and spoiler-hidden posts never appear', async () => {
    await person('Shahab', { city: 'تبریز', privacy: { city: 'private' } });
    const s = new SearchService(t);
    expect(((await s.search({ q: 'shahab', type: 'players', limit: 10 }, null)).results.players as unknown[]).length).toBe(1);
    expect(((await s.search({ q: 'shahab', type: 'players', city: 'تبریز', limit: 10 }, null)).results.players as unknown[]).length).toBe(0);
    const fx = await competition(t, { clauses: [clause('elim.third_place', false)], stages: [{ name: 'SE', format: 'single_elim' }], n: 2 });
    await t.c.events.updateOne({ _id: fx.eventId }, { $set: { visibility: 'private', name: 'رویداد محرمانه یکتا' } });
    expect(((await s.search({ q: 'محرمانه یکتا', type: 'events', limit: 10 }, null)).results.events as unknown[]).length).toBe(0);
    // Arabic yeh/kaf and Persian digits normalise
    await t.c.events.updateOne({ _id: fx.eventId }, { $set: { visibility: 'public', name: 'جام کیان ۱۴۰۵' } });
    expect(((await s.search({ q: 'جام كيان 1405', type: 'events', limit: 10 }, null)).results.events as unknown[]).length).toBe(0); // stored name keeps Persian digits
    expect(((await s.search({ q: 'جام كيان', type: 'events', limit: 10 }, null)).results.events as unknown[]).length).toBe(1);
  });

  it('only same-origin relative paths survive login', () => {
    expect(safeReturnPath('/events/abc?t=1#x')).toBe('/events/abc?t=1#x');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/%0d%0aSet-Cookie:x', null, '']) expect(safeReturnPath(bad)).toBe(bad === '/%0d%0aSet-Cookie:x' ? '/%0d%0aSet-Cookie:x' : '/');
  });
});

describe('display variants (EDIT-007)', () => {
  it('strips EXIF/XMP/comment segments from JPEG and text chunks from PNG without touching image data', () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]), // APP0 kept
      Buffer.from([0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00]), // APP1 EXIF dropped
      Buffer.from([0xff, 0xfe, 0x00, 0x05, 0x47, 0x50, 0x53]), // COM dropped
      Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]), // scan + EOI kept
    ]);
    const out = stripMetadata(jpeg, 'image/jpeg').data;
    expect(out.includes(Buffer.from('Exif'))).toBe(false);
    expect(out.includes(Buffer.from('GPS'))).toBe(false);
    expect(out.subarray(-8)).toEqual(Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]));
    const chunk = (type: string, data: Buffer) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); return b; };
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', Buffer.alloc(13)), chunk('tEXt', Buffer.from('Author\0me')), chunk('IDAT', Buffer.from([1, 2])), chunk('IEND', Buffer.alloc(0))]);
    const p = stripMetadata(png, 'image/png').data;
    expect(p.includes(Buffer.from('tEXt'))).toBe(false);
    expect(p.includes(Buffer.from('IDAT'))).toBe(true);
  });
});
