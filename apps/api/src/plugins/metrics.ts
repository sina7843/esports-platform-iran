import type { FastifyInstance } from 'fastify';
import { breakerStates, type Container } from '@esp/core';

/**
 * OPS-006 metrics without personal data: counters and latency sums keyed by the route template (never the concrete
 * URL, query, user or token), plus queue/outbox/provider gauges. Prometheus text exposition, served to operators
 * only (permission `outbox.read`). ponytail: per process; a scraper aggregates replicas.
 */
const buckets = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
interface Series {
  n: number;
  sum: number;
  le: number[];
}
export function registerMetrics(app: FastifyInstance, ct: Container): void {
  const series = new Map<string, Series>();
  const started = Date.now();
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? 'unmatched';
    const key = `${req.method}|${route}|${Math.floor(reply.statusCode / 100)}xx`;
    const s = series.get(key) ?? { n: 0, sum: 0, le: buckets.map(() => 0) };
    const sec = reply.elapsedTime / 1000;
    s.n++;
    s.sum += sec;
    buckets.forEach((b, i) => {
      if (sec <= b) s.le[i]!++;
    });
    series.set(key, s);
  });
  app.get('/api/v1/ops/metrics', { schema: { tags: ['ops'], hide: false } }, async (req, reply) => {
    await req.requirePermission('outbox.read', { type: 'site', id: 'site' });
    const lines: string[] = ['# TYPE esp_http_requests_total counter', '# TYPE esp_http_request_duration_seconds histogram'];
    for (const [key, s] of series) {
      const [method, route, status] = key.split('|');
      const l = `method="${method}",route="${route}",status="${status}"`;
      lines.push(`esp_http_requests_total{${l}} ${s.n}`);
      buckets.forEach((b, i) => lines.push(`esp_http_request_duration_seconds_bucket{${l},le="${b}"} ${s.le[i]}`));
      lines.push(`esp_http_request_duration_seconds_bucket{${l},le="+Inf"} ${s.n}`, `esp_http_request_duration_seconds_sum{${l}} ${s.sum.toFixed(6)}`, `esp_http_request_duration_seconds_count{${l}} ${s.n}`);
    }
    lines.push('# TYPE esp_outbox gauge');
    for (const [st, n] of Object.entries(await ct.consumer.stats())) lines.push(`esp_outbox{status="${st}"} ${n}`);
    lines.push('# TYPE esp_circuit_open gauge');
    for (const b of breakerStates()) lines.push(`esp_circuit_open{provider="${b.kind}"} ${b.state === 'closed' ? 0 : 1}`, `esp_provider_calls_total{provider="${b.kind}"} ${b.calls}`);
    lines.push('# TYPE esp_webhook_deliveries gauge');
    for (const st of ['pending', 'dead'] as const) lines.push(`esp_webhook_deliveries{state="${st}"} ${await ct.c.webhookDeliveries.countDocuments({ state: st })}`);
    lines.push('# TYPE esp_uptime_seconds gauge', `esp_uptime_seconds ${Math.round((Date.now() - started) / 1000)}`);
    return reply.header('content-type', 'text/plain; version=0.0.4').send(lines.join('\n') + '\n');
  });
}
