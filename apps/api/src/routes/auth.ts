import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { DevSessionRequestSchema, DomainError, ErrorResponse, GrantSchema, MeResponseSchema, SessionSchema } from '@esp/contracts';
import type { Container, GrantDoc, SessionDoc } from '@esp/core';
import { SESSION_COOKIE, setSessionCookie } from '../plugins/auth.js';

const grantOut = (g: GrantDoc) => ({ id: g._id, principalId: g.principalId, role: g.role, scope: g.scope, grantedBy: g.grantedBy, grantedAt: g.grantedAt, expiresAt: g.expiresAt, revokedAt: g.revokedAt, revokedBy: g.revokedBy, reason: g.reason });
const sessionOut = (s: SessionDoc, currentId: string) => ({ id: s._id, principalId: s.principalId, createdAt: s.createdAt, expiresAt: s.expiresAt, lastSeenAt: s.lastSeenAt, revokedAt: s.revokedAt, userAgent: s.userAgent, current: s._id === currentId });

export function authRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function me(principalId: string, session: SessionDoc) {
    const principal = await container.c.principals.findOne({ _id: principalId });
    if (!principal) throw new DomainError('UNAUTHENTICATED', 'principal missing');
    const grants = await container.acl.activeGrants(principalId);
    return { principal: { id: principal._id, displayName: principal.displayName, locale: principal.locale, timeZone: principal.timeZone, kind: principal.kind }, session: sessionOut(session, session._id), grants: grants.map(grantOut) };
  }

  /**
   * Development identity double (ESP-02 replaces it with mobile OTP). Enabled only when NODE_ENV is not
   * production AND AUTH_DEV_LOGIN_ENABLED=true AND AUTH_DEV_CODE is set. In production the route is not registered.
   */
  if (container.config.devLoginEnabled) {
    r.post('/auth/dev-session', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['auth'], summary: 'DEVELOPMENT DOUBLE: issue a session for a seeded principal', body: DevSessionRequestSchema, response: { 200: MeResponseSchema, 401: ErrorResponse } } }, async (req, reply) => {
      const expected = Buffer.from(container.config.AUTH_DEV_CODE ?? '');
      const given = Buffer.from(req.body.devCode);
      if (expected.length === 0 || expected.length !== given.length || !timingSafeEqual(expected, given)) throw new DomainError('UNAUTHENTICATED', 'invalid development code');
      const principal = await container.c.principals.findOne({ _id: req.body.principalId, status: 'active' });
      if (!principal) throw new DomainError('UNAUTHENTICATED', 'unknown principal');
      const { token, session } = await container.sessions.create(principal._id, { userAgent: req.headers['user-agent'] ?? null, ip: req.ip });
      await container.audit.append({ actorPrincipalId: principal._id, action: 'auth.dev_session', target: { type: 'session', id: session._id }, scope: { type: 'site', id: 'site' }, outcome: 'success', requestId: req.id });
      setSessionCookie(reply, token, container.config.isProduction, container.config.SESSION_TTL_HOURS * 3600);
      return me(principal._id, session);
    });
  }

  r.get('/auth/me', { schema: { tags: ['auth'], response: { 200: MeResponseSchema, 401: ErrorResponse } } }, async (req) => {
    const ctx = req.requireAuth();
    return me(ctx.principal._id, ctx.session);
  });

  r.post('/auth/logout', { schema: { tags: ['auth'], response: { 204: z.null() } } }, async (req, reply) => {
    if (req.auth) await container.sessions.revoke(req.auth.session._id, 'logout');
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send(null);
  });

  r.get('/auth/sessions', { schema: { tags: ['auth'], response: { 200: z.object({ items: z.array(SessionSchema) }), 401: ErrorResponse } } }, async (req) => {
    const ctx = req.requireAuth();
    const items = await container.sessions.listForPrincipal(ctx.principal._id);
    return { items: items.map((s) => sessionOut(s, ctx.session._id)) };
  });

  r.delete('/auth/sessions/:id', { schema: { tags: ['auth'], params: z.object({ id: z.string() }), response: { 204: z.null(), 401: ErrorResponse, 404: ErrorResponse } } }, async (req, reply) => {
    const ctx = req.requireAuth();
    const target = await container.c.sessions.findOne({ _id: req.params.id, principalId: ctx.principal._id });
    if (!target) throw new DomainError('NOT_FOUND', 'session not found');
    await container.sessions.revoke(target._id, 'user_revoked');
    await container.audit.append({ actorPrincipalId: ctx.principal._id, action: 'session.revoke', target: { type: 'session', id: target._id }, scope: { type: 'site', id: 'site' }, outcome: 'success', requestId: req.id });
    if (target._id === ctx.session._id) reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send(null);
  });

  r.get('/auth/grants/self', { schema: { tags: ['auth'], response: { 200: z.object({ items: z.array(GrantSchema) }) } } }, async (req) => {
    const ctx = req.requireAuth();
    return { items: (await container.acl.activeGrants(ctx.principal._id)).map(grantOut) };
  });
}
