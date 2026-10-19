import { randomBytes } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import type { z } from 'zod';
import {
  DomainError,
  eventMachine,
  type DisciplineCreateSchema,
  type DisciplineUpdateSchema,
  type EntryCodeCreateSchema,
  type EventAffiliationClaimSchema,
  type EventCreateSchema,
  type EventUpdateSchema,
  type QualificationSlotCreateSchema,
  type Role,
  type Scope,
  type SeasonCreateSchema,
  type StageCreateSchema,
} from '@esp/contracts';
import type { Container } from '../container.js';
import type { DisciplineDoc, EventDoc, StageDoc } from '../db/collections.js';
import type { EntryCodeDoc, EventAffiliation, QualificationSlotDoc, SeasonDoc } from '../db/collections-esp03.js';
import { applyTransition } from '../domain/transition.js';
import { newId } from '../ids.js';
import { GameService } from '../catalog/catalog.js';
import { RulesService } from '../rules/rules.js';
import { OrganizerService } from '../organizer/organizer.js';
import { defaultDisciplineConfig, defaultEventConfig } from './defaults.js';

/**
 * Event setup and publication (EVT-001..008, STG-001..006, chapter 15 event flow).
 * All structural edits happen in draft/in_review. Publication is a server-side gate: organizer authority and limits,
 * published rules package per discipline (frozen into an immutable snapshot), game/mode readiness, capacity and
 * quotas, prize responsibility, fee/refund/cancellation/dispute terms. Status only moves by named transitions.
 */
const iso = () => new Date().toISOString();
const EDITABLE: EventDoc['state'][] = ['draft', 'in_review'];
const ACTIVE_STATES: EventDoc['state'][] = ['published', 'registration_open', 'registration_closed', 'preparing', 'active', 'paused'];

export interface PublishCheck {
  ok: boolean;
  problems: Array<{ code: string; message: string; ref: string | null }>;
}

export class EventsService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private scope(eventId: string): Scope {
    return { type: 'event', id: eventId };
  }

  async load(eventId: string): Promise<EventDoc> {
    const e = await this.c.events.findOne({ $or: [{ _id: eventId }, { slug: eventId }] });
    if (!e) throw new DomainError('NOT_FOUND', 'event not found');
    return e;
  }

  async rolesInScope(principalId: string, scope: Scope): Promise<Role[]> {
    const grants = await this.ct.acl.activeGrants(principalId);
    const ctx = await this.ct.acl.resourceContext(scope);
    const chain = [ctx.scope, ...ctx.ancestors];
    return grants.filter((g) => chain.some((a) => a.type === g.scope.type && a.id === g.scope.id)).map((g) => g.role);
  }

  private async audit(actor: string, action: string, eventId: string, requestId: string, details: Record<string, unknown> = {}, session?: ClientSession) {
    await this.ct.audit.append({ actorPrincipalId: actor, action, target: { type: 'event', id: eventId }, scope: this.scope(eventId), outcome: 'success', details, requestId }, session);
  }

  // ------------------------------------------------------------------ create / edit
  async create(input: z.infer<typeof EventCreateSchema>, actor: string, requestId: string): Promise<EventDoc> {
    await this.ct.acl.require(actor, 'event.manage', { type: 'organization', id: input.organizerOrgId }, requestId);
    const now = iso();
    const { organizerOrgId, name, slug, visibility, timeZone, startsAt, endsAt, ...cfg } = input;
    const e: EventDoc = {
      _id: newId('evt'),
      slug,
      name,
      organizerOrgId,
      visibility,
      state: 'draft',
      timeZone,
      startsAt,
      endsAt,
      rulesSnapshot: null,
      config: { ...defaultEventConfig(), ...cfg },
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
      version: 0,
    };
    try {
      await this.c.events.insertOne(e);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'slug already in use');
      throw err;
    }
    await this.audit(actor, 'event.create', e._id, requestId);
    return e;
  }

  async update(eventId: string, input: z.infer<typeof EventUpdateSchema>, actor: string, requestId: string): Promise<EventDoc> {
    const e = await this.load(eventId);
    await this.ct.acl.require(actor, 'event.manage', this.scope(e._id), requestId);
    const { expectedVersion, name, slug, visibility, timeZone, startsAt, endsAt, ...cfg } = input;
    // after publication only presentation fields may change; competitive terms are frozen (RULE-007, EVT-005)
    const presentation = ['description', 'posterFileId', 'contact'];
    if (!EDITABLE.includes(e.state)) {
      const touched = [...Object.keys(cfg), ...(name !== undefined ? ['name'] : []), ...(slug !== undefined ? ['slug'] : []), ...(visibility !== undefined ? ['visibility'] : []), ...(startsAt !== undefined ? ['startsAt'] : []), ...(endsAt !== undefined ? ['endsAt'] : []), ...(timeZone !== undefined ? ['timeZone'] : [])];
      const blocked = touched.filter((k) => !presentation.includes(k));
      if (blocked.length) throw new DomainError('PRECONDITION_FAILED', 'published events only allow presentation changes; use an amendment/cancellation flow', { blocked });
    }
    const set: Record<string, unknown> = { updatedAt: iso() };
    if (name !== undefined) set['name'] = name;
    if (slug !== undefined) set['slug'] = slug;
    if (visibility !== undefined) set['visibility'] = visibility;
    if (timeZone !== undefined) set['timeZone'] = timeZone;
    if (startsAt !== undefined) set['startsAt'] = startsAt;
    if (endsAt !== undefined) set['endsAt'] = endsAt;
    for (const [k, v] of Object.entries(cfg)) if (v !== undefined) set[`config.${k}`] = v;
    const r = await this.c.events.findOneAndUpdate({ _id: e._id, version: expectedVersion }, { $set: set, $inc: { version: 1 } }, { returnDocument: 'after' }).catch((err: { code?: number }) => {
      if (err.code === 11000) throw new DomainError('CONFLICT', 'slug already in use');
      throw err;
    });
    if (!r) throw new DomainError('VERSION_CONFLICT', 'event changed since it was read');
    await this.audit(actor, 'event.update', e._id, requestId, { fields: Object.keys(set) });
    return r;
  }

  async addDiscipline(eventId: string, input: z.infer<typeof DisciplineCreateSchema>, actor: string, requestId: string): Promise<DisciplineDoc> {
    const e = await this.load(eventId);
    await this.ct.acl.require(actor, 'event.manage', this.scope(e._id), requestId);
    if (!EDITABLE.includes(e.state)) throw new DomainError('PRECONDITION_FAILED', 'disciplines can only be added before publication');
    const { name, gameId, gameVersion, platform, mode, ...cfg } = input;
    const d: DisciplineDoc = { _id: newId('dsc'), eventId: e._id, gameId, gameVersion, platform, mode, name, rulesSnapshot: null, config: { ...defaultDisciplineConfig(), ...cfg }, createdAt: iso(), version: 0 };
    this.validateDiscipline(d);
    await this.c.disciplines.insertOne(d);
    await this.audit(actor, 'event.discipline.add', e._id, requestId, { disciplineId: d._id });
    return d;
  }

  async updateDiscipline(disciplineId: string, input: z.infer<typeof DisciplineUpdateSchema>, actor: string, requestId: string): Promise<DisciplineDoc> {
    const d = await this.c.disciplines.findOne({ _id: disciplineId });
    if (!d) throw new DomainError('NOT_FOUND', 'discipline not found');
    const e = await this.load(d.eventId);
    await this.ct.acl.require(actor, 'event.manage', this.scope(e._id), requestId);
    if (!EDITABLE.includes(e.state)) throw new DomainError('PRECONDITION_FAILED', 'discipline settings are frozen after publication');
    const { expectedVersion, name, gameVersion, platform, mode, ...cfg } = input;
    const next: DisciplineDoc = { ...d, ...(name ? { name } : {}), ...(gameVersion ? { gameVersion } : {}), ...(platform ? { platform } : {}), ...(mode ? { mode } : {}), config: { ...d.config, ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined)) } };
    this.validateDiscipline(next);
    const r = await this.c.disciplines.findOneAndUpdate({ _id: d._id, version: expectedVersion }, { $set: { name: next.name, gameVersion: next.gameVersion, platform: next.platform, mode: next.mode, config: next.config }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('VERSION_CONFLICT', 'discipline changed since it was read');
    await this.audit(actor, 'event.discipline.update', e._id, requestId, { disciplineId: d._id });
    return r;
  }

  private validateDiscipline(d: DisciplineDoc) {
    const c = d.config;
    if (c.minParticipants > c.capacity) throw new DomainError('VALIDATION_FAILED', 'minimum participants exceed capacity');
    const reserved = c.quotas.filter((q) => q.kind !== 'public').reduce((a, q) => a + q.size, 0);
    if (reserved > c.capacity) throw new DomainError('VALIDATION_FAILED', 'quotas exceed capacity');
    if (c.registrationOpensAt && c.registrationClosesAt && c.registrationOpensAt >= c.registrationClosesAt) throw new DomainError('VALIDATION_FAILED', 'registration window is empty');
    if (c.lateRegistrationUntil && c.registrationClosesAt && c.lateRegistrationUntil < c.registrationClosesAt) throw new DomainError('VALIDATION_FAILED', 'late registration must end after the regular window');
    if (c.checkin?.policy === 'min_members' && !c.checkin.minMembers) throw new DomainError('VALIDATION_FAILED', 'min_members check-in needs minMembers');
  }

  async addStage(disciplineId: string, input: z.infer<typeof StageCreateSchema>, actor: string, requestId: string): Promise<StageDoc> {
    const d = await this.c.disciplines.findOne({ _id: disciplineId });
    if (!d) throw new DomainError('NOT_FOUND', 'discipline not found');
    const e = await this.load(d.eventId);
    await this.ct.acl.require(actor, 'event.manage', this.scope(e._id), requestId);
    if (!EDITABLE.includes(e.state)) throw new DomainError('PRECONDITION_FAILED', 'stages are frozen after publication');
    const siblings = await this.c.stages.find({ disciplineId }).toArray();
    for (const dep of input.dependsOnStageIds) if (!siblings.some((s) => s._id === dep && s.order < input.order)) throw new DomainError('VALIDATION_FAILED', 'a stage may only depend on earlier stages of the same discipline', { dep });
    for (const l of input.links) {
      if (l.fromStageId && !siblings.some((s) => s._id === l.fromStageId && s.order < input.order)) throw new DomainError('VALIDATION_FAILED', 'links must come from earlier stages of the same discipline', { from: l.fromStageId });
      if (l.points === 'factor' && (l.factor === null || l.factor === undefined)) throw new DomainError('VALIDATION_FAILED', 'factor links need a factor');
    }
    const st: StageDoc = { _id: newId('stg'), eventId: e._id, disciplineId, order: input.order, name: input.name, format: input.format, state: 'planned', dependsOnStageIds: input.dependsOnStageIds, presence: input.presence, links: input.links.map((l) => ({ ...l, factor: l.factor ?? null })), startException: null, createdAt: iso(), version: 0 };
    try {
      await this.c.stages.insertOne(st);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'stage order already used in this discipline');
      throw err;
    }
    await this.audit(actor, 'event.stage.add', e._id, requestId, { stageId: st._id });
    return st;
  }

  /** STG-006: a dependent stage may start only when its dependencies are finished, unless an approved exception exists. */
  async canStartStage(stageId: string): Promise<{ ok: boolean; waitingFor: string[]; exception: boolean }> {
    const st = await this.c.stages.findOne({ _id: stageId });
    if (!st) throw new DomainError('NOT_FOUND', 'stage not found');
    const deps = await this.c.stages.find({ _id: { $in: st.dependsOnStageIds } }).toArray();
    const waitingFor = deps.filter((d) => d.state !== 'finished').map((d) => d._id);
    return { ok: waitingFor.length === 0 || !!st.startException, waitingFor, exception: !!st.startException };
  }

  async grantStageStartException(stageId: string, approvalId: string, reason: string, actor: string, requestId: string): Promise<StageDoc> {
    const st = await this.c.stages.findOne({ _id: stageId });
    if (!st) throw new DomainError('NOT_FOUND', 'stage not found');
    await this.ct.acl.require(actor, 'event.manage', this.scope(st.eventId), requestId);
    await this.ct.approvals.consume(approvalId, 'stage.start_exception', this.scope(st.eventId), { principalId: actor, requestId });
    const r = await this.c.stages.findOneAndUpdate({ _id: stageId }, { $set: { startException: { approvalId, reason, by: actor, at: iso() } }, $inc: { version: 1 } }, { returnDocument: 'after' });
    await this.audit(actor, 'event.stage.start_exception', st.eventId, requestId, { stageId, reason });
    return r!;
  }

  // ------------------------------------------------------------------ publication (EVT-005/007)
  async publishCheck(eventId: string): Promise<PublishCheck & { event: EventDoc; disciplines: DisciplineDoc[] }> {
    const e = await this.load(eventId);
    const disciplines = await this.c.disciplines.find({ eventId: e._id }).toArray();
    const problems: PublishCheck['problems'] = [];
    const add = (code: string, message: string, ref: string | null = null) => problems.push({ code, message, ref });
    if (!EDITABLE.includes(e.state)) add('state', `event is ${e.state}`);
    if (!e.startsAt) add('starts_at', 'start time is required');
    if (!disciplines.length) add('disciplines', 'at least one discipline is required');
    if (!e.config.cancellationTerms) add('cancellation_terms', 'cancellation terms must be published before registration (EVT-005)');
    if (!e.config.disputeTerms) add('dispute_terms', 'dispute terms must be published before registration (EVT-005)');
    for (const p of e.config.prizes) {
      if (p.kind === 'cash' && p.amountRial <= 0) add('prize_amount', 'cash prizes need an amount', p.key);
      if (!p.responsible) add('prize_responsible', 'every prize needs a responsible party', p.key);
    }
    const games = new GameService(this.ct);
    for (const d of disciplines) {
      if (d.config.capacity <= 0) add('capacity', 'capacity must be set', d._id);
      if (d.config.feeRial > 0 && !e.config.refundPolicy) add('refund_policy', 'paid registration needs a published refund policy (FIN-006)', d._id);
      if (!d.config.registrationClosesAt) add('registration_window', 'registration close time is required', d._id);
      if (e.startsAt && d.config.registrationClosesAt && d.config.registrationClosesAt > e.startsAt) add('registration_window', 'registration must close before the event starts', d._id);
      if (!d.config.rulesPackageId) add('rules', 'a reviewed rules package is required (RULE-006/010)', d._id);
      else {
        const pkg = await this.c.rulesPackages.findOne({ _id: d.config.rulesPackageId });
        if (!pkg || pkg.state !== 'published') add('rules', 'rules package is not published', d._id);
        else {
          if (pkg.gameId !== d.gameId) add('rules', 'rules package belongs to another game', d._id);
          if (pkg.testOnly && this.ct.config.isProduction) add('rules', 'TEST ONLY packages cannot be used in production', d._id);
          if (e.config.rated && (!pkg.nextReviewDueAt || pkg.nextReviewDueAt < iso())) add('rules_review', 'rated events need a rules review within the last month (RULE-012)', d._id);
        }
      }
      if (!(await games.isReady(d.gameId, d.gameVersion, d.platform, d.mode))) add('game_readiness', 'this game version/platform/mode is not ready for standard competitions (GAME-004)', d._id);
    }
    const activeCount = await this.c.events.countDocuments({ organizerOrgId: e.organizerOrgId, state: { $in: ACTIVE_STATES }, _id: { $ne: e._id } });
    try {
      await new OrganizerService(this.ct).assertCanPublishEvent(e.organizerOrgId, { capacity: Math.max(0, ...disciplines.map((d) => d.config.capacity)), paid: disciplines.some((d) => d.config.feeRial > 0), activeEventsCount: activeCount });
    } catch (err) {
      add('organizer', (err as Error).message, e.organizerOrgId);
    }
    return { ok: problems.length === 0, problems, event: e, disciplines };
  }

  async publish(eventId: string, actor: string, requestId: string, opts: { system?: boolean } = {}): Promise<EventDoc> {
    const pre = await this.publishCheck(eventId);
    const e = pre.event;
    if (!opts.system) await this.ct.acl.require(actor, 'event.publish', this.scope(e._id), requestId);
    if (!pre.ok) throw new DomainError('PRECONDITION_FAILED', 'event cannot be published yet', { problems: pre.problems });
    const rules = new RulesService(this.ct);
    const snapshots = new Map<string, Awaited<ReturnType<RulesService['freezeSnapshot']>>>();
    for (const d of pre.disciplines) snapshots.set(d._id, await rules.freezeSnapshot(d.config.rulesPackageId!));
    const roles = opts.system ? (['system'] as const) : await this.rolesInScope(actor, this.scope(e._id));
    return this.ct.dbh.withTransaction(async (session) => {
      const now = iso();
      for (const d of pre.disciplines) {
        const snap = snapshots.get(d._id)!;
        await this.c.disciplines.updateOne({ _id: d._id }, { $set: { rulesSnapshot: snap }, $inc: { version: 1 } }, { session });
        // capacity counters per quota (REG-005/009); public gets what is not reserved by other quotas
        const reserved = d.config.quotas.filter((q) => q.kind !== 'public');
        const counters = [{ kind: 'public', size: d.config.capacity - reserved.reduce((a, q) => a + q.size, 0) }, ...reserved.map((q) => ({ kind: q.kind, size: q.size }))];
        for (const q of counters) await this.c.capacityCounters.updateOne({ _id: `${d._id}:${q.kind}` }, { $setOnInsert: { _id: `${d._id}:${q.kind}`, disciplineId: d._id, quotaKind: q.kind, capacity: q.size, held: 0, confirmed: 0, version: 0 } }, { upsert: true, session });
        if (d.config.feeRial > 0) {
          const key = `entry:${d._id}`;
          const last = await this.c.priceLists.findOne({ productKey: key }, { sort: { version: -1 }, session });
          // fee rate is the owner's commercial setting (17.2); without a configured list the platform fee is 0 bps
          if (!last) await this.c.priceLists.insertOne({ _id: newId('prl'), productKey: key, kind: 'entry', amountRial: d.config.feeRial, feeBps: 0, version: 1, effectiveFrom: now, createdBy: actor, createdAt: now, supersededAt: null }, { session });
        }
      }
      for (const p of e.config.prizes) {
        await this.c.prizes.updateOne({ eventId: e._id, prizeKey: p.key }, { $setOnInsert: { _id: newId('prz'), eventId: e._id, disciplineId: null, prizeKey: p.key, title: p.title, kind: p.kind, amountRial: p.amountRial, responsible: p.responsible, state: 'defined', recipient: null, resultRef: null, payout: null, history: [{ at: now, by: actor, transition: 'define', note: null }], createdAt: now, version: 0 } }, { upsert: true, session });
      }
      const linkToken = e.visibility === 'link_only' ? (e.config.linkToken ?? randomBytes(12).toString('base64url')) : e.config.linkToken;
      const { doc } = await applyTransition(eventMachine, this.c.events, e._id, { transition: 'publish', expectedVersion: e.version, actorRoles: [...roles] }, { rulesSnapshot: snapshots.get(pre.disciplines[0]!._id) ?? null, config: { ...e.config, linkToken, publishAt: null } } as Partial<EventDoc>, session);
      await this.audit(actor, 'event.publish', e._id, requestId, { disciplines: pre.disciplines.length, scheduled: !!opts.system }, session);
      await this.ct.outbox.append({ type: 'competition.event.published', aggregate: { type: 'event', id: e._id }, aggregateVersion: doc.version, actor: { principalId: actor, kind: opts.system ? 'system' : 'user' }, payload: { eventId: e._id, visibility: e.visibility }, correlationId: requestId }, session);
      return doc;
    });
  }

  /** EVT-006: scheduled publication. Preconditions are checked now and again when the worker publishes. */
  async schedule(eventId: string, publishAt: string, expectedVersion: number, actor: string, requestId: string): Promise<EventDoc> {
    const pre = await this.publishCheck(eventId);
    await this.ct.acl.require(actor, 'event.publish', this.scope(pre.event._id), requestId);
    if (!pre.ok) throw new DomainError('PRECONDITION_FAILED', 'event cannot be published yet', { problems: pre.problems });
    if (publishAt <= iso()) throw new DomainError('VALIDATION_FAILED', 'publication time must be in the future');
    const r = await this.c.events.findOneAndUpdate({ _id: pre.event._id, version: expectedVersion }, { $set: { 'config.publishAt': publishAt, updatedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('VERSION_CONFLICT', 'event changed since it was read');
    await this.audit(actor, 'event.schedule', r._id, requestId, { publishAt });
    return r;
  }

  /** Worker job: publish due scheduled events. A failing precondition keeps the event in draft and is audited. */
  async publishDue(now = new Date()): Promise<{ published: string[]; failed: Array<{ eventId: string; problems: unknown }> }> {
    const due = await this.c.events.find({ state: { $in: EDITABLE }, 'config.publishAt': { $ne: null, $lte: now.toISOString() } }).limit(50).toArray();
    const out = { published: [] as string[], failed: [] as Array<{ eventId: string; problems: unknown }> };
    for (const e of due) {
      try {
        await this.publish(e._id, 'system:scheduler', `schedule:${e._id}`, { system: true });
        out.published.push(e._id);
      } catch (err) {
        out.failed.push({ eventId: e._id, problems: (err as DomainError).details ?? (err as Error).message });
        await this.c.events.updateOne({ _id: e._id }, { $set: { 'config.publishAt': null } });
        await this.ct.audit.append({ actorPrincipalId: 'system:scheduler', action: 'event.schedule.failed', target: { type: 'event', id: e._id }, scope: this.scope(e._id), outcome: 'failed', details: { error: (err as Error).message }, requestId: `schedule:${e._id}` });
      }
    }
    return out;
  }

  /** EVT-006: duplicate an event (or create from a template) as a new draft without snapshots, counters or registrations. */
  async duplicate(eventId: string, input: { slug: string; name: string; asTemplate: boolean }, actor: string, requestId: string): Promise<EventDoc> {
    const src = await this.load(eventId);
    await this.ct.acl.require(actor, 'event.manage', { type: 'organization', id: src.organizerOrgId }, requestId);
    const now = iso();
    const copy: EventDoc = { ...src, _id: newId('evt'), slug: input.slug, name: input.name, state: 'draft', rulesSnapshot: null, config: { ...src.config, linkToken: null, publishAt: null, isTemplate: input.asTemplate, duplicatedFrom: src._id, affiliation: null }, createdBy: actor, createdAt: now, updatedAt: now, version: 0 };
    delete (copy as Partial<EventDoc>).seedLabel;
    await this.ct.dbh.withTransaction(async (session) => {
      await this.c.events.insertOne(copy, { session }).catch((err: { code?: number }) => {
        if (err.code === 11000) throw new DomainError('CONFLICT', 'slug already in use');
        throw err;
      });
      const stageMap = new Map<string, string>();
      for (const d of await this.c.disciplines.find({ eventId: src._id }, { session }).toArray()) {
        const nd = { ...d, _id: newId('dsc'), eventId: copy._id, rulesSnapshot: null, createdAt: now, version: 0 };
        await this.c.disciplines.insertOne(nd, { session });
        const stages = await this.c.stages.find({ disciplineId: d._id }, { session }).sort({ order: 1 }).toArray();
        for (const s of stages) stageMap.set(s._id, newId('stg'));
        for (const s of stages) {
          await this.c.stages.insertOne({ ...s, _id: stageMap.get(s._id)!, eventId: copy._id, disciplineId: nd._id, state: 'planned', dependsOnStageIds: s.dependsOnStageIds.map((x) => stageMap.get(x) ?? x), links: s.links.map((l) => ({ ...l, fromStageId: l.fromStageId ? (stageMap.get(l.fromStageId) ?? null) : null })), startException: null, createdAt: now, version: 0 }, { session });
        }
      }
      await this.audit(actor, 'event.duplicate', copy._id, requestId, { from: src._id, asTemplate: input.asTemplate }, session);
    });
    return copy;
  }

  // ------------------------------------------------------------------ visibility (EVT-003)
  /** Who may read an event: public → everyone; link_only → valid token; private/invite → staff and registrants. */
  async canView(e: EventDoc, viewer: string | null, token: string | null): Promise<boolean> {
    if (['draft', 'in_review'].includes(e.state)) return !!viewer && (await this.ct.acl.can(viewer, 'event.read_private', this.scope(e._id)));
    if (e.visibility === 'public') return true;
    if (e.visibility === 'link_only' && token && e.config.linkToken && token === e.config.linkToken) return true;
    if (!viewer) return false;
    if (await this.ct.acl.can(viewer, 'event.read_private', this.scope(e._id))) return true;
    return !!(await this.c.registrations.findOne({ eventId: e._id, $or: [{ applicantPrincipalId: viewer }, { 'roster.principalId': viewer }] }, { projection: { _id: 1 } }));
  }

  // ------------------------------------------------------------------ badges (EVT-008)
  /** Official affiliation is a claim backed by private, clean evidence; it is public only after an independent decision. */
  async claimAffiliation(eventId: string, input: z.infer<typeof EventAffiliationClaimSchema>, actor: string, requestId: string): Promise<EventDoc> {
    const e = await this.load(eventId);
    await this.ct.acl.require(actor, 'event.manage', this.scope(e._id), requestId);
    const f = await this.c.files.findOne({ _id: input.evidenceFileId });
    if (!f || f.ownerPrincipalId !== actor || f.visibility !== 'private' || f.quarantined) throw new DomainError('VALIDATION_FAILED', 'evidence must be your own clean private file');
    const affiliation: EventAffiliation = { ...input, state: 'pending', claimedBy: actor, claimedAt: iso(), decidedBy: null, decidedAt: null, note: null };
    const r = await this.c.events.findOneAndUpdate({ _id: e._id }, { $set: { 'config.affiliation': affiliation, updatedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' });
    await this.audit(actor, 'event.affiliation.claim', e._id, requestId, { kind: input.kind, body: input.body });
    return r!;
  }

  async decideAffiliation(eventId: string, decision: 'verify' | 'reject', note: string, actor: string, requestId: string): Promise<EventDoc> {
    await this.ct.acl.require(actor, 'organizer.review', { type: 'site', id: 'site' }, requestId);
    const e = await this.load(eventId);
    const a = e.config.affiliation;
    if (!a || a.state !== 'pending') throw new DomainError('PRECONDITION_FAILED', 'no pending affiliation claim');
    if (a.claimedBy === actor) throw new DomainError('FORBIDDEN', 'the claimant cannot decide their own claim');
    const r = await this.c.events.findOneAndUpdate(
      { _id: e._id, 'config.affiliation.state': 'pending' },
      { $set: { 'config.affiliation.state': decision === 'verify' ? 'verified' : 'rejected', 'config.affiliation.decidedBy': actor, 'config.affiliation.decidedAt': iso(), 'config.affiliation.note': note, updatedAt: iso() }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    );
    if (!r) throw new DomainError('CONFLICT', 'claim was decided concurrently');
    await this.audit(actor, `event.affiliation.${decision}`, e._id, requestId, { note });
    return r;
  }

  async pendingAffiliations(actor: string, requestId: string): Promise<EventDoc[]> {
    await this.ct.acl.require(actor, 'organizer.review', { type: 'site', id: 'site' }, requestId);
    return this.c.events.find({ 'config.affiliation.state': 'pending' }).limit(200).toArray();
  }

  /** Public badges: each is independent and evidence-based; none implies the others or a prize guarantee. */
  async badges(e: EventDoc): Promise<{ rated: boolean; organizerVerified: boolean; affiliation: { kind: string; body: string } | null }> {
    const org = await this.c.organizerProfiles.findOne({ _id: e.organizerOrgId });
    const live = !['draft', 'in_review'].includes(e.state);
    const a = e.config.affiliation;
    return {
      rated: live && e.config.rated, // rated events pass the rules-review gate at publication (RULE-012)
      organizerVerified: org?.verified.state === 'verified' && (!org.verified.expiresAt || org.verified.expiresAt > iso()),
      affiliation: a?.state === 'verified' ? { kind: a.kind, body: a.body } : null,
    };
  }

  // ------------------------------------------------------------------ cancellation (15.5, AC-19)
  async cancel(eventId: string, approvalId: string, reason: string, actor: string, requestId: string): Promise<EventDoc> {
    const e = await this.load(eventId);
    await this.ct.acl.require(actor, 'event.manage', this.scope(e._id), requestId);
    const roles = await this.rolesInScope(actor, this.scope(e._id));
    await this.ct.approvals.consume(approvalId, 'event.cancel', this.scope(e._id), { principalId: actor, requestId });
    const doc = await this.ct.dbh.withTransaction(async (session) => {
      const { doc } = await applyTransition(eventMachine, this.c.events, e._id, { transition: 'cancel', expectedVersion: e.version, actorRoles: roles, approvalId }, {}, session);
      await this.audit(actor, 'event.cancel', e._id, requestId, { reason }, session);
      await this.ct.outbox.append({ type: 'competition.event.cancelled', aggregate: { type: 'event', id: e._id }, aggregateVersion: doc.version, actor: { principalId: actor, kind: 'user' }, payload: { eventId: e._id, reason, refundPercent: e.config.refundPolicy?.onEventCancelPercent ?? 100 }, correlationId: requestId }, session);
      return doc;
    });
    return doc; // registrations, refunds, tickets and prizes are settled by the idempotent `competition.event.cancelled` consumer
  }

  // ------------------------------------------------------------------ seasons, slots, entry codes (STG-005, REG-005)
  async createSeason(input: z.infer<typeof SeasonCreateSchema>, actor: string, requestId: string): Promise<SeasonDoc> {
    await this.ct.acl.require(actor, 'catalog.manage', { type: 'site', id: 'site' }, requestId);
    if (input.from >= input.to) throw new DomainError('VALIDATION_FAILED', 'season must end after it starts');
    const s: SeasonDoc = { _id: newId('sea'), ...input, createdAt: iso(), version: 0 };
    await this.c.seasons.insertOne(s);
    return s;
  }

  /**
   * STG-002/005: a qualification slot is created only from an invite/season decision or from a FINAL result (ESP-04/05);
   * ESP-03 never fabricates advancement. Uniqueness: one live slot per holder per target discipline.
   */
  async createSlot(disciplineId: string, input: z.infer<typeof QualificationSlotCreateSchema> & { resultVersion?: number | null }, actor: string, requestId: string): Promise<QualificationSlotDoc> {
    const d = await this.c.disciplines.findOne({ _id: disciplineId });
    if (!d) throw new DomainError('NOT_FOUND', 'discipline not found');
    await this.ct.acl.require(actor, 'event.manage', this.scope(d.eventId), requestId);
    if (input.source.kind === 'stage' || input.source.kind === 'event') {
      const final = input.resultVersion ? await this.c.resultVersions.findOne({ targetId: input.source.ref, version: input.resultVersion, 'data.final': true }) : null;
      if (!final) throw new DomainError('PRECONDITION_FAILED', 'qualification from a stage/event needs a final result version (provided by ESP-04/05)');
    }
    const slot: QualificationSlotDoc = { _id: newId('qsl'), targetDisciplineId: disciplineId, targetStageId: input.targetStageId, source: input.source, holderKey: input.holderKey, state: 'reserved', provenance: { createdBy: actor, createdAt: iso(), resultVersion: input.resultVersion ?? null, reason: input.reason }, version: 0 };
    try {
      await this.c.qualificationSlots.insertOne(slot);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'this participant already holds a slot for this discipline');
      throw err;
    }
    await this.audit(actor, 'event.slot.create', d.eventId, requestId, { disciplineId, holderKey: input.holderKey, source: input.source });
    return slot;
  }

  async createEntryCodes(disciplineId: string, input: z.infer<typeof EntryCodeCreateSchema>, count: number, actor: string, requestId: string): Promise<EntryCodeDoc[]> {
    const d = await this.c.disciplines.findOne({ _id: disciplineId });
    if (!d) throw new DomainError('NOT_FOUND', 'discipline not found');
    await this.ct.acl.require(actor, 'event.manage', this.scope(d.eventId), requestId);
    if (count < 1 || count > 500) throw new DomainError('VALIDATION_FAILED', 'between 1 and 500 codes per request');
    const now = iso();
    const codes: EntryCodeDoc[] = Array.from({ length: count }, () => ({ _id: randomBytes(6).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, 'X'), disciplineId, quotaKind: input.quotaKind, holderKey: input.holderKey, maxUses: input.maxUses, used: 0, expiresAt: input.expiresAt, createdBy: actor, createdAt: now }));
    await this.c.entryCodes.insertMany(codes);
    await this.audit(actor, 'event.entry_codes.create', d.eventId, requestId, { disciplineId, count, quotaKind: input.quotaKind });
    return codes;
  }
}
