import type { ClientSession } from 'mongodb';
import {
  DomainError,
  SITE_SCOPE,
  rolePermissions,
  roleScopeTypes,
  scopeInheritance,
  type Permission,
  type Role,
  type Scope,
  type ScopeType,
} from '@esp/contracts';
import type { Collections, GrantDoc } from '../db/collections.js';
import { newId } from '../ids.js';
import type { AuditLog } from '../audit/audit.js';
import type { OutboxWriter } from '../outbox/outbox.js';

/**
 * Contextual authorizer (ACL-001..004).
 * - Deny by default: a permission is granted only if an ACTIVE grant exists whose role lists the permission AND
 *   whose scope equals the resource scope or is an ancestor scope the role is allowed to inherit into.
 * - Ancestors are resolved from the resource itself (match → event → organization), never from the request.
 * - Grants are loaded fresh per request; `principals.aclVersion` bumps on every change so live connections
 *   re-evaluate (ACL-002, AC-23).
 * - Conflict-of-interest: a principal who is a member of a participating team cannot act as referee/judge on that match.
 */
export interface ResourceContext {
  scope: Scope;
  /** Ancestor chain from nearest parent to root, e.g. match → [event, organization]. */
  ancestors: Scope[];
  /** Principal ids with a stake in the resource (team members of both sides) for conflict-of-interest checks. */
  interestedPrincipalIds?: string[];
}

export class Acl {
  constructor(
    private readonly c: Collections,
    private readonly audit: AuditLog,
    private readonly outbox: OutboxWriter,
  ) {}

  async activeGrants(principalId: string): Promise<GrantDoc[]> {
    const now = new Date().toISOString();
    return this.c.grants.find({ principalId, revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }).toArray();
  }

  /** Resolves scope ancestors from stored documents (never trusts client-provided parents). */
  async resourceContext(scope: Scope): Promise<ResourceContext> {
    const ancestors: Scope[] = [];
    let interested: string[] | undefined;
    if (scope.type === 'site') return { scope, ancestors: [] };
    if (scope.type === 'match') {
      const m = await this.c.matches.findOne({ _id: scope.id }, { projection: { eventId: 1, sides: 1 } });
      if (!m) throw new DomainError('NOT_FOUND', 'match not found');
      interested = m.sides.flatMap((s) => s.roster.map((r) => r.principalId));
      ancestors.push({ type: 'event', id: m.eventId });
      const ev = await this.c.events.findOne({ _id: m.eventId }, { projection: { organizerOrgId: 1 } });
      if (ev) ancestors.push({ type: 'organization', id: ev.organizerOrgId });
    } else if (scope.type === 'event') {
      const ev = await this.c.events.findOne({ _id: scope.id }, { projection: { organizerOrgId: 1 } });
      if (!ev) throw new DomainError('NOT_FOUND', 'event not found');
      ancestors.push({ type: 'organization', id: ev.organizerOrgId });
    } else if (scope.type === 'team') {
      const t = await this.c.teams.findOne({ _id: scope.id }, { projection: { organizationId: 1 } });
      if (!t) throw new DomainError('NOT_FOUND', 'team not found');
      if (t.organizationId) ancestors.push({ type: 'organization', id: t.organizationId });
    } else if (scope.type === 'organization') {
      const o = await this.c.organizations.findOne({ _id: scope.id }, { projection: { _id: 1 } });
      if (!o) throw new DomainError('NOT_FOUND', 'organization not found');
    }
    ancestors.push(SITE_SCOPE);
    return interested ? { scope, ancestors, interestedPrincipalIds: interested } : { scope, ancestors };
  }

  /** Pure decision over already-loaded grants; exported for unit tests. */
  static decide(grants: GrantDoc[], permission: Permission, ctx: ResourceContext): { allowed: boolean; via?: GrantDoc } {
    for (const g of grants) {
      const perms = rolePermissions[g.role];
      if (!perms.includes(permission)) continue;
      if (g.scope.type === ctx.scope.type && g.scope.id === ctx.scope.id) return { allowed: true, via: g };
      const inheritsInto = scopeInheritance[g.role] ?? [];
      if (!inheritsInto.includes(ctx.scope.type)) continue;
      // the grant scope must be an ancestor of the resource
      if (ctx.ancestors.some((a) => a.type === g.scope.type && a.id === g.scope.id)) return { allowed: true, via: g };
      // site-scoped roles with inheritance reach everything below site
      if (g.scope.type === 'site' && inheritsInto.includes(ctx.scope.type)) return { allowed: true, via: g };
    }
    return { allowed: false };
  }

  async can(principalId: string, permission: Permission, scope: Scope): Promise<boolean> {
    const [grants, ctx] = await Promise.all([this.activeGrants(principalId), this.resourceContext(scope)]);
    return Acl.decide(grants, permission, ctx).allowed;
  }

  /** Throws FORBIDDEN (and audits the denial) when the permission is not granted. */
  async require(principalId: string, permission: Permission, scope: Scope, requestId: string): Promise<GrantDoc> {
    const [grants, ctx] = await Promise.all([this.activeGrants(principalId), this.resourceContext(scope)]);
    const d = Acl.decide(grants, permission, ctx);
    if (!d.allowed) {
      await this.audit.append({ actorPrincipalId: principalId, action: `acl.deny:${permission}`, target: { type: scope.type, id: scope.id }, scope, outcome: 'denied', requestId });
      throw new DomainError('FORBIDDEN', 'permission denied in this scope', { permission, scope });
    }
    return d.via!;
  }

  /** Conflict of interest: actor must not be an interested party of the resource (REF-001, chapter 3). */
  async requireNoConflict(principalId: string, scope: Scope, requestId: string): Promise<void> {
    const ctx = await this.resourceContext(scope);
    if (ctx.interestedPrincipalIds?.includes(principalId)) {
      await this.audit.append({ actorPrincipalId: principalId, action: 'acl.conflict_of_interest', target: { type: scope.type, id: scope.id }, scope, outcome: 'denied', requestId });
      throw new DomainError('CONFLICT_OF_INTEREST', 'actor is an interested party of this resource');
    }
  }

  async grant(
    input: { principalId: string; role: Role; scope: Scope; expiresAt: string | null; reason: string | null },
    actor: { principalId: string; requestId: string },
    session?: ClientSession,
  ): Promise<GrantDoc> {
    if (!roleScopeTypes[input.role].includes(input.scope.type as ScopeType)) {
      throw new DomainError('VALIDATION_FAILED', `role ${input.role} cannot be granted in scope type ${input.scope.type}`);
    }
    await this.resourceContext(input.scope); // validates the scope exists
    const target = await this.c.principals.findOne({ _id: input.principalId }, { projection: { _id: 1 } });
    if (!target) throw new DomainError('NOT_FOUND', 'principal not found');
    const doc: GrantDoc = {
      _id: newId('grt'),
      principalId: input.principalId,
      role: input.role,
      scope: input.scope,
      grantedBy: actor.principalId,
      grantedAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      revokedAt: null,
      revokedBy: null,
      reason: input.reason,
    };
    const opts = session ? { session } : {};
    try {
      await this.c.grants.insertOne(doc, opts);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'an active grant with this role and scope already exists');
      throw err;
    }
    await this.c.principals.updateOne({ _id: input.principalId }, { $inc: { aclVersion: 1 } }, opts);
    await this.audit.append(
      { actorPrincipalId: actor.principalId, action: 'acl.grant', target: { type: 'grant', id: doc._id }, scope: input.scope, outcome: 'success', details: { role: input.role, principalId: input.principalId, expiresAt: input.expiresAt }, requestId: actor.requestId },
      session,
    );
    await this.outbox.append(
      { type: 'acl.grant.created', aggregate: { type: 'principal', id: input.principalId }, aggregateVersion: 0, actor: { principalId: actor.principalId, kind: 'user' }, payload: { grantId: doc._id, role: doc.role, scope: doc.scope }, correlationId: actor.requestId },
      session,
    );
    return doc;
  }

  async revoke(grantId: string, actor: { principalId: string; requestId: string }, reason: string | null, session?: ClientSession): Promise<GrantDoc> {
    const opts = session ? { session } : {};
    const g = await this.c.grants.findOneAndUpdate(
      { _id: grantId, revokedAt: null },
      { $set: { revokedAt: new Date().toISOString(), revokedBy: actor.principalId, ...(reason ? { reason } : {}) } },
      { returnDocument: 'after', ...opts },
    );
    if (!g) throw new DomainError('NOT_FOUND', 'active grant not found');
    await this.c.principals.updateOne({ _id: g.principalId }, { $inc: { aclVersion: 1 } }, opts);
    await this.audit.append(
      { actorPrincipalId: actor.principalId, action: 'acl.revoke', target: { type: 'grant', id: g._id }, scope: g.scope, outcome: 'success', details: { role: g.role, principalId: g.principalId, reason }, requestId: actor.requestId },
      session,
    );
    await this.outbox.append(
      { type: 'acl.grant.revoked', aggregate: { type: 'principal', id: g.principalId }, aggregateVersion: 0, actor: { principalId: actor.principalId, kind: 'user' }, payload: { grantId: g._id, role: g.role, scope: g.scope }, correlationId: actor.requestId },
      session,
    );
    return g;
  }

  async listForScope(scope: Scope): Promise<GrantDoc[]> {
    return this.c.grants.find({ 'scope.type': scope.type, 'scope.id': scope.id, revokedAt: null }).toArray();
  }
}
