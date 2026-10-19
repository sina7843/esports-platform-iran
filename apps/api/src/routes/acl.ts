import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApprovalDecisionSchema, ApprovalRequestSchema, ApprovalSchema, ErrorResponse, GrantRequestSchema, GrantSchema, RevokeGrantRequestSchema, ScopeTypes, DomainError } from '@esp/contracts';
import type { ApprovalDoc, Container, GrantDoc } from '@esp/core';

const grantOut = (g: GrantDoc) => ({ id: g._id, principalId: g.principalId, role: g.role, scope: g.scope, grantedBy: g.grantedBy, grantedAt: g.grantedAt, expiresAt: g.expiresAt, revokedAt: g.revokedAt, revokedBy: g.revokedBy, reason: g.reason });
const approvalOut = (a: ApprovalDoc) => ({ id: a._id, action: a.action, scope: a.scope, payload: a.payload, requestedBy: a.requestedBy, requestedAt: a.requestedAt, decidedBy: a.decidedBy, decidedAt: a.decidedAt, decisionReason: a.decisionReason, state: a.state, expiresAt: a.expiresAt, version: a.version });

const ScopeQuery = z.object({ scopeType: z.enum(ScopeTypes), scopeId: z.string().min(1).max(64) });

export function aclRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/acl/grants', { schema: { tags: ['acl'], querystring: ScopeQuery, response: { 200: z.object({ items: z.array(GrantSchema) }), 401: ErrorResponse, 403: ErrorResponse } } }, async (req) => {
    const scope = { type: req.query.scopeType, id: req.query.scopeId };
    await req.requirePermission('acl.read', scope);
    return { items: (await container.acl.listForScope(scope)).map(grantOut) };
  });

  r.post('/acl/grants', { schema: { tags: ['acl'], body: GrantRequestSchema, response: { 201: GrantSchema, 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 409: ErrorResponse } } }, async (req, reply) => {
    const ctx = req.requireAuth();
    await req.requirePermission('acl.grant', req.body.scope);
    // Granting platform_admin is itself a sensitive action: requires an approved second approval (ACL-003).
    if (req.body.role === 'platform_admin') {
      const approvalId = (req.headers['x-approval-id'] as string | undefined) ?? '';
      if (!approvalId) throw new DomainError('PRECONDITION_FAILED', 'granting platform_admin requires an approved approval id in X-Approval-Id');
      await container.approvals.consume(approvalId, 'acl.grant.platform_admin', req.body.scope, { principalId: ctx.principal._id, requestId: req.id });
    }
    const g = await container.acl.grant(req.body, { principalId: ctx.principal._id, requestId: req.id });
    return reply.status(201).send(grantOut(g));
  });

  r.delete('/acl/grants/:id', { schema: { tags: ['acl'], params: z.object({ id: z.string() }), body: RevokeGrantRequestSchema.optional(), response: { 204: z.null(), 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse } } }, async (req, reply) => {
    const ctx = req.requireAuth();
    const g = await container.c.grants.findOne({ _id: req.params.id });
    if (!g) throw new DomainError('NOT_FOUND', 'grant not found');
    await req.requirePermission('acl.revoke', g.scope);
    await container.acl.revoke(g._id, { principalId: ctx.principal._id, requestId: req.id }, req.body?.reason ?? null);
    return reply.status(204).send(null);
  });

  // ---- approvals (ACL-003)
  r.get('/approvals', { schema: { tags: ['approvals'], querystring: ScopeQuery, response: { 200: z.object({ items: z.array(ApprovalSchema) }), 401: ErrorResponse, 403: ErrorResponse } } }, async (req) => {
    const scope = { type: req.query.scopeType, id: req.query.scopeId };
    await req.requirePermission('approval.read', scope);
    return { items: (await container.approvals.listForScope(scope)).map(approvalOut) };
  });

  r.post('/approvals', { schema: { tags: ['approvals'], body: ApprovalRequestSchema, response: { 201: ApprovalSchema, 401: ErrorResponse, 403: ErrorResponse } } }, async (req, reply) => {
    const ctx = req.requireAuth();
    const a = await container.approvals.request(req.body, { principalId: ctx.principal._id, requestId: req.id });
    return reply.status(201).send(approvalOut(a));
  });

  r.post('/approvals/:id/decision', { schema: { tags: ['approvals'], params: z.object({ id: z.string() }), body: ApprovalDecisionSchema, response: { 200: ApprovalSchema, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse } } }, async (req) => {
    const ctx = req.requireAuth();
    const a = await container.approvals.decide(req.params.id, req.body, { principalId: ctx.principal._id, requestId: req.id });
    return approvalOut(a);
  });
}
