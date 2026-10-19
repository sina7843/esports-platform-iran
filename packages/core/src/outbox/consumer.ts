import type { ClientSession } from 'mongodb';
import type { Logger } from 'pino';
import { DomainError, type DomainEvent } from '@esp/contracts';
import type { Collections, OutboxDoc } from '../db/collections.js';
import type { DbHandle } from '../db/client.js';
import { newId } from '../ids.js';
import type { AuditLog } from '../audit/audit.js';

/**
 * Outbox consumer runtime.
 * - Claims one pending record at a time with a lease (`findOneAndUpdate` pending→processing) so several worker
 *   replicas never process the same record concurrently; expired leases are reclaimable (crash recovery).
 * - Each handler runs inside a transaction together with an insert into `processed_events` keyed by
 *   `${consumer}:${eventId}`. If the handler's side effects are in Mongo, a crash after effects but before the
 *   marker rolls everything back; a re-run sees no marker and applies once. If the marker exists, the handler is
 *   skipped (idempotent). Handlers that call external providers must use provider-side idempotency keys.
 * - Bounded retries with exponential backoff, then `dead_letter`. Replay is explicit, audited and creates a new
 *   record referencing the original (`replayOf`), so history is never rewritten.
 */
export type EventHandler = (event: DomainEvent, session: ClientSession) => Promise<void>;

export interface ConsumerRegistration {
  name: string;
  /** Event types or prefixes ('acl.' matches 'acl.grant.created'). */
  matches: string[];
  handle: EventHandler;
}

export interface ConsumerOptions {
  workerId: string;
  pollMs: number;
  leaseMs: number;
  logger: Logger;
}

function matchesType(reg: ConsumerRegistration, type: string): boolean {
  return reg.matches.some((m) => (m.endsWith('.') ? type.startsWith(m) : m === type));
}

export function toDomainEvent(doc: OutboxDoc): DomainEvent {
  return { id: doc._id, type: doc.type, aggregate: doc.aggregate, aggregateVersion: doc.aggregateVersion, occurredAt: doc.occurredAt, actor: doc.actor, payload: doc.payload, correlationId: doc.correlationId };
}

export class OutboxConsumer {
  private readonly consumers: ConsumerRegistration[] = [];
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly dbh: DbHandle,
    private readonly c: Collections,
    private readonly audit: AuditLog,
    private readonly opts: ConsumerOptions,
  ) {}

  register(reg: ConsumerRegistration): void {
    if (this.consumers.some((r) => r.name === reg.name)) throw new Error(`duplicate consumer ${reg.name}`);
    this.consumers.push(reg);
  }

  /** Claims the next eligible record (pending, or processing with an expired lease). */
  async claim(now = new Date()): Promise<OutboxDoc | null> {
    const nowIso = now.toISOString();
    const leaseUntil = new Date(now.getTime() + this.opts.leaseMs).toISOString();
    return this.c.outbox.findOneAndUpdate(
      { $or: [{ status: 'pending', nextAttemptAt: { $lte: nowIso } }, { status: 'processing', leaseUntil: { $lt: nowIso } }] },
      { $set: { status: 'processing', leaseUntil, leaseOwner: this.opts.workerId }, $inc: { attempts: 1 } },
      { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
    );
  }

  /** Processes one claimed record through every matching consumer. Returns the outcome for tests/metrics. */
  async process(doc: OutboxDoc): Promise<'done' | 'retry' | 'dead_letter' | 'skipped'> {
    const event = toDomainEvent(doc);
    const targets = this.consumers.filter((r) => matchesType(r, event.type));
    try {
      for (const reg of targets) {
        const markerId = `${reg.name}:${event.id}`;
        await this.dbh.withTransaction(async (session) => {
          const existing = await this.c.processedEvents.findOne({ _id: markerId }, { session });
          if (existing) return; // idempotent skip
          await reg.handle(event, session);
          await this.c.processedEvents.insertOne({ _id: markerId, consumer: reg.name, eventId: event.id, processedAt: new Date().toISOString() }, { session });
        });
      }
      await this.c.outbox.updateOne({ _id: doc._id }, { $set: { status: 'done', processedAt: new Date().toISOString(), leaseUntil: null, leaseOwner: null, lastError: null } });
      return 'done';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.logger.warn({ eventId: doc._id, type: doc.type, attempts: doc.attempts, err: message }, 'outbox handler failed');
      if (doc.attempts >= doc.maxAttempts) {
        await this.c.outbox.updateOne({ _id: doc._id }, { $set: { status: 'dead_letter', lastError: message, leaseUntil: null, leaseOwner: null } });
        await this.audit.append({ actorPrincipalId: 'system:worker', action: 'outbox.dead_letter', target: { type: 'outbox', id: doc._id }, scope: { type: 'site', id: 'site' }, outcome: 'failed', details: { type: doc.type, error: message }, requestId: doc.correlationId });
        return 'dead_letter';
      }
      const backoffMs = Math.min(60_000, 500 * 2 ** doc.attempts);
      await this.c.outbox.updateOne({ _id: doc._id }, { $set: { status: 'pending', nextAttemptAt: new Date(Date.now() + backoffMs).toISOString(), lastError: message, leaseUntil: null, leaseOwner: null } });
      return 'retry';
    }
  }

  /** Drains everything currently eligible; used by tests and the `--once` CLI mode. */
  async drain(max = 1000): Promise<number> {
    let n = 0;
    while (n < max) {
      const doc = await this.claim();
      if (!doc) break;
      await this.process(doc);
      n++;
    }
    return n;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        try {
          const processed = await this.drain(50);
          if (processed === 0) await new Promise((r) => setTimeout(r, this.opts.pollMs));
        } catch (err) {
          this.opts.logger.error({ err }, 'outbox loop error');
          await new Promise((r) => setTimeout(r, this.opts.pollMs * 4));
        }
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
    // release our leases so another replica can continue immediately
    await this.c.outbox.updateMany({ status: 'processing', leaseOwner: this.opts.workerId }, { $set: { status: 'pending', leaseUntil: null, leaseOwner: null } });
  }

  /** Controlled replay (OPS-006): creates a fresh pending copy that references the dead-lettered original. */
  async replay(outboxId: string, actor: { principalId: string; requestId: string }): Promise<OutboxDoc> {
    const original = await this.c.outbox.findOne({ _id: outboxId });
    if (!original) throw new DomainError('NOT_FOUND', 'outbox record not found');
    if (original.status !== 'dead_letter') throw new DomainError('PRECONDITION_FAILED', 'only dead-lettered records can be replayed');
    const copy: OutboxDoc = {
      ...original,
      _id: newId('evt'),
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
      leaseUntil: null,
      leaseOwner: null,
      lastError: null,
      processedAt: null,
      replayOf: original._id,
    };
    await this.c.outbox.insertOne(copy);
    await this.c.outbox.updateOne({ _id: original._id }, { $set: { lastError: `replayed as ${copy._id}` } });
    await this.audit.append({ actorPrincipalId: actor.principalId, action: 'outbox.replay', target: { type: 'outbox', id: original._id }, scope: { type: 'site', id: 'site' }, outcome: 'success', details: { replayId: copy._id, type: original.type }, requestId: actor.requestId });
    return copy;
  }

  async stats(): Promise<Record<string, number>> {
    const rows = await this.c.outbox.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray();
    return Object.fromEntries(rows.map((r) => [r._id, r.n]));
  }
}
