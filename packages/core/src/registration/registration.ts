import { randomBytes } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import type { z } from 'zod';
import { DomainError, registrationMachine, type RegistrationCreateSchema, type RegistrationState, type Role, type Scope } from '@esp/contracts';
import type { Container } from '../container.js';
import type { DisciplineDoc, EventDoc, ParticipationDoc } from '../db/collections.js';
import type { RegistrationDoc } from '../db/collections-esp03.js';
import { applyTransition, assertTransitionAllowed } from '../domain/transition.js';
import { newId } from '../ids.js';
import { PaymentsService } from '../finance/payments.js';
import { RulesService } from '../rules/rules.js';
import { getMembershipAt } from '../teams/teams.js';


/**
 * Registration (REG-001..010), roster confirmation (ROS-002) and the chapter-15 registration flow:
 * eligibility → roster → rules acceptance → atomic capacity reservation → payment → review → confirmation.
 *
 * Capacity: one counter per (discipline, quota) holds `held + confirmed ≤ capacity`; every reservation is a single
 * conditional `$inc` inside the same transaction as the registration write, and is released exactly once
 * (`reservation.released`). Races between expiry, late payment, withdrawal and promotion are resolved by
 * version-checked transitions: the loser re-reads and follows the explicit late-payment policy (REG-010):
 * allocate free capacity or refund — never confirm without capacity.
 */
const iso = () => new Date().toISOString();
const ACTIVE: RegistrationState[] = ['incomplete', 'awaiting_payment', 'awaiting_review', 'awaiting_capacity', 'confirmed'];
const APPLICANT_ROLES: Role[] = ['player', 'team_captain', 'team_manager', 'team_owner'];

type Clause = { key: string; kind: string; value: unknown };
const clauseValue = (clauses: Clause[] | undefined, key: string): unknown => clauses?.find((c) => c.key === key)?.value ?? null;

function trackingCode(): string {
  const a = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const b = randomBytes(8);
  return 'R-' + Array.from(b, (x) => a[x % a.length]).join('');
}

export class RegistrationService {
  private readonly payments: PaymentsService;
  constructor(private readonly ct: Container) {
    this.payments = new PaymentsService(ct);
  }
  private get c() {
    return this.ct.c;
  }
  private eventScope(eventId: string): Scope {
    return { type: 'event', id: eventId };
  }

  async load(id: string): Promise<RegistrationDoc> {
    const r = await this.c.registrations.findOne({ $or: [{ _id: id }, { trackingCode: id }] });
    if (!r) throw new DomainError('NOT_FOUND', 'registration not found');
    return r;
  }

  private async context(disciplineId: string): Promise<{ d: DisciplineDoc; e: EventDoc }> {
    const d = await this.c.disciplines.findOne({ _id: disciplineId });
    if (!d) throw new DomainError('NOT_FOUND', 'discipline not found');
    const e = await this.c.events.findOne({ _id: d.eventId });
    if (!e) throw new DomainError('NOT_FOUND', 'event not found');
    return { d, e };
  }

  private async staffRoles(actor: string, eventId: string): Promise<Role[]> {
    const grants = await this.ct.acl.activeGrants(actor);
    const ctx = await this.ct.acl.resourceContext(this.eventScope(eventId));
    const chain = [ctx.scope, ...ctx.ancestors];
    return grants.filter((g) => chain.some((a) => a.type === g.scope.type && a.id === g.scope.id)).map((g) => g.role);
  }

  private async audit(actor: string, action: string, r: Pick<RegistrationDoc, '_id' | 'eventId'>, requestId: string, details: Record<string, unknown> = {}, session?: ClientSession) {
    await this.ct.audit.append({ actorPrincipalId: actor, action, target: { type: 'registration', id: r._id }, scope: this.eventScope(r.eventId), outcome: 'success', details, requestId }, session);
  }

  private async event(type: string, r: RegistrationDoc, actor: string, requestId: string, session: ClientSession, payload: Record<string, unknown> = {}) {
    await this.ct.outbox.append({ type, aggregate: { type: 'registration', id: r._id }, aggregateVersion: r.version, actor: { principalId: actor, kind: actor.startsWith('system') ? 'system' : 'user' }, payload: { registrationId: r._id, eventId: r.eventId, disciplineId: r.disciplineId, state: r.state, applicant: r.applicantPrincipalId, ...payload }, correlationId: requestId }, session);
  }

  // ------------------------------------------------------------------ eligibility (REG-002/003)
  async eligibility(d: DisciplineDoc, kind: 'team' | 'player', teamId: string | null, roster: Array<{ principalId: string; role: string }>, excludeRegistrationId: string | null): Promise<RegistrationDoc['eligibility']> {
    const clauses = d.rulesSnapshot?.clauses as Clause[] | undefined;
    const issues: RegistrationDoc['eligibility']['issues'] = [];
    const add = (code: string, message: string, clause: string | null, needsReview = false) => issues.push({ code, message, clause, needsReview });
    const starters = roster.filter((m) => m.role === 'starter');
    const subs = roster.filter((m) => m.role === 'substitute');
    const min = clauseValue(clauses, 'roster.min');
    const max = clauseValue(clauses, 'roster.max');
    const maxSubs = clauseValue(clauses, 'roster.substitutes');
    if (typeof min === 'number' && starters.length < min) add('roster_min', `at least ${min} starters required`, 'roster.min');
    if (typeof max === 'number' && starters.length > max) add('roster_max', `at most ${max} starters allowed`, 'roster.max');
    if (typeof maxSubs === 'number' && subs.length > maxSubs) add('roster_substitutes', `at most ${maxSubs} substitutes allowed`, 'roster.substitutes');
    if (kind === 'team') {
      if (!teamId) add('team_required', 'team registration needs a team', null);
      else {
        const members = await getMembershipAt(this.c, teamId, iso());
        for (const m of roster) if (!members.some((x) => x.principalId === m.principalId)) add('not_member', `${m.principalId} is not a current team member`, null);
      }
    }
    const ids = roster.map((m) => m.principalId);
    const principals = await this.c.principals.find({ _id: { $in: ids } }).toArray();
    for (const id of ids) {
      const p = principals.find((x) => x._id === id);
      if (!p || p.status !== 'active') add('inactive_account', `${id} is not an active account`, null);
    }
    // REG-003: playing for several teams in the same competition is controlled by the rules package
    if (clauseValue(clauses, 'roster.multi_team_allowed') !== true) {
      const clash = await this.c.registrations.find({ disciplineId: d._id, state: { $in: ACTIVE }, 'roster.principalId': { $in: ids }, ...(excludeRegistrationId ? { _id: { $ne: excludeRegistrationId } } : {}) }).toArray();
      for (const r of clash) for (const m of r.roster) if (ids.includes(m.principalId) && m.status !== 'declined') add('multi_registration', `${m.principalId} already plays in ${r.trackingCode}`, 'roster.multi_team_allowed');
    }
    if (clauseValue(clauses, 'eligibility.game_identity_required') === true) {
      for (const id of ids) {
        const gi = await this.c.gameIdentities.findOne({ principalId: id, gameId: d.gameId, active: true, 'verification.state': { $nin: ['disputed', 'rejected'] } });
        if (!gi) add('game_identity', `${id} has no usable game identity for this game`, 'eligibility.game_identity_required');
      }
    }
    const minAge = clauseValue(clauses, 'age.minimum');
    // no birth date is collected until an identity-document policy is approved (OPS-002): age goes to human review
    if (typeof minAge === 'number') add('age_review', `minimum age ${minAge} must be verified by staff`, 'age.minimum', true);
    const regions = clauseValue(clauses, 'eligibility.regions');
    if (Array.isArray(regions) && regions.length) {
      for (const id of ids) {
        const prof = await this.c.profiles.findOne({ _id: id }, { projection: { province: 1 } });
        if (!prof?.province) add('region_unknown', `${id} has no province on the profile`, 'eligibility.regions', true);
        else if (!regions.includes(prof.province)) add('region', `${id} is outside the allowed regions`, 'eligibility.regions');
      }
    }
    if (clauseValue(clauses, 'eligibility.min_rank') !== null) add('rank_review', 'rank requirement is checked by staff until ranking is available (ESP-05)', 'eligibility.min_rank', true);
    // suspensions/sanctions are issued in ESP-05; until then only account status applies
    return { ok: !issues.some((i) => !i.needsReview), issues, checkedAt: iso() };
  }

  // ------------------------------------------------------------------ capacity
  private async nextWaitlistSeq(session: ClientSession): Promise<number> {
    return (await this.c.counters.findOneAndUpdate({ _id: 'waitlist_seq' }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after', session }))!.value;
  }

  private async reserve(counterId: string, session: ClientSession): Promise<boolean> {
    const r = await this.c.capacityCounters.findOneAndUpdate({ _id: counterId, $expr: { $lt: [{ $add: ['$held', '$confirmed'] }, '$capacity'] } }, { $inc: { held: 1, version: 1 } }, { returnDocument: 'after', session });
    return !!r;
  }

  /** Releases this registration's capacity unit exactly once (guarded by `reservation.released`). */
  private async release(reg: RegistrationDoc, session: ClientSession): Promise<boolean> {
    if (!reg.reservation || reg.reservation.released) return false;
    const marked = await this.c.registrations.updateOne({ _id: reg._id, 'reservation.released': false }, { $set: { 'reservation.released': true } }, { session });
    if (!marked.modifiedCount) return false;
    await this.c.capacityCounters.updateOne({ _id: reg.reservation.counterId }, { $inc: { [reg.reservation.confirmed ? 'confirmed' : 'held']: -1, version: 1 } }, { session });
    return true;
  }

  // ------------------------------------------------------------------ create (REG-001/005/006/009)
  async create(disciplineId: string, input: z.infer<typeof RegistrationCreateSchema>, actor: string, requestId: string): Promise<RegistrationDoc> {
    const { d, e } = await this.context(disciplineId);
    const now = iso();
    if (e.state !== 'registration_open') throw new DomainError('PRECONDITION_FAILED', 'registration is not open for this event');
    const cfg = d.config;
    const regular = (!cfg.registrationOpensAt || cfg.registrationOpensAt <= now) && (!cfg.registrationClosesAt || now < cfg.registrationClosesAt);
    const late = !regular && !!cfg.lateRegistrationUntil && cfg.registrationClosesAt !== null && now >= cfg.registrationClosesAt && now < cfg.lateRegistrationUntil;
    if (!regular && !late) throw new DomainError('PRECONDITION_FAILED', 'outside the registration window');
    if (!d.rulesSnapshot) throw new DomainError('PRECONDITION_FAILED', 'discipline has no frozen rules');
    if (input.acceptRulesHash !== d.rulesSnapshot.hash) throw new DomainError('PRECONDITION_FAILED', 'you must accept the current rules version shown before registration (RULE-006)', { expected: d.rulesSnapshot.hash });
    if (e.visibility === 'invite' && !input.entryCode) throw new DomainError('PRECONDITION_FAILED', 'this event is by invitation: an entry code is required');

    // form fields and documents (REG-001/008)
    for (const f of cfg.formFields) {
      const v = input.formAnswers[f.key];
      if (f.required && (v === undefined || v === '')) throw new DomainError('VALIDATION_FAILED', `form field ${f.key} is required`);
      if (v !== undefined && f.type === 'select' && f.options && !f.options.includes(String(v))) throw new DomainError('VALIDATION_FAILED', `invalid option for ${f.key}`);
    }
    for (const k of Object.keys(input.formAnswers)) if (!cfg.formFields.some((f) => f.key === k)) throw new DomainError('VALIDATION_FAILED', `unknown form field ${k}`);
    for (const doc of cfg.requiredDocuments) {
      const fid = input.documentFileIds[doc.key];
      if (!fid) throw new DomainError('VALIDATION_FAILED', `document ${doc.key} is required`);
      const f = await this.c.files.findOne({ _id: fid });
      if (!f || f.ownerPrincipalId !== actor || f.visibility !== 'private' || f.quarantined) throw new DomainError('VALIDATION_FAILED', `document ${doc.key} must be your own clean private file`);
    }

    // who registers (REG-001): the player themself, or a team staff member with roster authority
    let teamId: string | null = null;
    let displayName: string;
    if (cfg.participantKind === 'team') {
      if (!input.teamId) throw new DomainError('VALIDATION_FAILED', 'teamId is required');
      const team = await this.c.teams.findOne({ _id: input.teamId });
      if (!team) throw new DomainError('NOT_FOUND', 'team not found');
      await this.ct.acl.require(actor, 'team.roster.manage', { type: 'team', id: team._id }, requestId);
      if (team.gameId !== d.gameId && team.gameId !== 'unassigned') throw new DomainError('PRECONDITION_FAILED', 'team plays another game');
      teamId = team._id;
      displayName = team.name;
    } else {
      const prof = await this.c.profiles.findOne({ _id: actor }, { projection: { nickname: 1 } });
      displayName = prof?.nickname ?? (await this.c.principals.findOne({ _id: actor }))?.displayName ?? actor;
    }
    const holderKey = teamId ? `team:${teamId}` : `player:${actor}`;
    const rosterInput = cfg.participantKind === 'player' ? [{ principalId: actor, role: 'starter' as const }] : input.roster;
    const names = new Map((await this.c.profiles.find({ _id: { $in: rosterInput.map((m) => m.principalId) } }, { projection: { nickname: 1 } }).toArray()).map((p) => [p._id, p.nickname]));
    const roster: RegistrationDoc['roster'] = rosterInput.map((m) => ({ principalId: m.principalId, displayName: names.get(m.principalId) ?? m.principalId, role: m.role, status: m.principalId === actor ? 'confirmed' : 'invited', confirmedAt: m.principalId === actor ? now : null }));
    const eligibility = await this.eligibility(d, cfg.participantKind, teamId, roster, null);
    if (!eligibility.ok) throw new DomainError('PRECONDITION_FAILED', 'eligibility requirements are not met', { issues: eligibility.issues });

    const reg = await this.ct.dbh.withTransaction(async (session) => {
      // quota: entry code → invite/organization; qualification slot → qualifier; otherwise public
      let quotaKind = 'public';
      if (input.entryCode) {
        const code = await this.c.entryCodes.findOneAndUpdate(
          { _id: input.entryCode.toUpperCase(), disciplineId: d._id, $expr: { $lt: ['$used', '$maxUses'] }, $and: [{ $or: [{ holderKey: null }, { holderKey }] }, { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }] },
          { $inc: { used: 1 } },
          { returnDocument: 'after', session },
        );
        if (!code) throw new DomainError('PRECONDITION_FAILED', 'entry code is invalid, expired, used up or bound to someone else');
        quotaKind = code.quotaKind;
      } else {
        const slot = await this.c.qualificationSlots.findOneAndUpdate({ targetDisciplineId: d._id, holderKey, state: 'reserved' }, { $set: { state: 'claimed' }, $inc: { version: 1 } }, { returnDocument: 'after', session });
        if (slot) quotaKind = 'qualifier';
      }
      const counterId = `${d._id}:${quotaKind}`;
      if (!(await this.c.capacityCounters.findOne({ _id: counterId }, { session }))) throw new DomainError('PRECONDITION_FAILED', `no ${quotaKind} quota configured`);
      const reserved = await this.reserve(counterId, session);
      const fee = cfg.feeRial;
      const transition = !reserved ? 'join_waitlist' : fee > 0 ? 'submit_with_fee' : 'submit';
      const t = assertTransitionAllowed(registrationMachine, { transition, expectedVersion: 0, actorRoles: transition === 'join_waitlist' ? ['system'] : APPLICANT_ROLES }, 'draft');
      const r: RegistrationDoc = {
        _id: newId('reg'),
        trackingCode: trackingCode(),
        eventId: e._id,
        disciplineId: d._id,
        kind: cfg.participantKind,
        teamId,
        holderKey,
        applicantPrincipalId: actor,
        displayName,
        quotaKind,
        entryCode: input.entryCode?.toUpperCase() ?? null,
        state: t.to,
        roster,
        formAnswers: input.formAnswers,
        documentFileIds: input.documentFileIds,
        acceptedRules: { packageId: d.rulesSnapshot!.packageId, version: d.rulesSnapshot!.version, hash: d.rulesSnapshot!.hash, acceptedAt: now },
        eligibility,
        reservation: reserved ? { counterId, heldAt: now, expiresAt: fee > 0 ? new Date(Date.now() + cfg.paymentWindowMinutes * 60_000).toISOString() : null, released: false, confirmed: false } : null,
        waitlistedAt: reserved ? null : now,
        waitlistSeq: reserved ? null : await this.nextWaitlistSeq(session),
        feeRial: fee,
        orderId: null,
        participationId: null,
        late,
        history: [{ at: now, by: actor, transition, note: null }],
        createdAt: now,
        updatedAt: now,
        version: 0,
      };
      try {
        await this.c.registrations.insertOne(r, { session });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'already registered in this discipline');
        throw err;
      }
      if (reserved && fee > 0) {
        const order = await this.payments.createOrder({ kind: 'entry', payerPrincipalId: actor, items: [{ productKey: `entry:${d._id}`, description: `${e.name} — ${d.name}`, amountRial: fee, quantity: 1 }], refs: { registrationId: r._id, eventId: e._id }, productKey: `entry:${d._id}`, discountCode: null, creditAccount: `payable:organization:${e.organizerOrgId}` }, session);
        await this.c.registrations.updateOne({ _id: r._id }, { $set: { orderId: order._id } }, { session });
        r.orderId = order._id;
      }
      await this.audit(actor, `registration.${transition}`, r, requestId, { quotaKind, late }, session);
      await this.event('registration.submitted', r, actor, requestId, session, { quotaKind, waitlisted: !reserved });
      return r;
    });
    await new RulesService(this.ct).accept(actor, d.rulesSnapshot.packageId, { eventId: e._id, participationId: null }, requestId).catch(() => undefined); // RULE-006 record (frozen hash is on the registration)
    return (await this.tryAutoApprove(reg._id, requestId)) ?? reg;
  }

  // ------------------------------------------------------------------ roster confirmation (ROS-002)
  async confirmMembership(registrationId: string, decision: 'confirm' | 'decline', actor: string, requestId: string): Promise<RegistrationDoc> {
    const r = await this.load(registrationId);
    const m = r.roster.find((x) => x.principalId === actor);
    if (!m) throw new DomainError('FORBIDDEN', 'you are not on this roster');
    if (!ACTIVE.includes(r.state)) throw new DomainError('PRECONDITION_FAILED', `registration is ${r.state}`);
    const upd = await this.c.registrations.findOneAndUpdate(
      { _id: r._id, roster: { $elemMatch: { principalId: actor, status: 'invited' } } },
      { $set: { 'roster.$.status': decision === 'confirm' ? 'confirmed' : 'declined', 'roster.$.confirmedAt': iso(), updatedAt: iso() }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    );
    if (!upd) throw new DomainError('CONFLICT', 'invitation already answered');
    await this.audit(actor, `registration.roster.${decision}`, r, requestId);
    return (await this.tryAutoApprove(r._id, requestId)) ?? upd;
  }

  // ------------------------------------------------------------------ approval (REG-004)
  private approvalBlockers(r: RegistrationDoc, d: DisciplineDoc, paid: boolean, human: boolean): string[] {
    const b: string[] = [];
    if (r.state !== 'awaiting_review') b.push(`state is ${r.state}`);
    if (!r.eligibility.ok) b.push('eligibility failed');
    if (!human && r.eligibility.issues.some((i) => i.needsReview)) b.push('needs staff review');
    const starters = r.roster.filter((m) => m.role === 'starter');
    const min = clauseValue(d.rulesSnapshot?.clauses as Clause[] | undefined, 'roster.min');
    const confirmedStarters = starters.filter((m) => m.status === 'confirmed').length;
    if (typeof min === 'number' ? confirmedStarters < min : confirmedStarters < starters.length) b.push('roster members have not confirmed');
    if (r.feeRial > 0 && !paid) b.push('payment not verified');
    if (!r.reservation || r.reservation.released) b.push('no capacity reserved');
    return b;
  }

  private async tryAutoApprove(id: string, requestId: string): Promise<RegistrationDoc | null> {
    const r = await this.c.registrations.findOne({ _id: id });
    if (!r || r.state !== 'awaiting_review') return null;
    const { d } = await this.context(r.disciplineId);
    if (!d.config.autoApprove) return null;
    const paid = !r.orderId || !!(await this.c.orders.findOne({ _id: r.orderId, state: 'paid' }));
    if (this.approvalBlockers(r, d, paid, false).length) return null;
    return this.approveInternal(r, ['system'], 'system:auto-approve', requestId);
  }

  private async approveInternal(r: RegistrationDoc, roles: Array<Role | 'system'>, actor: string, requestId: string): Promise<RegistrationDoc> {
    return this.ct.dbh.withTransaction(async (session) => {
      const fresh = (await this.c.registrations.findOne({ _id: r._id }, { session }))!;
      const now = iso();
      const participation: ParticipationDoc = {
        _id: newId('ptc'),
        eventId: fresh.eventId,
        disciplineId: fresh.disciplineId,
        kind: fresh.kind,
        // DATA-002: immutable snapshot of the name and confirmed roster at confirmation time
        snapshot: { displayName: fresh.displayName, teamId: fresh.teamId, roster: fresh.roster.filter((m) => m.status === 'confirmed').map((m) => ({ principalId: m.principalId, displayName: m.displayName, role: m.role })) },
        acceptedRules: fresh.acceptedRules ? { ...fresh.acceptedRules, acceptedBy: fresh.applicantPrincipalId } : null,
        registrationState: 'confirmed',
        createdAt: now,
        updatedAt: now,
        version: 0,
      };
      const { doc } = await applyTransition(registrationMachine, this.c.registrations, fresh._id, { transition: 'approve', expectedVersion: fresh.version, actorRoles: roles }, { participationId: participation._id, 'reservation.confirmed': true, history: [...fresh.history, { at: now, by: actor, transition: 'approve', note: null }] } as Partial<RegistrationDoc>, session);
      await this.c.capacityCounters.updateOne({ _id: fresh.reservation!.counterId }, { $inc: { held: -1, confirmed: 1, version: 1 } }, { session });
      await this.c.participations.insertOne(participation, { session });
      await this.audit(actor, 'registration.approve', fresh, requestId, { participationId: participation._id }, session);
      await this.event('registration.confirmed', doc, actor, requestId, session, { participationId: participation._id });
      return doc;
    });
  }

  async decide(registrationId: string, action: 'approve' | 'reject' | 'mark_incomplete' | 'remove', reason: string | null, expectedVersion: number, actor: string, requestId: string): Promise<RegistrationDoc> {
    const r = await this.load(registrationId);
    await this.ct.acl.require(actor, 'event.manage', this.eventScope(r.eventId), requestId);
    const roles = await this.staffRoles(actor, r.eventId);
    if (r.version !== expectedVersion) throw new DomainError('VERSION_CONFLICT', 'registration changed since it was read');
    if (action !== 'approve' && !reason) throw new DomainError('VALIDATION_FAILED', 'a reason is required (REG-004)');
    const { d, e } = await this.context(r.disciplineId);
    if (action === 'approve') {
      const paid = !r.orderId || !!(await this.c.orders.findOne({ _id: r.orderId, state: 'paid' }));
      const blockers = this.approvalBlockers(r, d, paid, true);
      if (blockers.length) throw new DomainError('PRECONDITION_FAILED', 'registration cannot be approved yet', { blockers });
      return this.approveInternal(r, roles, actor, requestId);
    }
    const policy = e.config.refundPolicy;
    const refundPercent = action === 'remove' ? (policy?.onDisqualificationPercent ?? 0) : action === 'reject' ? 100 : null;
    const doc = await this.ct.dbh.withTransaction(async (session) => {
      const { doc } = await applyTransition(registrationMachine, this.c.registrations, r._id, { transition: action, expectedVersion, actorRoles: roles }, { history: [...r.history, { at: iso(), by: actor, transition: action, note: reason }] } as Partial<RegistrationDoc>, session);
      if (action !== 'mark_incomplete') await this.release(r, session);
      if (doc.participationId) await this.c.participations.updateOne({ _id: doc.participationId }, { $set: { registrationState: doc.state, updatedAt: iso() } }, { session });
      await this.audit(actor, `registration.${action}`, r, requestId, { reason }, session);
      await this.event(`registration.${action}`, doc, actor, requestId, session, { reason });
      return doc;
    });
    if (refundPercent && r.orderId) await this.payments.refundOrder(r.orderId, refundPercent, action === 'remove' ? 'disqualification' : 'manual', `reg:${r._id}:${action}`, actor, requestId);
    if (action !== 'mark_incomplete') await this.promoteWaitlist(r.disciplineId, requestId);
    return doc;
  }

  async requestReReview(registrationId: string, actor: string, requestId: string): Promise<RegistrationDoc> {
    const r = await this.load(registrationId);
    if (r.applicantPrincipalId !== actor) throw new DomainError('FORBIDDEN', 'only the applicant can ask for a re-review');
    return this.ct.dbh.withTransaction(async (session) => {
      const counterId = `${r.disciplineId}:${r.quotaKind}`;
      if (!(await this.reserve(counterId, session))) throw new DomainError('PRECONDITION_FAILED', 'no capacity left for a re-review');
      const { doc } = await applyTransition(registrationMachine, this.c.registrations, r._id, { transition: 'request_re_review', expectedVersion: r.version, actorRoles: APPLICANT_ROLES }, { reservation: { counterId, heldAt: iso(), expiresAt: null, released: false, confirmed: false }, history: [...r.history, { at: iso(), by: actor, transition: 'request_re_review', note: null }] } as Partial<RegistrationDoc>, session);
      await this.audit(actor, 'registration.request_re_review', r, requestId, {}, session);
      return doc;
    });
  }

  // ------------------------------------------------------------------ edit / withdraw (REG-007)
  async edit(registrationId: string, patch: { formAnswers?: Record<string, unknown>; documentFileIds?: Record<string, string> }, expectedVersion: number, actor: string, requestId: string): Promise<RegistrationDoc> {
    const r = await this.load(registrationId);
    if (r.applicantPrincipalId !== actor) throw new DomainError('FORBIDDEN', 'only the applicant can edit');
    const { d } = await this.context(r.disciplineId);
    if (d.config.editDeadline && iso() > d.config.editDeadline) throw new DomainError('PRECONDITION_FAILED', 'edit deadline has passed');
    if (!['incomplete', 'awaiting_review', 'awaiting_payment', 'awaiting_capacity'].includes(r.state)) throw new DomainError('PRECONDITION_FAILED', `registration is ${r.state}`);
    const set: Record<string, unknown> = { updatedAt: iso() };
    if (patch.formAnswers) {
      for (const k of Object.keys(patch.formAnswers)) if (!d.config.formFields.some((f) => f.key === k)) throw new DomainError('VALIDATION_FAILED', `unknown form field ${k}`);
      set['formAnswers'] = { ...r.formAnswers, ...patch.formAnswers };
    }
    if (patch.documentFileIds) {
      for (const fid of Object.values(patch.documentFileIds)) {
        const f = await this.c.files.findOne({ _id: fid });
        if (!f || f.ownerPrincipalId !== actor || f.visibility !== 'private' || f.quarantined) throw new DomainError('VALIDATION_FAILED', 'documents must be your own clean private files');
      }
      set['documentFileIds'] = { ...r.documentFileIds, ...patch.documentFileIds };
    }
    const upd = await this.c.registrations.findOneAndUpdate({ _id: r._id, version: expectedVersion }, { $set: set, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!upd) throw new DomainError('VERSION_CONFLICT', 'registration changed since it was read');
    // an incomplete registration returns to review once fixed
    if (upd.state === 'incomplete') return this.ct.dbh.withTransaction(async (session) => (await applyTransition(registrationMachine, this.c.registrations, upd._id, { transition: 'submit', expectedVersion: upd.version, actorRoles: APPLICANT_ROLES }, {}, session)).doc);
    await this.audit(actor, 'registration.edit', r, requestId, { fields: Object.keys(set) });
    return upd;
  }

  async withdraw(registrationId: string, actor: string, requestId: string): Promise<RegistrationDoc> {
    const r = await this.load(registrationId);
    const isApplicant = r.applicantPrincipalId === actor;
    if (!isApplicant && !(r.teamId && (await this.ct.acl.can(actor, 'team.roster.manage', { type: 'team', id: r.teamId })))) throw new DomainError('FORBIDDEN', 'not allowed to withdraw this registration');
    const { d, e } = await this.context(r.disciplineId);
    const policy = e.config.refundPolicy;
    const beforeDeadline = !d.config.withdrawalDeadline || iso() <= d.config.withdrawalDeadline;
    const percent = policy ? (beforeDeadline ? policy.beforeDeadlinePercent : policy.afterDeadlinePercent) : 0;
    const doc = await this.ct.dbh.withTransaction(async (session) => {
      const { doc } = await applyTransition(registrationMachine, this.c.registrations, r._id, { transition: 'withdraw', expectedVersion: r.version, actorRoles: APPLICANT_ROLES }, { history: [...r.history, { at: iso(), by: actor, transition: 'withdraw', note: null }] } as Partial<RegistrationDoc>, session);
      await this.release(r, session);
      if (doc.participationId) await this.c.participations.updateOne({ _id: doc.participationId }, { $set: { registrationState: 'withdrawn', updatedAt: iso() } }, { session });
      if (r.orderId) await this.c.orders.updateOne({ _id: r.orderId, state: 'open' }, { $set: { state: 'cancelled', updatedAt: iso() }, $inc: { version: 1 } }, { session });
      await this.audit(actor, 'registration.withdraw', r, requestId, { refundPercent: percent }, session);
      await this.event('registration.withdrawn', doc, actor, requestId, session, { refundPercent: percent });
      return doc;
    });
    if (r.orderId && percent > 0) await this.payments.refundOrder(r.orderId, percent, 'withdrawal', `reg:${r._id}:withdraw`, actor, requestId);
    await this.promoteWaitlist(r.disciplineId, requestId);
    return doc;
  }

  // ------------------------------------------------------------------ payment hooks (REG-010) — called by the outbox consumer
  async onOrderPaid(registrationId: string, requestId: string): Promise<'confirmed_payment' | 'allocated_after_expiry' | 'refunded' | 'ignored'> {
    const r = await this.c.registrations.findOne({ _id: registrationId });
    if (!r) return 'ignored';
    if (r.state === 'awaiting_payment' && r.reservation && !r.reservation.released) {
      await this.ct.dbh.withTransaction(async (session) => {
        await applyTransition(registrationMachine, this.c.registrations, r._id, { transition: 'payment_confirmed', expectedVersion: r.version, actorRoles: ['system'] }, { 'reservation.expiresAt': null, history: [...r.history, { at: iso(), by: 'system', transition: 'payment_confirmed', note: null }] } as Partial<RegistrationDoc>, session);
      });
      await this.tryAutoApprove(r._id, requestId);
      return 'confirmed_payment';
    }
    if (r.state === 'draft' || (r.state === 'awaiting_payment' && (!r.reservation || r.reservation.released))) {
      // REG-010: verified payment after the reservation expired → allocate free capacity, else refund. Never confirm without capacity.
      const allocated = await this.ct.dbh.withTransaction(async (session) => {
        const fresh = (await this.c.registrations.findOne({ _id: r._id }, { session }))!;
        const { doc } = await applyTransition(registrationMachine, this.c.registrations, fresh._id, { transition: 'payment_after_expiry', expectedVersion: fresh.version, actorRoles: ['system'] }, { waitlistedAt: iso(), waitlistSeq: await this.nextWaitlistSeq(session) } as Partial<RegistrationDoc>, session);
        const counterId = `${fresh.disciplineId}:${fresh.quotaKind}`;
        if (await this.reserve(counterId, session)) {
          await applyTransition(registrationMachine, this.c.registrations, fresh._id, { transition: 'allocate_from_waitlist', expectedVersion: doc.version, actorRoles: ['system'] }, { reservation: { counterId, heldAt: iso(), expiresAt: null, released: false, confirmed: false }, waitlistedAt: null, waitlistSeq: null, history: [...fresh.history, { at: iso(), by: 'system', transition: 'payment_after_expiry→allocate', note: null }] } as Partial<RegistrationDoc>, session);
          return true;
        }
        await applyTransition(registrationMachine, this.c.registrations, fresh._id, { transition: 'reject', expectedVersion: doc.version, actorRoles: ['system'] }, { history: [...fresh.history, { at: iso(), by: 'system', transition: 'reject', note: 'capacity_unavailable_after_late_payment' }] } as Partial<RegistrationDoc>, session);
        await this.audit('system', 'registration.late_payment_refund', fresh, requestId, {}, session);
        return false;
      });
      if (allocated) {
        await this.tryAutoApprove(r._id, requestId);
        return 'allocated_after_expiry';
      }
      await this.payments.refundOrder(r.orderId!, 100, 'capacity_unavailable', `reg:${r._id}:late`, 'system', requestId);
      return 'refunded';
    }
    if (['withdrawn', 'removed', 'rejected'].includes(r.state) && r.orderId) {
      await this.payments.refundOrder(r.orderId, 100, 'capacity_unavailable', `reg:${r._id}:dead`, 'system', requestId);
      return 'refunded';
    }
    return 'ignored';
  }

  // ------------------------------------------------------------------ jobs (REG-006)
  async expireReservations(now = new Date(), requestId = `expire:${now.toISOString()}`): Promise<number> {
    const due = await this.c.registrations.find({ state: 'awaiting_payment', 'reservation.released': false, 'reservation.expiresAt': { $ne: null, $lt: now.toISOString() } }).limit(500).toArray();
    let n = 0;
    const disciplines = new Set<string>();
    for (const r of due) {
      try {
        await this.ct.dbh.withTransaction(async (session) => {
          await applyTransition(registrationMachine, this.c.registrations, r._id, { transition: 'expire_reservation', expectedVersion: r.version, actorRoles: ['system'] }, { history: [...r.history, { at: iso(), by: 'system', transition: 'expire_reservation', note: null }] } as Partial<RegistrationDoc>, session);
          await this.release(r, session);
          if (r.orderId) await this.c.orders.updateOne({ _id: r.orderId, state: 'open' }, { $set: { state: 'expired', updatedAt: iso() }, $inc: { version: 1 } }, { session });
          await this.audit('system', 'registration.expire_reservation', r, requestId, {}, session);
        });
        n++;
        disciplines.add(r.disciplineId);
      } catch (err) {
        if ((err as DomainError).code !== 'VERSION_CONFLICT') throw err; // payment won the race; it will be handled by onOrderPaid
      }
    }
    for (const dId of disciplines) await this.promoteWaitlist(dId, requestId);
    return n;
  }

  /** FIFO promotion from the waitlist whenever capacity frees up. */
  async promoteWaitlist(disciplineId: string, requestId: string): Promise<number> {
    const { d, e } = await this.context(disciplineId);
    let promoted = 0;
    for (;;) {
      const next = await this.c.registrations.findOne({ disciplineId, state: 'awaiting_capacity', orderId: null }, { sort: { waitlistSeq: 1 } });
      if (!next) break;
      const ok = await this.ct.dbh.withTransaction(async (session) => {
        const counterId = `${disciplineId}:${next.quotaKind}`;
        if (!(await this.reserve(counterId, session))) return false;
        const fee = d.config.feeRial;
        const transition = fee > 0 ? 'allocate_for_payment' : 'allocate_from_waitlist';
        const expiresAt = fee > 0 ? new Date(Date.now() + d.config.paymentWindowMinutes * 60_000).toISOString() : null;
        const { doc } = await applyTransition(registrationMachine, this.c.registrations, next._id, { transition, expectedVersion: next.version, actorRoles: ['system'] }, { reservation: { counterId, heldAt: iso(), expiresAt, released: false, confirmed: false }, waitlistedAt: null, waitlistSeq: null, history: [...next.history, { at: iso(), by: 'system', transition, note: null }] } as Partial<RegistrationDoc>, session);
        if (fee > 0) {
          const order = await this.payments.createOrder({ kind: 'entry', payerPrincipalId: next.applicantPrincipalId, items: [{ productKey: `entry:${d._id}`, description: `${e.name} — ${d.name}`, amountRial: fee, quantity: 1 }], refs: { registrationId: next._id, eventId: e._id }, productKey: `entry:${d._id}`, discountCode: null, creditAccount: `payable:organization:${e.organizerOrgId}` }, session);
          await this.c.registrations.updateOne({ _id: next._id }, { $set: { orderId: order._id } }, { session });
        }
        await this.event('registration.promoted', doc, 'system', requestId, session);
        return true;
      });
      if (!ok) break;
      promoted++;
      await this.tryAutoApprove(next._id, requestId);
    }
    return promoted;
  }

  /** Event cancellation (AC-19): every active registration is removed, capacity released and money refunded per policy. */
  async cancelForEvent(eventId: string, refundPercent: number, requestId: string): Promise<number> {
    const regs = await this.c.registrations.find({ eventId, state: { $in: [...ACTIVE, 'draft'] } }).toArray();
    for (const r of regs) {
      await this.ct.dbh.withTransaction(async (session) => {
        const fresh = (await this.c.registrations.findOne({ _id: r._id }, { session }))!;
        if (!registrationMachine.transitions.find((t) => t.name === 'cancel_by_event')!.from.includes(fresh.state)) return;
        await applyTransition(registrationMachine, this.c.registrations, fresh._id, { transition: 'cancel_by_event', expectedVersion: fresh.version, actorRoles: ['system'] }, { history: [...fresh.history, { at: iso(), by: 'system', transition: 'cancel_by_event', note: null }] } as Partial<RegistrationDoc>, session);
        await this.release(fresh, session);
        if (fresh.participationId) await this.c.participations.updateOne({ _id: fresh.participationId }, { $set: { registrationState: 'removed', updatedAt: iso() } }, { session });
        if (fresh.orderId) await this.c.orders.updateOne({ _id: fresh.orderId, state: 'open' }, { $set: { state: 'cancelled', updatedAt: iso() }, $inc: { version: 1 } }, { session });
      });
      if (r.orderId && refundPercent > 0) await this.payments.refundOrder(r.orderId, refundPercent, 'event_cancelled', `reg:${r._id}:event_cancelled`, 'system', requestId);
    }
    return regs.length;
  }

  // ------------------------------------------------------------------ queries
  async listForDiscipline(disciplineId: string, actor: string, requestId: string, state?: string): Promise<RegistrationDoc[]> {
    const { e } = await this.context(disciplineId);
    await this.ct.acl.require(actor, 'event.read_private', this.eventScope(e._id), requestId);
    return this.c.registrations.find({ disciplineId, ...(state ? { state: state as RegistrationState } : {}) }).sort({ createdAt: 1 }).limit(2000).toArray();
  }

  async mine(actor: string): Promise<RegistrationDoc[]> {
    return this.c.registrations.find({ $or: [{ applicantPrincipalId: actor }, { 'roster.principalId': actor }] }).sort({ createdAt: -1 }).limit(200).toArray();
  }

  /** Applicant/roster members see their own registration; staff with event.read_private see all (REG-008). */
  async view(registrationId: string, actor: string, requestId: string): Promise<RegistrationDoc> {
    const r = await this.load(registrationId);
    if (r.applicantPrincipalId === actor || r.roster.some((m) => m.principalId === actor)) return r;
    await this.ct.acl.require(actor, 'event.read_private', this.eventScope(r.eventId), requestId);
    return r;
  }
}
