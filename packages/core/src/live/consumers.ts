import type { Container } from '../container.js';
import { NewsService } from '../news/news.js';
import { NotificationService } from '../notifications/notifications.js';
import { LiveService } from './live.js';

const NEWS_TYPES = ['competition.match.started', 'competition.match.finalized', 'competition.participant.', 'competition.match.rescheduled', 'honors.issued', 'competition.event.finished', 'competition.event.closed', 'competition.result.corrected'];
const NOTIFY_TYPES = ['registration.', 'finance.order.paid', 'finance.payment.failed', 'finance.refund.confirmed', 'team.invitation.created', 'competition.match.', 'integrity.', 'competition.result.', 'honors.'];

/**
 * ESP-06 consumers. Automatic posts are keyed by the official occurrence and notifications by (event id, person),
 * so redelivery or replay of the same outbox event changes nothing. Match changes become live refresh hints that
 * reach delayed views only when visible there.
 */
export function registerEsp06Consumers(ct: Container): void {
  const news = new NewsService(ct);
  const live = new LiveService(ct);
  const notes = new NotificationService(ct);
  ct.consumer.register({
    name: 'live-newsroom',
    matches: NEWS_TYPES,
    async handle(event) {
      await news.onEvent(event.type, event.payload, event.occurredAt);
      const matchId = typeof event.payload['matchId'] === 'string' ? event.payload['matchId'] : null;
      const eventId = typeof event.payload['eventId'] === 'string' ? event.payload['eventId'] : null;
      if (matchId && eventId && event.type.startsWith('competition.')) await live.pushMatches(eventId, [matchId], event.occurredAt, event.type !== 'competition.match.started' && event.type !== 'competition.match.rescheduled');
    },
  });
  ct.consumer.register({
    name: 'notifications-center',
    matches: NOTIFY_TYPES,
    async handle(event) {
      await notes.fromEvent(event.id, event.type, event.payload, event.occurredAt);
    },
  });
}

/** Worker jobs: scheduled posts, notification dispatch/receipts, realtime retention. Each is safe to rerun. */
export function startEsp06Jobs(ct: Container, intervalMs = 10_000, retentionDays = 7): () => void {
  const news = new NewsService(ct);
  const notes = new NotificationService(ct);
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      await news.publishDue();
      await notes.dispatch();
      await notes.pollDelivery();
      await ct.realtime.prune(retentionDays * 86_400_000);
    })()
      .catch((err: unknown) => ct.logger.error({ err }, 'esp06 job failed'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
