import type { ClientSession } from 'mongodb';
import { DomainError, type OrganizationUpdateSchema, type TeamUpdateSchema, type Role, type Scope } from '@esp/contracts';
import type { z } from 'zod';
import type { Container } from '../container.js';
import type { Collections, GrantDoc, OrganizationDoc, TeamDoc, TeamMembershipDoc } from '../db/collections.js';
import type { OwnershipTransferDoc, TeamCalendarEventDoc, TeamInvitationDoc, TeamJoinRequestDoc } from '../db/collections-esp02.js';
import { newId } from '../ids.js';
import { isBlockedEither } from '../social/social.js';
import { CareerService } from '../ranking/career.js';
import { HonorService } from '../honors/honors.js';

/** TEAM-001..007: organizations, teams, membership history, ownership transfer, calendar, public team page. */

/** Team-scope ACL grant that mirrors a membership role (player/substitute carry none). */
export const MEMBER_GRANT: Readonly<Record<string, Role>> = { owner: 'team_owner', manager: 'team_manager', captain: 'team_captain', coach: 'coach', analyst: 'analyst' };
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const TERMINAL_REGISTRATION: Array<'rejected' | 'withdrawn' | 'removed'> = ['rejected', 'withdrawn', 'removed'];
const teamScope = (id: string): Scope => ({ type: 'team', id });
const orgScope = (id: string): Scope => ({ type: 'organization', id });
const now = () => new Date().toISOString();

type Link = { label: string; url: string };
type Sponsor = { name: string; url: string | null; logoFileId: string | null };

/** Roster at instant `atIso`, from history only (ROS-006 foundation; ESP-03 roster lock uses this). */
export async function getMembershipAt(c: Collections, teamId: string, atIso: string) {
  if (Number.isNaN(Date.parse(atIso))) throw new DomainError('VALIDATION_FAILED', 'at must be an ISO instant');
  const at = new Date(atIso).toISOString();
  const rows = await c.teamMemberships.find({ teamId, from: { $lte: at }, $or: [{ to: null }, { to: { $gt: at } }] }).sort({ from: 1 }).toArray();
  return rows.map((m) => ({ principalId: m.principalId, role: m.role, displayName: m.displayNameAtJoin, from: m.from, to: m.to }));
}

export class TeamService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }

  // ---------------------------------------------------------------- helpers
  private async ev(s: ClientSession, type: string, aggregate: { type: string; id: string }, version: number, actor: string, payload: Record<string, unknown>, rid: string) {
    await this.ct.outbox.append({ type, aggregate, aggregateVersion: version, actor: { principalId: actor, kind: 'user' }, payload, correlationId: rid }, s);
  }
  private async au(s: ClientSession, actor: string, action: string, target: { type: string; id: string }, scope: Scope, details: Record<string, unknown>, rid: string) {
    await this.ct.audit.append({ actorPrincipalId: actor, action, target, scope, outcome: 'success', details, requestId: rid }, s);
  }

  /** Grant inside the caller's transaction (the scope document may not be committed yet, so no context lookup). */
  private async grantIn(s: ClientSession, principalId: string, role: Role, scope: Scope, by: string, rid: string, reason: string): Promise<void> {
    const q = { principalId, role, 'scope.type': scope.type, 'scope.id': scope.id, revokedAt: null };
    if (await this.c.grants.findOne(q, { session: s, projection: { _id: 1 } })) return;
    const doc: GrantDoc = { _id: newId('grt'), principalId, role, scope, grantedBy: by, grantedAt: now(), expiresAt: null, revokedAt: null, revokedBy: null, reason };
    await this.c.grants.insertOne(doc, { session: s });
    await this.c.principals.updateOne({ _id: principalId }, { $inc: { aclVersion: 1 } }, { session: s });
    await this.au(s, by, 'acl.grant', { type: 'grant', id: doc._id }, scope, { role, principalId, source: 'team_membership' }, rid);
    await this.ev(s, 'acl.grant.created', { type: 'principal', id: principalId }, 0, by, { grantId: doc._id, role, scope }, rid);
  }
  private async revokeIn(s: ClientSession, principalId: string, role: Role, scope: Scope, by: string, rid: string, reason: string): Promise<void> {
    const g = await this.c.grants.findOne({ principalId, role, 'scope.type': scope.type, 'scope.id': scope.id, revokedAt: null }, { session: s, projection: { _id: 1 } });
    if (g) await this.ct.acl.revoke(g._id, { principalId: by, requestId: rid }, reason, s);
  }

  private async nickname(principalId: string): Promise<string> {
    const pr = await this.c.principals.findOne({ _id: principalId }, { projection: { status: 1, displayName: 1 } });
    if (!pr || pr.status !== 'active') throw new DomainError('NOT_FOUND', 'user not available');
    return (await this.c.profiles.findOne({ _id: principalId }, { projection: { nickname: 1 } }))?.nickname ?? pr.displayName;
  }

  private async assertPublicImage(principalId: string, fileId: string | null | undefined): Promise<void> {
    if (!fileId) return;
    const f = await this.ct.files.get(fileId);
    if (!f || f.ownerPrincipalId !== principalId) throw new DomainError('VALIDATION_FAILED', 'file must be one of your own uploads');
    if (f.visibility !== 'public' || f.quarantined || !f.mimeType.startsWith('image/')) throw new DomainError('VALIDATION_FAILED', 'logo must be a public, non-quarantined image');
  }
  private async fileUrl(fileId: string | null): Promise<string | null> {
    if (!fileId) return null;
    const f = await this.ct.files.get(fileId);
    return f && f.visibility === 'public' && !f.quarantined ? f.publicUrl : null;
  }

  async getTeam(teamId: string): Promise<TeamDoc> {
    const t = await this.c.teams.findOne({ _id: teamId });
    if (!t) throw new DomainError('NOT_FOUND', 'team not found');
    return t;
  }

  // ---------------------------------------------------------------- organizations (TEAM-001)
  orgView(o: OrganizationDoc) {
    return { id: o._id, name: o.name, slug: o.slug, ownerPrincipalId: o.ownerPrincipalId, description: o.description, city: o.city, links: o.links, sponsors: o.sponsors, logoFileId: o.logoFileId, nameHistory: o.nameHistory, ownerHistory: o.ownerHistory, version: o.version, createdAt: o.createdAt, updatedAt: o.updatedAt };
  }

  async createOrganization(me: string, input: { name: string; slug: string; description: string | null; city: string | null; links: Link[]; sponsors: Sponsor[]; logoFileId: string | null }, rid: string) {
    await this.assertPublicImage(me, input.logoFileId);
    if (await this.c.organizations.findOne({ slug: input.slug }, { projection: { _id: 1 } })) throw new DomainError('CONFLICT', 'slug already taken');
    const t = now();
    const doc: OrganizationDoc = { _id: newId('org'), name: input.name, slug: input.slug, ownerPrincipalId: me, description: input.description, city: input.city, links: input.links, sponsors: input.sponsors, logoFileId: input.logoFileId, nameHistory: [{ name: input.name, from: t, to: null }], ownerHistory: [{ principalId: me, from: t, to: null }], createdAt: t, updatedAt: t, version: 0 };
    await this.ct.dbh.withTransaction(async (s) => {
      await this.c.organizations.insertOne(doc, { session: s });
      await this.grantIn(s, me, 'team_owner', orgScope(doc._id), me, rid, 'organization creator');
      await this.au(s, me, 'organization.create', { type: 'organization', id: doc._id }, orgScope(doc._id), { slug: doc.slug }, rid);
      await this.ev(s, 'organization.created', { type: 'organization', id: doc._id }, 0, me, { slug: doc.slug }, rid);
    });
    return doc;
  }

  private async assertOrgManager(me: string, org: OrganizationDoc, rid: string): Promise<void> {
    if (org.ownerPrincipalId === me) return;
    await this.ct.acl.require(me, 'organization.manage', orgScope(org._id), rid);
  }

  async updateOrganization(me: string, orgId: string, input: z.infer<typeof OrganizationUpdateSchema>, rid: string) {
    const org = await this.c.organizations.findOne({ _id: orgId });
    if (!org) throw new DomainError('NOT_FOUND', 'organization not found');
    await this.assertOrgManager(me, org, rid);
    if (org.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'organization was modified', { currentVersion: org.version });
    if (input.logoFileId !== undefined) await this.assertPublicImage(me, input.logoFileId);
    if (input.slug && input.slug !== org.slug && (await this.c.organizations.findOne({ slug: input.slug }, { projection: { _id: 1 } }))) throw new DomainError('CONFLICT', 'slug already taken');
    const { expectedVersion, ...rest } = input;
    const set: Record<string, unknown> = { ...rest, updatedAt: now() };
    if (rest.name && rest.name !== org.name) {
      const t = now();
      set['nameHistory'] = [...org.nameHistory.map((h) => (h.to === null ? { ...h, to: t } : h)), { name: rest.name, from: t, to: null }];
    }
    return this.ct.dbh.withTransaction(async (s) => {
      const r = await this.c.organizations.findOneAndUpdate({ _id: orgId, version: expectedVersion }, { $set: set, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
      if (!r) throw new DomainError('VERSION_CONFLICT', 'organization was modified');
      await this.au(s, me, 'organization.update', { type: 'organization', id: orgId }, orgScope(orgId), { fields: Object.keys(rest) }, rid);
      await this.ev(s, 'organization.updated', { type: 'organization', id: orgId }, r.version, me, { fields: Object.keys(rest) }, rid);
      return r;
    });
  }

  async publicOrganization(slug: string) {
    const o = await this.c.organizations.findOne({ slug });
    if (!o) throw new DomainError('NOT_FOUND', 'organization not found');
    const teams = await this.c.teams.find({ organizationId: o._id }).sort({ name: 1 }).toArray();
    return {
      id: o._id,
      name: o.name,
      slug: o.slug,
      description: o.description,
      city: o.city,
      links: o.links,
      sponsors: o.sponsors,
      logoUrl: await this.fileUrl(o.logoFileId),
      teams: await Promise.all(teams.map(async (t) => ({ id: t._id, name: t.name, tag: t.tag, gameId: t.gameId, logoUrl: await this.fileUrl(t.logoFileId) }))),
    };
  }

  // ---------------------------------------------------------------- teams (TEAM-002, TEAM-006)
  teamView(t: TeamDoc) {
    return { id: t._id, organizationId: t.organizationId, ownerPrincipalId: t.ownerPrincipalId, gameId: t.gameId, name: t.name, tag: t.tag, description: t.description, city: t.city, links: t.links, sponsors: t.sponsors, logoFileId: t.logoFileId, coverFileId: t.coverFileId, nameHistory: t.nameHistory, version: t.version, createdAt: t.createdAt, updatedAt: t.updatedAt };
  }

  async createTeam(me: string, input: { name: string; tag: string; gameId: string; organizationId: string | null; description: string | null; city: string | null; links: Link[]; sponsors: Sponsor[]; logoFileId: string | null; coverFileId: string | null }, rid: string) {
    if (input.organizationId) {
      const org = await this.c.organizations.findOne({ _id: input.organizationId });
      if (!org) throw new DomainError('NOT_FOUND', 'organization not found');
      await this.assertOrgManager(me, org, rid);
    }
    await this.assertPublicImage(me, input.logoFileId);
    await this.assertPublicImage(me, input.coverFileId);
    const t = now();
    const name = await this.nickname(me);
    const doc: TeamDoc = { _id: newId('team'), organizationId: input.organizationId, ownerPrincipalId: me, gameId: input.gameId, name: input.name, tag: input.tag, description: input.description, city: input.city, links: input.links, sponsors: input.sponsors, logoFileId: input.logoFileId, coverFileId: input.coverFileId, nameHistory: [{ name: input.name, tag: input.tag, from: t, to: null }], ownerHistory: [{ principalId: me, from: t, to: null }], createdAt: t, updatedAt: t, version: 0 };
    await this.ct.dbh.withTransaction(async (s) => {
      await this.c.teams.insertOne(doc, { session: s });
      await this.c.teamMemberships.insertOne({ _id: newId('mem'), teamId: doc._id, principalId: me, role: 'owner', from: t, to: null, endedReason: null, endedBy: null, displayNameAtJoin: name }, { session: s });
      await this.grantIn(s, me, 'team_owner', teamScope(doc._id), me, rid, 'team creator');
      await this.au(s, me, 'team.create', { type: 'team', id: doc._id }, teamScope(doc._id), { gameId: doc.gameId, organizationId: doc.organizationId }, rid);
      await this.ev(s, 'team.created', { type: 'team', id: doc._id }, 0, me, { gameId: doc.gameId, organizationId: doc.organizationId }, rid);
    });
    return doc;
  }

  async updateTeam(me: string, teamId: string, input: z.infer<typeof TeamUpdateSchema>, rid: string) {
    await this.ct.acl.require(me, 'team.manage', teamScope(teamId), rid);
    const team = await this.getTeam(teamId);
    if (team.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'team was modified', { currentVersion: team.version });
    if (input.logoFileId !== undefined) await this.assertPublicImage(me, input.logoFileId);
    if (input.coverFileId !== undefined) await this.assertPublicImage(me, input.coverFileId);
    const { expectedVersion, ...rest } = input;
    const t = now();
    const set: Record<string, unknown> = { ...rest, updatedAt: t };
    if ((rest.name && rest.name !== team.name) || (rest.tag && rest.tag !== team.tag)) {
      // same team, new identity: history keeps every earlier name/tag (TEAM-006)
      set['nameHistory'] = [...team.nameHistory.map((h) => (h.to === null ? { ...h, to: t } : h)), { name: rest.name ?? team.name, tag: rest.tag ?? team.tag, from: t, to: null }];
    }
    return this.ct.dbh.withTransaction(async (s) => {
      const r = await this.c.teams.findOneAndUpdate({ _id: teamId, version: expectedVersion }, { $set: set, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
      if (!r) throw new DomainError('VERSION_CONFLICT', 'team was modified');
      await this.au(s, me, 'team.update', { type: 'team', id: teamId }, teamScope(teamId), { fields: Object.keys(rest) }, rid);
      await this.ev(s, 'team.updated', { type: 'team', id: teamId }, r.version, me, { fields: Object.keys(rest), renamed: 'nameHistory' in set }, rid);
      return r;
    });
  }

  async myTeams(me: string) {
    const ms = await this.c.teamMemberships.find({ principalId: me, to: null }).toArray();
    const teams = await this.c.teams.find({ _id: { $in: ms.map((m) => m.teamId) } }).toArray();
    return ms.flatMap((m) => {
      const t = teams.find((x) => x._id === m.teamId);
      return t ? [{ teamId: t._id, name: t.name, tag: t.tag, gameId: t.gameId, role: m.role, from: m.from }] : [];
    });
  }

  /** Public team page (TEAM-007): public member projection only; results sections are real shapes, empty until ESP-03/05. */
  async teamProfile(teamId: string, viewerId: string | null) {
    const t = await this.getTeam(teamId);
    const ms = await this.c.teamMemberships.find({ teamId }).sort({ from: 1 }).toArray();
    const profiles = await this.c.profiles.find({ _id: { $in: [...new Set(ms.map((m) => m.principalId))] } }, { projection: { nickname: 1, avatarFileId: 1 } }).toArray();
    const rows: Array<{ principalId: string; nickname: string; avatarUrl: string | null; role: string; from: string; to: string | null }> = [];
    for (const m of ms) {
      if (viewerId && viewerId !== m.principalId && (await isBlockedEither(this.c, viewerId, m.principalId))) continue;
      const p = profiles.find((x) => x._id === m.principalId);
      rows.push({ principalId: m.principalId, nickname: p?.nickname ?? m.displayNameAtJoin, avatarUrl: await this.fileUrl(p?.avatarFileId ?? null), role: m.role, from: m.from, to: m.to });
    }
    return {
      id: t._id,
      name: t.name,
      tag: t.tag,
      gameId: t.gameId,
      organizationId: t.organizationId,
      description: t.description,
      city: t.city,
      links: t.links,
      sponsors: t.sponsors,
      logoUrl: await this.fileUrl(t.logoFileId),
      coverUrl: await this.fileUrl(t.coverFileId),
      nameHistory: t.nameHistory.map((h) => ({ name: h.name, tag: h.tag, from: h.from, to: h.to })),
      currentMembers: rows.filter((r) => r.to === null),
      // a past member appears once (latest stint); role changes of current members are not "past"
      pastMembers: [...new Map(rows.filter((r) => r.to !== null && !rows.some((x) => x.principalId === r.principalId && x.to === null)).map((r) => [r.principalId, r])).values()],
      ...(await this.career(t._id)),
    };
  }

  /** TEAM-006 / RANK-007: record, placements and honors from final official results (participation snapshots of the time). */
  private async career(teamId: string) {
    const rec = await new CareerService(this.ct).team(teamId);
    const hon = await new HonorService(this.ct).forTeam(teamId);
    return {
      record: rec.played ? { source: 'computed' as const, played: rec.played, wins: rec.wins, losses: rec.losses, draws: rec.draws } : { source: 'none_yet' as const, played: 0, wins: 0, losses: 0, draws: 0 },
      standings: rec.standings.length ? { source: 'computed' as const, items: rec.standings.map((x) => ({ eventId: x.eventId, title: x.eventName, rank: x.place, points: x.points })) } : { source: 'none_yet' as const, items: [] },
      honors: hon.verified.length || hon.declared.length
        ? { source: 'computed' as const, items: hon.verified.map((h) => ({ eventId: h.eventId, title: h.eventName, placement: h.place ?? 0, awardedAt: h.issuedAt, id: h.id, nameAtTime: h.team?.nameAtTime ?? null, state: h.state, verifyCode: h.verifyCode })), declared: hon.declared }
        : { source: 'none_yet' as const, items: [] },
    };
  }

  async membershipAt(me: string, teamId: string, at: string, rid: string) {
    await this.ct.acl.require(me, 'team.read_private', teamScope(teamId), rid);
    return getMembershipAt(this.c, teamId, at);
  }

  // ---------------------------------------------------------------- membership core (history never deleted)
  private async addMember(s: ClientSession, team: TeamDoc, principalId: string, role: string, by: string, rid: string): Promise<TeamMembershipDoc> {
    if (await this.c.teamMemberships.findOne({ teamId: team._id, principalId, to: null }, { session: s, projection: { _id: 1 } })) throw new DomainError('CONFLICT', 'already an active member of this team');
    const mem: TeamMembershipDoc = { _id: newId('mem'), teamId: team._id, principalId, role, from: now(), to: null, endedReason: null, endedBy: null, displayNameAtJoin: await this.nickname(principalId) };
    await this.c.teamMemberships.insertOne(mem, { session: s });
    const g = MEMBER_GRANT[role];
    if (g) await this.grantIn(s, principalId, g, teamScope(team._id), by, rid, `team membership ${role}`);
    const t = now();
    await this.c.teamInvitations.updateMany({ teamId: team._id, principalId, state: 'pending' }, { $set: { state: 'cancelled', decidedAt: t }, $inc: { version: 1 } }, { session: s });
    await this.c.teamJoinRequests.updateMany({ teamId: team._id, principalId, state: 'pending' }, { $set: { state: 'cancelled', decidedAt: t }, $inc: { version: 1 } }, { session: s });
    await this.au(s, by, 'team.member.join', { type: 'team', id: team._id }, teamScope(team._id), { principalId, role }, rid);
    await this.ev(s, 'team.member.joined', { type: 'team', id: team._id }, team.version, by, { teamId: team._id, principalId, role }, rid);
    return mem;
  }

  private async closeMembership(s: ClientSession, m: TeamMembershipDoc, reason: string, by: string, rid: string, at = now()): Promise<void> {
    const r = await this.c.teamMemberships.updateOne({ _id: m._id, to: null }, { $set: { to: at, endedReason: reason, endedBy: by } }, { session: s });
    if (r.modifiedCount === 0) throw new DomainError('CONFLICT', 'membership already ended');
    const g = MEMBER_GRANT[m.role];
    if (g) await this.revokeIn(s, m.principalId, g, teamScope(m.teamId), by, rid, `membership ended: ${reason}`);
  }

  private async removeMember(s: ClientSession, team: TeamDoc, m: TeamMembershipDoc, kind: 'left' | 'kicked', reason: string | null, by: string, rid: string) {
    await this.closeMembership(s, m, reason ?? kind, by, rid);
    await this.au(s, by, `team.member.${kind}`, { type: 'team', id: team._id }, teamScope(team._id), { principalId: m.principalId, role: m.role, reason }, rid);
    await this.ev(s, 'team.member.left', { type: 'team', id: team._id }, team.version, by, { teamId: team._id, principalId: m.principalId, role: m.role, kind, reason }, rid);
  }

  /** Role change = close the row and open a new one at the same instant, so history stays exact. */
  private async setRole(s: ClientSession, team: TeamDoc, m: TeamMembershipDoc, role: string, by: string, rid: string): Promise<void> {
    const t = now();
    await this.closeMembership(s, m, 'role_changed', by, rid, t);
    await this.c.teamMemberships.insertOne({ _id: newId('mem'), teamId: m.teamId, principalId: m.principalId, role, from: t, to: null, endedReason: null, endedBy: null, displayNameAtJoin: m.displayNameAtJoin }, { session: s });
    const g = MEMBER_GRANT[role];
    if (g) await this.grantIn(s, m.principalId, g, teamScope(m.teamId), by, rid, `team membership ${role}`);
    await this.au(s, by, 'team.member.role_change', { type: 'team', id: team._id }, teamScope(team._id), { principalId: m.principalId, from: m.role, to: role }, rid);
    await this.ev(s, 'team.member.role_changed', { type: 'team', id: team._id }, team.version, by, { teamId: team._id, principalId: m.principalId, from: m.role, to: role }, rid);
  }

  private async requireRosterRight(me: string, teamId: string, role: string, rid: string) {
    // handing out the manager role is a team.manage act; captains cannot escalate
    await this.ct.acl.require(me, role === 'manager' ? 'team.manage' : 'team.roster.manage', teamScope(teamId), rid);
  }

  async listMembers(me: string, teamId: string, rid: string) {
    await this.ct.acl.require(me, 'team.read_private', teamScope(teamId), rid);
    return (await this.c.teamMemberships.find({ teamId, to: null }).sort({ from: 1 }).toArray()).map((m) => ({ principalId: m.principalId, role: m.role, displayName: m.displayNameAtJoin, from: m.from }));
  }

  // ---------------------------------------------------------------- invitations (TEAM-003)
  inviteView(i: TeamInvitationDoc) {
    return { id: i._id, teamId: i.teamId, principalId: i.principalId, role: i.role, message: i.message, state: i.state, invitedBy: i.invitedBy, createdAt: i.createdAt, expiresAt: i.expiresAt, decidedAt: i.decidedAt, version: i.version };
  }

  /** Also used by recruitment (accepting an application creates an invitation, never a membership). */
  async createInvitation(me: string, teamId: string, input: { principalId: string; role: string; message: string | null }, rid: string, session?: ClientSession): Promise<TeamInvitationDoc> {
    await this.requireRosterRight(me, teamId, input.role, rid);
    const team = await this.getTeam(teamId);
    await this.nickname(input.principalId); // active target
    if (await isBlockedEither(this.c, me, input.principalId)) throw new DomainError('NOT_FOUND', 'user not available');
    const opts = session ? { session } : {};
    if (await this.c.teamMemberships.findOne({ teamId, principalId: input.principalId, to: null }, { ...opts, projection: { _id: 1 } })) throw new DomainError('CONFLICT', 'user is already a member');
    if (await this.c.teamInvitations.findOne({ teamId, principalId: input.principalId, state: 'pending', expiresAt: { $gt: now() } }, { ...opts, projection: { _id: 1 } })) throw new DomainError('CONFLICT', 'a pending invitation already exists');
    const t = now();
    const doc: TeamInvitationDoc = { _id: newId('inv'), teamId, principalId: input.principalId, role: input.role as TeamInvitationDoc['role'], invitedBy: me, message: input.message, state: 'pending', createdAt: t, expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(), decidedAt: null, version: 0 };
    const run = async (s: ClientSession) => {
      await this.c.teamInvitations.insertOne(doc, { session: s });
      await this.au(s, me, 'team.invitation.create', { type: 'team', id: teamId }, teamScope(teamId), { principalId: input.principalId, role: input.role }, rid);
      await this.ev(s, 'team.invitation.created', { type: 'team', id: team._id }, team.version, me, { teamId, principalId: input.principalId, role: input.role, invitationId: doc._id }, rid);
    };
    if (session) await run(session);
    else await this.ct.dbh.withTransaction(run);
    return doc;
  }

  async myInvitations(me: string) {
    return (await this.c.teamInvitations.find({ principalId: me }).sort({ createdAt: -1 }).limit(100).toArray()).map((i) => this.inviteView(i));
  }
  async teamInvitations(me: string, teamId: string, rid: string) {
    await this.ct.acl.require(me, 'team.roster.manage', teamScope(teamId), rid);
    return (await this.c.teamInvitations.find({ teamId }).sort({ createdAt: -1 }).limit(200).toArray()).map((i) => this.inviteView(i));
  }

  async respondInvitation(me: string, invId: string, accept: boolean, rid: string) {
    const inv = await this.c.teamInvitations.findOne({ _id: invId });
    if (!inv || inv.principalId !== me) throw new DomainError('NOT_FOUND', 'invitation not found');
    if (inv.state !== 'pending') throw new DomainError('CONFLICT', `invitation is ${inv.state}`);
    if (inv.expiresAt <= now()) {
      await this.c.teamInvitations.updateOne({ _id: invId, state: 'pending' }, { $set: { state: 'expired', decidedAt: now() }, $inc: { version: 1 } });
      throw new DomainError('CONFLICT', 'invitation expired');
    }
    const team = await this.getTeam(inv.teamId);
    return this.ct.dbh.withTransaction(async (s) => {
      // the conditional update makes a second acceptance impossible even under races
      const r = await this.c.teamInvitations.findOneAndUpdate({ _id: invId, principalId: me, state: 'pending', expiresAt: { $gt: now() } }, { $set: { state: accept ? 'accepted' : 'declined', decidedAt: now() }, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
      if (!r) throw new DomainError('CONFLICT', 'invitation is no longer pending');
      if (accept) await this.addMember(s, team, me, inv.role, me, rid);
      else await this.au(s, me, 'team.invitation.decline', { type: 'team', id: team._id }, teamScope(team._id), { invitationId: invId }, rid);
      return r;
    });
  }

  async cancelInvitation(me: string, invId: string, rid: string) {
    const inv = await this.c.teamInvitations.findOne({ _id: invId });
    if (!inv) throw new DomainError('NOT_FOUND', 'invitation not found');
    await this.ct.acl.require(me, 'team.roster.manage', teamScope(inv.teamId), rid);
    return this.ct.dbh.withTransaction(async (s) => {
      const r = await this.c.teamInvitations.findOneAndUpdate({ _id: invId, state: 'pending' }, { $set: { state: 'cancelled', decidedAt: now() }, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
      if (!r) throw new DomainError('CONFLICT', 'invitation is no longer pending');
      await this.au(s, me, 'team.invitation.cancel', { type: 'team', id: inv.teamId }, teamScope(inv.teamId), { invitationId: invId }, rid);
      return r;
    });
  }

  // ---------------------------------------------------------------- join requests (TEAM-003)
  requestView(r: TeamJoinRequestDoc) {
    return { id: r._id, teamId: r.teamId, principalId: r.principalId, role: r.role, message: r.message, state: r.state, decidedBy: r.decidedBy, createdAt: r.createdAt, decidedAt: r.decidedAt, version: r.version };
  }

  async requestToJoin(me: string, teamId: string, input: { role: string; message: string | null }, rid: string) {
    const team = await this.getTeam(teamId);
    if (await this.c.teamMemberships.findOne({ teamId, principalId: me, to: null }, { projection: { _id: 1 } })) throw new DomainError('CONFLICT', 'already a member');
    if (await this.c.teamJoinRequests.findOne({ teamId, principalId: me, state: 'pending' }, { projection: { _id: 1 } })) throw new DomainError('CONFLICT', 'a join request is already pending');
    if (await isBlockedEither(this.c, me, team.ownerPrincipalId)) throw new DomainError('NOT_FOUND', 'team not found');
    const doc: TeamJoinRequestDoc = { _id: newId('jrq'), teamId, principalId: me, role: input.role as TeamJoinRequestDoc['role'], message: input.message, state: 'pending', decidedBy: null, createdAt: now(), decidedAt: null, version: 0 };
    await this.ct.dbh.withTransaction(async (s) => {
      await this.c.teamJoinRequests.insertOne(doc, { session: s });
      await this.au(s, me, 'team.join_request.create', { type: 'team', id: teamId }, teamScope(teamId), { role: input.role }, rid);
      await this.ev(s, 'team.join_request.created', { type: 'team', id: teamId }, team.version, me, { teamId, principalId: me, requestId: doc._id }, rid);
    });
    return doc;
  }

  async listJoinRequests(me: string, teamId: string, rid: string) {
    await this.ct.acl.require(me, 'team.roster.manage', teamScope(teamId), rid);
    return (await this.c.teamJoinRequests.find({ teamId }).sort({ createdAt: -1 }).limit(200).toArray()).map((r) => this.requestView(r));
  }

  async decideJoinRequest(me: string, reqId: string, accept: boolean, rid: string) {
    const jr = await this.c.teamJoinRequests.findOne({ _id: reqId });
    if (!jr) throw new DomainError('NOT_FOUND', 'join request not found');
    await this.requireRosterRight(me, jr.teamId, jr.role, rid);
    const team = await this.getTeam(jr.teamId);
    return this.ct.dbh.withTransaction(async (s) => {
      const r = await this.c.teamJoinRequests.findOneAndUpdate({ _id: reqId, state: 'pending' }, { $set: { state: accept ? 'accepted' : 'declined', decidedBy: me, decidedAt: now() }, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
      if (!r) throw new DomainError('CONFLICT', 'join request is no longer pending');
      if (accept) await this.addMember(s, team, jr.principalId, jr.role, me, rid);
      else await this.au(s, me, 'team.join_request.decline', { type: 'team', id: team._id }, teamScope(team._id), { requestId: reqId }, rid);
      return r;
    });
  }

  // ---------------------------------------------------------------- leave / kick / role change
  async leave(me: string, teamId: string, reason: string | null, rid: string): Promise<void> {
    const team = await this.getTeam(teamId);
    const m = await this.c.teamMemberships.findOne({ teamId, principalId: me, to: null });
    if (!m) throw new DomainError('NOT_FOUND', 'you are not a member of this team');
    if (m.role === 'owner') throw new DomainError('PRECONDITION_FAILED', 'the owner must transfer ownership before leaving');
    await this.ct.dbh.withTransaction((s) => this.removeMember(s, team, m, 'left', reason, me, rid));
  }

  async kick(me: string, teamId: string, principalId: string, reason: string | null, rid: string): Promise<void> {
    const team = await this.getTeam(teamId);
    const m = await this.c.teamMemberships.findOne({ teamId, principalId, to: null });
    if (!m) throw new DomainError('NOT_FOUND', 'member not found');
    if (principalId === me) throw new DomainError('VALIDATION_FAILED', 'use leave instead');
    if (m.role === 'owner') throw new DomainError('FORBIDDEN', 'the owner cannot be removed');
    await this.requireRosterRight(me, teamId, m.role, rid);
    await this.ct.dbh.withTransaction((s) => this.removeMember(s, team, m, 'kicked', reason, me, rid));
  }

  async changeRole(me: string, teamId: string, principalId: string, role: string, rid: string): Promise<void> {
    const team = await this.getTeam(teamId);
    const m = await this.c.teamMemberships.findOne({ teamId, principalId, to: null });
    if (!m) throw new DomainError('NOT_FOUND', 'member not found');
    if (m.role === 'owner') throw new DomainError('FORBIDDEN', 'the owner role changes only through ownership transfer');
    if (m.role === role) return;
    await this.requireRosterRight(me, teamId, role, rid);
    if (m.role === 'manager') await this.requireRosterRight(me, teamId, 'manager', rid);
    await this.ct.dbh.withTransaction((s) => this.setRole(s, team, m, role, me, rid));
  }

  // ---------------------------------------------------------------- ownership transfer (TEAM-005)
  transferView(t: OwnershipTransferDoc) {
    return { id: t._id, targetType: t.targetType, targetId: t.targetId, fromPrincipalId: t.fromPrincipalId, toPrincipalId: t.toPrincipalId, responsibilities: t.responsibilities, state: t.state, createdAt: t.createdAt, expiresAt: t.expiresAt, decidedAt: t.decidedAt, version: t.version };
  }

  async requestTransfer(me: string, targetType: 'team' | 'organization', targetId: string, input: { toPrincipalId: string; responsibilitiesNote: string | null }, rid: string) {
    let teamIds: string[];
    let from: string;
    if (targetType === 'team') {
      const team = await this.getTeam(targetId);
      await this.ct.acl.require(me, 'team.ownership.transfer', teamScope(targetId), rid);
      from = team.ownerPrincipalId;
      teamIds = [targetId];
      if (!(await this.c.teamMemberships.findOne({ teamId: targetId, principalId: input.toPrincipalId, to: null }, { projection: { _id: 1 } }))) throw new DomainError('VALIDATION_FAILED', 'the new owner must be a current member of the team');
    } else {
      const org = await this.c.organizations.findOne({ _id: targetId });
      if (!org) throw new DomainError('NOT_FOUND', 'organization not found');
      await this.ct.acl.require(me, 'team.ownership.transfer', orgScope(targetId), rid);
      from = org.ownerPrincipalId;
      teamIds = (await this.c.teams.find({ organizationId: targetId }, { projection: { _id: 1 } }).toArray()).map((t) => t._id);
      if (!(await this.c.teamMemberships.findOne({ teamId: { $in: teamIds }, principalId: input.toPrincipalId, to: null }, { projection: { _id: 1 } }))) throw new DomainError('VALIDATION_FAILED', 'the new owner must be a member of one of the organization teams');
    }
    if (from !== me) throw new DomainError('FORBIDDEN', 'only the current owner can transfer ownership');
    if (input.toPrincipalId === me) throw new DomainError('VALIDATION_FAILED', 'cannot transfer ownership to yourself');
    if (await this.c.ownershipTransfers.findOne({ targetType, targetId, state: 'pending', expiresAt: { $gt: now() } }, { projection: { _id: 1 } })) throw new DomainError('CONFLICT', 'a transfer is already pending');
    const activeRegistrations = await this.c.participations.countDocuments({ 'snapshot.teamId': { $in: teamIds }, registrationState: { $nin: TERMINAL_REGISTRATION } });
    const doc: OwnershipTransferDoc = {
      _id: newId('otr'),
      targetType,
      targetId,
      fromPrincipalId: me,
      toPrincipalId: input.toPrincipalId,
      // ponytail: finance (ESP-03) does not exist yet, so open obligations are reported as 0 with this explicit note
      responsibilities: { activeRegistrations, openObligations: 0, note: [input.responsibilitiesNote, 'open obligations: financial obligations are not tracked until ESP-03 (reported as 0)'].filter(Boolean).join(' | ') },
      state: 'pending',
      createdAt: now(),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      decidedAt: null,
      version: 0,
    };
    await this.ct.dbh.withTransaction(async (s) => {
      await this.c.ownershipTransfers.insertOne(doc, { session: s });
      await this.au(s, me, 'ownership.transfer.request', { type: targetType, id: targetId }, targetType === 'team' ? teamScope(targetId) : orgScope(targetId), { to: input.toPrincipalId }, rid);
      await this.ev(s, 'team.ownership.requested', { type: targetType, id: targetId }, 0, me, { targetType, targetId, to: input.toPrincipalId }, rid);
    });
    return doc;
  }

  async myTransfers(me: string) {
    return (await this.c.ownershipTransfers.find({ $or: [{ toPrincipalId: me }, { fromPrincipalId: me }] }).sort({ createdAt: -1 }).limit(50).toArray()).map((t) => this.transferView(t));
  }

  async respondTransfer(me: string, id: string, decision: 'accept' | 'decline' | 'cancel', rid: string) {
    const tr = await this.c.ownershipTransfers.findOne({ _id: id });
    if (!tr) throw new DomainError('NOT_FOUND', 'transfer not found');
    if (decision === 'cancel' ? tr.fromPrincipalId !== me : tr.toPrincipalId !== me) throw new DomainError('FORBIDDEN', 'not allowed to answer this transfer');
    if (tr.state !== 'pending') throw new DomainError('CONFLICT', `transfer is ${tr.state}`);
    if (tr.expiresAt <= now()) {
      await this.c.ownershipTransfers.updateOne({ _id: id, state: 'pending' }, { $set: { state: 'expired', decidedAt: now() }, $inc: { version: 1 } });
      throw new DomainError('CONFLICT', 'transfer expired');
    }
    const scope = tr.targetType === 'team' ? teamScope(tr.targetId) : orgScope(tr.targetId);
    return this.ct.dbh.withTransaction(async (s) => {
      const r = await this.c.ownershipTransfers.findOneAndUpdate({ _id: id, state: 'pending' }, { $set: { state: decision === 'accept' ? 'accepted' : decision === 'decline' ? 'declined' : 'cancelled', decidedAt: now() }, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
      if (!r) throw new DomainError('CONFLICT', 'transfer is no longer pending');
      if (decision !== 'accept') {
        await this.au(s, me, `ownership.transfer.${decision}`, { type: tr.targetType, id: tr.targetId }, scope, {}, rid);
        return r;
      }
      const t = now();
      const close = <H extends { to: string | null }>(h: H[]) => h.map((e) => (e.to === null ? { ...e, to: t } : e));
      if (tr.targetType === 'team') {
        const team = await this.c.teams.findOne({ _id: tr.targetId }, { session: s });
        if (!team || team.ownerPrincipalId !== tr.fromPrincipalId) throw new DomainError('CONFLICT', 'the team owner changed; request a new transfer');
        await this.c.teams.updateOne({ _id: team._id }, { $set: { ownerPrincipalId: me, ownerHistory: [...close(team.ownerHistory), { principalId: me, from: t, to: null }], updatedAt: t }, $inc: { version: 1 } }, { session: s });
        const oldM = await this.c.teamMemberships.findOne({ teamId: team._id, principalId: tr.fromPrincipalId, to: null }, { session: s });
        const newM = await this.c.teamMemberships.findOne({ teamId: team._id, principalId: me, to: null }, { session: s });
        if (!newM) throw new DomainError('CONFLICT', 'the new owner is no longer a member');
        if (oldM) await this.setRole(s, team, oldM, 'manager', me, rid);
        else await this.revokeIn(s, tr.fromPrincipalId, 'team_owner', scope, me, rid, 'ownership transferred');
        await this.setRole(s, team, newM, 'owner', me, rid);
      } else {
        const org = await this.c.organizations.findOne({ _id: tr.targetId }, { session: s });
        if (!org || org.ownerPrincipalId !== tr.fromPrincipalId) throw new DomainError('CONFLICT', 'the organization owner changed; request a new transfer');
        await this.c.organizations.updateOne({ _id: org._id }, { $set: { ownerPrincipalId: me, ownerHistory: [...close(org.ownerHistory), { principalId: me, from: t, to: null }], updatedAt: t }, $inc: { version: 1 } }, { session: s });
        await this.revokeIn(s, tr.fromPrincipalId, 'team_owner', scope, me, rid, 'ownership transferred');
        await this.grantIn(s, me, 'team_owner', scope, me, rid, 'ownership transferred');
      }
      await this.au(s, me, 'ownership.transfer.accept', { type: tr.targetType, id: tr.targetId }, scope, { from: tr.fromPrincipalId, to: me, responsibilities: tr.responsibilities }, rid);
      await this.ev(s, 'team.ownership.transferred', { type: tr.targetType, id: tr.targetId }, r.version, me, { targetType: tr.targetType, targetId: tr.targetId, from: tr.fromPrincipalId, to: me }, rid);
      return r;
    });
  }

  // ---------------------------------------------------------------- calendar (TEAM-007)
  calendarView(e: TeamCalendarEventDoc) {
    return { id: e._id, teamId: e.teamId, kind: e.kind, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, note: e.note, refId: e.refId, createdBy: e.createdBy, version: e.version };
  }

  async addCalendarEvent(me: string, teamId: string, input: { kind: TeamCalendarEventDoc['kind']; title: string; startsAt: string; endsAt: string; note: string | null; refId: string | null }, rid: string) {
    await this.ct.acl.require(me, 'team.manage', teamScope(teamId), rid);
    const a = Date.parse(input.startsAt);
    const b = Date.parse(input.endsAt);
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) throw new DomainError('VALIDATION_FAILED', 'endsAt must be after startsAt (ISO instants)');
    const doc: TeamCalendarEventDoc = { _id: newId('cal'), teamId, kind: input.kind, title: input.title, startsAt: new Date(a).toISOString(), endsAt: new Date(b).toISOString(), note: input.note, refId: input.refId, createdBy: me, createdAt: now(), version: 0 };
    await this.ct.dbh.withTransaction(async (s) => {
      await this.c.teamCalendar.insertOne(doc, { session: s });
      await this.au(s, me, 'team.calendar.add', { type: 'team', id: teamId }, teamScope(teamId), { eventId: doc._id, kind: doc.kind }, rid);
    });
    return doc;
  }

  async deleteCalendarEvent(me: string, teamId: string, eventId: string, rid: string): Promise<void> {
    await this.ct.acl.require(me, 'team.manage', teamScope(teamId), rid);
    await this.ct.dbh.withTransaction(async (s) => {
      const r = await this.c.teamCalendar.deleteOne({ _id: eventId, teamId }, { session: s });
      if (r.deletedCount === 0) throw new DomainError('NOT_FOUND', 'calendar entry not found');
      await this.au(s, me, 'team.calendar.delete', { type: 'team', id: teamId }, teamScope(teamId), { eventId }, rid);
    });
  }

  async listCalendar(me: string, teamId: string, rid: string) {
    await this.getTeam(teamId);
    const isMember = await this.c.teamMemberships.findOne({ teamId, principalId: me, to: null }, { projection: { _id: 1 } });
    if (!isMember) await this.ct.acl.require(me, 'team.read_private', teamScope(teamId), rid);
    return (await this.c.teamCalendar.find({ teamId }).sort({ startsAt: 1 }).limit(500).toArray()).map((e) => this.calendarView(e));
  }
}
