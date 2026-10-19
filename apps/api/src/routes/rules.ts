import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AmendmentSchema, ConflictCreateSchema, ConflictResolveSchema, ErrorResponse, RulesAcceptanceSchema, RulesListQuerySchema, RulesPackageCreateSchema, RulesPackageUpdateSchema, RulesReviewSchema, RulesTransitionSchema, ValidateSettingsBodySchema } from '@esp/contracts';
import { RulesService, type Container } from '@esp/core';

const errs = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 412: ErrorResponse };
const Obj = z.record(z.string(), z.unknown());
const List = z.object({ items: z.array(Obj) });
const id = z.object({ id: z.string().min(1).max(64) });

/** RULE-001..012. Published packages are public (projection); working data only for managers. */
export function rulesRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const svc = new RulesService(container);
  const who = (req: { requireAuth(): { principal: { _id: string } } }) => req.requireAuth().principal._id;
  const maybe = (req: { auth: { principal: { _id: string } } | null }) => req.auth?.principal._id ?? null;
  const full = async (me: string, pid: string) => svc.get(me, pid);

  r.get('/rules', { schema: { tags: ['rules'], summary: 'Published packages (public) or working packages you manage', querystring: RulesListQuerySchema, response: { 200: List, ...errs } } }, async (req) => ({ items: (await svc.list(maybe(req), req.query)) as Array<Record<string, unknown>> }));
  r.get('/rules/review-reminders', { schema: { tags: ['rules'], summary: 'Monthly review due + packages of events starting within 14 days (rules.review)', response: { 200: List, ...errs } } }, async (req) => ({ items: await svc.reminders(who(req), req.id) }));
  r.get('/rules/reacceptance', { schema: { tags: ['rules'], summary: 'Do I need to re-accept rules for an event?', querystring: z.object({ eventId: z.string().min(1).max(64) }), response: { 200: Obj, ...errs } } }, async (req) => ({ eventId: req.query.eventId, needed: await svc.needsReacceptance(who(req), req.query.eventId) }));
  r.get('/rules/:id', { schema: { tags: ['rules'], params: id, response: { 200: Obj, ...errs } } }, async (req) => svc.get(maybe(req), req.params.id));
  r.post('/rules', { schema: { tags: ['rules'], summary: 'Create a draft package (scope-dependent permission)', body: RulesPackageCreateSchema, response: { 201: Obj, ...errs } } }, async (req, reply) => {
    const me = who(req);
    const p = await svc.create(me, req.body, req.id);
    return reply.status(201).send(await full(me, p._id));
  });
  r.patch('/rules/:id', { schema: { tags: ['rules'], summary: 'Edit a draft (published packages are immutable)', params: id, body: RulesPackageUpdateSchema, response: { 200: Obj, ...errs } } }, async (req) => {
    const me = who(req);
    await svc.update(me, req.params.id, req.body, req.id);
    return full(me, req.params.id);
  });
  r.post('/rules/:id/transition', { schema: { tags: ['rules'], params: id, body: RulesTransitionSchema, response: { 200: Obj, ...errs } } }, async (req) => {
    const me = who(req);
    await svc.transition(me, req.params.id, req.body, req.id);
    return full(me, req.params.id);
  });
  r.post('/rules/:id/review', { schema: { tags: ['rules'], summary: 'Reviewer sign-off; response lists human-review clauses (rules.review)', params: id, body: RulesReviewSchema, response: { 200: Obj, ...errs } } }, async (req) => {
    const me = who(req);
    await svc.review(me, req.params.id, req.body, req.id);
    return full(me, req.params.id);
  });
  r.post('/rules/:id/conflicts', { schema: { tags: ['rules'], params: id, body: ConflictCreateSchema, response: { 200: Obj, ...errs } } }, async (req) => {
    const me = who(req);
    await svc.recordConflict(me, req.params.id, req.body, req.id);
    return full(me, req.params.id);
  });
  r.post('/rules/:id/conflicts/:cid/resolve', { schema: { tags: ['rules'], params: id.extend({ cid: z.string().min(1).max(64) }), body: ConflictResolveSchema, response: { 200: Obj, ...errs } } }, async (req) => {
    const me = who(req);
    await svc.resolveConflict(me, req.params.id, req.params.cid, req.body, req.id);
    return full(me, req.params.id);
  });
  r.post('/rules/:id/amendments', { schema: { tags: ['rules'], summary: 'New version superseding a published package', params: id, body: AmendmentSchema, response: { 201: Obj, ...errs } } }, async (req, reply) => {
    const me = who(req);
    const p = await svc.amend(me, req.params.id, req.body, req.id);
    return reply.status(201).send(await full(me, p._id));
  });
  r.post('/rules/:id/validate-settings', { schema: { tags: ['rules'], summary: 'Check organizer settings against clause bounds', params: id, body: ValidateSettingsBodySchema, response: { 200: Obj, ...errs } } }, async (req) => {
    who(req);
    return svc.validateSettings(req.params.id, req.body.settings);
  });
  r.post('/rules/:id/accept', { schema: { tags: ['rules'], summary: 'Accept a published package (idempotent)', params: id, body: RulesAcceptanceSchema.shape.context.optional(), response: { 200: Obj, ...errs } } }, async (req) => {
    const { doc, created } = await svc.accept(who(req), req.params.id, req.body ?? { eventId: null, participationId: null }, req.id);
    return { id: doc._id, packageId: doc.packageId, versionLabel: doc.packageVersionLabel, clausesHash: doc.clausesHash, context: doc.context, acceptedAt: doc.acceptedAt, created };
  });
  r.get('/rules/:id/acceptances', { schema: { tags: ['rules'], params: id, querystring: z.object({ eventId: z.string().max(64).optional() }), response: { 200: List, ...errs } } }, async (req) => ({
    items: (await svc.acceptances(who(req), req.params.id, req.query.eventId, req.id)).map((a) => ({ id: a._id, principalId: a.principalId, versionLabel: a.packageVersionLabel, clausesHash: a.clausesHash, context: a.context, acceptedAt: a.acceptedAt })),
  }));
}
