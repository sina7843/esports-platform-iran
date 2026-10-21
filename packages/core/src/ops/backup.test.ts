import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testContainer, rid } from '../test/harness.js';
import { seedIds } from '../db/seed-ids.js';
import { newId } from '../ids.js';
import { AccountService } from '../identity/account.js';
import { createBackup, verifyBackup } from './backup.js';
import { runBackupDrill } from './drill.js';
import { clause, openEvent, preparePublishable } from '../test/esp03-fixture.js';
import { RegistrationService } from '../registration/registration.js';
import { PaymentsService } from '../finance/payments.js';
import type { DevGatewayAdapter } from '../adapters/devGateway.js';

const KEY = 'backup-test-key-0123456789-abcdefghijklmnop';
let t: Awaited<ReturnType<typeof testContainer>>;
let target: string;
beforeAll(async () => {
  t = await testContainer({ seed: true });
  target = mkdtempSync(join(tmpdir(), 'esp-bak-target-'));
  (t.config as { BACKUP_TARGET_DIR?: string }).BACKUP_TARGET_DIR = target;
});
afterAll(async () => {
  await t.drop();
});

describe('encrypted backup, restore and drill (OPS-004/005)', () => {
  it('refuses a target inside the data directory and a short key', async () => {
    await expect(createBackup(t, { targetDir: join(t.config.DATA_DIR, 'bk'), key: KEY })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(createBackup(t, { targetDir: target, key: 'short' })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('backup files are encrypted, verification detects tampering and a wrong key', async () => {
    const { dir } = await createBackup(t, { targetDir: target, key: KEY });
    const file = readdirSync(join(dir, 'db')).find((f) => f.startsWith('principals'))!;
    expect(readFileSync(join(dir, 'db', file)).toString('latin1')).not.toContain(seedIds.admin);
    expect((await verifyBackup(dir, KEY)).ok).toBe(true);
    expect((await verifyBackup(dir, 'another-key-0123456789-abcdefghijklmnopqrst')).ok).toBe(false);
    const p = join(dir, 'db', file);
    const buf = readFileSync(p);
    buf[Math.floor(buf.length / 2)] = (buf[Math.floor(buf.length / 2)] ?? 0) ^ 0xff;
    writeFileSync(p, buf);
    const bad = await verifyBackup(dir, KEY);
    expect(bad.ok).toBe(false);
    expect(bad.problems.join(' ')).toContain('hash mismatch');
  });

  it('drill: restore into a fresh database passes integrity, audit chain, finance and queue checks; deletions are logged outside the backups', async () => {
    const now = new Date().toISOString();
    const victim = `usr_bak_${newId().slice(-6)}`;
    await t.c.principals.insertOne({ _id: victim, kind: 'user', displayName: 'نام واقعی قربانی', locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0 });
    const { createDefaultProfile } = await import('../profiles/defaults.js');
    await t.c.profiles.insertOne(createDefaultProfile(victim, `bak_${newId().slice(-5).toLowerCase()}`));
    await t.audit.append({ actorPrincipalId: seedIds.admin, action: 'drill.marker', target: { type: 'drill', id: 'm' }, scope: { type: 'site', id: 'site' }, outcome: 'success', requestId: rid() });
    await t.c.ledger.insertMany([
      { _id: newId('led'), seq: 9_000_001, txId: 'tx_drill', account: 'cash:drill', amountRial: 100, kind: 'payment', refs: { paymentId: 'pay_none' }, reason: null, reversalOf: null, createdBy: 'test', createdAt: now },
      { _id: newId('led'), seq: 9_000_002, txId: 'tx_drill', account: 'revenue:drill', amountRial: -100, kind: 'payment', refs: {}, reason: null, reversalOf: null, createdBy: 'test', createdAt: now },
    ]);
    const mongoUrl = process.env['MONGO_URL'] ?? 'mongodb://127.0.0.1:27018/esports?directConnection=true';
    const env = { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', LOG_LEVEL: 'silent' };
    const before = await createBackup(t, { targetDir: target, key: KEY });
    await new AccountService(t).anonymize(victim, seedIds.admin, rid()); // deletion AFTER the backup
    const report = await runBackupDrill(t, { targetDir: target, key: KEY, mongoUrl, env });
    expect(report.verify, JSON.stringify(report.verify)).toMatchObject({ ok: true });
    expect(report.countsMatch).toBe(true);
    expect(report.checks.audit.ok).toBe(true);
    expect(report.checks.finance.unbalancedTransactions).toBe(0);
    expect(report.rpo.met).toBe(true);
    expect(report.rto.met).toBe(true);
    const log = readFileSync(join(target, 'tombstones.ndjson'), 'utf8');
    expect(log).toContain(victim);
    expect(log).not.toContain('نام واقعی');
    expect((await verifyBackup(before.dir, KEY)).ok).toBe(true);
  });

  it('drill with a real paid registration: the ledger posting for every verified payment survives the restore and reconciles (AC-22)', async () => {
    const pkg = await preparePublishable(t, [clause('roster.min', 1)]);
    const { disciplineIds } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'پولی', participantKind: 'player', capacity: 4, feeRial: 2_000_000 }], refund: { before: 100, after: 50, cancel: 100, dq: 0 } });
    const now = new Date().toISOString();
    const payer = `usr_pay_${newId().slice(-6)}`;
    await t.c.principals.insertOne({ _id: payer, kind: 'user', displayName: 'پرداخت‌کننده', locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0 });
    await t.acl.grant({ principalId: payer, role: 'player', scope: { type: 'site', id: 'site' }, expiresAt: null, reason: 'test' }, { principalId: 'system', requestId: rid() });
    const { createDefaultProfile } = await import('../profiles/defaults.js');
    await t.c.profiles.insertOne(createDefaultProfile(payer, `pay_${newId().slice(-5).toLowerCase()}`));
    const hash = (await t.c.disciplines.findOne({ _id: disciplineIds[0]! }))!.rulesSnapshot!.hash;
    const reg = await new RegistrationService(t).create(disciplineIds[0]!, { teamId: null, roster: [], formAnswers: {}, documentFileIds: {}, entryCode: null, acceptRulesHash: hash }, payer, rid());
    const pay = new PaymentsService(t);
    const { payment } = await pay.pay(reg.orderId!, payer, 'http://localhost/return', rid());
    await pay.handleCallback((await (t.adapters.payment as unknown as DevGatewayAdapter).settle(payment.gatewayRef!, 'success'))!, rid());
    await t.consumer.drain();
    const mongoUrl = process.env['MONGO_URL'] ?? 'mongodb://127.0.0.1:27018/esports?directConnection=true';
    const report = await runBackupDrill(t, { targetDir: target, key: KEY, mongoUrl, env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', LOG_LEVEL: 'silent' } });
    expect(report.checks.finance.verifiedPayments).toBeGreaterThanOrEqual(1);
    expect(report.checks.finance.missingPostings).toEqual([]);
    expect(report.checks.finance.unbalancedTransactions).toBe(0);
    expect(report.countsMatch).toBe(true);
    expect(report.checks.ok).toBe(true);
  });
});
