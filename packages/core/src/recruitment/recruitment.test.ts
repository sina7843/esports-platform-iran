import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '@esp/contracts';
import { rid, testContainer } from '../test/harness.js';
import { createDefaultProfile } from '../profiles/defaults.js';
import { seedIds } from '../db/seed-ids.js';
import { TeamService } from '../teams/teams.js';
import { RecruitmentService } from './recruitment.js';
import { seedTeamsDomain, teamsSeedIds } from './seed.js';

type C = Awaited<ReturnType<typeof testContainer>>;
let ct: C;
let rec: RecruitmentService;
let teams: TeamService;
const G = 'game_seed_synthetic';
const AD = { kind: 'player' as const, gameId: G, role: 'entry', level: 'advanced', city: 'تهران', activityHours: null, description: 'به دنبال بازیکن' };
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? e.code : String(e);
  }
};
async function mk(id: string, nick = `nick_${id}`): Promise<string> {
  const t = new Date().toISOString();
  await ct.c.principals.insertOne({ _id: id, kind: 'user', displayName: id, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: t, updatedAt: t, version: 0 });
  await ct.c.profiles.insertOne(createDefaultProfile(id, nick));
  return id;
}
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString();

beforeAll(async () => {
  ct = await testContainer({ seed: true });
  await seedTeamsDomain(ct.c, ct.acl);
  await seedTeamsDomain(ct.c, ct.acl); // idempotent
  rec = new RecruitmentService(ct);
  teams = new TeamService(ct);
});
afterAll(async () => ct.drop());

describe('recruitment', () => {
  it('seed is idempotent and creates one ad and one open scrim', async () => {
    expect(await ct.c.recruitmentAds.countDocuments({ _id: teamsSeedIds.ad })).toBe(1);
    expect(await ct.c.scrims.countDocuments({ _id: teamsSeedIds.scrim, state: 'open' })).toBe(1);
  });

  it('ads: only recruitment.manage creates/closes; game must match; filters and cursor paginate', async () => {
    const owner = seedIds.organizer;
    expect(await code(rec.createAd(seedIds.player, seedIds.teamA, AD, rid()))).toBe('FORBIDDEN');
    expect(await code(rec.createAd(owner, seedIds.teamA, { ...AD, gameId: 'other' }, rid()))).toBe('VALIDATION_FAILED');
    const a2 = await rec.createAd(owner, seedIds.teamA, { ...AD, kind: 'coach', role: null, level: null, city: 'شیراز' }, rid());
    await rec.createAd(owner, seedIds.teamA, { ...AD, city: 'شیراز' }, rid());
    expect((await rec.listAds({ gameId: G, kind: 'coach', limit: 20 })).items.map((i) => i['id'])).toEqual([a2._id]);
    expect((await rec.listAds({ city: 'شیراز', limit: 20 })).items).toHaveLength(2);
    const p1 = await rec.listAds({ limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await rec.listAds({ limit: 2, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect(JSON.stringify(p1)).not.toContain('createdBy');
    await rec.closeAd(owner, a2._id, rid());
    expect((await rec.listAds({ kind: 'coach', limit: 20 })).items).toHaveLength(0);
    expect(await code(rec.closeAd(owner, a2._id, rid()))).toBe('CONFLICT');
  });

  it('applications: one per ad, manager actions with history and expectedVersion; accept creates an invitation, not a membership', async () => {
    const owner = seedIds.organizer;
    const pl = await mk('u_rec_pl');
    const ad = await rec.createAd(owner, seedIds.teamA, AD, rid());
    const app = await rec.apply(pl, ad._id, 'سلام', rid());
    expect(await code(rec.apply(pl, ad._id, null, rid()))).toBe('CONFLICT');
    expect(await code(rec.decide(seedIds.player, app._id, { action: 'start_review', note: null, expectedVersion: 0 }, rid()))).toBe('FORBIDDEN');
    expect(await code(rec.decide(owner, app._id, { action: 'start_review', note: null, expectedVersion: 5 }, rid()))).toBe('VERSION_CONFLICT');
    const r1 = await rec.decide(owner, app._id, { action: 'invite_tryout', note: 'تست', expectedVersion: 0 }, rid());
    expect(r1.application.state).toBe('tryout_invited');
    const r2 = await rec.decide(owner, app._id, { action: 'start_review', note: null, expectedVersion: 1 }, rid());
    expect(r2.application.state).toBe('under_review');
    // closing the ad leaves the pending application visible and decidable
    await rec.closeAd(owner, ad._id, rid());
    const listed = await rec.listApplications(owner, ad._id, rid());
    expect(listed.adState).toBe('closed');
    expect(listed.items.map((i) => i.state)).toEqual(['under_review']);
    const r3 = await rec.decide(owner, app._id, { action: 'accept', note: null, expectedVersion: 2 }, rid());
    expect(r3.application.state).toBe('accepted');
    expect(r3.application.history.map((h) => h.state)).toEqual(['applied', 'tryout_invited', 'under_review', 'accepted']);
    expect(await ct.c.teamMemberships.countDocuments({ teamId: seedIds.teamA, principalId: pl })).toBe(0);
    const inv = await ct.c.teamInvitations.findOne({ _id: r3.invitationId! });
    expect(inv).toMatchObject({ principalId: pl, teamId: seedIds.teamA, role: 'player', state: 'pending' });
    expect(await code(rec.decide(owner, app._id, { action: 'reject', note: null, expectedVersion: 3 }, rid()))).toBe('ILLEGAL_TRANSITION');
    await teams.respondInvitation(pl, inv!._id, true, rid());
    expect(await ct.c.teamMemberships.countDocuments({ teamId: seedIds.teamA, principalId: pl, to: null })).toBe(1);
  });

  it('applicants can withdraw; closed ads reject new applications; own team members cannot apply', async () => {
    const pl = await mk('u_rec_pl2');
    const ad = await rec.createAd(seedIds.organizer, seedIds.teamA, AD, rid());
    const app = await rec.apply(pl, ad._id, null, rid());
    expect((await rec.withdraw(pl, app._id, rid())).state).toBe('withdrawn');
    expect(await code(rec.withdraw(pl, app._id, rid()))).toBe('ILLEGAL_TRANSITION');
    expect(await code(rec.withdraw(seedIds.player, app._id, rid()))).toBe('NOT_FOUND');
    expect(await code(rec.apply(seedIds.captain, ad._id, null, rid()))).toBe('CONFLICT');
    await rec.closeAd(seedIds.organizer, ad._id, rid());
    expect(await code(rec.apply(await mk('u_rec_pl3'), ad._id, null, rid()))).toBe('PRECONDITION_FAILED');
  });

  it('looking-for-team list shows the public projection only and respects blocks', async () => {
    const a = await mk('u_lft_a', 'lft_a');
    const b = await mk('u_lft_b', 'lft_b');
    const viewer = await mk('u_lft_v', 'lft_v');
    for (const [id, extra] of [[a, { city: 'تهران', realName: 'نام واقعی', bio: 'secret-bio' }], [b, { city: 'رشت' }]] as const) {
      await ct.c.profiles.updateOne({ _id: id }, { $set: { ...extra, 'privacy.city': 'public', 'privacy.games': 'private', games: [{ gameId: G, roles: ['entry'], declaredLevel: 'pro', verifiedLevel: null, equipment: 'secret-eq', activityHours: 'secret-hours' }], lookingForTeam: { active: true, resume: 'رزومه', gameIds: [G], since: new Date().toISOString() } } });
    }
    const res = await rec.lookingForTeam({ gameId: G, limit: 20 }, viewer);
    const ids = res.items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([a, b]));
    const dump = JSON.stringify(res);
    expect(dump).not.toMatch(/نام واقعی|secret|realName|phone|email/);
    expect(res.items.find((i) => i.id === a)).toMatchObject({ nickname: 'lft_a', city: 'تهران', resume: 'رزومه', games: [] });
    await ct.c.blocks.insertOne({ _id: 'blk_lft', blockerId: b, blockedId: viewer, createdAt: new Date().toISOString() });
    expect((await rec.lookingForTeam({ gameId: G, limit: 20 }, viewer)).items.map((i) => i.id)).not.toContain(b);
    expect((await rec.lookingForTeam({ gameId: G, city: 'تهران', limit: 20 }, null)).items.map((i) => i.id)).toContain(a);
    await ct.c.profiles.updateOne({ _id: a }, { $set: { 'lookingForTeam.active': false } });
    expect((await rec.lookingForTeam({ gameId: G, limit: 20 }, null)).items.map((i) => i.id)).not.toContain(a);
  });
});

describe('scrims', () => {
  it('request -> propose -> accept -> friendly result; never counts for rating', async () => {
    const win = { gameId: G, level: 'advanced', windowStart: day(2), windowEnd: day(3), server: 'EU', conditions: null };
    expect(await code(rec.createScrim(seedIds.organizer, seedIds.teamB, win, rid()))).toBe('FORBIDDEN');
    expect(await code(rec.createScrim(seedIds.player, seedIds.teamB, { ...win, windowEnd: win.windowStart }, rid()))).toBe('VALIDATION_FAILED');
    const sc = await rec.createScrim(seedIds.player, seedIds.teamB, win, rid());
    const found = await rec.searchScrims({ gameId: G, level: 'advanced', from: day(1), to: day(4), limit: 20 });
    expect(found.items.map((i) => i['id'])).toContain(sc._id);
    expect((await rec.searchScrims({ gameId: 'nope', limit: 20 })).items).toHaveLength(0);
    // own team and a non-scrim.manage user cannot propose
    expect(await code(rec.propose(seedIds.player, sc._id, seedIds.teamB, { proposedAt: day(2.5), server: null, note: null }, rid()))).toBe('VALIDATION_FAILED');
    expect(await code(rec.propose(seedIds.player, sc._id, seedIds.teamA, { proposedAt: day(2.5), server: null, note: null }, rid()))).toBe('FORBIDDEN');
    expect(await code(rec.propose(seedIds.organizer, sc._id, seedIds.teamA, { proposedAt: day(5), server: null, note: null }, rid()))).toBe('VALIDATION_FAILED');
    const p = await rec.propose(seedIds.organizer, sc._id, seedIds.teamA, { proposedAt: day(2.5), server: 'ME', note: 'ok' }, rid());
    expect(p.state).toBe('proposed');
    expect(await code(rec.answer(seedIds.organizer, sc._id, 'accept', rid()))).toBe('FORBIDDEN'); // only the requester answers
    const acc = await rec.answer(seedIds.player, sc._id, 'accept', rid());
    expect(acc.state).toBe('accepted');
    const scores = [{ teamId: seedIds.teamA, score: 2 }, { teamId: seedIds.teamB, score: 1 }];
    expect(await code(rec.reportResult(seedIds.captain, sc._id, seedIds.teamA, { scores, note: null, expectedVersion: acc.version }, rid()))).toBe('OK');
    const done = await ct.c.scrims.findOne({ _id: sc._id });
    expect(done?.state).toBe('played');
    expect(done?.result).toMatchObject({ label: 'friendly', countsForRating: false, reportedBy: seedIds.captain });
    expect(await code(rec.reportResult(seedIds.player, sc._id, seedIds.teamB, { scores, note: null, expectedVersion: done!.version }, rid()))).toBe('ILLEGAL_TRANSITION');
    expect((await rec.searchScrims({ gameId: G, limit: 50 })).items.map((i) => i['id'])).not.toContain(sc._id);
  });

  it('decline reopens the scrim; outsiders cannot report; wrong score teams rejected', async () => {
    const sc = await rec.createScrim(seedIds.player, seedIds.teamB, { gameId: G, level: null, windowStart: day(2), windowEnd: day(3), server: null, conditions: null }, rid());
    await rec.propose(seedIds.organizer, sc._id, seedIds.teamA, { proposedAt: day(2.5), server: null, note: null }, rid());
    const re = await rec.answer(seedIds.player, sc._id, 'decline', rid());
    expect(re).toMatchObject({ state: 'open', proposal: null });
    await rec.propose(seedIds.organizer, sc._id, seedIds.teamA, { proposedAt: day(2.6), server: null, note: null }, rid());
    const acc = await rec.answer(seedIds.player, sc._id, 'accept', rid());
    const bad = [{ teamId: seedIds.teamA, score: 1 }, { teamId: 'team_x', score: 1 }];
    expect(await code(rec.reportResult(seedIds.organizer, sc._id, seedIds.teamA, { scores: bad, note: null, expectedVersion: acc.version }, rid()))).toBe('VALIDATION_FAILED');
    const cancelled = await rec.cancelScrim(seedIds.player, sc._id, rid());
    expect(cancelled.state).toBe('cancelled');
  });
});
