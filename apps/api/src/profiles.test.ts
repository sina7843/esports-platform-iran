import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createContainer, runMigrations, seedDatabase, seedIds, seedIdentityDomain, seedProfilesDomain, type Container } from '@esp/core';
import { buildApp } from './app.js';

let container: Container;
let app: FastifyInstance;
const DEV_CODE = 'api-profiles-dev-code';
const H = { 'x-requested-with': 'fetch' };
let seq = 0;

type User = { h: Record<string, string>; id: string; phone: string };
async function otpLogin(): Promise<User> {
  const phone = `0913${String(5100000 + ++seq)}`;
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone } });
  const inbox = await app.inject({ url: `/api/v1/dev/inbox/sms?phone=${encodeURIComponent(phone.replace(/^0/, '+98'))}`, headers: { 'x-dev-code': DEV_CODE } });
  const code = /\d{6}/.exec(inbox.json().items[0].text)![0];
  const v = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone, code } });
  expect(v.statusCode).toBe(200);
  return { h: { cookie: `esp_session=${v.cookies.find((x) => x.name === 'esp_session')!.value}`, ...H }, id: v.json().principalId, phone };
}
async function devLogin(principalId: string): Promise<User> {
  const v = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-session', payload: { principalId, devCode: DEV_CODE } });
  expect(v.statusCode).toBe(200);
  return { h: { cookie: `esp_session=${v.cookies.find((x) => x.name === 'esp_session')!.value}`, ...H }, id: principalId, phone: '' };
}
const api = (u: User | null, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url: `/api/v1${url}`, ...(u ? { headers: u.h } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });
async function me(u: User) {
  return (await api(u, 'GET', '/me/profile')).json() as { nickname: string; version: number; id: string };
}
async function patch(u: User, body: Record<string, unknown>) {
  const cur = await me(u);
  return api(u, 'PATCH', '/me/profile', { expectedVersion: cur.version, ...body });
}
let nickN = 0;
const freshNick = () => `pl_${Date.now().toString(36)}_${++nickN}`;

beforeAll(async () => {
  const base = new URL(process.env['MONGO_URL'] ?? 'mongodb://127.0.0.1:27018/esports?directConnection=true');
  base.pathname = `/apiprof_${Date.now().toString(36)}`;
  container = await createContainer({ serviceName: 'api-prof-test', env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', MONGO_URL: base.toString(), DATA_DIR: mkdtempSync(join(tmpdir(), 'esp-apiprof-')), LOG_LEVEL: 'silent', AUTH_DEV_LOGIN_ENABLED: 'true', AUTH_DEV_CODE: DEV_CODE, RATE_LIMIT_MAX: '5000', AUTH_OTP_RESEND_SECONDS: '0' } });
  await runMigrations(container.dbh.db);
  await seedDatabase(container.c, container.acl);
  await seedIdentityDomain(container.c);
  await seedProfilesDomain(container.c);
  app = await buildApp(container);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await container.dbh.db.dropDatabase();
  await container.close();
});

describe('own profile', () => {
  it('updates with expectedVersion, rejects stale versions and case-insensitive duplicate nicknames', async () => {
    const a = await otpLogin();
    const b = await otpLogin();
    const nick = freshNick();
    const ok = await patch(a, { nickname: nick, bio: 'سلام', city: 'تهران' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().nickname).toBe(nick);
    expect(ok.json().essentialNotificationsAlwaysDelivered).toBe(true);
    const dup = await patch(b, { nickname: nick.toUpperCase() });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('CONFLICT');
    const stale = await api(a, 'PATCH', '/me/profile', { expectedVersion: 0, bio: 'x' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('VERSION_CONFLICT');
    expect((await api(null, 'GET', '/me/profile')).statusCode).toBe(401);
  });

  it('notification prefs patch keeps other settings', async () => {
    const a = await otpLogin();
    const res = await patch(a, { notificationPrefs: { promotional: true, channels: { email: true } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().notificationPrefs).toMatchObject({ promotional: true, channels: { inApp: true, sms: true, email: true } });
  });

  it('avatar must be the user\'s own public file', async () => {
    const a = await otpLogin();
    const b = await otpLogin();
    const mk = (id: string, owner: string, visibility: 'public' | 'private') =>
      container.c.files.insertOne({ _id: id, visibility, scope: { type: 'site', id: 'site' }, ownerPrincipalId: owner, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 10, sha256: 'x', scanState: 'skipped_dev', quarantined: false, retentionClass: 'profile_media', retentionNoticeFa: '', createdAt: new Date().toISOString(), publicUrl: visibility === 'public' ? `http://localhost/${id}.png` : null, storageKey: `${id}.png`, version: 0 } as never);
    await mk(`fil_${a.id}_own`, a.id, 'public');
    await mk(`fil_${a.id}_priv`, a.id, 'private');
    await mk(`fil_${b.id}_other`, b.id, 'public');
    expect((await patch(a, { avatarFileId: `fil_${a.id}_priv` })).statusCode).toBe(400);
    expect((await patch(a, { avatarFileId: `fil_${b.id}_other` })).statusCode).toBe(400);
    expect((await patch(a, { avatarFileId: 'fil_missing' })).statusCode).toBe(400);
    const ok = await patch(a, { avatarFileId: `fil_${a.id}_own` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().avatarUrl).toContain('.png');
  });
});

describe('public profile', () => {
  it('filters by privacy for anonymous, follower and self; never leaks phone/email/private data', async () => {
    const owner = await otpLogin();
    const follower = await otpLogin();
    const nick = freshNick();
    const secretName = 'نام-واقعی-خصوصی';
    await patch(owner, {
      nickname: nick,
      realName: secretName,
      bio: 'bio-public',
      city: 'اصفهان',
      games: [{ gameId: 'g1', roles: ['igl'], declaredLevel: 'pro', equipment: 'mouse-x', activityHours: '20-23' }],
      privacy: { realName: 'private', city: 'followers', activityHours: 'followers', equipment: 'public' },
      lookingForTeam: { active: true, resume: 'resume-text', gameIds: ['g1'] },
    });
    await api(owner, 'POST', '/me/game-identities', { gameId: 'g1', platform: 'pc', value: 'PrivateTag#1', visibility: 'private' });
    const anon = await api(null, 'GET', `/players/${encodeURIComponent(nick)}`);
    expect(anon.statusCode).toBe(200);
    const ab = anon.json();
    expect(ab.bio).toBe('bio-public');
    expect(ab.city).toBeNull();
    expect(ab.realName).toBeNull();
    expect(ab.games[0]).toMatchObject({ equipment: 'mouse-x', activityHours: null });
    expect(ab.gameIdentities).toEqual([]);
    expect(ab.lookingForTeam).toMatchObject({ active: true, resume: 'resume-text' });
    const raw = anon.body;
    for (const forbidden of [owner.phone, owner.phone.replace(/^0/, '+98'), secretName, 'PrivateTag', 'nicknameLower', 'email', 'phone']) expect(raw).not.toContain(forbidden);
    expect(ab.competitiveRecord).toEqual({ source: 'none_yet', items: [] });
    expect(ab.honors).toEqual({ source: 'none_yet', items: [] });
    expect(ab.ratingChart).toEqual({ source: 'none_yet', points: [] });

    expect((await api(follower, 'POST', '/follows', { targetType: 'player', targetId: owner.id })).statusCode).toBe(200);
    const fb = (await api(follower, 'GET', `/players/${encodeURIComponent(nick.toUpperCase())}`)).json();
    expect(fb.city).toBe('اصفهان');
    expect(fb.games[0].activityHours).toBe('20-23');
    expect(fb.realName).toBeNull();
    expect(fb.viewer.isFollowing).toBe(true);
    expect(fb.followerCount).toBe(1);

    const self = (await api(owner, 'GET', `/players/${encodeURIComponent(nick)}`)).json();
    expect(self.realName).toBe(secretName);
    expect(self.gameIdentities[0].value).toBe('PrivateTag#1');
    expect(JSON.stringify(self)).not.toContain(owner.phone);
  });

  it('blocked viewers (either direction) get 404 and cannot follow', async () => {
    const a = await otpLogin();
    const b = await otpLogin();
    const na = freshNick();
    const nb = freshNick();
    await patch(a, { nickname: na });
    await patch(b, { nickname: nb });
    expect((await api(b, 'POST', '/follows', { targetType: 'player', targetId: a.id })).statusCode).toBe(200);
    expect((await api(a, 'PUT', `/me/blocks/${b.id}`)).statusCode).toBe(204);
    expect((await api(a, 'PUT', `/me/blocks/${b.id}`)).statusCode).toBe(204); // idempotent
    expect(await container.c.follows.countDocuments({ followerId: b.id, targetId: a.id })).toBe(0);
    expect((await api(b, 'GET', `/players/${na}`)).statusCode).toBe(404);
    expect((await api(a, 'GET', `/players/${nb}`)).statusCode).toBe(404);
    expect((await api(b, 'POST', '/follows', { targetType: 'player', targetId: a.id })).statusCode).toBe(404);
    expect((await api(a, 'POST', '/follows', { targetType: 'player', targetId: b.id })).statusCode).toBe(404);
    const search = (await api(b, 'GET', `/players?q=${na}`)).json();
    expect(search.items).toEqual([]);
    expect((await api(a, 'DELETE', `/me/blocks/${b.id}`)).statusCode).toBe(204);
    expect((await api(b, 'GET', `/players/${na}`)).statusCode).toBe(200);
  });
});

describe('verified level and badges (badge.issue)', () => {
  it('only an issuer sets the verified level; users cannot overwrite it', async () => {
    const admin = await devLogin(seedIds.admin);
    const p = await otpLogin();
    const nick = freshNick();
    await patch(p, { nickname: nick, games: [{ gameId: 'g1', declaredLevel: 'gold' }] });
    expect((await api(p, 'POST', `/admin/players/${p.id}/verified-level`, { gameId: 'g1', value: 'diamond' })).statusCode).toBe(403);
    const ok = await api(admin, 'POST', `/admin/players/${p.id}/verified-level`, { gameId: 'g1', value: 'diamond' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().verifiedLevel).toMatchObject({ value: 'diamond', issuer: seedIds.admin });
    await patch(p, { games: [{ gameId: 'g1', declaredLevel: 'silver' }] });
    const pub = (await api(null, 'GET', `/players/${nick}`)).json();
    expect(pub.games[0]).toMatchObject({ declaredLevel: 'silver', verifiedLevel: { value: 'diamond' } });
    expect(pub.games[0].verifiedLevel.issuer).toBeUndefined();
  });

  it('issues/revokes badges; expired and revoked badges are hidden; identity badge stores no documents', async () => {
    const admin = await devLogin(seedIds.admin);
    const p = await otpLogin();
    const nick = freshNick();
    await patch(p, { nickname: nick });
    expect((await api(p, 'POST', '/admin/badges', { kind: 'identity', principalId: p.id, referenceText: 'x' })).statusCode).toBe(403);
    const idb = await api(admin, 'POST', '/admin/badges', { kind: 'identity', principalId: p.id, referenceText: 'ref-123' });
    expect(idb.statusCode).toBe(201);
    expect(idb.json().ref).toEqual({ referenceText: 'ref-123' });
    expect((await api(admin, 'POST', '/admin/badges', { kind: 'identity', principalId: p.id, referenceText: 'again' })).statusCode).toBe(409);
    const org = await api(admin, 'POST', '/admin/badges', { kind: 'org_position', principalId: p.id, organizationId: seedIds.orgA, position: 'داور', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(org.statusCode).toBe(201);
    const kinds = async () => (await api(null, 'GET', `/players/${nick}`)).json().badges.map((b: { kind: string }) => b.kind).sort();
    expect(await kinds()).toEqual(['identity', 'org_position']);
    const pubBody = (await api(null, 'GET', `/players/${nick}`)).body;
    expect(pubBody).not.toContain('ref-123');
    await container.c.badges.updateOne({ _id: org.json().id }, { $set: { expiresAt: new Date(Date.now() - 1000).toISOString() } });
    expect(await kinds()).toEqual(['identity']);
    expect((await api(p, 'POST', `/admin/badges/${idb.json().id}/revoke`, { reason: 'abuse test' })).statusCode).toBe(403);
    expect((await api(admin, 'POST', `/admin/badges/${idb.json().id}/revoke`, { reason: 'abuse test' })).statusCode).toBe(200);
    expect(await kinds()).toEqual([]);
  });
});

describe('game identities and account reviews', () => {
  it('keeps history, flags duplicates as disputed with an account review, never merges; admin decides', async () => {
    const admin = await devLogin(seedIds.admin);
    const a = await otpLogin();
    const b = await otpLogin();
    const created = await api(a, 'POST', '/me/game-identities', { gameId: 'gx', platform: 'pc', value: 'Ali Tag' });
    expect(created.statusCode).toBe(201);
    const upd = await api(a, 'PATCH', `/me/game-identities/${created.json().id}`, { value: 'AliTag2', expectedVersion: 0 });
    expect(upd.json().valueHistory.map((h: { value: string }) => h.value)).toEqual(['Ali Tag', 'AliTag2']);
    expect((await api(a, 'POST', '/me/game-identities', { gameId: 'gx', platform: 'pc', value: 'other' })).statusCode).toBe(409);
    const pub = await api(b, 'POST', '/me/game-identities', { gameId: 'gx', platform: 'pc', value: 'x', method: 'publisher' });
    expect(pub.statusCode).toBe(503);
    expect(pub.json().error.code).toBe('PROVIDER_NOT_CONFIGURED');

    const dup = await api(b, 'POST', '/me/game-identities', { gameId: 'gx', platform: 'pc', value: ' alitag2 ' });
    expect(dup.statusCode).toBe(201);
    expect(dup.json().verification.state).toBe('disputed');
    expect(await container.c.gameIdentities.countDocuments({ principalId: a.id, gameId: 'gx', active: true })).toBe(1);
    const rev = await container.c.accountReviews.findOne({ reason: 'duplicate_game_identity', principalIds: b.id });
    expect(rev?.principalIds.sort()).toEqual([a.id, b.id].sort());

    // staff cannot verify a disputed identity; a player cannot list or decide reviews
    expect((await api(admin, 'POST', `/admin/game-identities/${dup.json().id}/verify`, {})).statusCode).toBe(412);
    expect((await api(a, 'GET', '/admin/account-reviews')).statusCode).toBe(403);
    expect((await api(a, 'POST', `/admin/account-reviews/${rev!._id}/decision`, { decision: 'resolved_distinct', note: 'nope' })).statusCode).toBe(403);

    const list = await api(admin, 'GET', '/admin/account-reviews?state=open');
    expect(list.statusCode).toBe(200);
    expect(list.json().items.some((x: { id: string }) => x.id === rev!._id)).toBe(true);
    const bad = await api(admin, 'POST', `/admin/account-reviews/${rev!._id}/decision`, { decision: 'resolved_suspended', note: 'dup account' });
    expect(bad.statusCode).toBe(400); // suspend target required
    const done = await api(admin, 'POST', `/admin/account-reviews/${rev!._id}/decision`, { decision: 'resolved_suspended', note: 'confirmed duplicate', suspendPrincipalIds: [b.id] });
    expect(done.statusCode).toBe(200);
    expect(done.json().state).toBe('resolved_suspended');
    expect((await container.c.principals.findOne({ _id: b.id }))?.status).toBe('suspended');
    expect((await api(b, 'GET', '/me/profile')).statusCode).toBe(401);
    expect((await container.c.principals.findOne({ _id: a.id }))?.status).toBe('active');
    expect((await api(admin, 'POST', `/admin/account-reviews/${rev!._id}/decision`, { decision: 'resolved_distinct', note: 'again' })).statusCode).toBe(409);
  });

  it('staff verification issues a game_identity badge that expires and is revoked on value change', async () => {
    const admin = await devLogin(seedIds.admin);
    const p = await otpLogin();
    const nick = freshNick();
    await patch(p, { nickname: nick });
    const g = await api(p, 'POST', '/me/game-identities', { gameId: 'gv', platform: 'pc', value: 'verifyme' });
    expect((await api(p, 'POST', `/admin/game-identities/${g.json().id}/verify`, {})).statusCode).toBe(403);
    const v = await api(admin, 'POST', `/admin/game-identities/${g.json().id}/verify`, { expiresAt: new Date(Date.now() + 86400_000).toISOString() });
    expect(v.statusCode).toBe(200);
    const pub = (await api(null, 'GET', `/players/${nick}`)).json();
    expect(pub.badges).toHaveLength(1);
    expect(pub.gameIdentities[0].verified).toBe(true);
    await api(p, 'PATCH', `/me/game-identities/${g.json().id}`, { value: 'changed', expectedVersion: 1 });
    const after = (await api(null, 'GET', `/players/${nick}`)).json();
    expect(after.badges).toHaveLength(0);
    expect(after.gameIdentities[0].verified).toBe(false);
  });
});

describe('search and following', () => {
  it('search only matches public fields and returns public projections', async () => {
    const hidden = await otpLogin();
    const open = await otpLogin();
    const city = `شهر${Date.now().toString(36)}`;
    const nh = freshNick();
    const no = freshNick();
    await patch(hidden, { nickname: nh, city, privacy: { city: 'private' }, lookingForTeam: { active: true, gameIds: ['g1'] } });
    await patch(open, { nickname: no, city, lookingForTeam: { active: true, gameIds: ['g1'] } });
    const res = (await api(null, 'GET', `/players?city=${encodeURIComponent(city)}`)).json();
    expect(res.items.map((i: { nickname: string }) => i.nickname)).toEqual([no]);
    expect(Object.keys(res.items[0]).sort()).toEqual(['avatarUrl', 'city', 'games', 'id', 'lookingForTeam', 'nickname']);
    const l = (await api(null, 'GET', `/players?q=${nh.slice(0, 6)}&lookingForTeam=true`)).json();
    expect(l.items.map((i: { nickname: string }) => i.nickname)).toContain(nh);
    expect(l.items.find((i: { nickname: string }) => i.nickname === nh).city).toBeNull();
  });

  it('follow is idempotent for every target type; /me/following lists labels; unknown targets are 404', async () => {
    const u = await otpLogin();
    await container.c.games.updateOne({ _id: 'game_follow_t' }, { $setOnInsert: { _id: 'game_follow_t', title: 'بازی تست' } as never }, { upsert: true });
    for (const t of [{ targetType: 'team', targetId: seedIds.teamA }, { targetType: 'game', targetId: 'game_follow_t' }, { targetType: 'organizer', targetId: seedIds.orgA }, { targetType: 'event', targetId: seedIds.eventA }, { targetType: 'player', targetId: seedIds.player }]) {
      expect((await api(u, 'POST', '/follows', t)).statusCode).toBe(200);
      const again = await api(u, 'POST', '/follows', t);
      expect(again.json().followerCount).toBe(t.targetId === seedIds.player ? 2 : 1 + (t.targetId === seedIds.teamA ? 0 : 0));
    }
    const list = (await api(u, 'GET', '/me/following')).json();
    expect(list.items).toHaveLength(5);
    expect(list.items.find((i: { targetType: string }) => i.targetType === 'game').label).toBe('بازی تست');
    expect((await api(u, 'POST', '/follows', { targetType: 'team', targetId: 'team_nope' })).statusCode).toBe(404);
    expect((await api(u, 'POST', '/follows', { targetType: 'player', targetId: u.id })).statusCode).toBe(400);
    expect((await api(u, 'DELETE', `/follows/player/${seedIds.player}`)).statusCode).toBe(204);
    expect((await api(u, 'DELETE', `/follows/player/${seedIds.player}`)).statusCode).toBe(204);
    expect((await api(u, 'GET', '/me/following?targetType=player')).json().items).toHaveLength(0);
  });
});
