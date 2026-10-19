import { createHash } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import type { Scope } from '@esp/contracts';
import type { Collections, AuditDoc } from '../db/collections.js';
import { newId } from '../ids.js';

/**
 * Append-only, hash-chained audit log (SEC-007, ACL-004, BASE-004).
 * - Insert-only API; no update/delete helpers exist in the codebase.
 * - Each entry stores sha256(prevHash + canonical entry) so ordinary edits break the chain (verifiable with `verifyChain`).
 * - The Mongo application role is documented without update/remove privileges on `audit_log`.
 * - `seq` comes from an atomic counter inside the same transaction as the audited change when a session is given.
 */
export interface AuditInput {
  actorPrincipalId: string;
  action: string;
  target: { type: string; id: string };
  scope: Scope;
  outcome: 'success' | 'denied' | 'failed';
  details?: Record<string, unknown>;
  requestId: string;
}

function canonical(e: Omit<AuditDoc, 'hash'>): string {
  return JSON.stringify({ seq: e.seq, at: e.at, actor: e.actorPrincipalId, action: e.action, target: e.target, scope: e.scope, outcome: e.outcome, details: e.details, requestId: e.requestId, prevHash: e.prevHash });
}

export class AuditLog {
  constructor(private readonly c: Collections) {}

  async append(input: AuditInput, session?: ClientSession): Promise<AuditDoc> {
    const counter = await this.c.counters.findOneAndUpdate(
      { _id: 'audit_seq' },
      { $inc: { value: 1 } },
      { upsert: true, returnDocument: 'after', ...(session ? { session } : {}) },
    );
    const seq = counter!.value;
    const prev = await this.c.audit.find({ seq: seq - 1 }, session ? { session } : {}).limit(1).next();
    const prevHash = prev?.hash ?? 'GENESIS';
    const base: Omit<AuditDoc, 'hash'> = {
      _id: newId('aud'),
      seq,
      at: new Date().toISOString(),
      actorPrincipalId: input.actorPrincipalId,
      action: input.action,
      target: input.target,
      scope: input.scope,
      outcome: input.outcome,
      details: input.details ?? {},
      requestId: input.requestId,
      prevHash,
    };
    const doc: AuditDoc = { ...base, hash: createHash('sha256').update(prevHash + canonical(base)).digest('hex') };
    await this.c.audit.insertOne(doc, session ? { session } : {});
    return doc;
  }

  /** Walks the chain and reports the first broken link, if any. */
  async verifyChain(): Promise<{ ok: boolean; checked: number; brokenAtSeq?: number }> {
    let prevHash = 'GENESIS';
    let checked = 0;
    for await (const e of this.c.audit.find({}).sort({ seq: 1 })) {
      const { hash, ...rest } = e;
      const expected = createHash('sha256').update(prevHash + canonical(rest)).digest('hex');
      if (expected !== hash || rest.prevHash !== prevHash) return { ok: false, checked, brokenAtSeq: e.seq };
      prevHash = hash;
      checked++;
    }
    return { ok: true, checked };
  }
}
