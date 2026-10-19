import { DomainError, type AccountReviewDecisions } from '@esp/contracts';
import type { Container } from '../container.js';
import type { AccountReviewDoc } from '../db/collections-esp02.js';

const SITE = { type: 'site', id: 'site' } as const;

/**
 * Duplicate-account review queue (USR-010). A decision is only RECORDED: no data is merged or moved automatically
 * (a manual merge is a separate, human, audited procedure). Permission (`account.review`, site scope) is checked by the caller.
 */
export class ReviewService {
  constructor(private readonly ct: Container) {}

  async list(opts: { state?: AccountReviewDoc['state'] | undefined; limit: number; afterCreatedAt?: string | undefined; id?: string | undefined }): Promise<Array<AccountReviewDoc & { principals: Array<{ id: string; nickname: string | null; status: string | null }> }>> {
    const { c } = this.ct;
    const filter: Record<string, unknown> = {};
    if (opts.state) filter['state'] = opts.state;
    if (opts.id) filter['_id'] = opts.id;
    if (opts.afterCreatedAt) filter['createdAt'] = { $lt: opts.afterCreatedAt };
    const rows = await c.accountReviews.find(filter).sort({ createdAt: -1 }).limit(opts.limit).toArray();
    const ids = [...new Set(rows.flatMap((r) => r.principalIds))];
    const [profiles, principals] = await Promise.all([c.profiles.find({ _id: { $in: ids } }, { projection: { nickname: 1 } }).toArray(), c.principals.find({ _id: { $in: ids } }, { projection: { status: 1 } }).toArray()]);
    const nick = new Map(profiles.map((p) => [p._id, p.nickname]));
    const status = new Map(principals.map((p) => [p._id, p.status]));
    return rows.map((r) => ({ ...r, principals: r.principalIds.map((id) => ({ id, nickname: nick.get(id) ?? null, status: status.get(id) ?? null })) }));
  }

  async decide(
    reviewId: string,
    input: { decision: (typeof AccountReviewDecisions)[number]; note: string; suspendPrincipalIds: string[]; expectedVersion?: number | undefined },
    actor: { principalId: string; requestId: string },
  ): Promise<AccountReviewDoc> {
    const { c, dbh, audit, outbox } = this.ct;
    const rev = await c.accountReviews.findOne({ _id: reviewId });
    if (!rev) throw new DomainError('NOT_FOUND', 'review not found');
    if (rev.state !== 'open') throw new DomainError('ILLEGAL_TRANSITION', 'review already decided');
    if (input.expectedVersion !== undefined && input.expectedVersion !== rev.version) throw new DomainError('VERSION_CONFLICT', 'review changed');
    if (input.suspendPrincipalIds.some((id) => !rev.principalIds.includes(id))) throw new DomainError('VALIDATION_FAILED', 'suspendPrincipalIds must belong to the review');
    if (input.suspendPrincipalIds.includes(actor.principalId)) throw new DomainError('CONFLICT_OF_INTEREST', 'reviewer cannot suspend their own account');
    const now = new Date().toISOString();
    return dbh.withTransaction(async (session) => {
      const upd = await c.accountReviews.findOneAndUpdate(
        { _id: reviewId, state: 'open', version: rev.version },
        { $set: { state: input.decision, decidedBy: actor.principalId, decidedAt: now, note: input.note }, $inc: { version: 1 } },
        { returnDocument: 'after', session },
      );
      if (!upd) throw new DomainError('VERSION_CONFLICT', 'review changed');
      for (const pid of input.suspendPrincipalIds) {
        await c.principals.updateOne({ _id: pid, status: 'active' }, { $set: { status: 'suspended', updatedAt: now }, $inc: { version: 1, aclVersion: 1 } }, { session });
        await c.sessions.updateMany({ principalId: pid, revokedAt: null }, { $set: { revokedAt: now, revokedReason: 'account_suspended' } }, { session });
        await audit.append({ actorPrincipalId: actor.principalId, action: 'account.suspend', target: { type: 'principal', id: pid }, scope: SITE, outcome: 'success', details: { reviewId }, requestId: actor.requestId }, session);
      }
      await audit.append({ actorPrincipalId: actor.principalId, action: 'account_review.decide', target: { type: 'account_review', id: reviewId }, scope: SITE, outcome: 'success', details: { decision: input.decision, suspended: input.suspendPrincipalIds, autoMerge: false }, requestId: actor.requestId }, session);
      await outbox.append({ type: 'account.review.decided', aggregate: { type: 'account_review', id: reviewId }, aggregateVersion: upd.version, actor: { principalId: actor.principalId, kind: 'user' }, payload: { decision: input.decision }, correlationId: actor.requestId }, session);
      return upd;
    });
  }
}
