import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HealthSchema, ErrorResponse } from '@esp/contracts';
import type { Container } from '@esp/core';
import { adaptersHealth, migrationStatus } from '@esp/core';

const started = Date.now();

export function healthRoutes(app: FastifyInstance, container: Container, version: string): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/health/live', { schema: { tags: ['health'], response: { 200: z.object({ status: z.literal('ok') }) } } }, async () => ({ status: 'ok' as const }));

  r.get('/health/ready', { schema: { tags: ['health'], response: { 200: z.object({ status: z.literal('ok') }), 503: ErrorResponse } } }, async (_req, reply) => {
    const ping = await container.dbh.ping();
    const mig = await migrationStatus(container.dbh.db);
    if (!ping.ok || !ping.replicaSet || mig.pending.length) {
      return reply.status(503).send({ error: { code: 'PROVIDER_UNAVAILABLE', message: `not ready: db=${ping.ok} rs=${ping.replicaSet} pendingMigrations=${mig.pending.length}`, requestId: _req.id } });
    }
    return { status: 'ok' as const };
  });

  r.get('/health', { schema: { tags: ['health'], response: { 200: HealthSchema } } }, async () => {
    const ping = await container.dbh.ping();
    const providers = await adaptersHealth(container.adapters);
    const outbox = await container.consumer.stats();
    const checks: Record<string, { status: 'ok' | 'degraded' | 'down' | 'unconfigured'; detail?: string; latencyMs?: number }> = {
      mongo: { status: ping.ok ? (ping.replicaSet ? 'ok' : 'degraded') : 'down', latencyMs: ping.latencyMs, ...(ping.detail ? { detail: ping.detail } : {}) },
      outbox: { status: (outbox['dead_letter'] ?? 0) > 0 ? 'degraded' : 'ok', detail: JSON.stringify(outbox) },
    };
    for (const p of providers) checks[`provider:${p.kind}`] = { status: p.status, detail: `${p.adapter} (${p.mode})${p.detail ? ': ' + p.detail : ''}` };
    const statuses = Object.values(checks).map((c) => c.status);
    const status: 'ok' | 'degraded' | 'down' = checks['mongo']!.status === 'down' ? 'down' : statuses.includes('degraded') || statuses.includes('down') ? 'degraded' : 'ok';
    return { status, version, uptimeSeconds: Math.round((Date.now() - started) / 1000), checks, serverTime: new Date().toISOString() };
  });
}
