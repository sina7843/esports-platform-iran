import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DomainError, type Permission, type Scope } from '@esp/contracts';
import type { Container, SessionContext } from '@esp/core';

export const SESSION_COOKIE = 'esp_session';

declare module 'fastify' {
  interface FastifyRequest {
    auth: SessionContext | null;
    /** Throws UNAUTHENTICATED when anonymous. */
    requireAuth(): SessionContext;
    /** Server-side permission check in the resource scope (ACL-001). */
    requirePermission(permission: Permission, scope: Scope): Promise<void>;
  }
}

/**
 * Resolves the session on every request from the httpOnly cookie or an `Authorization: Bearer` header.
 * No claims are cached: grants are read from the database at check time, so revocation is immediate (ACL-002).
 * CSRF: cookie-authenticated mutating requests must carry `X-Requested-With: fetch` (plus SameSite=Strict cookie).
 */
export function registerAuth(app: FastifyInstance, container: Container): void {
  app.decorateRequest('auth', null);
  app.decorateRequest('requireAuth', function (this: FastifyRequest) {
    if (!this.auth) throw new DomainError('UNAUTHENTICATED', 'authentication required');
    return this.auth;
  });
  app.decorateRequest('requirePermission', async function (this: FastifyRequest, permission: Permission, scope: Scope) {
    const ctx = this.requireAuth();
    await container.acl.require(ctx.principal._id, permission, scope, this.id);
  });

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
    const cookie = req.cookies?.[SESSION_COOKIE] ?? null;
    const token = bearer ?? cookie;
    req.auth = token ? await container.sessions.resolve(token) : null;
    if (cookie && !bearer && req.auth && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers['x-requested-with'] !== 'fetch') {
        throw new DomainError('FORBIDDEN', 'missing X-Requested-With header for cookie-authenticated mutation');
      }
    }
    if (cookie && !req.auth) {
      // stale/revoked cookie: clear it so the client re-authenticates
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
    }
  });
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean, maxAgeSeconds: number): void {
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: maxAgeSeconds });
}
