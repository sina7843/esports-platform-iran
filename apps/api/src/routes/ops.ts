import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AuditEntrySchema, ErrorResponse, OutboxRecordSchema, ProviderHealthSchema, SITE_SCOPE } from '@esp/contracts';
import { adaptersHealth, type AuditDoc, type Container, type OutboxDoc } from '@esp/core';

const outboxOut = (d: OutboxDoc) => {
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
};
const auditOut = (d: AuditDoc) => {
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
};

/** Operational endpoints (OPS-006/007, ADM-013 foundations). All require site-scope permissions. */
export function opsRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/ops/providers', { schema: { tags: ['ops'], response: { 200: z.object({ items: z.array(ProviderHealthSchema) }), 401: ErrorResponse, 403: ErrorResponse } } }, async (req) => {
    await req.requirePermission('platform.settings', SITE_SCOPE);
    return { items: await adaptersHealth(container.adapters) };
  });

  r.get('/ops/outbox', { schema: { tags: ['ops'], response: { 200: z.object({ stats: z.record(z.string(), z.number()), deadLetters: z.array(OutboxRecordSchema) }), 401: ErrorResponse, 403: ErrorResponse } } }, async (req) => {
    await req.requirePermission('outbox.read', SITE_SCOPE);
    const deadLetters = await container.c.outbox.find({ status: 'dead_letter' }).sort({ occurredAt: -1 }).limit(100).toArray();
    return { stats: await container.consumer.stats(), deadLetters: deadLetters.map(outboxOut) };
  });

  r.post('/ops/outbox/:id/replay', { schema: { tags: ['ops'], params: z.object({ id: z.string() }), response: { 200: OutboxRecordSchema, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 412: ErrorResponse } } }, async (req) => {
    const ctx = req.requireAuth();
    await req.requirePermission('outbox.replay', SITE_SCOPE);
    return outboxOut(await container.consumer.replay(req.params.id, { principalId: ctx.principal._id, requestId: req.id }));
  });

  r.get('/ops/audit', { schema: { tags: ['ops'], querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), targetType: z.string().optional(), targetId: z.string().optional() }), response: { 200: z.object({ items: z.array(AuditEntrySchema) }), 401: ErrorResponse, 403: ErrorResponse } } }, async (req) => {
    await req.requirePermission('audit.read', SITE_SCOPE);
    const filter: Record<string, unknown> = {};
    if (req.query.targetType) filter['target.type'] = req.query.targetType;
    if (req.query.targetId) filter['target.id'] = req.query.targetId;
    const items = await container.c.audit.find(filter).sort({ seq: -1 }).limit(req.query.limit).toArray();
    return { items: items.map(auditOut) };
  });

  r.get('/ops/audit/verify', { schema: { tags: ['ops'], response: { 200: z.object({ ok: z.boolean(), checked: z.number().int(), brokenAtSeq: z.number().int().optional() }), 401: ErrorResponse, 403: ErrorResponse } } }, async (req) => {
    await req.requirePermission('audit.read', SITE_SCOPE);
    return container.audit.verifyChain();
  });
}
