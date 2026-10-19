import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ErrorResponse,
  OrganizerApplicationSchema,
  OrganizerListQuerySchema,
  OrganizerProfileUpdateSchema,
  OrganizerRatingModerationListSchema,
  OrganizerRatingModerationSchema,
  OrganizerRatingSchema,
  OrganizerResubmitSchema,
  OrganizerReviewSchema,
  OrganizerVerificationRevokeSchema,
} from '@esp/contracts';
import { OrganizerService, type Container } from '@esp/core';

const errs = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 412: ErrorResponse };
const Obj = z.record(z.string(), z.unknown());
const List = z.object({ items: z.array(Obj) });
const id = z.object({ id: z.string().min(1).max(64) });

/** ADM-002/003/004/010. Permissions are resolved server-side per organization; public responses are explicit projections. */
export function organizerRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const svc = new OrganizerService(container);
  const who = (req: { requireAuth(): { principal: { _id: string } } }) => req.requireAuth().principal._id;

  // ---- applications
  r.post('/organizers/applications', { schema: { tags: ['organizer'], summary: 'Apply for organizer verification (organization owner/manager)', body: OrganizerApplicationSchema, response: { 201: Obj, ...errs } } }, async (req, reply) =>
    reply.status(201).send(svc.applicationView(await svc.submit(who(req), req.body, req.id))),
  );
  r.get('/me/organizer-applications', { schema: { tags: ['organizer'], response: { 200: List, ...errs } } }, async (req) => ({ items: (await svc.myApplications(who(req))).map((a) => svc.applicationView(a)) }));
  r.patch('/organizers/applications/:id', { schema: { tags: ['organizer'], summary: 'Resubmit after needs_info', params: id, body: OrganizerResubmitSchema, response: { 200: Obj, ...errs } } }, async (req) =>
    svc.applicationView(await svc.resubmit(who(req), req.params.id, req.body, req.id)),
  );
  r.get('/organizers/applications', { schema: { tags: ['organizer'], summary: 'Review queue (organizer.review)', querystring: z.object({ state: z.enum(['submitted', 'needs_info', 'under_review', 'approved', 'rejected']).optional() }), response: { 200: List, ...errs } } }, async (req) => ({
    items: (await svc.queue(who(req), req.query.state, req.id)).map((a) => svc.applicationView(a)),
  }));
  r.post('/organizers/applications/:id/review', { schema: { tags: ['organizer'], summary: 'Request info / start review / approve (level + limits) / reject', params: id, body: OrganizerReviewSchema, response: { 200: Obj, ...errs } } }, async (req) =>
    svc.applicationView(await svc.review(who(req), req.params.id, req.body, req.id)),
  );
  r.post('/organizers/:id/verification/revoke', { schema: { tags: ['organizer'], summary: 'Revoke verification and organizer grants (organizer.review)', params: id, body: OrganizerVerificationRevokeSchema, response: { 200: Obj, ...errs } } }, async (req) => {
    const p = await svc.revokeVerification(who(req), req.params.id, req.body.reason, req.id);
    return { organizationId: req.params.id, verification: p?.verified.state ?? 'revoked' };
  });

  // ---- profile (editor) and public pages
  r.get('/organizers/:id/profile', { schema: { tags: ['organizer'], summary: 'Editable profile (organizer.profile.manage)', params: id, response: { 200: Obj, ...errs } } }, async (req) => {
    const p = await svc.profileForEdit(who(req), req.params.id, req.id);
    return { ...p, id: p._id };
  });
  r.patch('/organizers/:id/profile', { schema: { tags: ['organizer'], summary: 'Edit public organizer profile (organizer.profile.manage)', params: id, body: OrganizerProfileUpdateSchema, response: { 200: Obj, ...errs } } }, async (req) => {
    const p = await svc.updateProfile(who(req), req.params.id, req.body, req.id);
    return { id: p._id, version: p.version, updatedAt: p.updatedAt };
  });
  r.get('/organizers', { schema: { tags: ['organizer'], summary: 'Public list of verified organizers', querystring: OrganizerListQuerySchema, response: { 200: List, 400: ErrorResponse } } }, async (req) => ({ items: await svc.publicList(req.query) }));
  r.get('/organizers/:slug', { schema: { tags: ['organizer'], summary: 'Public organizer page', params: z.object({ slug: z.string().min(2).max(60) }), response: { 200: Obj, 404: ErrorResponse } } }, async (req) => svc.publicPage(req.params.slug));

  // ---- ratings
  r.post('/organizers/:id/ratings', { schema: { tags: ['organizer'], summary: 'Rate an organizer (confirmed participant of a finished event)', params: id, body: OrganizerRatingSchema, response: { 201: Obj, ...errs } } }, async (req, reply) =>
    reply.status(201).send(svc.ratingView(await svc.rate(who(req), req.params.id, req.body, req.id))),
  );
  r.get('/organizer-ratings/moderation', { schema: { tags: ['organizer'], summary: 'All ratings incl. hidden (rating.moderate)', querystring: OrganizerRatingModerationListSchema, response: { 200: List, ...errs } } }, async (req) => ({
    items: (await svc.moderationList(who(req), req.query, req.id)).map((x) => svc.ratingView(x)),
  }));
  r.patch('/organizer-ratings/:id/moderation', { schema: { tags: ['organizer'], summary: 'Hide/unhide a rating with a reason (rating.moderate)', params: id, body: OrganizerRatingModerationSchema, response: { 200: Obj, ...errs } } }, async (req) =>
    svc.ratingView(await svc.moderate(who(req), req.params.id, req.body.action, req.body.reason, req.id)),
  );
}
