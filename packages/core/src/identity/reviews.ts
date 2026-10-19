import type { ClientSession } from 'mongodb';
import type { Collections } from '../db/collections.js';
import type { AccountReviewDoc } from '../db/collections-esp02.js';
import type { AuditLog } from '../audit/audit.js';
import { newId } from '../ids.js';

/**
 * Duplicate-account signal sink (USR-010). Opens (or returns the already open) review for the same principal set
 * and reason. Never merges, suspends or edits any account: a human decides (resolved_* states).
 */
export async function openAccountReview(
  c: Collections,
  principalIds: string[],
  reason: string,
  signals: Record<string, unknown>,
  opts: { audit?: AuditLog; requestId?: string; session?: ClientSession } = {},
): Promise<AccountReviewDoc> {
  const ids = [...new Set(principalIds)].sort();
  const o = opts.session ? { session: opts.session } : {};
  const existing = await c.accountReviews.findOne({ state: 'open', reason, principalIds: { $all: ids, $size: ids.length } }, o);
  if (existing) return existing;
  const doc: AccountReviewDoc = { _id: newId('rev'), principalIds: ids, reason, signals, state: 'open', decidedBy: null, decidedAt: null, note: null, createdAt: new Date().toISOString(), version: 0 };
  await c.accountReviews.insertOne(doc, o);
  await opts.audit?.append({ actorPrincipalId: 'system:identity', action: 'account_review.open', target: { type: 'account_review', id: doc._id }, scope: { type: 'site', id: 'site' }, outcome: 'success', details: { reason, principalIds: ids }, requestId: opts.requestId ?? 'system' }, opts.session);
  return doc;
}
