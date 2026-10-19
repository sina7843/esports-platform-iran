import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DomainError, MfaRequiredRoles, type Permission, type Scope } from '@esp/contracts';
import { assertMfaForRole, type Container, type SessionContext } from '@esp/core';

export const SESSION_COOKIE = 'esp_session';

/** Routes a not-yet-stepped-up session of a sensitive-role holder may still use (login, step-up, MFA enrolment, logout, health). */
const MFA_EXEMPT = /^\/api\/v1\/(auth\/|me\/mfa|health|dev\/inbox)/;

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
    const via = await container.acl.require(ctx.principal._id, permission, scope, this.id);
    // USR-009: sensitive roles only apply on a session that proved a second factor
    await assertMfaForRole(container, ctx, via.role);
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
    // USR-009 at the session layer: a session of someone holding a sensitive role is limited to the auth/MFA
    // endpoints until it proves a second factor. Covers every route, including services that call acl.require
    // directly, so no handler can forget the check.
    if (req.auth && container.config.mfaEnforced && !req.auth.session.mfaVerifiedAt && !MFA_EXEMPT.test(req.url)) {
      const grants = await container.acl.activeGrants(req.auth.principal._id);
      const sensitive = grants.find((g) => (MfaRequiredRoles as readonly string[]).includes(g.role));
      if (sensitive) await assertMfaForRole(container, req.auth, sensitive.role);
    }
  });
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean, maxAgeSeconds: number): void {
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: maxAgeSeconds });
}
