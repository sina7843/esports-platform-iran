import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { RealtimePollQuerySchema, RealtimePollResponseSchema, type RealtimeEvent } from '@esp/contracts';
import type { Container, Viewer } from '@esp/core';

/**
 * Realtime transports (selectable): SSE (`/realtime/stream`), WebSocket (`/realtime/ws`) and polling fallback
 * (`/realtime/events`). All three share the same cursor (`after` = last seq) and the same server-side audience
 * checks; a revoked session closes the live transport (AC-23). Delayed projection (visibleAt) is enforced in core.
 */
export function realtimeRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const viewerOf = (auth: { principal: { _id: string }; session: { _id: string } } | null): Viewer => (auth ? { principalId: auth.principal._id, sessionId: auth.session._id } : { principalId: null, sessionId: null });
  const channelsOf = (s: string | undefined) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50) : null);

  r.get('/realtime/events', { schema: { tags: ['realtime'], querystring: RealtimePollQuerySchema, response: { 200: RealtimePollResponseSchema } } }, async (req) => {
    const { events, cursor, resync } = await container.realtime.poll(viewerOf(req.auth), req.query.after, channelsOf(req.query.channels), req.query.limit);
    return { events, cursor, serverTime: new Date().toISOString(), ...(resync ? { resync } : {}) };
  });

  r.get('/realtime/stream', { schema: { tags: ['realtime'], querystring: RealtimePollQuerySchema, summary: 'Server-Sent Events stream; id = seq cursor' } }, async (req, reply) => {
    const lastEventId = Number(req.headers['last-event-id']);
    const after = Number.isFinite(lastEventId) && lastEventId > req.query.after ? lastEventId : req.query.after;
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    reply.raw.write(`retry: 3000\n: connected ${new Date().toISOString()}\n\n`);
    const ping = setInterval(() => reply.raw.write(`: ping ${Date.now()}\n\n`), 15_000);
    const unsubscribe = container.realtime.subscribe(viewerOf(req.auth), {
      after,
      channels: channelsOf(req.query.channels),
      onEvent: (e: RealtimeEvent) => reply.raw.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`),
      onClose: (reason) => {
        clearInterval(ping);
        if (!reply.raw.writableEnded) {
          reply.raw.write(`event: close\ndata: ${JSON.stringify({ reason })}\n\n`);
          reply.raw.end();
        }
      },
    });
    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  app.get('/realtime/ws', { websocket: true, schema: { tags: ['realtime'], summary: 'WebSocket transport; query after/channels like the SSE stream' } }, (socket, req) => {
    const q = RealtimePollQuerySchema.safeParse(req.query);
    const after = q.success ? q.data.after : 0;
    const channels = q.success ? channelsOf(q.data.channels) : null;
    const unsubscribe = container.realtime.subscribe(viewerOf(req.auth), {
      after,
      channels,
      onEvent: (e) => socket.send(JSON.stringify(e)),
      onClose: (reason) => socket.close(reason === 'session_revoked' ? 4401 : reason === 'resync_required' ? 4409 : 1000, reason),
    });
    socket.on('close', unsubscribe);
    socket.on('error', unsubscribe);
  });
}
