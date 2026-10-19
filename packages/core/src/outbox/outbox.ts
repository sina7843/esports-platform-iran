import type { ClientSession } from 'mongodb';
import { DomainEventSchema, type DomainEvent } from '@esp/contracts';
import type { Collections, OutboxDoc } from '../db/collections.js';
import { newId } from '../ids.js';

/**
 * Transactional outbox writer. `append` must be called with the same session as the domain write so the
 * event is committed atomically with the change (or not at all).
 */
export type NewDomainEvent = Omit<DomainEvent, 'id' | 'occurredAt'> & { id?: string; occurredAt?: string };

export class OutboxWriter {
  constructor(
    private readonly c: Collections,
    private readonly maxAttempts: number,
  ) {}

  async append(input: NewDomainEvent, session?: ClientSession): Promise<OutboxDoc> {
    const event = DomainEventSchema.parse({ id: input.id ?? newId('evt'), occurredAt: input.occurredAt ?? new Date().toISOString(), ...input });
    const { id, ...rest } = event;
    const doc: OutboxDoc = {
      _id: id,
      ...rest,
      status: 'pending',
      attempts: 0,
      maxAttempts: this.maxAttempts,
      nextAttemptAt: event.occurredAt,
      leaseUntil: null,
      leaseOwner: null,
      lastError: null,
      processedAt: null,
      replayOf: null,
    };
    await this.c.outbox.insertOne(doc, session ? { session } : {});
    return doc;
  }
}
