import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testContainer, rid } from '../test/harness.js';
import { createContainer, type Container } from '../container.js';
import { runMigrations } from '../db/migrations.js';
import { seedDatabase } from '../db/seed.js';
import { seedIds } from '../db/seed-ids.js';
import { newId } from '../ids.js';
import { adaptersHealth } from '../adapters/registry.js';
import { clause, competition, drawAndGenerate, playStage, win } from '../test/testing.js';
import { NotificationService } from '../notifications/notifications.js';
import { LiveService } from '../live/live.js';
import { guarded, resetBreaker } from '../integrations/providers.js';

/**
 * ESP-07 acceptance re-tests that need a whole-system view: AC-17 (cross-event access) and AC-18 (every external
 * service down). The other acceptance scenarios keep their stage suites (see docs/release/acceptance-report.md).
 */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

describe('AC-17 unauthorised access across events', () => {
  let t: Awaited<ReturnType<typeof testContainer>>;
  beforeAll(async () => {
    t = await testContainer({ seed: true });
  });
  afterAll(async () => {
    await t.drop();
  });

  it('secrets, documents and transactions of another event are unreachable, the attempts are audited, and nothing leaks in errors', async () => {
    const A = seedIds.organizer; // organiser of event A
    const evB = { type: 'event' as const, id: seedIds.eventB };
    // event B (private draft) holds a lobby secret, a private document and a paid order
    const doc = await t.files.upload({ data: PNG, originalName: 'b-contract.png', declaredMime: 'image/png', visibility: 'private', scope: evB, retentionClass: 'dispute_evidence' }, { principalId: seedIds.organizerB, requestId: rid() });
    const before = await t.c.audit.countDocuments({ outcome: 'denied' });

    // 1. permission checks in event B's scope are denied for organiser A (and audited)
    for (const perm of ['event.read_private', 'event.manage', 'finance.read', 'file.read_private'] as const) {
      await expect(t.acl.require(A, perm, evB, rid()), perm).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    // 2. the private document cannot be linked or read
    await expect(t.files.signPrivateLink(doc._id, { principalId: A, requestId: rid() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // 3. the public live projection of the private event does not exist for outsiders, and never carries the lobby secret
    const live = new LiveService(t);
    await expect(live.snapshot(seedIds.eventB, undefined, {}, A, null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(live.snapshot(seedIds.eventB, undefined, {}, null, null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const pub = JSON.stringify(await live.snapshot(seedIds.eventA, undefined, {}, null, null));
    expect(pub).not.toContain('other-event-secret');
    expect(pub).not.toMatch(/password|lobby/i);
    // 4. denial messages do not echo secrets or ids of the protected resource
    const err = await t.acl.require(A, 'finance.read', evB, rid()).catch((e: Error) => e.message);
    expect(String(err)).not.toContain(seedIds.eventB);
    // 5. every attempt left an audit record
    expect((await t.c.audit.countDocuments({ outcome: 'denied' })) - before).toBeGreaterThanOrEqual(4);
    // 6. the owner of event B still can
    await expect(t.files.signPrivateLink(doc._id, { principalId: seedIds.organizerB, requestId: rid() })).resolves.toBeTruthy();
  });
});

describe('AC-18 every external service is down', () => {
  let ct: Container;
  beforeAll(async () => {
    const url = new URL(process.env['MONGO_URL'] ?? 'mongodb://127.0.0.1:27018/esports?directConnection=true');
    url.pathname = `/ac18_${newId().toLowerCase()}`;
    ct = await createContainer({
      serviceName: 'ac18',
      env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', MONGO_URL: url.toString(), DATA_DIR: mkdtempSync(join(tmpdir(), 'esp-ac18-')), LOG_LEVEL: 'silent', PAYMENT_ADAPTER: 'none', SMS_ADAPTER: 'none', EMAIL_ADAPTER: 'none', VIDEO_ADAPTER: 'none', MAP_ADAPTER: 'none', SCANNER_ADAPTER: 'none' },
    });
    await runMigrations(ct.dbh.db);
    await seedDatabase(ct.c, ct.acl);
  });
  afterAll(async () => {
    await ct.dbh.db.dropDatabase();
    await ct.close();
  });

  it('health says exactly which capability is unavailable; nothing is faked as available', async () => {
    const h = await adaptersHealth(ct.adapters);
    for (const kind of ['payment', 'sms', 'email', 'video', 'map', 'scanner']) expect(h.find((x) => x.kind === kind), kind).toMatchObject({ status: 'unconfigured', mode: 'production' });
    await expect(ct.adapters.payment.createPayment({ orderId: 'o', amount: { rial: 1000 } as never, description: '', callbackUrl: 'https://x.ir' })).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });

  it('a whole competition still runs on manual paths: draw, lobby, result, confirmation, advance, final standings', async () => {
    resetBreaker('payment');
    const fx = await competition(ct, { clauses: [clause('elim.third_place', false)], stages: [{ name: 'SE', format: 'single_elim' }], n: 4 });
    await drawAndGenerate(ct, fx.stageIds[0]!);
    const played = await playStage(ct, fx.stageIds[0]!, () => win(0));
    expect(played).toBe(3); // semi-finals + final, all by manual entry
    const finals = await ct.c.matches.find({ stageId: fx.stageIds[0]!, state: 'final' }).toArray();
    expect(finals).toHaveLength(3);
  });

  it('notifications keep working in-app and record the unavailable external channels instead of pretending to send', async () => {
    const u = seedIds.player;
    const notes = new NotificationService(ct);
    await notes.notify({ principalIds: [u], category: 'official', title: 'اعلام رسمی', body: 'متن', essential: true });
    const n = (await ct.c.notifications.findOne({ principalId: u, title: 'اعلام رسمی' }))!;
    expect(n.channels.find((c) => c.channel === 'in_app')).toMatchObject({ status: 'sent' });
    await notes.dispatch(new Date(Date.now() + 1000));
    const after = (await ct.c.notifications.findOne({ _id: n._id }))!;
    const sms = after.channels.find((c) => c.channel === 'sms')!;
    expect(['sent', 'delivered']).not.toContain(sms.status); // never claimed as sent
    expect(sms.lastError ?? sms.reason).toBeTruthy(); // the reason is recorded; delivery is retried when the provider returns
    expect(sms.attempts).toBeGreaterThanOrEqual(1);
  });

  it('a file upload with the scanner down is refused with a clear reason (fail closed), nothing is stored or published', async () => {
    const before = await ct.c.files.countDocuments({});
    await expect(ct.files.upload({ data: PNG, originalName: 'x.png', declaredMime: 'image/png', visibility: 'public', scope: { type: 'site', id: 'site' }, retentionClass: 'media_public' }, { principalId: seedIds.admin, requestId: rid() })).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(await ct.c.files.countDocuments({})).toBe(before);
  });

  it('a repeatedly failing provider trips its circuit instead of piling up work, and recovers', async () => {
    resetBreaker('map');
    for (let i = 0; i < 5; i++) await guarded('map', 'geocode', async () => Promise.reject(new Error('timeout')), { backoffMs: 1, retries: 0 }).catch(() => undefined);
    await expect(guarded('map', 'geocode', async () => 'x')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(await guarded('map', 'geocode', async () => 'back', { now: () => Date.now() + 40_000 })).toBe('back');
    resetBreaker('map');
  });
});
