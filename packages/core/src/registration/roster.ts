import { DomainError, type Scope } from '@esp/contracts';
import type { Container } from '../container.js';
import type { CheckinDoc, DisciplineConfig, RegistrationDoc, RosterLockDoc, SubstitutionDoc } from '../db/collections-esp03.js';
import { newId } from '../ids.js';
import { getMembershipAt } from '../teams/teams.js';

/**
 * Roster locks and substitutions (ROS-001..006) and check-in (CHK-001..004).
 * A lock is an immutable snapshot of the confirmed lineup at event/stage/match level; it is never overwritten,
 * so honors can be attributed to the historical roster (ROS-006). Substitution rules come only from the frozen
 * rules package of the discipline (no platform-wide defaults).
 */
const iso = () => new Date().toISOString();
type Clause = { key: string; value: unknown };

export class RosterService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private scope(eventId: string): Scope {
    return { type: 'event', id: eventId };
  }

  private async registrationsAt(level: 'event' | 'stage' | 'match', ref: string): Promise<{ eventId: string; regs: RegistrationDoc[] }> {
    if (level === 'event') return { eventId: ref, regs: await this.c.registrations.find({ eventId: ref, state: 'confirmed' }).toArray() };
    if (level === 'stage') {
      const st = await this.c.stages.findOne({ _id: ref });
      if (!st) throw new DomainError('NOT_FOUND', 'stage not found');
      return { eventId: st.eventId, regs: await this.c.registrations.find({ disciplineId: st.disciplineId, state: 'confirmed' }).toArray() };
    }
    const m = await this.c.matches.findOne({ _id: ref });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    const pids = m.sides.map((s) => s.participationId);
    return { eventId: m.eventId, regs: await this.c.registrations.find({ participationId: { $in: pids }, state: 'confirmed' }).toArray() };
  }

  /** ROS-003: locks every confirmed lineup at a level. Idempotent; an existing lock is never replaced. */
  async lock(level: 'event' | 'stage' | 'match', ref: string, actor: string, requestId: string): Promise<RosterLockDoc[]> {
    const { eventId, regs } = await this.registrationsAt(level, ref);
    await this.ct.acl.require(actor, 'match.manage', this.scope(eventId), requestId);
    const out: RosterLockDoc[] = [];
    for (const r of regs) {
      const doc: RosterLockDoc = { _id: `${level}:${ref}:${r._id}`, level, ref, registrationId: r._id, members: r.roster.filter((m) => m.status === 'confirmed').map((m) => ({ principalId: m.principalId, displayName: m.displayName, role: m.role })), lockedAt: iso(), lockedBy: actor };
      await this.c.rosterLocks.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
      out.push((await this.c.rosterLocks.findOne({ _id: doc._id }))!);
    }
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'roster.lock', target: { type: level, id: ref }, scope: this.scope(eventId), outcome: 'success', details: { count: regs.length }, requestId });
    return out;
  }

  /** ROS-004/005: regular, between-maps and emergency substitutions with eligibility, season cap and accountability. */
  async substitute(registrationId: string, input: { kind: SubstitutionDoc['kind']; outPrincipalId: string; inPrincipalId: string; matchId: string | null; reason: string | null }, actor: string, requestId: string): Promise<SubstitutionDoc> {
    const r = await this.c.registrations.findOne({ _id: registrationId });
    if (!r || r.state !== 'confirmed') throw new DomainError('PRECONDITION_FAILED', 'only confirmed registrations can substitute');
    const d = (await this.c.disciplines.findOne({ _id: r.disciplineId }))!;
    const e = (await this.c.events.findOne({ _id: r.eventId }))!;
    const clauses = (d.rulesSnapshot?.clauses ?? []) as Clause[];
    const rule = (k: string) => clauses.find((c) => c.key === k)?.value ?? null;
    const out = r.roster.find((m) => m.principalId === input.outPrincipalId && m.status === 'confirmed');
    if (!out) throw new DomainError('VALIDATION_FAILED', 'the outgoing player is not on the confirmed roster');
    if (input.kind === 'emergency') {
      await this.ct.acl.require(actor, 'match.manage', this.scope(r.eventId), requestId); // ROS-004: responsible official
      if (!input.reason || input.reason.length < 5) throw new DomainError('VALIDATION_FAILED', 'emergency substitutions need a reason');
    } else if (r.teamId) await this.ct.acl.require(actor, 'team.roster.manage', { type: 'team', id: r.teamId }, requestId);
    else throw new DomainError('PRECONDITION_FAILED', 'individual registrations have no substitutions');
    const eventLock = await this.c.rosterLocks.findOne({ _id: `event:${r.eventId}:${r._id}` });
    if (input.kind === 'regular' && eventLock && rule('substitution.regular_after_lock') !== true) throw new DomainError('PRECONDITION_FAILED', 'roster is locked; regular substitutions are not allowed by the rules package', { clause: 'substitution.regular_after_lock' });
    if (input.kind === 'between_maps') {
      if (rule('substitution.between_maps_allowed') !== true) throw new DomainError('PRECONDITION_FAILED', 'the rules package does not allow between-map substitutions', { clause: 'substitution.between_maps_allowed' });
      if (!input.matchId) throw new DomainError('VALIDATION_FAILED', 'matchId is required');
      const lock = await this.c.rosterLocks.findOne({ _id: `match:${input.matchId}:${r._id}` });
      if (!lock?.members.some((m) => m.principalId === input.inPrincipalId)) throw new DomainError('PRECONDITION_FAILED', 'between-map substitutes must be on the locked match roster');
    }
    // eligibility of the incoming player (ROS-005)
    if (r.teamId) {
      const members = await getMembershipAt(this.c, r.teamId, iso());
      if (!members.some((m) => m.principalId === input.inPrincipalId)) throw new DomainError('PRECONDITION_FAILED', 'the incoming player is not a current team member');
    }
    const other = await this.c.registrations.findOne({ disciplineId: r.disciplineId, _id: { $ne: r._id }, state: { $in: ['awaiting_review', 'awaiting_payment', 'confirmed'] }, roster: { $elemMatch: { principalId: input.inPrincipalId, status: { $ne: 'declined' } } } });
    if (other && rule('roster.multi_team_allowed') !== true) throw new DomainError('PRECONDITION_FAILED', 'the incoming player already plays for another registration in this competition');
    const cap = d.config.seasonChangeCap;
    if (cap !== null) {
      const used = await this.c.substitutions.countDocuments({ registrationId: r._id, kind: { $ne: 'between_maps' }, ...(e.config.seasonId ? { seasonId: e.config.seasonId } : {}) });
      if (used >= cap) throw new DomainError('PRECONDITION_FAILED', `season change cap (${cap}) reached`);
    }
    const prof = await this.c.profiles.findOne({ _id: input.inPrincipalId }, { projection: { nickname: 1 } });
    const sub: SubstitutionDoc = { _id: newId('sub'), registrationId: r._id, kind: input.kind, outPrincipalId: input.outPrincipalId, inPrincipalId: input.inPrincipalId, matchId: input.matchId, reason: input.reason, approvedBy: input.kind === 'emergency' ? actor : null, seasonId: e.config.seasonId, createdBy: actor, createdAt: iso() };
    await this.ct.dbh.withTransaction(async (session) => {
      await this.c.substitutions.insertOne(sub, { session });
      if (input.kind !== 'between_maps') {
        const roster = r.roster.map((m) => (m.principalId === input.outPrincipalId ? { ...m, role: 'substitute' as const, status: 'declined' as const } : m)).filter((m) => m.principalId !== input.inPrincipalId);
        // the incoming player confirms personally unless an official made an emergency change
        roster.push({ principalId: input.inPrincipalId, displayName: prof?.nickname ?? input.inPrincipalId, role: out.role, status: input.kind === 'emergency' ? 'confirmed' : 'invited', confirmedAt: input.kind === 'emergency' ? iso() : null });
        const upd = await this.c.registrations.updateOne({ _id: r._id, version: r.version }, { $set: { roster, updatedAt: iso() }, $inc: { version: 1 } }, { session });
        if (!upd.modifiedCount) throw new DomainError('VERSION_CONFLICT', 'registration changed concurrently');
      }
      await this.ct.audit.append({ actorPrincipalId: actor, action: `roster.substitute.${input.kind}`, target: { type: 'registration', id: r._id }, scope: this.scope(r.eventId), outcome: 'success', details: { out: input.outPrincipalId, in: input.inPrincipalId, matchId: input.matchId, reason: input.reason }, requestId }, session);
    });
    return sub;
  }

  // ------------------------------------------------------------------ check-in (CHK-001..004)
  private async window(level: 'event' | 'stage' | 'match', ref: string, eventId: string) {
    const e = (await this.c.events.findOne({ _id: eventId }))!;
    let at: string | null = e.startsAt;
    let disciplineId: string | null = null;
    if (level === 'match') {
      const m = await this.c.matches.findOne({ _id: ref });
      at = m?.scheduledAt ?? null;
      disciplineId = m?.disciplineId ?? null;
    } else if (level === 'stage') disciplineId = (await this.c.stages.findOne({ _id: ref }))?.disciplineId ?? null;
    return { at, disciplineId };
  }

  async checkIn(level: 'event' | 'stage' | 'match', ref: string, actor: string, requestId: string, now = new Date()): Promise<CheckinDoc> {
    const { eventId, regs } = await this.registrationsAt(level, ref);
    const r = regs.find((x) => x.roster.some((m) => m.principalId === actor && m.status === 'confirmed'));
    if (!r) throw new DomainError('FORBIDDEN', 'you are not on a confirmed roster here');
    const d = (await this.c.disciplines.findOne({ _id: r.disciplineId }))!;
    const cfg = d.config.checkin;
    if (!cfg) throw new DomainError('PRECONDITION_FAILED', 'check-in is not enabled for this competition');
    const { at } = await this.window(level, ref, eventId);
    if (!at) throw new DomainError('PRECONDITION_FAILED', 'no scheduled time to check in for');
    const t = Date.parse(at);
    const opens = t - cfg.opensMinutesBefore * 60_000;
    const closes = t - cfg.closesMinutesBefore * 60_000;
    const graceEnd = closes + cfg.graceMinutes * 60_000;
    const n = now.getTime();
    if (n < opens) throw new DomainError('PRECONDITION_FAILED', 'check-in is not open yet', { opensAt: new Date(opens).toISOString() });
    if (n > graceEnd) throw new DomainError('PRECONDITION_FAILED', 'check-in has closed', { closedAt: new Date(graceEnd).toISOString() });
    const member = r.roster.find((m) => m.principalId === actor)!;
    const isCaptain = r.applicantPrincipalId === actor || member.role === 'manager';
    if (cfg.policy === 'captain' && !isCaptain) throw new DomainError('FORBIDDEN', 'only the captain checks in for this competition');
    const id = `${level}:${ref}:${r._id}`;
    await this.c.checkins.updateOne({ _id: id }, { $setOnInsert: { _id: id, level, ref, registrationId: r._id, members: [], state: 'pending', decidedBy: null, reason: null, updatedAt: iso(), version: 0 } }, { upsert: true });
    await this.c.checkins.updateOne({ _id: id, 'members.principalId': { $ne: actor } }, { $push: { members: { principalId: actor, at: now.toISOString(), by: actor, manual: false } }, $set: { updatedAt: iso() }, $inc: { version: 1 } });
    return this.evaluate(id, r, cfg, n > closes, d.rulesSnapshot?.clauses as Clause[] | undefined);
  }

  /** CHK-002: the registration is checked in when the policy and the minimum lineup are satisfied. */
  private async evaluate(id: string, r: RegistrationDoc, cfg: NonNullable<DisciplineConfig['checkin']>, late: boolean, clauses: Clause[] | undefined): Promise<CheckinDoc> {
    const c = (await this.c.checkins.findOne({ _id: id }))!;
    if (c.state !== 'pending') return c;
    const starters = r.roster.filter((m) => m.role === 'starter' && m.status === 'confirmed').map((m) => m.principalId);
    const present = c.members.filter((m) => starters.includes(m.principalId) || m.principalId === r.applicantPrincipalId).length;
    const minRoster = clauses?.find((x) => x.key === 'roster.min')?.value;
    const needed = cfg.policy === 'captain' ? 1 : cfg.policy === 'all_members' ? starters.length : (cfg.minMembers ?? starters.length);
    const satisfied = present >= needed && (typeof minRoster !== 'number' || cfg.policy === 'captain' || present >= minRoster);
    if (!satisfied) return c;
    const upd = await this.c.checkins.findOneAndUpdate({ _id: id, state: 'pending' }, { $set: { state: late ? 'late' : 'checked_in', updatedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' });
    return upd ?? (await this.c.checkins.findOne({ _id: id }))!;
  }

  /** CHK-003: manual record by an operator with a reason (also used to excuse or mark no-show). */
  async manual(level: 'event' | 'stage' | 'match', ref: string, registrationId: string, outcome: CheckinDoc['state'], reason: string, actor: string, requestId: string): Promise<CheckinDoc> {
    const { eventId, regs } = await this.registrationsAt(level, ref);
    await this.ct.acl.require(actor, 'match.manage', this.scope(eventId), requestId);
    if (!regs.some((r) => r._id === registrationId)) throw new DomainError('NOT_FOUND', 'registration is not part of this check-in');
    const id = `${level}:${ref}:${registrationId}`;
    await this.c.checkins.updateOne({ _id: id }, { $setOnInsert: { _id: id, level, ref, registrationId, members: [], state: 'pending', decidedBy: null, reason: null, updatedAt: iso(), version: 0 } }, { upsert: true });
    const upd = await this.c.checkins.findOneAndUpdate({ _id: id }, { $set: { state: outcome, decidedBy: actor, reason, updatedAt: iso() }, $push: { members: { principalId: actor, at: iso(), by: actor, manual: true } }, $inc: { version: 1 } }, { returnDocument: 'after' });
    await this.ct.audit.append({ actorPrincipalId: actor, action: `checkin.manual.${outcome}`, target: { type: 'registration', id: registrationId }, scope: this.scope(eventId), outcome: 'success', details: { level, ref, reason }, requestId });
    return upd!;
  }

  /** CHK-003/004: after the grace period, pending check-ins become no-shows (consequences are decided per rules by staff/ESP-04). */
  async finalizeNoShows(level: 'event' | 'stage' | 'match', ref: string, actor: string, requestId: string, now = new Date()): Promise<CheckinDoc[]> {
    const { eventId, regs } = await this.registrationsAt(level, ref);
    if (actor !== 'system') await this.ct.acl.require(actor, 'match.manage', this.scope(eventId), requestId);
    const out: CheckinDoc[] = [];
    for (const r of regs) {
      const d = (await this.c.disciplines.findOne({ _id: r.disciplineId }))!;
      const cfg = d.config.checkin;
      if (!cfg) continue;
      const { at } = await this.window(level, ref, eventId);
      if (!at || now.getTime() <= Date.parse(at) - cfg.closesMinutesBefore * 60_000 + cfg.graceMinutes * 60_000) continue;
      const id = `${level}:${ref}:${r._id}`;
      await this.c.checkins.updateOne({ _id: id }, { $setOnInsert: { _id: id, level, ref, registrationId: r._id, members: [], state: 'pending', decidedBy: null, reason: null, updatedAt: iso(), version: 0 } }, { upsert: true });
      const upd = await this.c.checkins.findOneAndUpdate({ _id: id, state: 'pending' }, { $set: { state: 'no_show', decidedBy: actor, reason: 'grace period elapsed', updatedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' });
      if (upd) {
        out.push(upd);
        await this.ct.outbox.append({ type: 'registration.checkin.no_show', aggregate: { type: 'registration', id: r._id }, aggregateVersion: r.version, actor: { principalId: actor, kind: 'system' }, payload: { level, ref, registrationId: r._id, eventId }, correlationId: requestId });
      }
    }
    return out;
  }

  async status(level: 'event' | 'stage' | 'match', ref: string): Promise<CheckinDoc[]> {
    return this.c.checkins.find({ level, ref }).toArray();
  }
}
