import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DomainError, ErrorResponse, EventStates, MatchStates, PageQuerySchema, decodeCursor, encodeCursor, pageOf, allMachines, eventMachine, matchMachine } from '@esp/contracts';
import { applyTransition, CommerceService, EventsService, PrizeService, RoomService, type Container, type EventDoc, type MatchDoc } from '@esp/core';

/**
 * Competition hierarchy read projections (DATA-001/002) and the status-transition endpoint.
 * - Public projections never include lobby credentials, principal ids or evidence (ROOM-004, REG-008).
 * - `PATCH /events/:id` with a `state` field is rejected: status only moves via named transitions.
 * ESP-03/04/05 add creation, registration, draw and result flows on top of these contracts.
 */
const EventSummary = z.object({ id: z.string(), slug: z.string(), name: z.string(), state: z.enum(EventStates), visibility: z.string(), timeZone: z.string(), startsAt: z.string().nullable(), endsAt: z.string().nullable(), organizerOrgId: z.string(), version: z.number().int() });
const StageOut = z.object({ id: z.string(), name: z.string(), order: z.number().int(), format: z.string(), state: z.string() });
const DisciplineOut = z.object({ id: z.string(), name: z.string(), gameId: z.string(), platform: z.string(), mode: z.string(), stages: z.array(StageOut) });
const MatchPublic = z.object({ id: z.string(), eventId: z.string(), stageId: z.string(), state: z.enum(MatchStates), kind: z.string(), scheduledAt: z.string().nullable(), estimated: z.boolean(), sides: z.array(z.object({ displayName: z.string(), roster: z.array(z.object({ displayName: z.string(), role: z.string() })) })), resultVersion: z.number().int(), version: z.number().int() });
const Token = z.object({ t: z.string().max(64).optional() });
const PublicDiscipline = DisciplineOut.extend({
  gameVersion: z.string(),
  participantKind: z.enum(['team', 'player']),
  capacity: z.number().int(),
  remaining: z.number().int(),
  waitlisted: z.number().int(),
  feeRial: z.number().int(),
  registrationOpensAt: z.string().nullable(),
  registrationClosesAt: z.string().nullable(),
  lateRegistrationUntil: z.string().nullable(),
  withdrawalDeadline: z.string().nullable(),
  presence: z.string(),
  formFields: z.array(z.object({ key: z.string(), label: z.string(), type: z.string(), required: z.boolean(), options: z.array(z.string()).nullable() })),
  requiredDocuments: z.array(z.object({ key: z.string(), label: z.string(), retentionClass: z.string() })),
  rules: z.object({ packageId: z.string(), version: z.string(), label: z.string(), hash: z.string(), clauses: z.array(z.object({ key: z.string(), kind: z.string(), value: z.unknown(), citation: z.string().optional() })) }).nullable(),
});
const EventDetail = z.object({
  event: EventSummary.extend({
    description: z.string().nullable(),
    presence: z.string(),
    regions: z.array(z.string()),
    language: z.string(),
    contact: z.string().nullable(),
    rated: z.boolean(),
    refundPolicy: z.object({ beforeDeadlinePercent: z.number(), afterDeadlinePercent: z.number(), onEventCancelPercent: z.number(), onDisqualificationPercent: z.number(), text: z.string() }).nullable(),
    cancellationTerms: z.string().nullable(),
    disputeTerms: z.string().nullable(),
    robots: z.enum(['index', 'noindex']),
    posterUrl: z.string().nullable(),
  }),
  /** EVT-008: independent, evidence-based badges; none implies another or a prize guarantee */
  badges: z.object({ rated: z.boolean(), organizerVerified: z.boolean(), affiliation: z.object({ kind: z.string(), body: z.string() }).nullable() }),
  disciplines: z.array(PublicDiscipline),
  prizes: z.array(z.object({ id: z.string(), prizeKey: z.string(), title: z.string(), kind: z.string(), amountRial: z.number().int(), responsible: z.string(), state: z.string(), guaranteed: z.literal(false) })),
  sponsors: z.array(z.object({ id: z.string(), sponsorName: z.string(), placement: z.string(), label: z.string() })),
});
const TransitionBody = z.object({ transition: z.string().min(1).max(64), expectedVersion: z.number().int().nonnegative(), approvalId: z.string().optional() });

const eventOut = (e: EventDoc) => ({ id: e._id, slug: e.slug, name: e.name, state: e.state, visibility: e.visibility, timeZone: e.timeZone, startsAt: e.startsAt, endsAt: e.endsAt, organizerOrgId: e.organizerOrgId, version: e.version });
const matchOut = (m: MatchDoc) => ({ id: m._id, eventId: m.eventId, stageId: m.stageId, state: m.state, kind: m.kind, scheduledAt: m.scheduledAt, estimated: m.estimated, sides: m.sides.map((s) => ({ displayName: s.displayName, roster: s.roster.map((p) => ({ displayName: p.displayName, role: p.role })) })), resultVersion: m.resultVersion, version: m.version });

export function competitionRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const events = new EventsService(container);
  /** EVT-003: public, link-only (token), private and invite visibility are enforced here and in every list. */
  async function canSeeEvent(req: { auth: { principal: { _id: string } } | null; query?: unknown }, e: EventDoc): Promise<boolean> {
    const token = (req.query as { t?: string } | undefined)?.t ?? null;
    return events.canView(e, req.auth?.principal._id ?? null, token);
  }

  r.get('/events', { schema: { tags: ['competition'], querystring: PageQuerySchema, response: { 200: pageOf(EventSummary) } } }, async (req) => {
    const cursor = decodeCursor(req.query.cursor, z.object({ id: z.string() }));
    const filter: Record<string, unknown> = { visibility: 'public', state: { $nin: ['draft', 'in_review'] } };
    if (cursor) filter['_id'] = { $gt: cursor.id };
    const docs = await container.c.events.find(filter).sort({ _id: 1 }).limit(req.query.limit + 1).toArray();
    const items = docs.slice(0, req.query.limit).map(eventOut);
    const last = items[items.length - 1];
    return { items, page: { nextCursor: docs.length > req.query.limit && last ? encodeCursor({ id: last.id }) : null, limit: req.query.limit } };
  });

  r.get('/events/:id', { schema: { tags: ['competition'], params: z.object({ id: z.string() }), querystring: Token, response: { 200: EventDetail, 404: ErrorResponse } } }, async (req) => {
    const e = await container.c.events.findOne({ $or: [{ _id: req.params.id }, { slug: req.params.id }] });
    if (!e || !(await canSeeEvent(req, e))) throw new DomainError('NOT_FOUND', 'event not found'); // no existence leak for private events
    const disciplines = await container.c.disciplines.find({ eventId: e._id }).toArray();
    const stages = await container.c.stages.find({ eventId: e._id }).sort({ order: 1 }).toArray();
    const counters = await container.c.capacityCounters.find({ disciplineId: { $in: disciplines.map((d) => d._id) } }).toArray();
    const waiting = await container.c.registrations.aggregate<{ _id: string; n: number }>([{ $match: { eventId: e._id, state: 'awaiting_capacity' } }, { $group: { _id: '$disciplineId', n: { $sum: 1 } } }]).toArray();
    const c = e.config;
    return {
      event: { ...eventOut(e), description: c.description, presence: c.presence, regions: c.regions, language: c.language, contact: c.contact, rated: c.rated, refundPolicy: c.refundPolicy, cancellationTerms: c.cancellationTerms, disputeTerms: c.disputeTerms, robots: e.visibility === 'public' ? ('index' as const) : ('noindex' as const), posterUrl: c.posterFileId ? ((await container.c.files.findOne({ _id: c.posterFileId, visibility: 'public', quarantined: false }))?.publicUrl ?? null) : null },
      badges: await new EventsService(container).badges(e),
      disciplines: disciplines.map((d) => {
        const own = counters.filter((k) => k.disciplineId === d._id && k.quotaKind === 'public');
        const remaining = own.reduce((a, k) => a + Math.max(0, k.capacity - k.held - k.confirmed), 0);
        return {
          id: d._id, name: d.name, gameId: d.gameId, platform: d.platform, mode: d.mode, gameVersion: d.gameVersion,
          stages: stages.filter((s) => s.disciplineId === d._id).map((s) => ({ id: s._id, name: s.name, order: s.order, format: s.format, state: s.state })),
          participantKind: d.config.participantKind, capacity: d.config.capacity, remaining, waitlisted: waiting.find((w) => w._id === d._id)?.n ?? 0, feeRial: d.config.feeRial,
          registrationOpensAt: d.config.registrationOpensAt, registrationClosesAt: d.config.registrationClosesAt, lateRegistrationUntil: d.config.lateRegistrationUntil, withdrawalDeadline: d.config.withdrawalDeadline, presence: d.config.presence,
          formFields: d.config.formFields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, options: f.options })),
          requiredDocuments: d.config.requiredDocuments.map((x) => ({ key: x.key, label: x.label, retentionClass: x.retentionClass })),
          rules: d.rulesSnapshot ? { packageId: d.rulesSnapshot.packageId, version: d.rulesSnapshot.version, label: d.rulesSnapshot.label, hash: d.rulesSnapshot.hash, clauses: d.rulesSnapshot.clauses } : null,
        };
      }),
      prizes: await new PrizeService(container).publicList(e._id),
      sponsors: await new CommerceService(container).publicSponsors(e._id),
    };
  });

  r.get('/events/:id/matches', { schema: { tags: ['competition'], params: z.object({ id: z.string() }), querystring: Token, response: { 200: z.object({ items: z.array(MatchPublic) }), 404: ErrorResponse } } }, async (req) => {
    const e = await container.c.events.findOne({ _id: req.params.id });
    if (!e || !(await canSeeEvent(req, e))) throw new DomainError('NOT_FOUND', 'event not found');
    const items = await container.c.matches.find({ eventId: e._id }).sort({ _id: 1 }).limit(200).toArray();
    return { items: items.map(matchOut) };
  });

  r.get('/matches/:id', { schema: { tags: ['competition'], params: z.object({ id: z.string() }), querystring: Token, response: { 200: MatchPublic, 404: ErrorResponse } } }, async (req) => {
    const m = await container.c.matches.findOne({ _id: req.params.id });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    const e = await container.c.events.findOne({ _id: m.eventId });
    if (!e || !(await canSeeEvent(req, e))) throw new DomainError('NOT_FOUND', 'match not found');
    return matchOut(m);
  });

  /** Private lobby credentials: only `match.lobby.read` in THIS match's scope (ROOM-004, AC-17). */
  r.get('/matches/:id/lobby', { schema: { tags: ['competition'], params: z.object({ id: z.string() }), response: { 200: z.object({ host: z.string(), password: z.string(), releasedAt: z.string().nullable() }), 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse } } }, async (req) => {
    // ROOM-004: sides of the match (in the allowed states) and officials with match.lobby.read; every read audited
    const ctx = req.requireAuth();
    const l = await new RoomService(container).lobby(req.params.id, ctx.principal._id, req.id);
    return { host: l.host, password: l.password, releasedAt: null };
  });

  /** Named transitions only. The actor's roles are the roles of their grants that cover this event's scope. */
  r.post('/events/:id/transitions', { schema: { tags: ['competition'], params: z.object({ id: z.string() }), body: TransitionBody, response: { 200: EventSummary, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 412: ErrorResponse } } }, async (req) => {
    const ctx = req.requireAuth();
    const scope = { type: 'event' as const, id: req.params.id };
    await req.requirePermission('event.manage', scope);
    const roles = await rolesInScope(container, ctx.principal._id, scope);
    if (['publish', 'cancel', 'finish', 'close', 'archive'].includes(req.body.transition)) throw new DomainError('PRECONDITION_FAILED', `use the dedicated ${req.body.transition} endpoint (publication gate / cancellation settlement / END-001..006 close gates)`);
    const t = eventMachine.transitions.find((x) => x.name === req.body.transition);
    if (t?.secondApproval) {
      if (!req.body.approvalId) throw new DomainError('PRECONDITION_FAILED', 'this transition requires an independent approval', { secondApproval: true });
      await container.approvals.consume(req.body.approvalId, 'stage.delete_active', scope, { principalId: ctx.principal._id, requestId: req.id });
    }
    const result = await container.dbh.withTransaction(async (session) => {
      const { doc, transition } = await applyTransition(eventMachine, container.c.events, req.params.id, { transition: req.body.transition, expectedVersion: req.body.expectedVersion, actorRoles: roles, ...(req.body.approvalId ? { approvalId: req.body.approvalId } : {}) }, {}, session);
      await container.audit.append({ actorPrincipalId: ctx.principal._id, action: `event.${transition.name}`, target: { type: 'event', id: doc._id }, scope, outcome: 'success', details: { from: transition.from, to: transition.to, version: doc.version }, requestId: req.id }, session);
      await container.outbox.append({ type: `competition.event.${transition.name}`, aggregate: { type: 'event', id: doc._id }, aggregateVersion: doc.version, actor: { principalId: ctx.principal._id, kind: 'user' }, payload: { state: doc.state }, correlationId: req.id }, session);
      return doc;
    });
    return eventOut(result);
  });

  r.post('/matches/:id/transitions', { schema: { tags: ['competition'], params: z.object({ id: z.string() }), body: TransitionBody, response: { 200: MatchPublic, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 412: ErrorResponse } } }, async (req) => {
    const ctx = req.requireAuth();
    const scope = { type: 'match' as const, id: req.params.id };
    await req.requirePermission('match.manage', scope).catch(async (err) => {
      // referees verify/finalize via match.result.verify; captains via match.result.submit
      if (await container.acl.can(ctx.principal._id, 'match.result.verify', scope)) return;
      if (await container.acl.can(ctx.principal._id, 'match.result.submit', scope)) return;
      throw err;
    });
    await container.acl.requireNoConflict(ctx.principal._id, scope, req.id);
    // result lifecycle transitions carry case/confirmation/correction rules (AC-09/AC-11): dedicated endpoints only
    if (['submit_result', 'dispute', 'finalize', 'reopen', 'forfeit', 'reset_sides'].includes(req.body.transition)) throw new DomainError('PRECONDITION_FAILED', `use the dedicated result endpoint for ${req.body.transition}`);
    const roles = await rolesInScope(container, ctx.principal._id, scope);
    const t = matchMachine.transitions.find((x) => x.name === req.body.transition);
    if (t?.secondApproval) {
      if (!req.body.approvalId) throw new DomainError('PRECONDITION_FAILED', 'this transition requires an independent approval', { secondApproval: true });
      await container.approvals.consume(req.body.approvalId, 'match.result.correct', scope, { principalId: ctx.principal._id, requestId: req.id });
    }
    const result = await container.dbh.withTransaction(async (session) => {
      const { doc, transition } = await applyTransition(matchMachine, container.c.matches, req.params.id, { transition: req.body.transition, expectedVersion: req.body.expectedVersion, actorRoles: roles, ...(req.body.approvalId ? { approvalId: req.body.approvalId } : {}) }, {}, session);
      await container.audit.append({ actorPrincipalId: ctx.principal._id, action: `match.${transition.name}`, target: { type: 'match', id: doc._id }, scope, outcome: 'success', details: { to: transition.to, version: doc.version }, requestId: req.id }, session);
      await container.outbox.append({ type: `competition.match.${transition.name}`, aggregate: { type: 'match', id: doc._id }, aggregateVersion: doc.version, actor: { principalId: ctx.principal._id, kind: 'user' }, payload: { state: doc.state, eventId: doc.eventId }, correlationId: req.id }, session);
      await container.realtime.publish({ channel: `match:${doc._id}`, type: `match.${transition.name}`, audience: { kind: 'public' }, payload: { matchId: doc._id, state: doc.state, version: doc.version } }, session);
      return doc;
    });
    return matchOut(result);
  });

  r.get('/meta/state-machines', { schema: { tags: ['meta'], summary: 'Chapter 15 state machines (same table that generates docs/state-transitions.md)' } }, async () => allMachines);
}

async function rolesInScope(container: Container, principalId: string, scope: { type: 'event' | 'match'; id: string }) {
  const grants = await container.acl.activeGrants(principalId);
  const ctx = await container.acl.resourceContext(scope);
  const ancestors = [ctx.scope, ...ctx.ancestors];
  return grants.filter((g) => ancestors.some((a) => a.type === g.scope.type && a.id === g.scope.id)).map((g) => g.role);
}
