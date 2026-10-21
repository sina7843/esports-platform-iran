import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DomainError, ErrorResponse, SITE_SCOPE } from '@esp/contracts';
import {
  BulkService, DataRequestService, LegalHoldService, LegalService, ModerationAppealService, OpsDashboardService, PartnerService, ProviderRegistryService, ReportService, RetentionService, ServiceHealthService,
  SettingsService, TaskService, rotateSealedSecrets, TicketService, UserAdminService, replayWebhook, type Container,
} from '@esp/core';

/**
 * ESP-07 administration API (ADM-001..013, OPS-001..003). Every handler authenticates the caller and the service
 * layer enforces the permission in the resource scope; nothing here trusts the UI.
 */
const Id = z.object({ id: z.string().min(1).max(80) });
const Out = z.record(z.string(), z.unknown());
const Items = z.object({ items: z.array(Out) });
const plain = <T extends object>(x: T): Record<string, unknown> => x as unknown as Record<string, unknown>;
const list = <T extends object>(xs: T[]) => ({ items: xs.map(plain) });
const Kind = z.enum(['terms', 'privacy', 'consent_marketing', 'retention']);
const ScopeRef = z.object({ type: z.enum(['site', 'event']), id: z.string().min(1).max(80) });
const Priority = z.enum(['low', 'normal', 'high', 'urgent']);
const TicketCategory = z.enum(['account', 'payment', 'registration', 'match', 'result', 'content', 'technical', 'other']);
const errors = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 412: ErrorResponse, 429: ErrorResponse };

export function adminRoutes(app: FastifyInstance, ct: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const me = (req: { requireAuth(): { principal: { _id: string } } }) => req.requireAuth().principal._id;
  const tasks = new TaskService(ct);
  const tickets = new TicketService(ct);
  const bulk = new BulkService(ct);
  const settings = new SettingsService(ct);
  const users = new UserAdminService(ct);
  const appeals = new ModerationAppealService(ct);
  const legal = new LegalService(ct);
  const holds = new LegalHoldService(ct);
  const retention = new RetentionService(ct);
  const dsr = new DataRequestService(ct);
  const providers = new ProviderRegistryService(ct);
  const partners = new PartnerService(ct);
  const ops = new OpsDashboardService(ct);
  const reports = new ReportService(ct);
  const health = new ServiceHealthService(ct);
  const sch = <S extends object>(extra?: S) => ({ tags: ['admin'], response: { 200: Out, ...errors }, ...extra }) as { tags: string[]; response: { 200: typeof Out } & typeof errors } & S;

  // ---- users (ADM-001)
  r.get('/admin/users', { schema: sch({ querystring: z.object({ q: z.string().min(2).max(80) }), response: { 200: Items, ...errors } }) }, async (req) => ({ items: await users.search(req.query.q, me(req), req.id) }));
  r.post('/admin/users/:id/status', { schema: sch({ params: Id, body: z.object({ status: z.enum(['active', 'suspended']), reason: z.string().min(5).max(500) }) }) }, async (req) => plain(await users.setStatus(req.params.id, req.body.status, req.body.reason, me(req), req.id)));

  // ---- settings (ADM-001)
  r.get('/admin/settings', { schema: sch({ response: { 200: z.object({ keys: z.array(z.string()), items: z.array(Out) }), ...errors } }) }, async (req) => ({ keys: [...SettingsService.KEYS], ...list(await settings.list(me(req), req.id)) }));
  r.put('/admin/settings/:key', { schema: sch({ params: z.object({ key: z.string().max(80) }), body: z.object({ value: z.unknown(), reason: z.string().min(5).max(500) }) }) }, async (req) => plain(await settings.set(req.params.key, req.body.value, req.body.reason, me(req), req.id)));

  // ---- tasks (ADM-007)
  const TaskScope = z.object({ scopeType: z.enum(['site', 'event']), scopeId: z.string().max(80) });
  r.get('/admin/tasks', { schema: sch({ querystring: TaskScope.extend({ state: z.string().optional(), mine: z.coerce.boolean().optional() }), response: { 200: Items, ...errors } }) }, async (req) => list(await tasks.list({ type: req.query.scopeType, id: req.query.scopeId } as never, { state: req.query.state, mine: req.query.mine }, me(req), req.id)));
  r.post('/admin/tasks', { schema: sch({ body: z.object({ scope: ScopeRef, title: z.string().min(3).max(200), description: z.string().max(4000).default(''), ownerId: z.string().nullable().default(null), dueAt: z.string().datetime().nullable().default(null), priority: Priority.default('normal'), links: z.object({ matchId: z.string().nullable(), paymentId: z.string().nullable(), ticketId: z.string().nullable() }).partial().optional() }) }) }, async (req) => plain(await tasks.create({ ...req.body, scope: req.body.scope as never, priority: req.body.priority, links: req.body.links as never }, me(req), req.id)));
  r.patch('/admin/tasks/:id', { schema: sch({ params: Id, body: z.object({ state: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(), ownerId: z.string().nullable().optional(), dueAt: z.string().datetime().nullable().optional(), note: z.string().max(2000).optional(), expectedVersion: z.number().int() }) }) }, async (req) => plain(await tasks.update(req.params.id, req.body, me(req), req.id)));
  r.post('/admin/tasks/:id/handover', { schema: sch({ params: Id, body: z.object({ to: z.string().min(1), note: z.string().min(5).max(2000) }) }) }, async (req) => plain(await tasks.handover(req.params.id, req.body.to, req.body.note, me(req), req.id)));

  // ---- tickets (ADM-008)
  r.post('/support/tickets', { schema: sch({ body: z.object({ subject: z.string().min(3).max(200), text: z.string().min(5).max(4000), category: TicketCategory, priority: Priority.default('normal'), links: z.object({ eventId: z.string().nullable(), matchId: z.string().nullable(), paymentId: z.string().nullable(), registrationId: z.string().nullable() }).partial().optional() }) }) }, async (req) => plain(tickets.view(await tickets.open({ ...req.body, links: req.body.links as never }, me(req)), false)));
  r.get('/support/tickets/mine', { schema: sch({ response: { 200: Items, ...errors } }) }, async (req) => list(await tickets.mine(me(req))));
  r.get('/support/tickets/:id', { schema: sch({ params: Id }) }, async (req) => plain(await tickets.get(req.params.id, me(req), req.id)));
  r.post('/support/tickets/:id/reply', { schema: sch({ params: Id, body: z.object({ text: z.string().min(1).max(4000), internal: z.boolean().default(false) }) }) }, async (req) => plain(await tickets.reply(req.params.id, req.body.text, req.body.internal, me(req), req.id)));
  r.get('/admin/tickets', { schema: sch({ querystring: z.object({ state: z.string().optional(), category: z.string().optional(), assignee: z.string().optional(), eventId: z.string().optional() }), response: { 200: Items, ...errors } }) }, async (req) => list(await tickets.queue(req.query, me(req), req.id)));
  r.patch('/admin/tickets/:id', { schema: sch({ params: Id, body: z.object({ state: z.enum(['open', 'pending', 'resolved', 'closed']).optional(), priority: Priority.optional(), assigneeId: z.string().nullable().optional(), note: z.string().max(1000).optional() }) }) }, async (req) => plain(await tickets.manage(req.params.id, req.body, me(req), req.id)));

  // ---- bulk (ADM-006)
  r.post('/admin/bulk/preview', { schema: sch({ body: z.object({ kind: z.enum(['registration.approve', 'registration.reject', 'match.shift', 'notify']), eventId: z.string().min(1), refs: z.array(z.string().min(1)).min(1).max(500), params: z.record(z.string(), z.unknown()).default({}) }) }) }, async (req) => plain(await bulk.preview(req.body, me(req), req.id)));
  r.post('/admin/bulk/:id/execute', { schema: sch({ params: Id }) }, async (req) => plain(await bulk.execute(req.params.id, me(req), req.id)));
  r.get('/admin/events/:id/bulk', { schema: sch({ params: Id, response: { 200: Items, ...errors } }) }, async (req) => list(await bulk.list(req.params.id, me(req), req.id)));

  // ---- moderation appeals (ADM-009)
  r.post('/community/reports/:id/appeal', { schema: sch({ params: Id, body: z.object({ text: z.string().min(10).max(2000) }) }) }, async (req) => plain(await appeals.appeal(req.params.id, req.body.text, me(req))));
  r.get('/admin/appeals', { schema: sch({ response: { 200: Items, ...errors } }) }, async (req) => list(await appeals.queue(me(req), req.id)));
  r.post('/admin/appeals/:id/decide', { schema: sch({ params: Id, body: z.object({ outcome: z.enum(['upheld', 'reversed']) }) }) }, async (req) => plain(await appeals.decide(req.params.id, req.body.outcome, me(req), req.id)));

  // ---- dashboards and reports (ADM-005/011/013)
  r.get('/admin/events/:id/ops', { schema: sch({ params: Id }) }, async (req) => plain(await ops.event(req.params.id, me(req), req.id)));
  r.get('/admin/reports', { schema: sch({ querystring: z.object({ from: z.string().datetime(), to: z.string().datetime() }) }) }, async (req) => plain(await reports.platform(req.query, me(req), req.id)));
  r.get('/admin/events/:id/sponsor.csv', { schema: { tags: ['admin'], params: Id } }, async (req, reply) => {
    const csv = await reports.sponsorCsv(req.params.id, me(req), req.id);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="sponsor-${req.params.id}.csv"`).send(csv);
  });
  r.get('/admin/health', { schema: sch() }, async (req) => plain(await health.snapshot(me(req), req.id)));

  // ---- consents and legal texts (ADM-012)
  r.get('/legal/pending', { schema: sch({ response: { 200: Items, ...errors } }) }, async (req) => list(await legal.pending(me(req))));
  r.get('/legal/consents', { schema: sch({ response: { 200: Items, ...errors } }) }, async (req) => list(await legal.mine(me(req))));
  r.get('/legal/:kind', { schema: { tags: ['legal'], params: z.object({ kind: Kind }), response: { 200: Out.nullable(), ...errors } } }, async (req) => {
    const d = await legal.current(req.params.kind);
    return d ? plain(d) : null;
  });
  r.post('/legal/:kind/accept', { schema: sch({ params: z.object({ kind: Kind }), body: z.object({ version: z.number().int().min(1) }) }) }, async (req) => plain(await legal.accept(me(req), req.params.kind, req.body.version)));
  r.post('/legal/:kind/withdraw', { schema: sch({ params: z.object({ kind: Kind }), response: { 200: z.object({ withdrawn: z.number() }), ...errors } }) }, async (req) => ({ withdrawn: await legal.withdraw(me(req), req.params.kind) }));
  r.post('/admin/legal', { schema: sch({ body: z.object({ kind: Kind, title: z.string().min(3).max(200), body: z.string().min(20).max(50_000), requiresAcceptance: z.boolean(), effectiveAt: z.string().datetime().nullable().default(null) }) }) }, async (req) => plain(await legal.publish(req.body, me(req), req.id)));
  r.get('/admin/legal/:kind/history', { schema: sch({ params: z.object({ kind: Kind }), response: { 200: Items, ...errors } }) }, async (req) => {
    await req.requirePermission('privacy.manage', SITE_SCOPE);
    return list(await legal.history(req.params.kind));
  });

  // ---- holds and retention (OPS-001..003)
  r.get('/admin/holds', { schema: sch({ response: { 200: Items, ...errors } }) }, async (req) => list(await holds.list(me(req), req.id)));
  r.post('/admin/holds', { schema: sch({ body: z.object({ kind: z.enum(['principal', 'event', 'file', 'dispute']), id: z.string().min(1), reason: z.string().min(5).max(500) }) }) }, async (req) => plain(await holds.place(req.body as never, me(req), req.id)));
  r.post('/admin/holds/:id/release', { schema: sch({ params: Id }) }, async (req) => plain(await holds.release(req.params.id, me(req), req.id)));
  r.get('/admin/retention', { schema: sch({ response: { 200: Items, ...errors } }) }, async (req) => list(await retention.policies(me(req), req.id)));
  r.put('/admin/retention/:id', { schema: sch({ params: Id, body: z.object({ days: z.number().int().min(1).max(3650).nullable(), approved: z.boolean(), note: z.string().max(1000).default('') }) }) }, async (req) => plain(await retention.setPolicy(req.params.id, req.body, me(req), req.id)));
  r.post('/admin/retention/run', { schema: sch({ body: z.object({ dryRun: z.boolean().default(true) }) }) }, async (req) => {
    const actor = me(req);
    await ct.acl.require(actor, 'privacy.manage', SITE_SCOPE, req.id);
    await ct.audit.append({ actorPrincipalId: actor, action: req.body.dryRun ? 'retention.dry_run' : 'retention.run', target: { type: 'retention', id: 'job' }, scope: SITE_SCOPE, outcome: 'success', requestId: req.id });
    return plain(await retention.run({ dryRun: req.body.dryRun }));
  });

  // ---- data-subject requests (ADM-012)
  r.post('/privacy/requests', { schema: sch({ body: z.object({ kind: z.enum(['export', 'correction', 'deletion']), detail: z.string().max(2000).default('') }) }) }, async (req) => plain(await dsr.create(me(req), req.body.kind, req.body.detail, req.id)));
  r.get('/privacy/requests', { schema: sch({ response: { 200: Items, ...errors } }) }, async (req) => list(await dsr.mine(me(req))));
  r.get('/admin/privacy/requests', { schema: sch({ response: { 200: Items, ...errors } }) }, async (req) => list(await dsr.queue(me(req), req.id)));
  r.post('/admin/privacy/requests/:id/decide', { schema: sch({ params: Id, body: z.object({ decision: z.enum(['complete', 'reject']), note: z.string().min(5).max(1000) }) }) }, async (req) => plain(await dsr.decide(req.params.id, req.body.decision, req.body.note, me(req), req.id)));

  // ---- providers (INTG-001..004/006/009)
  r.get('/admin/providers', { schema: sch({ response: { 200: Items, ...errors } }) }, async (req) => list(await providers.list(me(req), req.id)));
  r.get('/admin/providers/sms', { schema: sch({ response: { 200: z.object({
    adapter: z.string(), apiKeyConfigured: z.boolean(), template: z.string().nullable(), sender: z.string().nullable(),
    health: z.object({ status: z.enum(['ok', 'degraded', 'down', 'unconfigured']), detail: z.string().optional() }),
  }), ...errors } }) }, async (req) => {
    await req.requirePermission('providers.manage', SITE_SCOPE);
    const h = await ct.adapters.sms.health();
    return { adapter: ct.adapters.sms.name, apiKeyConfigured: !!ct.config.KAVENEGAR_API_KEY,
      template: ct.config.KAVENEGAR_OTP_TEMPLATE ?? null, sender: ct.config.KAVENEGAR_SENDER ?? null,
      health: { status: h.status, ...(h.detail ? { detail: h.detail } : {}) } };
  });
  r.get('/admin/providers/readiness', { schema: sch() }, async (req) => plain(await providers.readiness(me(req), req.id)));
  r.get('/admin/providers/allowlist', { schema: sch({ response: { 200: z.object({ origins: z.array(z.string()) }), ...errors } }) }, async (req) => {
    await req.requirePermission('providers.manage', SITE_SCOPE);
    return { origins: await providers.allowlist() };
  });
  r.put('/admin/providers', {
    schema: sch({
      body: z.object({
        id: z.string().optional(), category: z.enum(['sms', 'payment', 'storage', 'cdn', 'video', 'email', 'map', 'search', 'analytics', 'errors', 'metrics', 'push', 'publisher']), name: z.string().min(2).max(120), origins: z.array(z.string()).max(20),
        iranian: z.boolean(), selfHosted: z.boolean(), publisherException: z.object({ gameId: z.string(), reason: z.string().min(10) }).nullable().default(null),
        evaluation: z.object({ capabilities: z.array(z.string()).max(30), limits: z.string().max(2000), costNote: z.string().max(2000), contractRef: z.string().max(300).nullable(), exitPlan: z.string().max(2000), result: z.enum(['not_tested', 'passed', 'failed']) }),
        keyEnvNames: z.array(z.string()).max(10), quota: z.object({ perMinute: z.number().int().positive().nullable(), perDay: z.number().int().positive().nullable() }),
      }),
    }),
  }, async (req) => plain(await providers.upsert(req.body, me(req), req.id)));
  r.post('/admin/providers/:id/decide', { schema: sch({ params: Id, body: z.object({ decision: z.enum(['selected', 'rejected', 'retired']) }) }) }, async (req) => plain(await providers.decide(req.params.id, req.body.decision, me(req), req.id)));

  // ---- partner clients and webhook dead letters (INTG-005..008)
  r.get('/admin/partners', { schema: sch({ response: { 200: Items, ...errors } }) }, async (req) => list(await partners.list(me(req), req.id)));
  r.post('/admin/partners', { schema: sch({ body: z.object({ name: z.string().min(3).max(120), scopes: z.array(z.enum(['events:read', 'results:read', 'news:read', 'webhooks:manage'])).min(1), eventIds: z.array(z.string()).max(100).default([]), quotaPerMinute: z.number().int().min(1).max(6000) }) }) }, async (req) => plain(await partners.createClient(req.body, me(req), req.id)));
  r.post('/admin/partners/:id/rotate', { schema: sch({ params: Id }) }, async (req) => plain(await partners.rotate(req.params.id, me(req), req.id)));
  r.post('/admin/partners/:id/revoke', { schema: sch({ params: Id, response: { 200: z.object({ ok: z.literal(true) }), ...errors } }) }, async (req) => {
    await partners.revoke(req.params.id, me(req), req.id);
    return { ok: true as const };
  });
  r.get('/admin/webhook-deliveries', { schema: sch({ querystring: z.object({ state: z.enum(['pending', 'delivered', 'dead']).default('dead') }), response: { 200: Items, ...errors } }) }, async (req) => {
    await req.requirePermission('partner.manage', SITE_SCOPE);
    return list(await ct.c.webhookDeliveries.find({ state: req.query.state }).sort({ createdAt: -1 }).limit(100).toArray());
  });
  r.post('/admin/webhook-deliveries/:id/replay', { schema: sch({ params: z.object({ id: z.string().min(1).max(200) }), response: { 200: z.object({ ok: z.literal(true) }), ...errors } }) }, async (req) => {
    await replayWebhook(ct, req.params.id, me(req), req.id);
    return { ok: true as const };
  });
  r.post('/admin/security/rotate-secrets', { schema: sch() }, async (req) => plain(await rotateSealedSecrets(ct, me(req), req.id)));
  void DomainError;
}
