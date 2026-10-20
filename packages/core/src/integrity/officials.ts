import { DomainError, type Role } from '@esp/contracts';
import type { Container } from '../container.js';
import type { MatchDoc } from '../db/collections.js';
import type { OfficialDoc } from '../db/collections-esp05.js';
import { newId } from '../ids.js';

const iso = () => new Date().toISOString();

/**
 * Conflict of interest (REF-001): a principal is conflicted for a match when they are on either roster, an active
 * member of either side's team, or the owner of that team's organization. For event-level cases the parties' teams
 * are checked the same way.
 */
export async function conflictedFor(ct: Container, principalId: string, m: Pick<MatchDoc, 'principalIds' | 'participantIds'> | null, parties: string[] = []): Promise<string | null> {
  if (m?.principalIds?.includes(principalId) || parties.includes(principalId)) return 'is a party to the match or case';
  const partIds = m?.participantIds ?? [];
  const parts = partIds.length ? await ct.c.participations.find({ _id: { $in: partIds } }, { projection: { 'snapshot.teamId': 1 } }).toArray() : [];
  const partyTeams = parties.length ? (await ct.c.teamMemberships.find({ principalId: { $in: parties }, to: null }, { projection: { teamId: 1 } }).toArray()).map((x) => x.teamId) : [];
  const teamIds = [...new Set([...parts.map((p) => p.snapshot.teamId).filter((x): x is string => !!x), ...partyTeams])];
  if (!teamIds.length) return null;
  if (await ct.c.teamMemberships.findOne({ teamId: { $in: teamIds }, principalId, to: null })) return 'is a member of a team involved';
  const teams = await ct.c.teams.find({ _id: { $in: teamIds } }, { projection: { organizationId: 1 } }).toArray();
  const orgIds = teams.map((t) => t.organizationId).filter((x): x is string => !!x);
  if (orgIds.length && (await ct.c.organizations.findOne({ _id: { $in: orgIds }, ownerPrincipalId: principalId }))) return 'owns an organization involved';
  return null;
}

/**
 * REF-001: appointments of referees, head referees and appeal authorities. Each appointment creates a scoped grant
 * (so the ACL enforces it), refuses conflicted people, and refuses a referee double-booked at an overlapping match
 * unless someone with `schedule.override` gives a reason.
 */
export class OfficialsService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }

  async assign(input: { eventId: string; matchId: string | null; principalId: string; role: OfficialDoc['role']; overrideReason?: string | null | undefined }, actor: string, requestId: string): Promise<OfficialDoc> {
    await this.ct.acl.require(actor, 'acl.grant', { type: 'event', id: input.eventId }, requestId);
    const p = await this.c.principals.findOne({ _id: input.principalId, status: 'active' });
    if (!p) throw new DomainError('NOT_FOUND', 'principal not found or inactive');
    let m: MatchDoc | null = null;
    if (input.matchId) {
      m = await this.c.matches.findOne({ _id: input.matchId, eventId: input.eventId });
      if (!m) throw new DomainError('NOT_FOUND', 'match not found in this event');
      if (input.role === 'appeal_authority') throw new DomainError('VALIDATION_FAILED', 'appeal authorities are appointed for the event');
      const conflict = await conflictedFor(this.ct, input.principalId, m);
      if (conflict) throw new DomainError('CONFLICT', `conflict of interest: the official ${conflict}`);
      if (m.scheduledAt && input.role === 'referee') {
        const start = Date.parse(m.scheduledAt);
        const end = start + Math.max(m.schedule?.durationMinutes ?? 0, 30) * 60_000;
        const busy = await this.c.matches.find({ _id: { $ne: m._id }, 'resources.refereeIds': input.principalId, scheduledAt: { $ne: null }, state: { $nin: ['final', 'cancelled'] } }).toArray();
        const clash = busy.find((o) => {
          const s = Date.parse(o.scheduledAt!);
          return s < end && start < s + Math.max(o.schedule?.durationMinutes ?? 0, 30) * 60_000;
        });
        if (clash) {
          if (!input.overrideReason || input.overrideReason.trim().length < 5) throw new DomainError('CONFLICT', `referee already assigned to overlapping match ${clash._id}`);
          await this.ct.acl.require(actor, 'schedule.override', { type: 'event', id: input.eventId }, requestId);
        }
      }
    }
    const grant = await this.ct.acl.grant({ principalId: input.principalId, role: input.role as Role, scope: m ? { type: 'match', id: m._id } : { type: 'event', id: input.eventId }, expiresAt: null, reason: `official appointment${input.overrideReason ? ` (override: ${input.overrideReason})` : ''}` }, { principalId: actor, requestId });
    const doc: OfficialDoc = { _id: newId('ofc'), eventId: input.eventId, matchId: input.matchId, principalId: input.principalId, role: input.role, grantId: grant._id, assignedBy: actor, at: iso(), active: true };
    try {
      await this.c.officials.insertOne(doc);
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'already appointed in this role');
      throw e;
    }
    if (m && input.role === 'referee') await this.c.matches.updateOne({ _id: m._id }, { $addToSet: { 'resources.refereeIds': input.principalId }, $inc: { version: 1 } });
    if (m && input.role === 'head_referee') await this.c.matches.updateOne({ _id: m._id }, { $set: { headRefereeId: input.principalId }, $inc: { version: 1 } });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'official.assign', target: { type: m ? 'match' : 'event', id: m?._id ?? input.eventId }, scope: { type: 'event', id: input.eventId }, outcome: 'success', details: { principalId: input.principalId, role: input.role, override: input.overrideReason ?? null }, requestId });
    return doc;
  }

  async unassign(officialId: string, actor: string, requestId: string): Promise<void> {
    const o = await this.c.officials.findOne({ _id: officialId, active: true });
    if (!o) throw new DomainError('NOT_FOUND', 'appointment not found');
    await this.ct.acl.require(actor, 'acl.revoke', { type: 'event', id: o.eventId }, requestId);
    if (o.grantId) await this.ct.acl.revoke(o.grantId, { principalId: actor, requestId }, 'appointment ended').catch(() => undefined);
    await this.c.officials.updateOne({ _id: o._id }, { $set: { active: false } });
    if (o.matchId && o.role === 'referee') await this.c.matches.updateOne({ _id: o.matchId }, { $pull: { 'resources.refereeIds': o.principalId }, $inc: { version: 1 } });
    if (o.matchId && o.role === 'head_referee') await this.c.matches.updateOne({ _id: o.matchId }, { $set: { headRefereeId: null }, $inc: { version: 1 } });
  }

  async list(eventId: string, actor: string, requestId: string): Promise<OfficialDoc[]> {
    await this.ct.acl.require(actor, 'event.read_private', { type: 'event', id: eventId }, requestId);
    return this.c.officials.find({ eventId, active: true }).sort({ at: 1 }).toArray();
  }

  async appealAuthorities(eventId: string): Promise<string[]> {
    return (await this.c.officials.find({ eventId, role: 'appeal_authority', active: true }).toArray()).map((o) => o.principalId);
  }
}
