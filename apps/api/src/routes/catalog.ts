import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DomainError, ErrorResponse, GameCreateSchema, GameFilterSchema, GameStateTransitionSchema, GameUpdateSchema, ModuleValidateSchema, ReadinessUpsertSchema } from '@esp/contracts';
import { GameService, getGameModule, listGameModules, type Container } from '@esp/core';

const errs = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 412: ErrorResponse };
const Obj = z.record(z.string(), z.unknown());
const List = z.object({ items: z.array(Obj) });
const id = z.object({ id: z.string().min(1).max(64) });

/** GAME-001..006. Public reads are explicit projections that state readiness and capabilities honestly. */
export function catalogRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const svc = new GameService(container);
  const who = (req: { requireAuth(): { principal: { _id: string } } }) => req.requireAuth().principal._id;

  r.get('/catalog/games', { schema: { tags: ['catalog'], summary: 'Public game list with state and readiness', querystring: GameFilterSchema, response: { 200: List, 400: ErrorResponse } } }, async (req) => ({ items: await svc.list(req.query) }));
  r.get('/catalog/games/:id', { schema: { tags: ['catalog'], summary: 'Public game detail (id or slug)', params: id, response: { 200: Obj, 404: ErrorResponse } } }, async (req) => svc.view(await svc.get(req.params.id)));
  r.post('/catalog/games', { schema: { tags: ['catalog'], summary: 'Create a game as proposed (catalog.manage)', body: GameCreateSchema, response: { 201: Obj, ...errs } } }, async (req, reply) => reply.status(201).send(await svc.view(await svc.create(who(req), req.body, req.id))));
  r.patch('/catalog/games/:id', { schema: { tags: ['catalog'], params: id, body: GameUpdateSchema, response: { 200: Obj, ...errs } } }, async (req) => svc.view(await svc.update(who(req), req.params.id, req.body, req.id)));
  r.post('/catalog/games/:id/transition', { schema: { tags: ['catalog'], summary: 'State machine; ready needs evidence, a reviewed package and a ready mode', params: id, body: GameStateTransitionSchema, response: { 200: Obj, ...errs } } }, async (req) =>
    svc.view(await svc.transition(who(req), req.params.id, req.body, req.id)),
  );
  r.put('/catalog/games/:id/readiness', { schema: { tags: ['catalog'], summary: 'Upsert readiness of one (version, platform, mode)', params: id, body: ReadinessUpsertSchema, response: { 200: Obj, ...errs } } }, async (req) => {
    const x = await svc.upsertReadiness(who(req), req.params.id, req.body, req.id);
    return { version: x.version, platform: x.platform, mode: x.mode, state: x.state, reviewedAt: x.reviewedAt };
  });
  r.get('/catalog/games/:id/history', { schema: { tags: ['catalog'], params: id, response: { 200: List, ...errs } } }, async (req) => ({ items: (await svc.history(who(req), req.params.id, req.id)) as unknown as Array<Record<string, unknown>> }));

  r.get('/catalog/modules', { schema: { tags: ['catalog'], summary: 'Game module descriptors (all TEST ONLY generic modules)', response: { 200: List } } }, async () => ({ items: listGameModules() }));
  r.post('/catalog/modules/:id/validate', { schema: { tags: ['catalog'], summary: 'Validation tool: check a result payload against a module', params: id, body: ModuleValidateSchema, response: { 200: Obj, ...errs } } }, async (req) => {
    who(req);
    const m = getGameModule(req.params.id);
    if (!m) throw new DomainError('NOT_FOUND', 'module not found');
    return { moduleId: m.descriptor.id, testOnly: m.descriptor.testOnly, ...m.validateResult(req.body.values) };
  });
}
