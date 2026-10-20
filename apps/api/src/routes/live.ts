import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AssignmentSchema, ChatSendSchema, CommentSchema, CrewSchema, DomainError, ErrorResponse, HandoverSchema, LiveQuerySchema, LiveTabs, MarkReadSchema, MediaItemSchema, ModerationDecisionSchema, NewsListQuerySchema,
  NotificationPrefsUpdateSchema, OfficialMessageSchema, OverlaySchema, PageBeforeSchema, PostCreateSchema, PostEditSchema, PostFlagSchema, PostMediaSchema, PostNoteSchema, PostReturnSchema, PostScheduleSchema,
  PostVersionSchema, PostWithdrawSchema, ReactSchema, ReportSchema, SearchQuerySchema, StreamSchema, StreamUpdateSchema,
} from '@esp/contracts';
import { BroadcastService, CommunityService, HomeService, LiveService, NewsService, NotificationService, SearchService, type Container } from '@esp/core';

/**
 * ESP-06 API. The live centre has two separate families of endpoints: the stream-synced view (default, delayed by
 * the stream's broadcast delay, cacheable for a few seconds because later responses only reveal more) and the
 * explicit latest-result view (never cached). The synced endpoints refuse `view=latest`, so a delayed page can never
 * fetch or prefetch latest data by accident. Overlays are reachable only by their limited token.
 */
const Id = z.object({ id: z.string().min(1).max(64) });
const Out = z.record(z.string(), z.unknown());
const Items = z.object({ items: z.array(Out) });
const plain = <T extends object>(x: T): Record<string, unknown> => x as unknown as Record<string, unknown>;
const plainAll = <T extends object>(xs: T[]): Array<Record<string, unknown>> => xs.map(plain);

export function liveRoutes(app: FastifyInstance, ct: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const live = new LiveService(ct);
  const news = new NewsService(ct);
  const bc = new BroadcastService(ct);
  const com = new CommunityService(ct);
  const notes = new NotificationService(ct);
  const search = new SearchService(ct);
  const home = new HomeService(ct);
  const errors = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 412: ErrorResponse, 429: ErrorResponse };
  const me = (req: { requireAuth(): { principal: { _id: string } } }) => req.requireAuth().principal._id;
  const viewer = (req: { auth: { principal: { _id: string } } | null }) => req.auth?.principal._id ?? null;
  const filters = (q: z.infer<typeof LiveQuerySchema>) => ({ disciplineId: q.disciplineId, stageId: q.stageId, day: q.day, teamId: q.teamId, matchId: q.matchId, before: q.before });
  const syncedView = (v: string | undefined) => {
    if (v === 'latest') throw new DomainError('VALIDATION_FAILED', 'the latest-result view has its own endpoint (/latest)');
    return v;
  };
  const Tab = z.object({ id: z.string().max(64), tab: z.enum(LiveTabs) });

  // ------------------------------------------------------------------ live centre (LIVE-001..006, CAST-005/006)
  r.get('/live/events/:id', { schema: { tags: ['live'], summary: 'Live centre, stream-synced view (delayed)', params: Id, querystring: LiveQuerySchema, response: { 200: Out, ...errors } } }, async (req, reply) => {
    void reply.header('cache-control', 'public, max-age=5');
    return plain(await live.snapshot(req.params.id, syncedView(req.query.view), filters(req.query), viewer(req), req.query.t ?? null));
  });
  r.get('/live/events/:id/latest', { schema: { tags: ['live'], summary: 'Live centre, explicit latest-result view', params: Id, querystring: LiveQuerySchema, response: { 200: Out, ...errors } } }, async (req, reply) => {
    void reply.header('cache-control', 'no-store');
    return plain(await live.snapshot(req.params.id, 'latest', filters(req.query), viewer(req), req.query.t ?? null));
  });
  r.get('/live/events/:id/tabs/:tab', { schema: { tags: ['live'], params: Tab, querystring: LiveQuerySchema, response: { 200: Out, ...errors } } }, async (req, reply) => {
    void reply.header('cache-control', 'public, max-age=5');
    return plain(await live.section(req.params.id, syncedView(req.query.view), req.params.tab, filters(req.query), viewer(req), req.query.t ?? null));
  });
  r.get('/live/events/:id/latest/tabs/:tab', { schema: { tags: ['live'], params: Tab, querystring: LiveQuerySchema, response: { 200: Out, ...errors } } }, async (req, reply) => {
    void reply.header('cache-control', 'no-store');
    return plain(await live.section(req.params.id, 'latest', req.params.tab, filters(req.query), viewer(req), req.query.t ?? null));
  });

  // ------------------------------------------------------------------ news (NEWS, EDIT)
  r.get('/news', { schema: { tags: ['news'], querystring: NewsListQuerySchema, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await news.list(req.query)) }));
  r.get('/news/:id', { schema: { tags: ['news'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await news.bySlug(req.params.id)));
  r.get('/news/:id/meta', { schema: { tags: ['news'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await news.meta(req.params.id, ct.config.PUBLIC_WEB_ORIGIN)));
  r.get('/news/:id/card.svg', { schema: { tags: ['news'], params: Id } }, async (req, reply) => reply.type('image/svg+xml; charset=utf-8').header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'").header('cache-control', 'public, max-age=60').send(await news.card(req.params.id)));
  r.post('/news', { schema: { tags: ['newsroom'], body: PostCreateSchema, response: { 201: Out, ...errors } } }, async (req, reply) => {
    const out = await news.create(req.body, me(req), req.id);
    return reply.status(201).send({ post: plain(out.post), warnings: out.warnings });
  });
  r.patch('/news/:id', { schema: { tags: ['newsroom'], params: Id, body: PostEditSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await news.edit(req.params.id, req.body, me(req), req.id)));
  r.post('/news/:id/media', { schema: { tags: ['newsroom'], params: Id, body: PostMediaSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await news.attachMedia(req.params.id, req.body, me(req), req.id)));
  r.post('/news/:id/notes', { schema: { tags: ['newsroom'], params: Id, body: PostNoteSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await news.note(req.params.id, req.body.text, me(req), req.id)));
  r.post('/news/:id/submit', { schema: { tags: ['newsroom'], params: Id, body: PostVersionSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await news.submit(req.params.id, req.body.expectedVersion, me(req), req.id)));
  r.post('/news/:id/return', { schema: { tags: ['newsroom'], params: Id, body: PostReturnSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await news.returnToDraft(req.params.id, req.body.note, req.body.expectedVersion, me(req), req.id)));
  r.post('/news/:id/schedule', { schema: { tags: ['newsroom'], params: Id, body: PostScheduleSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await news.schedule(req.params.id, req.body.publishAt, req.body.expectedVersion, me(req), req.id)));
  r.post('/news/:id/publish', { schema: { tags: ['newsroom'], params: Id, body: PostVersionSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await news.publish(req.params.id, req.body.expectedVersion, me(req), req.id)));
  r.post('/news/:id/withdraw', { schema: { tags: ['newsroom'], params: Id, body: PostWithdrawSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await news.withdraw(req.params.id, req.body.reason, req.body.expectedVersion, me(req), req.id)));
  r.post('/news/:id/flags', { schema: { tags: ['newsroom'], params: Id, body: PostFlagSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await news.flag(req.params.id, req.body, me(req), req.id)));
  r.get('/newsroom/events/:id/queue', { schema: { tags: ['newsroom'], params: Id, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await news.newsroomQueue(req.params.id, me(req), req.id)) }));
  r.get('/newsroom/matches/:id/templates', { schema: { tags: ['newsroom'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await news.templates(req.params.id, me(req), req.id)));
  r.get('/newsroom/events/:id/assignments', { schema: { tags: ['newsroom'], params: Id, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await news.assignments(req.params.id, me(req), req.id)) }));
  r.post('/newsroom/events/:id/assignments', { schema: { tags: ['newsroom'], params: Id, body: AssignmentSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await news.assign({ eventId: req.params.id, ...req.body }, me(req), req.id)));
  r.post('/newsroom/assignments/:id/handover', { schema: { tags: ['newsroom'], params: Id, body: HandoverSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await news.handover(req.params.id, req.body.to, req.body.note, me(req), req.id)));
  r.post('/newsroom/events/:id/final-report', { schema: { tags: ['newsroom'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await news.draftFinalReport(req.params.id, me(req), req.id)));

  // ------------------------------------------------------------------ audience (AUD-001/002)
  r.get('/news/:id/reactions', { schema: { tags: ['community'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await com.reactionCounts(req.params.id)));
  r.post('/news/:id/reactions', { schema: { tags: ['community'], params: Id, body: ReactSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await com.react(req.params.id, req.body.emoji, me(req))));
  r.get('/news/:id/comments', { schema: { tags: ['community'], params: Id, querystring: PageBeforeSchema, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await com.comments(req.params.id, viewer(req), req.query)) }));
  r.post('/news/:id/comments', { schema: { tags: ['community'], params: Id, body: CommentSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await com.comment(req.params.id, req.body.text, me(req))));
  r.get('/events/:id/spectator-chat', { schema: { tags: ['community'], params: Id, querystring: PageBeforeSchema, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await com.spectatorMessages(req.params.id, req.query)) }));
  r.post('/events/:id/spectator-chat', { schema: { tags: ['community'], params: Id, body: ChatSendSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await com.send(`ev:${req.params.id}`, req.body.text, me(req))));
  r.get('/chat/rooms', { schema: { tags: ['community'], response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await com.myRooms(me(req))) }));
  r.post('/chat/dm', { schema: { tags: ['community'], body: z.object({ principalId: z.string().min(1).max(64) }), response: { 200: Out, ...errors } } }, async (req) => plain(await com.openDm(me(req), req.body.principalId)));
  r.get('/chat/rooms/:id/messages', { schema: { tags: ['community'], params: z.object({ id: z.string().min(1).max(200) }), querystring: PageBeforeSchema, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await com.messages(req.params.id, me(req), req.query)) }));
  r.post('/chat/rooms/:id/messages', { schema: { tags: ['community'], params: z.object({ id: z.string().min(1).max(200) }), body: ChatSendSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await com.send(req.params.id, req.body.text, me(req))));
  r.post('/reports', { schema: { tags: ['community'], body: ReportSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const d = await com.report(req.body, me(req));
    return { id: d._id, state: d.state };
  });
  r.get('/moderation/queue', { schema: { tags: ['community'], querystring: z.object({ eventId: z.string().max(64).optional() }), response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await com.queue(me(req), req.id, req.query.eventId)) }));
  r.post('/moderation/reports/:id/decision', { schema: { tags: ['community'], params: Id, body: ModerationDecisionSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await com.decide(req.params.id, req.body.action, req.body.note, me(req), req.id)));

  // ------------------------------------------------------------------ broadcast (CAST)
  r.get('/broadcast/events/:id/streams', { schema: { tags: ['broadcast'], params: Id, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await bc.streams(req.params.id, me(req), req.id)) }));
  r.post('/broadcast/events/:id/streams', { schema: { tags: ['broadcast'], params: Id, body: StreamSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await bc.addStream(req.params.id, req.body, me(req), req.id)));
  r.patch('/broadcast/streams/:id', { schema: { tags: ['broadcast'], params: Id, body: StreamUpdateSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await bc.updateStream(req.params.id, req.body, me(req), req.id)));
  r.get('/broadcast/events/:id/crew', { schema: { tags: ['broadcast'], params: Id, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await bc.crew(req.params.id, me(req), req.id)) }));
  r.post('/broadcast/events/:id/crew', { schema: { tags: ['broadcast'], params: Id, body: CrewSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await bc.assignCrew(req.params.id, req.body, me(req), req.id)));
  r.delete('/broadcast/crew/:id', { schema: { tags: ['broadcast'], params: Id, response: { 200: z.object({ ok: z.literal(true) }), ...errors } } }, async (req) => {
    await bc.endCrew(req.params.id, me(req), req.id);
    return { ok: true as const };
  });
  r.post('/broadcast/events/:id/media', { schema: { tags: ['broadcast'], params: Id, body: MediaItemSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await bc.addMedia(req.params.id, req.body, me(req), req.id)));
  r.get('/broadcast/events/:id/overlays', { schema: { tags: ['broadcast'], params: Id, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await bc.overlays(req.params.id, me(req), req.id)) }));
  r.post('/broadcast/events/:id/overlays', { schema: { tags: ['broadcast'], params: Id, body: OverlaySchema, response: { 200: Out, ...errors } } }, async (req) => plain(await bc.createOverlay(req.params.id, req.body, me(req), req.id)));
  r.delete('/broadcast/overlays/:id', { schema: { tags: ['broadcast'], params: Id, response: { 200: z.object({ ok: z.literal(true) }), ...errors } } }, async (req) => {
    await bc.revokeOverlay(req.params.id, me(req), req.id);
    return { ok: true as const };
  });
  r.get('/overlay/:token', { schema: { tags: ['broadcast'], summary: 'Broadcast graphics data for an overlay token (OBS browser source)', params: z.object({ token: z.string().min(20).max(64) }), response: { 200: Out, ...errors } } }, async (req, reply) => {
    void reply.header('cache-control', 'no-store');
    return plain(await bc.overlayState(req.params.token));
  });

  // ------------------------------------------------------------------ notifications (COM)
  r.get('/me/notifications', { schema: { tags: ['notifications'], querystring: z.object({ before: z.string().max(40).optional(), unread: z.coerce.boolean().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }), response: { 200: Out, ...errors } } }, async (req) => plain(await notes.inbox(me(req), { before: req.query.before, unreadOnly: req.query.unread, limit: req.query.limit })));
  r.post('/me/notifications/read', { schema: { tags: ['notifications'], body: MarkReadSchema, response: { 200: Out, ...errors } } }, async (req) => ({ updated: await notes.markRead(me(req), req.body.ids) }));
  r.post('/me/notifications/:id/ack', { schema: { tags: ['notifications'], params: Id, response: { 200: z.object({ ok: z.literal(true) }), ...errors } } }, async (req) => {
    await notes.ack(me(req), req.params.id);
    return { ok: true as const };
  });
  r.get('/me/notification-prefs', { schema: { tags: ['notifications'], response: { 200: Out, ...errors } } }, async (req) => {
    const { unsubscribeToken: _t, ...p } = await notes.prefs(me(req));
    return plain(p);
  });
  r.patch('/me/notification-prefs', { schema: { tags: ['notifications'], body: NotificationPrefsUpdateSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const input = req.body as Parameters<NotificationService['updatePrefs']>[1];
    const { unsubscribeToken: _t, ...p } = await notes.updatePrefs(me(req), input);
    return plain(p);
  });
  r.post('/notifications/unsubscribe', { schema: { tags: ['notifications'], body: z.object({ token: z.string().min(10).max(64) }), response: { 200: z.object({ ok: z.literal(true) }), ...errors } } }, async (req) => {
    await notes.unsubscribePromotional(req.body.token);
    return { ok: true as const };
  });
  r.post('/events/:id/official-messages', { schema: { tags: ['notifications'], params: Id, body: OfficialMessageSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await notes.sendOfficial(req.params.id, req.body, me(req), req.id)));
  r.get('/events/:id/official-messages', { schema: { tags: ['notifications'], params: Id, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await notes.officialList(req.params.id, me(req), req.id)) }));
  r.get('/official-messages/:id/report', { schema: { tags: ['notifications'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await notes.officialReport(req.params.id, me(req), req.id)));
  r.get('/ops/notifications', { schema: { tags: ['notifications'], response: { 200: Out, ...errors } } }, async (req) => {
    await ct.acl.require(me(req), 'outbox.read', { type: 'site', id: 'site' }, req.id);
    return plain(await notes.queueHealth());
  });

  // ------------------------------------------------------------------ search and home (UX-001/002)
  r.get('/search', { schema: { tags: ['search'], querystring: SearchQuerySchema, response: { 200: Out, ...errors } } }, async (req) => plain(await search.search(req.query, viewer(req))));
  r.get('/home', { schema: { tags: ['search'], response: { 200: Out, ...errors } } }, async (req, reply) => {
    void reply.header('cache-control', 'private, no-store');
    return plain(await home.home(viewer(req)));
  });
}
