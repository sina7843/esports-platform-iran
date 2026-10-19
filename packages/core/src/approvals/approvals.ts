import { DomainError, sensitiveActionApproverPermission, type Scope, type SensitiveAction } from '@esp/contracts';
import type { Collections, ApprovalDoc } from '../db/collections.js';
import { newId } from '../ids.js';
import type { Acl } from '../acl/acl.js';
import type { AuditLog } from '../audit/audit.js';
import type { OutboxWriter } from '../outbox/outbox.js';

/**
 * Independent second approval (ACL-003 / separation of duties). A sensitive action is first REQUESTED, then
 * DECIDED by a different principal holding the approver permission in the action's scope, then CONSUMED exactly
 * once by the executing transition. Self-approval is rejected even for platform admins.
 */
const APPROVAL_TTL_HOURS = 72;

export class Approvals {
  constructor(
    private readonly c: Collections,
    private readonly acl: Acl,
    private readonly audit: AuditLog,
    private readonly outbox: OutboxWriter,
  ) {}

  async request(input: { action: SensitiveAction; scope: Scope; payload: Record<string, unknown>; reason: string }, actor: { principalId: string; requestId: string }): Promise<ApprovalDoc> {
    await this.acl.require(actor.principalId, 'approval.request', input.scope, actor.requestId);
    const now = new Date();
    const doc: ApprovalDoc = {
      _id: newId('apr'),
      action: input.action,
      scope: input.scope,
      payload: { ...input.payload, reason: input.reason },
      requestedBy: actor.principalId,
      requestedAt: now.toISOString(),
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
      state: 'pending',
      expiresAt: new Date(now.getTime() + APPROVAL_TTL_HOURS * 3600_000).toISOString(),
      version: 0,
    };
    await this.c.approvals.insertOne(doc);
    await this.audit.append({ actorPrincipalId: actor.principalId, action: 'approval.request', target: { type: 'approval', id: doc._id }, scope: input.scope, outcome: 'success', details: { action: input.action }, requestId: actor.requestId });
    await this.outbox.append({ type: 'approval.request.created', aggregate: { type: 'approval', id: doc._id }, aggregateVersion: 0, actor: { principalId: actor.principalId, kind: 'user' }, payload: { action: input.action, scope: input.scope }, correlationId: actor.requestId });
    return doc;
  }

  async decide(id: string, input: { decision: 'approve' | 'reject'; reason: string; expectedVersion: number }, actor: { principalId: string; requestId: string }): Promise<ApprovalDoc> {
    const current = await this.c.approvals.findOne({ _id: id });
    if (!current) throw new DomainError('NOT_FOUND', 'approval not found');
    if (current.state !== 'pending') throw new DomainError('ILLEGAL_TRANSITION', `approval is ${current.state}`);
    if (current.expiresAt <= new Date().toISOString()) {
      await this.c.approvals.updateOne({ _id: id, state: 'pending' }, { $set: { state: 'expired' }, $inc: { version: 1 } });
      throw new DomainError('PRECONDITION_FAILED', 'approval expired');
    }
    if (current.requestedBy === actor.principalId) {
      await this.audit.append({ actorPrincipalId: actor.principalId, action: 'approval.self_decide_blocked', target: { type: 'approval', id }, scope: current.scope, outcome: 'denied', requestId: actor.requestId });
      throw new DomainError('SEPARATION_OF_DUTIES', 'requester cannot decide their own approval');
    }
    await this.acl.require(actor.principalId, sensitiveActionApproverPermission[current.action], current.scope, actor.requestId);
    const updated = await this.c.approvals.findOneAndUpdate(
      { _id: id, state: 'pending', version: input.expectedVersion },
      { $set: { state: input.decision === 'approve' ? 'approved' : 'rejected', decidedBy: actor.principalId, decidedAt: new Date().toISOString(), decisionReason: input.reason }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    );
    if (!updated) throw new DomainError('VERSION_CONFLICT', 'approval changed concurrently');
    await this.audit.append({ actorPrincipalId: actor.principalId, action: `approval.${input.decision}`, target: { type: 'approval', id }, scope: current.scope, outcome: 'success', details: { action: current.action, requestedBy: current.requestedBy }, requestId: actor.requestId });
    await this.outbox.append({ type: 'approval.decided', aggregate: { type: 'approval', id }, aggregateVersion: updated.version, actor: { principalId: actor.principalId, kind: 'user' }, payload: { decision: input.decision, action: current.action, scope: current.scope }, correlationId: actor.requestId });
    return updated;
  }

  /** Consumes an approved approval exactly once for the given action/scope; returns it or throws. */
  async consume(id: string, action: SensitiveAction, scope: Scope, executor: { principalId: string; requestId: string }): Promise<ApprovalDoc> {
    const a = await this.c.approvals.findOne({ _id: id });
    if (!a) throw new DomainError('NOT_FOUND', 'approval not found');
    if (a.action !== action || a.scope.type !== scope.type || a.scope.id !== scope.id) throw new DomainError('PRECONDITION_FAILED', 'approval does not match this action/scope');
    if (a.state !== 'approved') throw new DomainError('PRECONDITION_FAILED', `approval is ${a.state}`);
    if (a.decidedBy === executor.principalId && a.requestedBy === executor.principalId) throw new DomainError('SEPARATION_OF_DUTIES', 'executor cannot be both requester and approver');
    const r = await this.c.approvals.findOneAndUpdate({ _id: id, state: 'approved' }, { $set: { state: 'executed' }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('CONFLICT', 'approval already consumed');
    await this.audit.append({ actorPrincipalId: executor.principalId, action: 'approval.executed', target: { type: 'approval', id }, scope, outcome: 'success', details: { action }, requestId: executor.requestId });
    return r;
  }

  async get(id: string): Promise<ApprovalDoc | null> {
    return this.c.approvals.findOne({ _id: id });
  }

  async listForScope(scope: Scope, limit = 50): Promise<ApprovalDoc[]> {
    return this.c.approvals.find({ 'scope.type': scope.type, 'scope.id': scope.id }).sort({ requestedAt: -1 }).limit(limit).toArray();
  }
}
