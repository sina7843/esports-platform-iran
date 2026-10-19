import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApplicationCreateSchema, ApplicationDecisionSchema, ErrorResponse, RecruitmentAdSchema, RecruitmentFilterSchema, ScrimProposeSchema, ScrimRequestSchema, ScrimResultSchema } from '@esp/contracts';
import { RecruitmentService, type Container } from '@esp/core';

const errs = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse };
const Obj = z.record(z.string(), z.unknown());
const List = z.object({ items: z.array(Obj) });
const Page = z.object({ items: z.array(Obj), page: z.object({ nextCursor: z.string().nullable(), limit: z.number().int() }) });
const id = z.object({ id: z.string().min(1).max(64) });

/** REC-001..005. Lists are public projections with cursor pagination; every write is authorized per team. */
export function recruitmentRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const svc = new RecruitmentService(container);
  const who = (req: { requireAuth(): { principal: { _id: string } } }) => req.requireAuth().principal._id;

  // ---- ads
  r.get('/recruitment/ads', { schema: { tags: ['recruitment'], summary: 'Open recruitment ads (filters + cursor)', querystring: RecruitmentFilterSchema, response: { 200: Page, 400: ErrorResponse } } }, async (req) => {
    const res = await svc.listAds(req.query);
    return { items: res.items, page: { nextCursor: res.nextCursor, limit: req.query.limit } };
  });
  r.get('/recruitment/ads/:id', { schema: { tags: ['recruitment'], params: id, response: { 200: Obj, 404: ErrorResponse } } }, async (req) => svc.getAd(req.params.id));
  r.post('/teams/:id/recruitment/ads', { schema: { tags: ['recruitment'], summary: 'Create an ad (recruitment.manage)', params: id, body: RecruitmentAdSchema, response: { 201: Obj, ...errs } } }, async (req, reply) =>
    reply.status(201).send(await svc.adView(await svc.createAd(who(req), req.params.id, req.body, req.id))),
  );
  r.get('/teams/:id/recruitment/ads', { schema: { tags: ['recruitment'], params: id, response: { 200: List, ...errs } } }, async (req) => ({ items: await svc.teamAds(who(req), req.params.id, req.id) }));
  r.post('/recruitment/ads/:id/close', { schema: { tags: ['recruitment'], params: id, response: { 200: Obj, ...errs } } }, async (req) => svc.adView(await svc.closeAd(who(req), req.params.id, req.id)));

  // ---- applications
  r.post('/recruitment/ads/:id/applications', { schema: { tags: ['recruitment'], params: id, body: ApplicationCreateSchema, response: { 201: Obj, ...errs } } }, async (req, reply) =>
    reply.status(201).send(svc.appView(await svc.apply(who(req), req.params.id, req.body.message, req.id))),
  );
  r.get('/recruitment/ads/:id/applications', { schema: { tags: ['recruitment'], summary: 'Applications for an ad (stay visible after the ad is closed)', params: id, response: { 200: z.object({ adState: z.string(), items: z.array(Obj) }), ...errs } } }, async (req) =>
    svc.listApplications(who(req), req.params.id, req.id),
  );
  r.get('/me/recruitment/applications', { schema: { tags: ['recruitment'], response: { 200: List, ...errs } } }, async (req) => ({ items: await svc.myApplications(who(req)) }));
  r.post('/recruitment/applications/:id/withdraw', { schema: { tags: ['recruitment'], params: id, response: { 200: Obj, ...errs } } }, async (req) => svc.appView(await svc.withdraw(who(req), req.params.id, req.id)));
  r.post('/recruitment/applications/:id/decision', { schema: { tags: ['recruitment'], summary: 'invite_tryout | start_review | accept | reject; accept creates a team invitation, not a membership', params: id, body: ApplicationDecisionSchema, response: { 200: z.object({ application: Obj, invitationId: z.string().nullable() }), ...errs } } }, async (req) => {
    const res = await svc.decide(who(req), req.params.id, req.body, req.id);
    return { application: svc.appView(res.application), invitationId: res.invitationId };
  });

  // ---- looking for team
  r.get('/recruitment/players', { schema: { tags: ['recruitment'], summary: 'Players looking for a team (public projection, privacy and blocks respected)', querystring: z.object({ gameId: z.string().max(64).optional(), city: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().optional() }), response: { 200: Page, 400: ErrorResponse } } }, async (req) => {
    const res = await svc.lookingForTeam(req.query, req.auth?.principal._id ?? null);
    return { items: res.items, page: { nextCursor: res.nextCursor, limit: req.query.limit } };
  });

  // ---- scrims
  r.get('/scrims', { schema: { tags: ['scrims'], summary: 'Open scrim requests by game/level/time', querystring: z.object({ gameId: z.string().max(64).optional(), level: z.string().max(40).optional(), from: z.string().optional(), to: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().optional() }), response: { 200: Page, 400: ErrorResponse } } }, async (req) => {
    const res = await svc.searchScrims(req.query);
    return { items: res.items, page: { nextCursor: res.nextCursor, limit: req.query.limit } };
  });
  r.post('/teams/:id/scrims', { schema: { tags: ['scrims'], params: id, body: ScrimRequestSchema, response: { 201: Obj, ...errs } } }, async (req, reply) =>
    reply.status(201).send(await svc.scrimView(await svc.createScrim(who(req), req.params.id, req.body, req.id))),
  );
  r.get('/teams/:id/scrims', { schema: { tags: ['scrims'], params: id, response: { 200: List, ...errs } } }, async (req) => ({ items: await svc.teamScrims(who(req), req.params.id, req.id) }));
  r.post('/scrims/:id/propose', { schema: { tags: ['scrims'], summary: 'Another team proposes a time/server inside the window (scrim.manage on that team)', params: id, body: ScrimProposeSchema.extend({ teamId: z.string().min(1).max(64) }), response: { 200: Obj, ...errs } } }, async (req) => {
    const { teamId, ...p } = req.body;
    return svc.scrimView(await svc.propose(who(req), req.params.id, teamId, p, req.id));
  });
  r.post('/scrims/:id/accept', { schema: { tags: ['scrims'], params: id, response: { 200: Obj, ...errs } } }, async (req) => svc.scrimView(await svc.answer(who(req), req.params.id, 'accept', req.id)));
  r.post('/scrims/:id/decline', { schema: { tags: ['scrims'], params: id, response: { 200: Obj, ...errs } } }, async (req) => svc.scrimView(await svc.answer(who(req), req.params.id, 'decline', req.id)));
  r.post('/scrims/:id/cancel', { schema: { tags: ['scrims'], params: id, response: { 200: Obj, ...errs } } }, async (req) => svc.scrimView(await svc.cancelScrim(who(req), req.params.id, req.id)));
  r.post('/scrims/:id/result', { schema: { tags: ['scrims'], summary: 'Report a friendly result (label friendly, never counts for rating)', params: id, body: ScrimResultSchema.extend({ teamId: z.string().min(1).max(64) }), response: { 200: Obj, ...errs } } }, async (req) => {
    const { teamId, ...p } = req.body;
    return svc.scrimView(await svc.reportResult(who(req), req.params.id, teamId, p, req.id));
  });
}
