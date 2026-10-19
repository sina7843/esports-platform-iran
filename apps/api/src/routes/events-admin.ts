import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  DisciplineCreateSchema,
  DisciplineUpdateSchema,
  DomainError,
  EntryCodeCreateSchema,
  ErrorResponse,
  EventAffiliationClaimSchema,
  EventAffiliationDecisionSchema,
  EventCreateSchema,
  EventDuplicateSchema,
  EventScheduleSchema,
  EventUpdateSchema,
  QualificationSlotCreateSchema,
  SeasonCreateSchema,
  StageCreateSchema,
  StageStartExceptionSchema,
} from '@esp/contracts';
import { EventsService, type Container, type DisciplineDoc, type EventDoc, type StageDoc } from '@esp/core';

/** Organizer event management (EVT-001..008, STG-001..006). Every route checks authority in the event/organization scope. */
const eventOut = (e: EventDoc) => ({ id: e._id, slug: e.slug, name: e.name, state: e.state, visibility: e.visibility, timeZone: e.timeZone, startsAt: e.startsAt, endsAt: e.endsAt, organizerOrgId: e.organizerOrgId, config: e.config, version: e.version });
const disciplineOut = (d: DisciplineDoc) => ({ id: d._id, eventId: d.eventId, name: d.name, gameId: d.gameId, gameVersion: d.gameVersion, platform: d.platform, mode: d.mode, config: d.config, rulesFrozen: !!d.rulesSnapshot, version: d.version });
const stageOut = (s: StageDoc) => ({ id: s._id, disciplineId: s.disciplineId, name: s.name, order: s.order, format: s.format, state: s.state, presence: s.presence, dependsOnStageIds: s.dependsOnStageIds, links: s.links, startException: s.startException, version: s.version });
const Id = z.object({ id: z.string().min(1).max(64) });
const Out = z.record(z.string(), z.unknown());
/** Domain documents are returned as plain JSON records (fields are explicit projections or non-sensitive finance docs). */
const plain = <T extends object>(x: T): Record<string, unknown> => x as unknown as Record<string, unknown>;
const plainAll = <T extends object>(xs: T[]): Array<Record<string, unknown>> => xs.map(plain);

export function eventsAdminRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const ev = new EventsService(container);
  const errors = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 412: ErrorResponse };

  r.post('/events', { schema: { tags: ['events'], body: EventCreateSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(eventOut(await ev.create(req.body, req.requireAuth().principal._id, req.id))));

  r.patch('/events/:id', { schema: { tags: ['events'], params: Id, body: EventUpdateSchema.extend({ state: z.string().optional() }), response: { 200: Out, ...errors } } }, async (req) => {
    if (req.body.state !== undefined) throw new DomainError('ILLEGAL_TRANSITION', 'status cannot be written directly; use the transition endpoints');
    const { state: _s, ...body } = req.body;
    void _s;
    return eventOut(await ev.update(req.params.id, body, req.requireAuth().principal._id, req.id));
  });

  /** Organizer view: full configuration, disciplines, stages and the publication checklist (EVT-006 preview). */
  r.get('/events/:id/manage', { schema: { tags: ['events'], params: Id, response: { 200: Out, ...errors } } }, async (req) => {
    const e = await ev.load(req.params.id);
    await req.requirePermission('event.read_private', { type: 'event', id: e._id });
    const check = await ev.publishCheck(e._id);
    const stages = await container.c.stages.find({ eventId: e._id }).sort({ order: 1 }).toArray();
    return { event: eventOut(e), disciplines: check.disciplines.map(disciplineOut), stages: stages.map(stageOut), publishCheck: { ok: check.ok, problems: check.problems } };
  });

  r.get('/organizations/:id/events', { schema: { tags: ['events'], params: Id, response: { 200: z.object({ items: z.array(Out) }), ...errors } } }, async (req) => {
    await req.requirePermission('event.manage', { type: 'organization', id: req.params.id });
    const items = await container.c.events.find({ organizerOrgId: req.params.id }).sort({ createdAt: -1 }).limit(200).toArray();
    return { items: items.map(eventOut) };
  });

  r.post('/events/:id/disciplines', { schema: { tags: ['events'], params: Id, body: DisciplineCreateSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(disciplineOut(await ev.addDiscipline(req.params.id, req.body, req.requireAuth().principal._id, req.id))));
  r.patch('/disciplines/:id', { schema: { tags: ['events'], params: Id, body: DisciplineUpdateSchema, response: { 200: Out, ...errors } } }, async (req) => disciplineOut(await ev.updateDiscipline(req.params.id, req.body, req.requireAuth().principal._id, req.id)));
  r.post('/disciplines/:id/stages', { schema: { tags: ['events'], params: Id, body: StageCreateSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(stageOut(await ev.addStage(req.params.id, req.body, req.requireAuth().principal._id, req.id))));
  r.get('/stages/:id/can-start', { schema: { tags: ['events'], params: Id, response: { 200: Out, ...errors } } }, async (req) => {
    const st = await container.c.stages.findOne({ _id: req.params.id });
    if (!st) throw new DomainError('NOT_FOUND', 'stage not found');
    await req.requirePermission('event.read_private', { type: 'event', id: st.eventId });
    return plain(await ev.canStartStage(req.params.id));
  });
  r.post('/stages/:id/start-exception', { schema: { tags: ['events'], params: Id, body: StageStartExceptionSchema, response: { 200: Out, ...errors } } }, async (req) => stageOut(await ev.grantStageStartException(req.params.id, req.body.approvalId, req.body.reason, req.requireAuth().principal._id, req.id)));

  r.get('/events/:id/publish-check', { schema: { tags: ['events'], params: Id, response: { 200: Out, ...errors } } }, async (req) => {
    const e = await ev.load(req.params.id);
    await req.requirePermission('event.read_private', { type: 'event', id: e._id });
    const c = await ev.publishCheck(e._id);
    return { ok: c.ok, problems: c.problems };
  });
  r.post('/events/:id/publish', { schema: { tags: ['events'], params: Id, response: { 200: Out, ...errors } } }, async (req) => eventOut(await ev.publish(req.params.id, req.requireAuth().principal._id, req.id)));
  r.post('/events/:id/schedule', { schema: { tags: ['events'], params: Id, body: EventScheduleSchema, response: { 200: Out, ...errors } } }, async (req) => eventOut(await ev.schedule(req.params.id, req.body.publishAt, req.body.expectedVersion, req.requireAuth().principal._id, req.id)));
  r.post('/events/:id/duplicate', { schema: { tags: ['events'], params: Id, body: EventDuplicateSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(eventOut(await ev.duplicate(req.params.id, req.body, req.requireAuth().principal._id, req.id))));
  r.post('/events/:id/cancel', { schema: { tags: ['events'], params: Id, body: z.object({ approvalId: z.string(), reason: z.string().min(5).max(2000) }), response: { 200: Out, ...errors } } }, async (req) => eventOut(await ev.cancel(req.params.id, req.body.approvalId, req.body.reason, req.requireAuth().principal._id, req.id)));

  // EVT-008: official affiliation claim (event staff) and independent decision (organizer.review)
  r.post('/events/:id/affiliation', { schema: { tags: ['events'], params: Id, body: EventAffiliationClaimSchema, response: { 200: Out, ...errors } } }, async (req) => eventOut(await ev.claimAffiliation(req.params.id, req.body, req.requireAuth().principal._id, req.id)));
  r.post('/events/:id/affiliation/decision', { schema: { tags: ['events'], params: Id, body: EventAffiliationDecisionSchema, response: { 200: Out, ...errors } } }, async (req) => eventOut(await ev.decideAffiliation(req.params.id, req.body.decision, req.body.note, req.requireAuth().principal._id, req.id)));
  r.get('/affiliations/pending', { schema: { tags: ['events'], response: { 200: z.object({ items: z.array(Out) }), ...errors } } }, async (req) => ({ items: (await ev.pendingAffiliations(req.requireAuth().principal._id, req.id)).map((e) => ({ eventId: e._id, name: e.name, organizerOrgId: e.organizerOrgId, affiliation: e.config.affiliation })) }));

  r.post('/seasons', { schema: { tags: ['events'], body: SeasonCreateSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await ev.createSeason(req.body, req.requireAuth().principal._id, req.id))));
  r.get('/seasons', { schema: { tags: ['events'], querystring: z.object({ gameId: z.string().optional() }), response: { 200: z.object({ items: z.array(Out) }) } } }, async (req) => ({ items: plainAll(await container.c.seasons.find(req.query.gameId ? { gameId: req.query.gameId } : {}).sort({ from: -1 }).limit(100).toArray()) }));
  r.post('/disciplines/:id/slots', { schema: { tags: ['events'], params: Id, body: QualificationSlotCreateSchema.extend({ resultVersion: z.number().int().nullable().default(null) }), response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await ev.createSlot(req.params.id, req.body, req.requireAuth().principal._id, req.id))));
  r.get('/disciplines/:id/slots', { schema: { tags: ['events'], params: Id, response: { 200: z.object({ items: z.array(Out) }), ...errors } } }, async (req) => {
    const d = await container.c.disciplines.findOne({ _id: req.params.id });
    if (!d) throw new DomainError('NOT_FOUND', 'discipline not found');
    await req.requirePermission('event.read_private', { type: 'event', id: d.eventId });
    return { items: plainAll(await container.c.qualificationSlots.find({ targetDisciplineId: d._id }).toArray()) };
  });
  r.post('/disciplines/:id/entry-codes', { schema: { tags: ['events'], params: Id, body: EntryCodeCreateSchema.extend({ count: z.number().int().min(1).max(500).default(1) }), response: { 201: z.object({ items: z.array(Out) }), ...errors } } }, async (req, reply) => {
    const { count, ...input } = req.body;
    return reply.status(201).send({ items: plainAll(await ev.createEntryCodes(req.params.id, input, count, req.requireAuth().principal._id, req.id)) });
  });
}
