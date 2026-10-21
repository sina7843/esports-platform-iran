import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DomainError, type ErrorCode } from '@esp/contracts';
import { PartnerService, WEBHOOK_TYPES, type Container, type PartnerClientDoc } from '@esp/core';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const EventQuery = z.object({ view: z.string().max(80).optional() });
const HookBody = z.object({ url: z.string().url().max(500), events: z.array(z.enum(WEBHOOK_TYPES)).min(1).max(10) });

/**
 * Public/partner API v1 (INTG-005..008), mounted at /partner/v1 — separate from the browser API: no cookies, no
 * CSRF header, but every request is HMAC-signed over method, path (with query) and body hash, with a timestamp
 * and a single-use nonce. The raw body is kept for the signature, so the signed bytes are the received bytes.
 */
export function partnerRoutes(app: FastifyInstance, ct: Container): void {
  const svc = new PartnerService(ct);
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req: FastifyRequest, body: string, done) => {
    req.rawBody = body;
    try {
      done(null, body ? JSON.parse(body) : {});
    } catch {
      done(new DomainError('VALIDATION_FAILED' as ErrorCode, 'invalid JSON'), undefined);
    }
  });
  const auth = (req: FastifyRequest): Promise<PartnerClientDoc> => svc.authenticate({ method: req.method, path: req.raw.url ?? req.url, body: req.rawBody ?? '', headers: req.headers as Record<string, string | undefined> });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'private, no-store');
    reply.header('x-esp-api-version', 'v1');
  });

  app.get('/events', async (req) => svc.events(await auth(req)));
  app.get<{ Params: { id: string }; Querystring: { view?: string } }>('/events/:id/results', async (req) => {
    const q = EventQuery.parse(req.query);
    return svc.results(await auth(req), req.params.id, q.view === 'latest' ? undefined : q.view); // partners never get the un-delayed "latest" view
  });
  app.get<{ Params: { id: string } }>('/events/:id/news', async (req) => svc.news(await auth(req), req.params.id));
  app.get('/webhooks', async (req) => ({ items: await svc.listWebhooks(await auth(req)) }));
  app.post('/webhooks', async (req) => svc.createWebhook(await auth(req), HookBody.parse(req.body)));
  app.delete<{ Params: { id: string } }>('/webhooks/:id', async (req) => {
    await svc.deleteWebhook(await auth(req), req.params.id);
    return { ok: true };
  });
}
