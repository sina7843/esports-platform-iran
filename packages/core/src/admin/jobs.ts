import type { Container } from '../container.js';
import { deliverWebhooks } from '../integrations/partner.js';
import { createBackup, pruneBackups } from '../ops/backup.js';
import { RetentionService } from './privacy.js';

/**
 * ESP-07 worker jobs, each safe to rerun: webhook delivery (signed, retried, dead-lettered) every few seconds and
 * the retention job every few hours. Retention only touches classes with an approved policy and skips holds/open cases.
 */
export function startEsp07Jobs(ct: Container, intervalMs = 5_000, retentionEveryMs = 6 * 3_600_000): () => void {
  let running = false;
  let lastRetention = 0;
  let lastBackup = 0;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      await deliverWebhooks(ct, ct.config.isProduction ? {} : { allowPrivate: true });
      const { BACKUP_TARGET_DIR: dir, BACKUP_ENCRYPTION_KEY: key, BACKUP_INTERVAL_MINUTES: every, BACKUP_KEEP: keep } = ct.config;
      if (dir && key && Date.now() - lastBackup > every * 60_000) {
        lastBackup = Date.now();
        const b = await createBackup(ct, { targetDir: dir, key, label: 'scheduled' });
        ct.logger.info({ backup: b.manifest.id, bytes: b.manifest.totals.bytes, documents: b.manifest.totals.documents }, 'scheduled backup finished');
        await pruneBackups(dir, keep);
      }
      if (Date.now() - lastRetention > retentionEveryMs) {
        lastRetention = Date.now();
        const r = await new RetentionService(ct).run();
        ct.logger.info({ retention: r.report }, 'retention job finished');
      }
    })()
      .catch((err: unknown) => ct.logger.error({ err }, 'esp07 job failed'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
