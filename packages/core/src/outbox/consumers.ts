import type { Logger } from 'pino';
import type { Collections } from '../db/collections.js';
import type { OutboxConsumer } from './consumer.js';
import type { Realtime } from '../realtime/realtime.js';
import type { Sessions } from '../identity/sessions.js';

/**
 * Core consumers registered in every runtime that hosts the outbox loop (worker, and tests).
 * - acl.*: push an `acl.changed` realtime event so live connections re-evaluate; on revocation of a
 *   platform-wide role also revoke the principal's sessions when requested by payload.
 * - approval.*: publish to the requester/decider channels (notification center in ESP-06 consumes the same stream).
 */
export function registerCoreConsumers(consumer: OutboxConsumer, deps: { realtime: Realtime; sessions: Sessions; c: Collections; logger: Logger }): void {
  consumer.register({
    name: 'acl-live-projection',
    matches: ['acl.'],
    async handle(event, session) {
      const principalId = event.aggregate.id;
      await deps.realtime.publish({ channel: 'system', type: event.type, audience: { kind: 'principals', principalIds: [principalId] }, payload: { grantId: event.payload['grantId'], role: event.payload['role'], scope: event.payload['scope'] } }, session);
    },
  });
  consumer.register({
    name: 'approval-notifications',
    matches: ['approval.'],
    async handle(event, session) {
      const approval = await deps.c.approvals.findOne({ _id: event.aggregate.id }, { session });
      if (!approval) return;
      const principalIds = [approval.requestedBy, ...(approval.decidedBy ? [approval.decidedBy] : [])];
      await deps.realtime.publish({ channel: `approvals:${approval.scope.type}:${approval.scope.id}`, type: event.type, audience: { kind: 'principals', principalIds }, payload: { approvalId: approval._id, action: approval.action, state: approval.state } }, session);
    },
  });
}
