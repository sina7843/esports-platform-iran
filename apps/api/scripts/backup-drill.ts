/**
 * OPS-004/005 backup and restore drill (manual, test environment only):
 *   MONGO_URL=<source db> BACKUP_TARGET_DIR=<independent dir> pnpm --filter @esp/api exec tsx scripts/backup-drill.ts [--ephemeral-key]
 * Backs up the source database and files, verifies the encrypted copy, restores into a throw-away database, runs the
 * integrity / audit chain / finance reconciliation / queue replay / tombstone checks and writes the measured RPO/RTO
 * report to docs/release/evidence/. The key comes from BACKUP_ENCRYPTION_KEY, or with --ephemeral-key a random key
 * that lives only for this process (the drill proves the procedure; production keeps a managed key).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createContainer, runBackupDrill } from '@esp/core';

const ct = await createContainer({ serviceName: 'backup-drill' });
try {
  const ephemeral = process.argv.includes('--ephemeral-key');
  const key = ephemeral ? randomBytes(32).toString('base64url') : ct.config.BACKUP_ENCRYPTION_KEY;
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY is not set (use --ephemeral-key for a drill)');
  const targetDir = ct.config.BACKUP_TARGET_DIR ?? mkdtempSync(join(tmpdir(), 'esp-drill-target-'));
  if (ct.config.isProduction) throw new Error('the drill restores into a throw-away database; run it on a test environment');
  const report = await runBackupDrill(ct, { targetDir, key, mongoUrl: ct.config.MONGO_URL, intervalMinutes: ct.config.BACKUP_INTERVAL_MINUTES });
  const dir = join(process.cwd(), '..', '..', 'docs', 'release', 'evidence');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `backup-drill-${report.at.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ ...report, host: { platform: process.platform, node: process.version } }, null, 2));
  await ct.c.platformSettings.updateOne({ _id: 'ops.last_drill' }, { $set: { value: { at: report.at, ok: report.verify.ok && report.countsMatch && report.checks.ok, rpoMinutes: report.rpo.worstMinutes, rtoMinutes: report.rto.minutes }, updatedBy: 'system:drill', updatedAt: report.at }, $inc: { version: 1 }, $setOnInsert: { history: [] } }, { upsert: true });
  console.log(JSON.stringify({ file, backup: report.backup, verify: report.verify, restore: report.restore, countsMatch: report.countsMatch, mismatches: report.mismatches, checks: report.checks, rpo: report.rpo, rto: report.rto }, null, 2));
  if (!report.verify.ok || !report.countsMatch || !report.checks.ok) process.exitCode = 1;
} finally {
  await ct.close();
}
