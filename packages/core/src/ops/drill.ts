import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import type { Container } from '../container.js';
import { createContainer } from '../container.js';
import { runMigrations } from '../db/migrations.js';
import { reapplyTombstones } from '../admin/privacy.js';
import { createBackup, importTombstoneLog, restoreBackup, verifyBackup } from './backup.js';

/** OPS-004/005 checks run against a RESTORED database before it is trusted. */
export async function postRestoreChecks(ct: Container, tombstoneDir?: string) {
  const imported = tombstoneDir ? await importTombstoneLog(ct, tombstoneDir) : 0;
  const audit = await ct.audit.verifyChain();
  // finance: every ledger transaction balances to zero, and every verified payment has its ledger posting
  const unbalanced = await ct.c.ledger.aggregate<{ _id: string; s: number }>([{ $group: { _id: '$txId', s: { $sum: '$amountRial' } } }, { $match: { s: { $ne: 0 } } }]).toArray();
  const verified = await ct.c.payments.find({ state: { $in: ['verified', 'refunded_partial', 'refunded_full', 'awaiting_refund'] } }, { projection: { _id: 1 } }).toArray();
  const posted = new Set((await ct.c.ledger.find({ kind: { $in: ['payment', 'manual_payment'] } }, { projection: { refs: 1 } }).toArray()).map((l) => l.refs['paymentId']));
  const missingPostings = verified.filter((p) => !posted.has(p._id)).map((p) => p._id);
  // queue replay: work that was in flight at the time of the backup is made eligible and re-run (consumers are idempotent)
  const requeued = (await ct.c.outbox.updateMany({ status: 'processing' as never }, { $set: { status: 'pending' as never, leaseUntil: null, leaseOwner: null } })).modifiedCount;
  const drained = await ct.consumer.drain(5000);
  const tomb = await reapplyTombstones(ct);
  return { audit, finance: { unbalancedTransactions: unbalanced.length, verifiedPayments: verified.length, missingPostings }, queue: { requeued, drained, stillDead: await ct.c.outbox.countDocuments({ status: 'dead_letter' }) }, tombstones: { ...tomb, imported }, ok: audit.ok && unbalanced.length === 0 && missingPostings.length === 0 };
}

export interface DrillReport {
  at: string;
  intervalMinutes: number;
  backup: { id: string; ms: number; bytes: number; collections: number; documents: number; files: number };
  verify: { ok: boolean; problems: string[] };
  restore: { ms: number; db: string };
  checks: Awaited<ReturnType<typeof postRestoreChecks>>;
  countsMatch: boolean;
  mismatches: string[];
  rpo: { worstMinutes: number; targetMinutes: 15; met: boolean };
  rto: { minutes: number; targetMinutes: 120; met: boolean; note: string };
}

/**
 * Full drill on a TEST environment: backup → verify → restore into a fresh database and file dir → checks, with RPO and
 * RTO computed from measured durations. RPO worst case = backup interval + backup duration (data written after the
 * backup started is what a failure loses); RTO = verify + restore + checks, excluding human and provisioning time
 * (stated in `note`).
 */
export async function runBackupDrill(ct: Container, opts: { targetDir: string; key: string; mongoUrl: string; intervalMinutes?: number; env?: NodeJS.ProcessEnv }): Promise<DrillReport> {
  const intervalMinutes = opts.intervalMinutes ?? 10;
  const b0 = Date.now();
  const { dir, manifest } = await createBackup(ct, { targetDir: opts.targetDir, key: opts.key, label: 'drill' });
  const backupMs = Date.now() - b0;
  const t0 = Date.now();
  const v = await verifyBackup(dir, opts.key);
  const url = new URL(opts.mongoUrl);
  url.pathname = `/esp_restore_${Date.now().toString(36)}`;
  const dataDir = mkdtempSync(join(tmpdir(), 'esp-restore-'));
  const r = await restoreBackup({ dir, key: opts.key, mongoUrl: url.toString(), dataDir });
  const restored = await createContainer({ serviceName: 'restore-drill', env: { ...(opts.env ?? process.env), MONGO_URL: url.toString(), DATA_DIR: dataDir } });
  try {
    const mismatches: string[] = [];
    for (const c of manifest.collections) {
      const n = await restored.dbh.db.collection(c.name).countDocuments({});
      if (n !== c.documents) mismatches.push(`${c.name}: backup ${c.documents}, restored ${n}`);
    }
    await runMigrations(restored.dbh.db); // after the faithful-copy comparison: an older backup may lack the newest migration
    const checks = await postRestoreChecks(restored, opts.targetDir);
    const rtoMin = (Date.now() - t0) / 60_000;
    const worst = intervalMinutes + backupMs / 60_000;
    return {
      at: new Date().toISOString(), intervalMinutes,
      backup: { id: manifest.id, ms: backupMs, bytes: manifest.totals.bytes, collections: manifest.collections.length, documents: manifest.totals.documents, files: manifest.totals.files },
      verify: { ok: v.ok, problems: v.problems }, restore: { ms: r.ms, db: r.db }, checks, countsMatch: mismatches.length === 0, mismatches,
      rpo: { worstMinutes: Math.round(worst * 100) / 100, targetMinutes: 15, met: worst <= 15 },
      rto: { minutes: Math.round(rtoMin * 100) / 100, targetMinutes: 120, met: rtoMin <= 120, note: 'measured restore + verification + checks on this machine; excludes provisioning a replacement host and operator reaction time' },
    };
  } finally {
    await restored.close();
    const c = await new MongoClient(url.toString()).connect();
    await c.db().dropDatabase();
    await c.close();
  }
}
