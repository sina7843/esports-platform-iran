import type { Container } from '../container.js';
import { MatchResultService } from '../competition/results.js';
import { RatingService } from '../ranking/ratings.js';
import { DisputeService } from './disputes.js';
import { SanctionService } from './sanctions.js';

/**
 * ESP-05 consumers. Newsroom events carry a stable `dedupeKey` (NEWS-006) so an automatic post is created once even
 * when an event is redelivered; notifications go to the principals named in the payload (the notification center in
 * ESP-06 consumes the same stream).
 */
export function registerEsp05Consumers(ct: Container): void {
  ct.consumer.register({
    name: 'integrity-notifications',
    matches: ['integrity.', 'competition.result.', 'competition.match.reopened', 'honors.'],
    async handle(event, session) {
      const principalIds = (event.payload['principals'] as string[] | undefined)?.filter(Boolean) ?? [];
      if (!principalIds.length) return;
      await ct.realtime.publish({ channel: 'notifications', type: event.type, audience: { kind: 'principals', principalIds }, payload: { ...event.payload, principals: undefined } }, session);
    },
  });
  ct.consumer.register({
    name: 'newsroom-results',
    matches: ['competition.match.finalized'],
    async handle(event) {
      const m = await ct.c.matches.findOne({ _id: String(event.payload['matchId']) });
      if (!m || m.state !== 'final' || m.outcome?.kind !== 'win' || !m.slot) return;
      const elim = await ct.c.stageStructures.findOne({ _id: m.stageId }, { projection: { format: 1 } });
      if (!elim || !['single_elim', 'double_elim', 'mixed'].includes(elim.format)) return;
      const winner = m.sides[m.outcome.winnerSide];
      const loser = m.sides[m.outcome.winnerSide === 0 ? 1 : 0];
      const losersBracket = await ct.c.matches.findOne({ stageId: m.stageId, 'slot.sources': { $elemMatch: { kind: 'loser', slot: m.slot.key } } }, { projection: { _id: 1 } });
      const key = `${m._id}:${m.resultVersion}`;
      const items: Array<{ type: string; side: typeof winner }> = [{ type: 'competition.participant.advanced', side: winner }, ...(losersBracket ? [] : [{ type: 'competition.participant.eliminated', side: loser }])];
      for (const { type, side } of items) {
        if (!side || (await ct.c.outbox.findOne({ type, 'payload.dedupeKey': `${type}:${key}` }))) continue;
        await ct.outbox.append({ type, aggregate: { type: 'match', id: m._id }, aggregateVersion: m.version, actor: { principalId: 'system', kind: 'system' }, payload: { eventId: m.eventId, stageId: m.stageId, matchId: m._id, participationId: side.participationId, displayName: side.displayName, dedupeKey: `${type}:${key}` }, correlationId: event.correlationId });
      }
    },
  });
}

/** Worker jobs: auto-confirm by rules, appeal-window close, sanction expiry, rating builds. Each is safe to rerun. */
export function startEsp05Jobs(ct: Container, intervalMs = 15_000): () => void {
  const results = new MatchResultService(ct);
  const disputes = new DisputeService(ct);
  const sanctions = new SanctionService(ct);
  const ratings = new RatingService(ct);
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      await results.autoConfirm();
      await disputes.closeExpired();
      await sanctions.expire();
      await ratings.tick();
    })()
      .catch((err: unknown) => ct.logger.error({ err }, 'esp05 job failed'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
