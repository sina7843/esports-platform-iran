import type { ClientSession } from 'mongodb';
import { DomainError } from '@esp/contracts';
import type { Collections } from '../db/collections.js';
import type { LedgerEntryDoc } from '../db/collections-esp03.js';
import { newId } from '../ids.js';

/**
 * Append-only double-entry ledger (FIN-003, SEC-006/007). Every transaction is a set of lines whose amounts sum to
 * zero (integer IRR). There is no update or delete API: a correction is a new transaction that reverses another
 * (`reversalOf`). `seq` is allocated from an atomic counter inside the caller's transaction.
 */
export type LedgerKind = LedgerEntryDoc['kind'];

export class Ledger {
  constructor(private readonly c: Collections) {}

  async post(
    input: { lines: Array<{ account: string; amountRial: number }>; kind: LedgerKind; refs: Record<string, string>; reason: string | null; createdBy: string; reversalOf?: string | null },
    session: ClientSession,
  ): Promise<string> {
    if (input.lines.length < 2) throw new DomainError('VALIDATION_FAILED', 'a ledger transaction needs at least two lines');
    for (const l of input.lines) if (!Number.isSafeInteger(l.amountRial) || l.amountRial === 0) throw new DomainError('VALIDATION_FAILED', 'ledger amounts must be non-zero integer rial');
    const sum = input.lines.reduce((a, l) => a + l.amountRial, 0);
    if (sum !== 0) throw new DomainError('VALIDATION_FAILED', `unbalanced ledger transaction (${sum})`);
    const txId = newId('ltx');
    const counter = await this.c.counters.findOneAndUpdate({ _id: 'ledger_seq' }, { $inc: { value: input.lines.length } }, { upsert: true, returnDocument: 'after', session });
    let seq = counter!.value - input.lines.length;
    const now = new Date().toISOString();
    const docs: LedgerEntryDoc[] = input.lines.map((l) => ({
      _id: newId('led'),
      seq: ++seq,
      txId,
      account: l.account,
      amountRial: l.amountRial,
      kind: input.kind,
      refs: input.refs,
      reason: input.reason,
      reversalOf: input.reversalOf ?? null,
      createdBy: input.createdBy,
      createdAt: now,
    }));
    await this.c.ledger.insertMany(docs, { session });
    return txId;
  }

  /** Compensating transaction for a previous one (never edits history). */
  async reverse(txId: string, reason: string, createdBy: string, session: ClientSession): Promise<string> {
    const lines = await this.c.ledger.find({ txId }, { session }).toArray();
    if (!lines.length) throw new DomainError('NOT_FOUND', 'ledger transaction not found');
    if (await this.c.ledger.findOne({ reversalOf: txId }, { session })) throw new DomainError('CONFLICT', 'transaction already reversed');
    return this.post({ lines: lines.map((l) => ({ account: l.account, amountRial: -l.amountRial })), kind: 'reversal', refs: { ...lines[0]!.refs, reversed: txId }, reason, createdBy, reversalOf: txId }, session);
  }

  async balance(account: string): Promise<number> {
    const r = await this.c.ledger.aggregate<{ total: number }>([{ $match: { account } }, { $group: { _id: null, total: { $sum: '$amountRial' } } }]).toArray();
    return r[0]?.total ?? 0;
  }

  /** Integrity check used by reconciliation and restore drills: every transaction must balance. */
  async unbalancedTransactions(): Promise<string[]> {
    const r = await this.c.ledger.aggregate<{ _id: string; total: number }>([{ $group: { _id: '$txId', total: { $sum: '$amountRial' } } }, { $match: { total: { $ne: 0 } } }]).toArray();
    return r.map((x) => x._id);
  }
}
