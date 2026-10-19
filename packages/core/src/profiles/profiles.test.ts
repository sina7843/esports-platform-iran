import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIdentityDomain } from '../identity/seed.js';
import { seedIds } from '../db/seed-ids.js';
import { rid, teamDoc, testContainer } from '../test/harness.js';
import { createDefaultProfile } from './defaults.js';
import { ProfileService, GameIdentityService, BadgeService, normalizeIdentityValue, seedProfilesDomain } from './profiles.js';
import { SocialService, canMessage, ReviewService } from '../social/social.js';

type T = Awaited<ReturnType<typeof testContainer>>;
let t: T;
let profiles: ProfileService;
let ids: GameIdentityService;
let badges: BadgeService;
let social: SocialService;
let n = 0;

async function mkUser(nick: string): Promise<string> {
  const id = `usr_t_${++n}_${nick}`;
  const now = new Date().toISOString();
  await t.c.principals.insertOne({ _id: id, kind: 'user', displayName: nick, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0 });
  await t.c.profiles.insertOne(createDefaultProfile(id, nick));
  return id;
}
const upd = async (id: string, body: Record<string, unknown>) => {
  const cur = (await t.c.profiles.findOne({ _id: id }))!;
  return profiles.update(id, { expectedVersion: cur.version, ...body } as never, rid());
};

beforeAll(async () => {
  t = await testContainer({ seed: true });
  await seedIdentityDomain(t.c);
  await seedProfilesDomain(t.c);
  profiles = new ProfileService(t);
  ids = new GameIdentityService(t);
  badges = new BadgeService(t);
  social = new SocialService(t);
});
afterAll(async () => t.drop());

describe('profiles', () => {
  it('nickname is unique case-insensitively (service check and unique index)', async () => {
    const a = await mkUser('Alpha');
    const b = await mkUser('Beta');
    await expect(upd(b, { nickname: 'ALPHA' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(t.c.profiles.updateOne({ _id: b }, { $set: { nicknameLower: 'alpha' } })).rejects.toMatchObject({ code: 11000 });
    expect((await upd(a, { nickname: 'ALPHA' })).nickname).toBe('ALPHA'); // own case change is fine
  });

  it('seed domain: two games on the seed player and one follow', async () => {
    const p = await t.c.profiles.findOne({ _id: seedIds.player });
    expect(p?.games).toHaveLength(2);
    expect(await t.c.follows.countDocuments({ _id: 'fol_seed_1' })).toBe(1);
    await seedProfilesDomain(t.c); // idempotent
    expect(await t.c.follows.countDocuments({ targetId: seedIds.player })).toBe(1);
  });

  it('public projection honours field privacy by relation and never serializes private data', async () => {
    const o = await mkUser('Owner1');
    const f = await mkUser('Fan1');
    await upd(o, { realName: 'SECRET-REAL', city: 'Shiraz', privacy: { city: 'followers', realName: 'private', bio: 'public' }, bio: 'hello' });
    const anon = await profiles.publicProfile('owner1', null);
    expect(anon.city).toBeNull();
    expect(anon.bio).toBe('hello');
    expect(JSON.stringify(anon)).not.toMatch(/SECRET-REAL|phone|email|nicknameLower|account_review/i);
    await social.follow(f, 'player', o, rid());
    expect((await profiles.publicProfile('OWNER1', f)).city).toBe('Shiraz');
    expect((await profiles.publicProfile('owner1', o)).realName).toBe('SECRET-REAL');
    expect((await profiles.publicProfile('owner1', f)).realName).toBeNull();
  });

  it('record sections are honest empty states', async () => {
    const o = await mkUser('Empty1');
    const p = await profiles.publicProfile('empty1', null);
    expect([p.competitiveRecord, p.honors, p.ratingChart]).toEqual([
      { source: 'none_yet', items: [] },
      { source: 'none_yet', items: [] },
      { source: 'none_yet', points: [] },
    ]);
    expect(o).toBeTruthy();
  });

  it('shows current and past teams with the historical team name', async () => {
    const o = await mkUser('Teamed1');
    const team = { ...teamDoc('team_hist', null, 'NEW', 'New Name'), nameHistory: [{ name: 'Old Name', tag: 'OLD', from: '2020-01-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' }] };
    await t.c.teams.insertOne(team);
    await t.c.teamMemberships.insertMany([
      { _id: 'tm_h1', teamId: 'team_hist', principalId: o, role: 'player', from: '2025-01-01T00:00:00.000Z', to: '2025-06-01T00:00:00.000Z', endedReason: 'left', endedBy: o, displayNameAtJoin: 'x' },
      { _id: 'tm_h2', teamId: 'team_hist', principalId: o, role: 'coach', from: '2026-02-01T00:00:00.000Z', to: null, endedReason: null, endedBy: null, displayNameAtJoin: 'x' },
    ]);
    const p = await profiles.publicProfile('teamed1', null);
    expect(p.teams.past[0]).toMatchObject({ name: 'Old Name', tag: 'OLD' });
    expect(p.teams.current[0]).toMatchObject({ name: 'New Name', role: 'coach' });
  });

  it('blocked in either direction is NOT_FOUND', async () => {
    const a = await mkUser('Blk_a');
    const b = await mkUser('Blk_b');
    await social.block(a, b, rid());
    await expect(profiles.publicProfile('blk_a', b)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(profiles.publicProfile('blk_b', a)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(social.follow(b, 'player', a, rid())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await social.unblock(a, b, rid());
    expect((await profiles.publicProfile('blk_a', b)).nickname).toBe('Blk_a');
  });

  it('verifiedLevel is set by the issuer path and preserved when the user edits games', async () => {
    const o = await mkUser('Lvl1');
    await upd(o, { games: [{ gameId: 'g1', declaredLevel: 'gold' }] });
    await profiles.setVerifiedLevel(o, 'g1', 'diamond', seedIds.admin, rid());
    await upd(o, { games: [{ gameId: 'g1', declaredLevel: 'bronze' }] });
    const g = (await t.c.profiles.findOne({ _id: o }))!.games[0]!;
    expect(g.declaredLevel).toBe('bronze');
    expect(g.verifiedLevel).toMatchObject({ value: 'diamond', issuer: seedIds.admin });
    expect(g.verifiedLevel?.at).toBeTruthy();
  });

  it('search never matches private fields', async () => {
    const a = await mkUser('Srch_pub');
    const b = await mkUser('Srch_prv');
    await upd(a, { city: 'Qom' });
    await upd(b, { city: 'Qom', privacy: { city: 'private' } });
    const r = await profiles.search({ city: 'Qom', limit: 20 }, null);
    expect(r.items.map((i) => i.nickname)).toEqual(['Srch_pub']);
    expect(JSON.stringify(r)).not.toMatch(/phone|email/);
  });
});

describe('game identities and badges', () => {
  it('normalizes values (case, spaces, Persian digits)', () => {
    expect(normalizeIdentityValue('  Ali  ۱۲۳ ')).toBe('ali 123');
  });

  it('keeps value history and ownership history; duplicate becomes disputed + review without merging', async () => {
    const a = await mkUser('Gi_a');
    const b = await mkUser('Gi_b');
    const g1 = await ids.add(a, { gameId: 'gz', platform: 'pc', value: 'Tag1', method: 'manual', visibility: 'public' }, rid());
    const g2 = await ids.update(a, g1._id, { value: 'Tag2', expectedVersion: 0 }, rid());
    expect(g2.valueHistory.map((h) => h.value)).toEqual(['Tag1', 'Tag2']);
    expect(g2.valueHistory[0]!.to).not.toBeNull();
    const dup = await ids.add(b, { gameId: 'gz', platform: 'pc', value: 'TAG2', method: 'manual', visibility: 'public' }, rid());
    expect(dup.verification.state).toBe('disputed');
    expect((await t.c.gameIdentities.findOne({ _id: g1._id }))?.principalId).toBe(a);
    const rev = await t.c.accountReviews.findOne({ principalIds: b, reason: 'duplicate_game_identity' });
    expect(rev?.state).toBe('open');
    expect(await t.c.accountReviews.countDocuments({ reason: 'duplicate_game_identity' })).toBe(1);
    await ids.deactivate(a, g1._id, rid());
    const closed = (await t.c.gameIdentities.findOne({ _id: g1._id }))!;
    expect(closed.active).toBe(false);
    expect(closed.ownershipHistory[0]!.to).not.toBeNull();
    await expect(ids.add(a, { gameId: 'gz', platform: 'pc', value: 'x', method: 'publisher', visibility: 'public' }, rid())).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });

  it('badge expiry and revocation hide badges from the public profile', async () => {
    const o = await mkUser('Bdg1');
    const b = await badges.issue({ kind: 'identity', principalId: o, referenceText: 'ref', expiresAt: null }, seedIds.admin, rid());
    expect(b.ref).toEqual({ referenceText: 'ref' });
    expect((await profiles.publicProfile('bdg1', null)).badges).toHaveLength(1);
    await t.c.badges.updateOne({ _id: b._id }, { $set: { expiresAt: '2000-01-01T00:00:00.000Z' } });
    expect((await profiles.publicProfile('bdg1', null)).badges).toHaveLength(0);
  });
});

describe('social', () => {
  it('follow is idempotent and counted; block removes follows both ways', async () => {
    const a = await mkUser('Soc_a');
    const b = await mkUser('Soc_b');
    await social.follow(a, 'player', b, rid());
    expect((await social.follow(a, 'player', b, rid())).followerCount).toBe(1);
    await social.follow(b, 'player', a, rid());
    await social.block(b, a, rid());
    expect(await t.c.follows.countDocuments({ targetType: 'player', targetId: { $in: [a, b] } })).toBe(0);
    await social.unfollow(a, 'player', b, rid()); // idempotent
  });

  it('canMessage respects block, policy, followers and teammates', async () => {
    const a = await mkUser('Msg_a');
    const b = await mkUser('Msg_b');
    expect((await canMessage(t.c, a, b)).allowed).toBe(true);
    await t.c.profiles.updateOne({ _id: b }, { $set: { messagePolicy: 'followers' } });
    expect(await social.canMessage(a, b)).toEqual({ allowed: false, reason: 'policy' });
    await social.follow(a, 'player', b, rid());
    expect((await social.canMessage(a, b)).allowed).toBe(true);
    await t.c.profiles.updateOne({ _id: b }, { $set: { messagePolicy: 'teammates' } });
    expect((await social.canMessage(a, b)).allowed).toBe(false);
    const mk = (id: string, p: string) => ({ _id: id, teamId: 'team_msg', principalId: p, role: 'player', from: '2026-01-01T00:00:00.000Z', to: null, endedReason: null, endedBy: null, displayNameAtJoin: 'x' });
    await t.c.teamMemberships.insertMany([mk('tm_m1', a), mk('tm_m2', b)]);
    expect((await social.canMessage(a, b)).allowed).toBe(true);
    await t.c.profiles.updateOne({ _id: b }, { $set: { messagePolicy: 'nobody' } });
    expect((await social.canMessage(a, b)).allowed).toBe(false);
    await t.c.profiles.updateOne({ _id: b }, { $set: { messagePolicy: 'everyone' } });
    await social.block(b, a, rid());
    expect(await social.canMessage(a, b)).toEqual({ allowed: false, reason: 'blocked' });
  });

  it('review decision suspends named accounts and revokes sessions, merges nothing', async () => {
    const a = await mkUser('Rv_a');
    const b = await mkUser('Rv_b');
    const { token } = await t.sessions.create(b);
    await ids.add(a, { gameId: 'gr', platform: 'pc', value: 'same', method: 'manual', visibility: 'public' }, rid());
    await ids.add(b, { gameId: 'gr', platform: 'pc', value: 'same', method: 'manual', visibility: 'public' }, rid());
    const rev = (await t.c.accountReviews.findOne({ principalIds: b }))!;
    const reviews = new ReviewService(t);
    await expect(reviews.decide(rev._id, { decision: 'resolved_suspended', note: 'x', suspendPrincipalIds: ['usr_other'] }, { principalId: seedIds.admin, requestId: rid() })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const done = await reviews.decide(rev._id, { decision: 'resolved_suspended', note: 'duplicate', suspendPrincipalIds: [b] }, { principalId: seedIds.admin, requestId: rid() });
    expect(done.state).toBe('resolved_suspended');
    expect(await t.sessions.resolve(token)).toBeNull();
    expect(await t.c.gameIdentities.countDocuments({ gameId: 'gr', principalId: a })).toBe(1);
    expect(await t.c.gameIdentities.countDocuments({ gameId: 'gr', principalId: b })).toBe(1);
    await expect(reviews.decide(rev._id, { decision: 'resolved_distinct', note: 'again', suspendPrincipalIds: [] }, { principalId: seedIds.admin, requestId: rid() })).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
  });
});
