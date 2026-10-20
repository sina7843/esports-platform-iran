import { z } from 'zod';
import { ScopeSchema } from './acl.js';

/**
 * Durable outbox contract. A domain change and its event are written in the SAME MongoDB transaction;
 * the worker claims pending events with a lease, dispatches to idempotent consumers, retries with a bounded
 * backoff, parks failures in `dead_letter`, and supports audited replay.
 */
export const OutboxStatuses = ['pending', 'processing', 'done', 'dead_letter'] as const;
export type OutboxStatus = (typeof OutboxStatuses)[number];

export const DomainEventSchema = z.object({
  /** ULID-like unique id; also the idempotency key for consumers. */
  id: z.string(),
  type: z.string().regex(/^[a-z_]+\.[a-z_]+(\.[a-z_]+)?$/, 'domain.entity.action'),
  /** Aggregate that produced the event, used for ordering and replay scoping. */
  aggregate: z.object({ type: z.string(), id: z.string() }),
  /** Monotonic version of the aggregate after the change (optimistic concurrency). */
  aggregateVersion: z.number().int().nonnegative(),
  occurredAt: z.string(),
  actor: z.object({ principalId: z.string(), kind: z.enum(['user', 'system', 'service']) }),
  payload: z.record(z.string(), z.unknown()),
  /** Correlation for tracing a user request through API → outbox → worker → realtime. */
  correlationId: z.string(),
});
export type DomainEvent = z.infer<typeof DomainEventSchema>;

export const OutboxRecordSchema = DomainEventSchema.extend({
  status: z.enum(OutboxStatuses),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  nextAttemptAt: z.string(),
  leaseUntil: z.string().nullable(),
  leaseOwner: z.string().nullable(),
  lastError: z.string().nullable(),
  processedAt: z.string().nullable(),
  replayOf: z.string().nullable(),
});
export type OutboxRecord = z.infer<typeof OutboxRecordSchema>;

/**
 * Realtime contract (SSE primary, WebSocket optional, polling fallback). Every realtime event has a strictly
 * increasing `seq` used as the resume cursor. `audience` is evaluated server-side per connection on EVERY push,
 * so a revoked grant stops delivery immediately (ACL-002, AC-23).
 *
 * Delayed projection contract for ESP-06 (CAST-005/006): `visibleAt` is the earliest instant a channel may
 * expose the event. Public projections (API lists, streams, overlays, share images, notifications) filter
 * `visibleAt <= now` on the server; "latest result" views are a separately labeled channel with `delayed=false`.
 */
export const AudienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('public') }),
  z.object({ kind: z.literal('principals'), principalIds: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal('scope'), scope: ScopeSchema, permission: z.string() }),
]);
export type Audience = z.infer<typeof AudienceSchema>;

export const RealtimeEventSchema = z.object({
  seq: z.number().int().positive(),
  id: z.string(),
  channel: z.string(), // e.g. 'event:<id>:timeline', 'match:<id>', 'system'
  type: z.string(),
  audience: AudienceSchema,
  /** Earliest visibility per channel; undefined means immediate. */
  visibleAt: z.string().optional(),
  createdAt: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;

export const RealtimePollQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  channels: z.string().max(1000).optional(), // comma separated
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const RealtimePollResponseSchema = z.object({
  events: z.array(RealtimeEventSchema),
  cursor: z.number().int().nonnegative(),
  serverTime: z.string(),
  /** LIVE-006: the cursor is older than the retention floor; the client must reload a snapshot */
  resync: z.boolean().optional(),
});
