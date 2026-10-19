import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DomainError, ErrorResponse, EventStates, MatchStates, PageQuerySchema, decodeCursor, encodeCursor, pageOf, allMachines, eventMachine, matchMachine } from '@esp/contracts';
import { applyTransition, type Container, type EventDoc, type MatchDoc } from '@esp/core';

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
const TransitionBody = z.object({ transition: z.string().min(1).max(64), expectedVersion: z.number().int().nonnegative(), approvalId: z.string().optional() });

const eventOut = (e: EventDoc) => ({ id: e._id, slug: e.slug, name: e.name, state: e.state, visibility: e.visibility, timeZone: e.timeZone, startsAt: e.startsAt, endsAt: e.endsAt, organizerOrgId: e.organizerOrgId, version: e.version });
const matchOut = (m: MatchDoc) => ({ id: m._id, eventId: m.eventId, stageId: m.stageId, state: m.state, kind: m.kind, scheduledAt: m.scheduledAt, estimated: m.estimated, sides: m.sides.map((s) => ({ displayName: s.displayName, roster: s.roster.map((p) => ({ displayName: p.displayName, role: p.role })) })), resultVersion: m.resultVersion, version: m.version });

export function competitionRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function canSeeEvent(req: { auth: { principal: { _id: string } } | null }, e: EventDoc): Promise<boolean> {
    if (e.visibility === 'public' && !['draft', 'in_review'].includes(e.state)) return true;
    if (!req.auth) return false;
    return container.acl.can(req.auth.principal._id, 'event.read_private', { type: 'event', id: e._id });
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

  r.get('/events/:id', { schema: { tags: ['competition'], params: z.object({ id: z.string() }), response: { 200: z.object({ event: EventSummary, disciplines: z.array(DisciplineOut) }), 404: ErrorResponse } } }, async (req) => {
    const e = await container.c.events.findOne({ $or: [{ _id: req.params.id }, { slug: req.params.id }] });
    if (!e || !(await canSeeEvent(req, e))) throw new DomainError('NOT_FOUND', 'event not found'); // no existence leak for private events
    const disciplines = await container.c.disciplines.find({ eventId: e._id }).toArray();
    const stages = await container.c.stages.find({ eventId: e._id }).sort({ order: 1 }).toArray();
    return { event: eventOut(e), disciplines: disciplines.map((d) => ({ id: d._id, name: d.name, gameId: d.gameId, platform: d.platform, mode: d.mode, stages: stages.filter((s) => s.disciplineId === d._id).map((s) => ({ id: s._id, name: s.name, order: s.order, format: s.format, state: s.state })) })) };
  });

  r.get('/events/:id/matches', { schema: { tags: ['competition'], params: z.object({ id: z.string() }), response: { 200: z.object({ items: z.array(MatchPublic) }), 404: ErrorResponse } } }, async (req) => {
    const e = await container.c.events.findOne({ _id: req.params.id });
    if (!e || !(await canSeeEvent(req, e))) throw new DomainError('NOT_FOUND', 'event not found');
    const items = await container.c.matches.find({ eventId: e._id }).sort({ _id: 1 }).limit(200).toArray();
    return { items: items.map(matchOut) };
  });

  r.get('/matches/:id', { schema: { tags: ['competition'], params: z.object({ id: z.string() }), response: { 200: MatchPublic, 404: ErrorResponse } } }, async (req) => {
    const m = await container.c.matches.findOne({ _id: req.params.id });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    const e = await container.c.events.findOne({ _id: m.eventId });
    if (!e || !(await canSeeEvent(req, e))) throw new DomainError('NOT_FOUND', 'match not found');
    return matchOut(m);
  });

  /** Private lobby credentials: only `match.lobby.read` in THIS match's scope (ROOM-004, AC-17). */
  r.get('/matches/:id/lobby', { schema: { tags: ['competition'], params: z.object({ id: z.string() }), response: { 200: z.object({ host: z.string(), password: z.string(), releasedAt: z.string().nullable() }), 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse } } }, async (req) => {
    const ctx = req.requireAuth();
    const m = await container.c.matches.findOne({ _id: req.params.id });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    await req.requirePermission('match.lobby.read', { type: 'match', id: m._id });
    await container.audit.append({ actorPrincipalId: ctx.principal._id, action: 'match.lobby.read', target: { type: 'match', id: m._id }, scope: { type: 'match', id: m._id }, outcome: 'success', requestId: req.id });
    if (!m.lobby) throw new DomainError('NOT_FOUND', 'no lobby configured');
    return m.lobby;
  });

  /** Named transitions only. The actor's roles are the roles of their grants that cover this event's scope. */
  r.post('/events/:id/transitions', { schema: { tags: ['competition'], params: z.object({ id: z.string() }), body: TransitionBody, response: { 200: EventSummary, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 412: ErrorResponse } } }, async (req) => {
    const ctx = req.requireAuth();
    const scope = { type: 'event' as const, id: req.params.id };
    await req.requirePermission('event.manage', scope);
    const roles = await rolesInScope(container, ctx.principal._id, scope);
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

  /** Any attempt to write `state` directly is rejected with ILLEGAL_TRANSITION (chapter 15 rule). */
  r.patch('/events/:id', { schema: { tags: ['competition'], params: z.object({ id: z.string() }), body: z.object({ name: z.string().min(1).max(200).optional(), state: z.string().optional(), expectedVersion: z.number().int() }), response: { 200: EventSummary, 409: ErrorResponse } } }, async (req) => {
    const ctx = req.requireAuth();
    if (req.body.state !== undefined) throw new DomainError('ILLEGAL_TRANSITION', 'status cannot be written directly; use /transitions');
    await req.requirePermission('event.manage', { type: 'event', id: req.params.id });
    const updated = await container.c.events.findOneAndUpdate({ _id: req.params.id, version: req.body.expectedVersion }, { $set: { ...(req.body.name ? { name: req.body.name } : {}), updatedAt: new Date().toISOString() }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!updated) throw new DomainError('VERSION_CONFLICT', 'event changed since it was read');
    await container.audit.append({ actorPrincipalId: ctx.principal._id, action: 'event.update', target: { type: 'event', id: updated._id }, scope: { type: 'event', id: updated._id }, outcome: 'success', requestId: req.id });
    return eventOut(updated);
  });

  r.get('/meta/state-machines', { schema: { tags: ['meta'], summary: 'Chapter 15 state machines (same table that generates docs/state-transitions.md)' } }, async () => allMachines);
}

async function rolesInScope(container: Container, principalId: string, scope: { type: 'event' | 'match'; id: string }) {
  const grants = await container.acl.activeGrants(principalId);
  const ctx = await container.acl.resourceContext(scope);
  const ancestors = [ctx.scope, ...ctx.ancestors];
  return grants.filter((g) => ancestors.some((a) => a.type === g.scope.type && a.id === g.scope.id)).map((g) => g.role);
}
