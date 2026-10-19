import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AccountReviewDecisionSchema, AccountReviewQuerySchema, AccountReviewStates, ErrorResponse, FollowSchema, FollowTargetTypes, SITE_SCOPE, decodeCursor, encodeCursor } from '@esp/contracts';
import { ReviewService, SocialService, type Container } from '@esp/core';

const errs = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse };
const TargetParams = z.object({ targetType: z.enum(FollowTargetTypes), targetId: z.string().min(1).max(64) });
const Review = z.object({
  id: z.string(),
  principals: z.array(z.object({ id: z.string(), nickname: z.string().nullable(), status: z.string().nullable() })),
  reason: z.string(),
  signals: z.record(z.string(), z.unknown()),
  state: z.enum(AccountReviewStates),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
});

/** USR-008 (follow/block/message policy) and USR-010 (account review queue, `account.review` in site scope). */
export function socialRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const social = new SocialService(container);
  const reviews = new ReviewService(container);
  const reviewOut = (d: Awaited<ReturnType<ReviewService['list']>>[number]) => ({ id: d._id, principals: d.principals, reason: d.reason, signals: d.signals, state: d.state, decidedBy: d.decidedBy, decidedAt: d.decidedAt, note: d.note, createdAt: d.createdAt, version: d.version });

  r.post('/follows', { schema: { tags: ['social'], summary: 'Follow a player, team, game, organizer or event (idempotent)', body: FollowSchema, response: { 200: z.object({ following: z.literal(true), followerCount: z.number().int() }), ...errs } } }, async (req) =>
    social.follow(req.requireAuth().principal._id, req.body.targetType, req.body.targetId, req.id),
  );

  r.delete('/follows/:targetType/:targetId', { schema: { tags: ['social'], summary: 'Unfollow (idempotent)', params: TargetParams, response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    await social.unfollow(req.requireAuth().principal._id, req.params.targetType, req.params.targetId, req.id);
    return reply.status(204).send(null);
  });

  r.get('/follows/:targetType/:targetId/count', { schema: { tags: ['social'], params: TargetParams, response: { 200: z.object({ followerCount: z.number().int() }) } } }, async (req) => ({ followerCount: await social.followerCount(req.params.targetType, req.params.targetId) }));

  r.get('/me/following', { schema: { tags: ['social'], querystring: z.object({ targetType: z.enum(FollowTargetTypes).optional() }), response: { 200: z.object({ items: z.array(z.object({ targetType: z.enum(FollowTargetTypes), targetId: z.string(), label: z.string().nullable(), since: z.string() })) }), ...errs } } }, async (req) => ({
    items: await social.listFollowing(req.requireAuth().principal._id, req.query.targetType),
  }));

  r.put('/me/blocks/:principalId', { schema: { tags: ['social'], summary: 'Block a player (idempotent); removes follows both ways', params: z.object({ principalId: z.string().min(1).max(64) }), response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    await social.block(req.requireAuth().principal._id, req.params.principalId, req.id);
    return reply.status(204).send(null);
  });

  r.delete('/me/blocks/:principalId', { schema: { tags: ['social'], params: z.object({ principalId: z.string().min(1).max(64) }), response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    await social.unblock(req.requireAuth().principal._id, req.params.principalId, req.id);
    return reply.status(204).send(null);
  });

  r.get('/me/blocks', { schema: { tags: ['social'], response: { 200: z.object({ items: z.array(z.object({ principalId: z.string(), nickname: z.string().nullable(), since: z.string() })) }), ...errs } } }, async (req) => ({ items: await social.listBlocks(req.requireAuth().principal._id) }));

  // ---- account review queue (never merges data)
  r.get('/admin/account-reviews', { schema: { tags: ['account-review'], querystring: AccountReviewQuerySchema, response: { 200: z.object({ items: z.array(Review), page: z.object({ nextCursor: z.string().nullable(), limit: z.number().int() }) }), ...errs } } }, async (req) => {
    await req.requirePermission('account.review', SITE_SCOPE);
    const cursor = decodeCursor(req.query.cursor, z.object({ at: z.string() }));
    const rows = await reviews.list({ state: req.query.state, limit: req.query.limit + 1, afterCreatedAt: cursor?.at });
    const page = rows.slice(0, req.query.limit);
    const last = page[page.length - 1];
    return { items: page.map(reviewOut), page: { nextCursor: rows.length > req.query.limit && last ? encodeCursor({ at: last.createdAt }) : null, limit: req.query.limit } };
  });

  r.post('/admin/account-reviews/:id/decision', { schema: { tags: ['account-review'], summary: 'Record a decision (no automatic merge); resolved_suspended suspends the named accounts and revokes their sessions', params: z.object({ id: z.string().min(1).max(64) }), body: AccountReviewDecisionSchema, response: { 200: Review, ...errs } } }, async (req) => {
    await req.requirePermission('account.review', SITE_SCOPE);
    const me = req.requireAuth().principal._id;
    const done = await reviews.decide(req.params.id, req.body, { principalId: me, requestId: req.id });
    const [row] = await reviews.list({ limit: 1, id: done._id });
    return reviewOut(row ?? { ...done, principals: [] });
  });
}
