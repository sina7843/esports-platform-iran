import type { Container } from '../container.js';
import { StructureService } from './structure.js';
import { ServerService } from './servers.js';
import { SelectionService } from './selection.js';

/**
 * ESP-04 consumers. Advancement reacts to finalised matches only; it is idempotent (sync recomputes from final
 * results; side assignment is a version-checked transition; slots are unique per stage), so redelivery is harmless.
 */
export function registerEsp04Consumers(ct: Container): void {
  const structure = new StructureService(ct);
  const servers = new ServerService(ct);
  ct.consumer.register({
    name: 'competition-advancement',
    matches: ['competition.match.finalized'],
    async handle(event) {
      const m = await ct.c.matches.findOne({ _id: String(event.payload['matchId']) });
      if (!m || m.state !== 'final') return; // only final results are consumed
      await structure.applyLadderResult(m);
      await structure.sync(m.stageId, event.correlationId);
      // SRV-001 / LAN-001: resources are released after use (exactly once; both calls are conditional)
      await servers.release(m._id, 'match final', 'system', event.correlationId);
      await ct.c.stations.updateOne({ matchId: m._id, state: 'in_use' }, { $set: { state: 'ready', matchId: null }, $inc: { version: 1 } });
    },
  });
}

/** Worker job: expired selection turns get the rules' timeout action (reads also apply it lazily). */
export function startEsp04Jobs(ct: Container, intervalMs = 5_000): () => void {
  const selection = new SelectionService(ct);
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void selection
      .sweep()
      .catch((err: unknown) => ct.logger.error({ err }, 'esp04 job failed'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
