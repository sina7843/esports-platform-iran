import type { Container } from '../container.js';
import { RegistrationService } from '../registration/registration.js';
import { CommerceService } from './commerce.js';
import { PrizeService } from './prizes.js';
import { PaymentsService } from './payments.js';
import { EventsService } from '../events/events.js';

/**
 * ESP-03 outbox consumers. Their effects run in their own transactions and are idempotent at the domain level
 * (version-checked transitions, refund idempotency keys, `released` flags), so a retry after a crash has no second
 * effect. Notifications go to the per-user realtime channel; SMS/email fan-out is completed in ESP-06 (COM-*).
 */
export function registerEsp03Consumers(ct: Container): void {
  const regs = new RegistrationService(ct);
  const commerce = new CommerceService(ct);
  const prizes = new PrizeService(ct);

  ct.consumer.register({
    name: 'order-paid-fulfilment',
    matches: ['finance.order.paid'],
    async handle(event) {
      const refs = (event.payload['refs'] ?? {}) as Record<string, string>;
      const orderId = String(event.payload['orderId']);
      if (refs['registrationId']) await regs.onOrderPaid(refs['registrationId'], event.correlationId);
      if (refs['subscriptionId']) await commerce.onSubscriptionPaid(refs['subscriptionId'], orderId);
      if (event.payload['kind'] === 'ticket') await commerce.onTicketsPaid(orderId);
    },
  });

  ct.consumer.register({
    name: 'event-cancellation-settlement',
    matches: ['competition.event.cancelled'],
    async handle(event) {
      const eventId = String(event.payload['eventId']);
      const pct = Number(event.payload['refundPercent'] ?? 100);
      await regs.cancelForEvent(eventId, pct, event.correlationId);
      await commerce.voidTicketsForEvent(eventId, pct, event.correlationId);
      await prizes.cancelForEvent(eventId);
    },
  });

  ct.consumer.register({
    name: 'user-status-notifications',
    matches: ['registration.', 'finance.refund.confirmed', 'finance.payment.failed'],
    async handle(event, session) {
      let principalIds: string[] = [];
      if (event.type.startsWith('registration.')) {
        const r = await ct.c.registrations.findOne({ _id: event.aggregate.id }, { session });
        if (r) principalIds = [...new Set([r.applicantPrincipalId, ...r.roster.map((m) => m.principalId)])];
      } else {
        const orderId = String(event.payload['orderId'] ?? event.aggregate.id);
        const o = await ct.c.orders.findOne({ _id: orderId }, { session });
        if (o) principalIds = [o.payerPrincipalId];
      }
      if (!principalIds.length) return;
      await ct.realtime.publish({ channel: 'notifications', type: event.type, audience: { kind: 'principals', principalIds }, payload: { ...event.payload } }, session);
    },
  });
}

/** Periodic jobs hosted by the worker (REG-006 expiry/promotion, FIN-004 reconciliation, EVT-006 scheduling, FIN-009 renewals). */
export function startEsp03Jobs(ct: Container, intervalMs = 30_000): () => void {
  const regs = new RegistrationService(ct);
  const payments = new PaymentsService(ct);
  const events = new EventsService(ct);
  const commerce = new CommerceService(ct);
  let ticks = 0;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    ticks++;
    void (async () => {
      try {
        await regs.expireReservations();
        await payments.reconcile();
        await events.publishDue();
        if (ticks % 120 === 0) await commerce.renewAndExpire();
      } catch (err) {
        ct.logger.error({ err }, 'esp03 job failed');
      } finally {
        running = false;
      }
    })();
  }, intervalMs);
  return () => clearInterval(timer);
}
