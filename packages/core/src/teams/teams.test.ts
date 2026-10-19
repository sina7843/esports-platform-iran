import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '@esp/contracts';
import { rid, testContainer } from '../test/harness.js';
import { createDefaultProfile } from '../profiles/defaults.js';
import { seedIds } from '../db/seed-ids.js';
import { seedTeamsDomain } from '../recruitment/seed.js';
import { TeamService, getMembershipAt } from './teams.js';

type C = Awaited<ReturnType<typeof testContainer>>;
let ct: C;
let svc: TeamService;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T = { name: 'تیم آزمون', tag: 'TST', gameId: 'game_seed_synthetic', organizationId: null, description: null, city: null, links: [], sponsors: [], logoFileId: null, coverFileId: null };

async function mk(id: string): Promise<string> {
  const t = new Date().toISOString();
  await ct.c.principals.insertOne({ _id: id, kind: 'user', displayName: id, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: t, updatedAt: t, version: 0 });
  await ct.c.profiles.insertOne(createDefaultProfile(id, `nick_${id}`));
  return id;
}
const team = (scope: string) => ({ type: 'team' as const, id: scope });
async function newTeam(owner: string, extra: Record<string, unknown> = {}) {
  return svc.createTeam(owner, { ...T, ...extra } as typeof T, rid());
}
async function join(teamId: string, by: string, who: string, role: string) {
  const inv = await svc.createInvitation(by, teamId, { principalId: who, role, message: null }, rid());
  await svc.respondInvitation(who, inv._id, true, rid());
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? e.code : String(e);
  }
};

beforeAll(async () => {
  ct = await testContainer({ seed: true });
  await seedTeamsDomain(ct.c, ct.acl);
  svc = new TeamService(ct);
});
afterAll(async () => ct.drop());

describe('membership', () => {
  it('invite -> accept activates the membership and grants the role; history keeps displayNameAtJoin', async () => {
    const owner = await mk('u_own1');
    const mgr = await mk('u_mgr1');
    const tm = await newTeam(owner);
    expect(await ct.acl.can(owner, 'team.manage', team(tm._id))).toBe(true);
    const inv = await svc.createInvitation(owner, tm._id, { principalId: mgr, role: 'manager', message: null }, rid());
    expect(await ct.acl.can(mgr, 'team.manage', team(tm._id))).toBe(false); // nothing before acceptance
    await svc.respondInvitation(mgr, inv._id, true, rid());
    expect(await ct.acl.can(mgr, 'team.manage', team(tm._id))).toBe(true);
    const m = await ct.c.teamMemberships.findOne({ teamId: tm._id, principalId: mgr, to: null });
    expect(m?.role).toBe('manager');
    expect(m?.displayNameAtJoin).toBe(`nick_${mgr}`);
    expect(await ct.c.outbox.countDocuments({ type: 'team.member.joined', 'payload.principalId': mgr })).toBe(1);
  });

  it('rejects used, expired, cancelled and foreign invitations', async () => {
    const owner = await mk('u_own2');
    const p = await mk('u_p2');
    const q = await mk('u_q2');
    const tm = await newTeam(owner);
    const inv = await svc.createInvitation(owner, tm._id, { principalId: p, role: 'player', message: null }, rid());
    expect(await code(svc.respondInvitation(q, inv._id, true, rid()))).toBe('NOT_FOUND');
    await svc.respondInvitation(p, inv._id, true, rid());
    expect(await code(svc.respondInvitation(p, inv._id, true, rid()))).toBe('CONFLICT');
    const inv2 = await svc.createInvitation(owner, tm._id, { principalId: q, role: 'player', message: null }, rid());
    await ct.c.teamInvitations.updateOne({ _id: inv2._id }, { $set: { expiresAt: new Date(Date.now() - 1000).toISOString() } });
    expect(await code(svc.respondInvitation(q, inv2._id, true, rid()))).toBe('CONFLICT');
    expect((await ct.c.teamInvitations.findOne({ _id: inv2._id }))?.state).toBe('expired');
    expect(await ct.c.teamMemberships.countDocuments({ teamId: tm._id, principalId: q })).toBe(0);
    const inv3 = await svc.createInvitation(owner, tm._id, { principalId: q, role: 'player', message: null }, rid());
    await svc.cancelInvitation(owner, inv3._id, rid());
    expect(await code(svc.respondInvitation(q, inv3._id, true, rid()))).toBe('CONFLICT');
  });

  it('join request: player asks, manager accepts or declines', async () => {
    const owner = await mk('u_own3');
    const a = await mk('u_a3');
    const b = await mk('u_b3');
    const tm = await newTeam(owner);
    const ra = await svc.requestToJoin(a, tm._id, { role: 'player', message: 'hi' }, rid());
    expect(await code(svc.requestToJoin(a, tm._id, { role: 'player', message: null }, rid()))).toBe('CONFLICT');
    expect(await code(svc.decideJoinRequest(b, ra._id, true, rid()))).toBe('FORBIDDEN');
    await svc.decideJoinRequest(owner, ra._id, true, rid());
    expect((await ct.c.teamMemberships.findOne({ teamId: tm._id, principalId: a, to: null }))?.role).toBe('player');
    const rb = await svc.requestToJoin(b, tm._id, { role: 'substitute', message: null }, rid());
    await svc.decideJoinRequest(owner, rb._id, false, rid());
    expect(await ct.c.teamMemberships.countDocuments({ teamId: tm._id, principalId: b })).toBe(0);
    expect(await code(svc.decideJoinRequest(owner, rb._id, true, rid()))).toBe('CONFLICT');
  });

  it('kick revokes the grant immediately and keeps history; leave works; owner cannot leave', async () => {
    const owner = await mk('u_own4');
    const mgr = await mk('u_mgr4');
    const pl = await mk('u_pl4');
    const tm = await newTeam(owner);
    await join(tm._id, owner, mgr, 'manager');
    await join(tm._id, owner, pl, 'player');
    expect(await ct.acl.can(mgr, 'team.roster.manage', team(tm._id))).toBe(true);
    await svc.kick(owner, tm._id, mgr, 'violation', rid());
    expect(await ct.acl.can(mgr, 'team.roster.manage', team(tm._id))).toBe(false);
    const row = await ct.c.teamMemberships.findOne({ teamId: tm._id, principalId: mgr });
    expect(row).toMatchObject({ endedReason: 'violation', endedBy: owner });
    expect(row?.to).not.toBeNull();
    expect(await code(svc.kick(pl, tm._id, owner, null, rid()))).toBe('FORBIDDEN');
    await svc.leave(pl, tm._id, null, rid());
    expect(await code(svc.leave(owner, tm._id, null, rid()))).toBe('PRECONDITION_FAILED');
    expect(await ct.c.outbox.countDocuments({ type: 'team.member.left', 'aggregate.id': tm._id })).toBe(2);
  });

  it('role change syncs grants; captains cannot hand out the manager role', async () => {
    const owner = await mk('u_own5');
    const cap = await mk('u_cap5');
    const pl = await mk('u_pl5');
    const tm = await newTeam(owner);
    await join(tm._id, owner, cap, 'coach');
    await join(tm._id, owner, pl, 'player');
    expect(await ct.acl.can(cap, 'team.roster.manage', team(tm._id))).toBe(false);
    await svc.changeRole(owner, tm._id, cap, 'captain', rid());
    expect(await ct.acl.can(cap, 'team.roster.manage', team(tm._id))).toBe(true);
    expect(await code(svc.changeRole(cap, tm._id, pl, 'manager', rid()))).toBe('FORBIDDEN');
    await svc.changeRole(cap, tm._id, pl, 'substitute', rid());
    await svc.changeRole(owner, tm._id, cap, 'player', rid());
    expect(await ct.acl.can(cap, 'team.roster.manage', team(tm._id))).toBe(false);
    expect(await ct.c.teamMemberships.countDocuments({ teamId: tm._id, principalId: cap })).toBe(3); // coach, captain, player rows kept
    expect(await ct.c.grants.countDocuments({ principalId: cap, 'scope.id': tm._id, revokedAt: null })).toBe(0);
  });

  it('a blocked user cannot be invited; outsiders cannot manage another team', async () => {
    const owner = await mk('u_own6');
    const bl = await mk('u_bl6');
    const tm = await newTeam(owner);
    await ct.c.blocks.insertOne({ _id: 'blk_t6', blockerId: owner, blockedId: bl, createdAt: new Date().toISOString() });
    expect(await code(svc.createInvitation(owner, tm._id, { principalId: bl, role: 'player', message: null }, rid()))).toBe('NOT_FOUND');
    // owner of seed team B (usr_seed_player) is an outsider for tm
    expect(await code(svc.createInvitation(seedIds.player, tm._id, { principalId: await mk('u_x6'), role: 'player', message: null }, rid()))).toBe('FORBIDDEN');
    expect(await code(svc.updateTeam(seedIds.player, tm._id, { name: 'hijack', expectedVersion: 0 }, rid()))).toBe('FORBIDDEN');
    expect(await code(svc.kick(seedIds.player, tm._id, owner, null, rid()))).toBe('FORBIDDEN');
  });
});

describe('ownership transfer', () => {
  it('requires acceptance, rejects non-owner / non-member / wrong acceptor, then swaps grants atomically', async () => {
    const owner = await mk('u_own7');
    const mgr = await mk('u_mgr7');
    const pl = await mk('u_pl7');
    const out = await mk('u_out7');
    const tm = await newTeam(owner);
    await join(tm._id, owner, mgr, 'manager');
    await join(tm._id, owner, pl, 'player');
    expect(await code(svc.requestTransfer(mgr, 'team', tm._id, { toPrincipalId: pl, responsibilitiesNote: null }, rid()))).toBe('FORBIDDEN');
    expect(await code(svc.requestTransfer(owner, 'team', tm._id, { toPrincipalId: out, responsibilitiesNote: null }, rid()))).toBe('VALIDATION_FAILED');
    const tr = await svc.requestTransfer(owner, 'team', tm._id, { toPrincipalId: pl, responsibilitiesNote: null }, rid());
    expect(tr.responsibilities).toMatchObject({ activeRegistrations: 0, openObligations: 0 });
    expect(tr.responsibilities.note).toContain('ESP-03');
    expect((await ct.c.teams.findOne({ _id: tm._id }))?.ownerPrincipalId).toBe(owner); // unchanged until accepted
    expect(await ct.acl.can(pl, 'team.ownership.transfer', team(tm._id))).toBe(false);
    expect(await code(svc.respondTransfer(owner, tr._id, 'accept', rid()))).toBe('FORBIDDEN');
    expect(await code(svc.respondTransfer(mgr, tr._id, 'accept', rid()))).toBe('FORBIDDEN');
    await svc.respondTransfer(pl, tr._id, 'accept', rid());
    const after = await ct.c.teams.findOne({ _id: tm._id });
    expect(after?.ownerPrincipalId).toBe(pl);
    expect(after?.ownerHistory).toHaveLength(2);
    expect(after?.ownerHistory[0]?.to).not.toBeNull();
    expect(await ct.acl.can(pl, 'team.ownership.transfer', team(tm._id))).toBe(true);
    expect(await ct.acl.can(owner, 'team.ownership.transfer', team(tm._id))).toBe(false);
    expect(await ct.acl.can(owner, 'team.manage', team(tm._id))).toBe(true); // former owner is now manager
    expect(await ct.c.outbox.countDocuments({ type: 'team.ownership.transferred', 'aggregate.id': tm._id })).toBe(1);
    expect(await code(svc.respondTransfer(pl, tr._id, 'accept', rid()))).toBe('CONFLICT');
  });

  it('counts non-terminal participations as active registrations', async () => {
    const tr = await svc.requestTransfer(seedIds.organizer, 'team', seedIds.teamA, { toPrincipalId: seedIds.captain, responsibilitiesNote: 'x' }, rid());
    const expected = await ct.c.participations.countDocuments({ 'snapshot.teamId': seedIds.teamA, registrationState: { $nin: ['rejected', 'withdrawn', 'removed'] } });
    expect(tr.responsibilities.activeRegistrations).toBe(expected);
    await svc.respondTransfer(seedIds.organizer, tr._id, 'cancel', rid());
    expect((await ct.c.ownershipTransfers.findOne({ _id: tr._id }))?.state).toBe('cancelled');
  });

  it('organizations: owner grant, team under org inherits, transfer swaps org grant', async () => {
    const owner = await mk('u_own8');
    const mem = await mk('u_mem8');
    const org = await svc.createOrganization(owner, { name: 'سازمان آزمون', slug: 'org-test-8', description: null, city: null, links: [], sponsors: [], logoFileId: null }, rid());
    expect(org.ownerHistory).toHaveLength(1);
    expect(await code(svc.createOrganization(mem, { name: 'dup', slug: 'org-test-8', description: null, city: null, links: [], sponsors: [], logoFileId: null }, rid()))).toBe('CONFLICT');
    const upd = await svc.updateOrganization(owner, org._id, { name: 'سازمان جدید', expectedVersion: 0 }, rid());
    expect(upd.nameHistory.map((h) => h.name)).toEqual(['سازمان آزمون', 'سازمان جدید']);
    expect(await code(svc.updateOrganization(owner, org._id, { name: 'z', expectedVersion: 0 }, rid()))).toBe('VERSION_CONFLICT');
    expect(await code(svc.updateOrganization(mem, org._id, { name: 'hijack', expectedVersion: 1 }, rid()))).toBe('FORBIDDEN');
    expect(await code(svc.createTeam(mem, { ...T, organizationId: org._id }, rid()))).toBe('FORBIDDEN');
    const tm = await svc.createTeam(owner, { ...T, organizationId: org._id }, rid());
    await join(tm._id, owner, mem, 'player');
    expect(await ct.acl.can(owner, 'team.manage', team(tm._id))).toBe(true);
    const pub = await svc.publicOrganization('org-test-8');
    expect(pub.teams.map((t) => t.id)).toEqual([tm._id]);
    const tr = await svc.requestTransfer(owner, 'organization', org._id, { toPrincipalId: mem, responsibilitiesNote: null }, rid());
    await svc.respondTransfer(mem, tr._id, 'accept', rid());
    expect((await ct.c.organizations.findOne({ _id: org._id }))?.ownerPrincipalId).toBe(mem);
    expect(await ct.acl.can(mem, 'team.ownership.transfer', { type: 'organization', id: org._id })).toBe(true);
    expect(await ct.acl.can(owner, 'team.ownership.transfer', { type: 'organization', id: org._id })).toBe(false);
  });
});

describe('history and snapshots (AC-02 / AC-13 foundation)', () => {
  it('rename keeps the team and nameHistory and does not change a participation snapshot; membership-at reads history', async () => {
    const before = await ct.c.participations.findOne({ _id: seedIds.participationA1 });
    expect(before).not.toBeNull();
    const extra = await mk('u_snap');
    const t0 = new Date().toISOString();
    await sleep(5);
    await join(seedIds.teamA, seedIds.organizer, extra, 'player');
    await sleep(5);
    const t1 = new Date().toISOString();
    await sleep(5);
    const upd = await svc.updateTeam(seedIds.organizer, seedIds.teamA, { name: 'نام جدید', tag: 'NEW', expectedVersion: 0 }, rid());
    expect(upd._id).toBe(seedIds.teamA);
    expect(upd.nameHistory.map((h) => h.name)).toEqual(['تیم الف', 'نام جدید']);
    await svc.kick(seedIds.organizer, seedIds.teamA, extra, 'x', rid());
    expect(await ct.c.teams.countDocuments({ organizationId: seedIds.orgA })).toBe(1);
    const after = await ct.c.participations.findOne({ _id: seedIds.participationA1 });
    expect(after).toEqual(before);
    const at0 = await getMembershipAt(ct.c, seedIds.teamA, t0);
    const at1 = await getMembershipAt(ct.c, seedIds.teamA, t1);
    const now = await getMembershipAt(ct.c, seedIds.teamA, new Date().toISOString());
    expect(at0.map((m) => m.principalId)).not.toContain(extra);
    expect(at1.map((m) => m.principalId)).toContain(extra);
    expect(now.map((m) => m.principalId)).not.toContain(extra);
    expect(await code(getMembershipAt(ct.c, seedIds.teamA, 'nope'))).toBe('VALIDATION_FAILED');
  });

  it('one organization may own several teams for different games', async () => {
    const owner = await mk('u_own9');
    const org = await svc.createOrganization(owner, { name: 'چندتیمی', slug: 'multi-9', description: null, city: null, links: [], sponsors: [], logoFileId: null }, rid());
    await svc.createTeam(owner, { ...T, organizationId: org._id }, rid());
    await svc.createTeam(owner, { ...T, tag: 'TS2', gameId: 'game_other', organizationId: org._id }, rid());
    expect((await svc.publicOrganization('multi-9')).teams.map((t) => t.gameId).sort()).toEqual(['game_other', 'game_seed_synthetic']);
  });
});

describe('public page and calendar', () => {
  it('public profile exposes only public member fields and honest empty sections', async () => {
    const owner = await mk('u_own10');
    const pl = await mk('u_pl10');
    const tm = await newTeam(owner);
    await join(tm._id, owner, pl, 'player');
    await svc.leave(pl, tm._id, 'bye', rid());
    const pub = await svc.teamProfile(tm._id, null);
    expect(pub.currentMembers.map((m) => m.nickname)).toEqual(['nick_u_own10']);
    expect(pub.pastMembers.map((m) => m.nickname)).toEqual(['nick_u_pl10']);
    expect(JSON.stringify(pub)).not.toMatch(/endedReason|endedBy|bye/);
    expect(pub.record.source).toBe('none_yet');
    expect(pub.standings).toEqual({ source: 'none_yet', items: [] });
    expect(pub.honors).toEqual({ source: 'none_yet', items: [] });
  });

  it('calendar: managers write, members read, outsiders denied', async () => {
    const owner = await mk('u_own11');
    const pl = await mk('u_pl11');
    const out = await mk('u_out11');
    const tm = await newTeam(owner);
    await join(tm._id, owner, pl, 'player');
    const ev = { kind: 'practice' as const, title: 'تمرین', startsAt: '2030-01-01T10:00:00Z', endsAt: '2030-01-01T12:00:00Z', note: null, refId: null };
    expect(await code(svc.addCalendarEvent(pl, tm._id, ev, rid()))).toBe('FORBIDDEN');
    expect(await code(svc.addCalendarEvent(owner, tm._id, { ...ev, endsAt: ev.startsAt }, rid()))).toBe('VALIDATION_FAILED');
    const e = await svc.addCalendarEvent(owner, tm._id, ev, rid());
    expect((await svc.listCalendar(pl, tm._id, rid())).map((x) => x.id)).toEqual([e._id]);
    expect(await code(svc.listCalendar(out, tm._id, rid()))).toBe('FORBIDDEN');
    await svc.deleteCalendarEvent(owner, tm._id, e._id, rid());
    expect(await svc.listCalendar(pl, tm._id, rid())).toEqual([]);
  });
});
