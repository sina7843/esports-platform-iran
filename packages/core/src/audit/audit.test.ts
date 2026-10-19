import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultEventConfig } from '../events/defaults.js';
import { testContainer, rid } from '../test/harness.js';
import { loadConfig } from '../config.js';
import { assertTransitionAllowed } from '../domain/transition.js';
import { matchMachine, eventMachine } from '@esp/contracts';

let t: Awaited<ReturnType<typeof testContainer>>;
beforeAll(async () => {
  t = await testContainer();
});
afterAll(async () => {
  await t.drop();
});

describe('append-only hash-chained audit (SEC-007)', () => {
  it('verifies an intact chain and detects ordinary edits', async () => {
    for (let i = 0; i < 3; i++) await t.audit.append({ actorPrincipalId: 'usr_a', action: `test.${i}`, target: { type: 'x', id: String(i) }, scope: { type: 'site', id: 'site' }, outcome: 'success', requestId: rid() });
    expect(await t.audit.verifyChain()).toMatchObject({ ok: true, checked: 3 });
    await t.c.audit.updateOne({ seq: 2 }, { $set: { action: 'tampered' } }); // what an admin with raw DB access would do
    expect(await t.audit.verifyChain()).toMatchObject({ ok: false, brokenAtSeq: 2 });
  });
  it('audit writes inside a transaction roll back with it', async () => {
    const before = await t.c.audit.countDocuments({});
    await expect(
      t.dbh.withTransaction(async (session) => {
        await t.audit.append({ actorPrincipalId: 'usr_a', action: 'tx', target: { type: 'x', id: 'tx' }, scope: { type: 'site', id: 'site' }, outcome: 'success', requestId: rid() }, session);
        throw new Error('abort');
      }),
    ).rejects.toThrow();
    expect(await t.c.audit.countDocuments({})).toBe(before);
  });
});

describe('configuration guards (SEC-005, OPS-005, D-004)', () => {
  it('production refuses development doubles, dev login and missing secrets', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', MONGO_URL: 'mongodb://mongo:27017/esports?replicaSet=rs0' })).toThrow(/APP_SECRET is required/);
    expect(() => loadConfig({ NODE_ENV: 'production', APP_SECRET: 'x'.repeat(40), TRUST_PROXY: 'true', PAYMENT_ADAPTER: 'none', SMS_ADAPTER: 'none', EMAIL_ADAPTER: 'none', VIDEO_ADAPTER: 'none', MAP_ADAPTER: 'none', SCANNER_ADAPTER: 'none', AUTH_DEV_LOGIN_ENABLED: 'true' })).toThrow(/AUTH_DEV_LOGIN_ENABLED/);
    const ok = loadConfig({ NODE_ENV: 'production', APP_SECRET: 'x'.repeat(40), TRUST_PROXY: 'true', PAYMENT_ADAPTER: 'none', SMS_ADAPTER: 'none', EMAIL_ADAPTER: 'none', VIDEO_ADAPTER: 'none', MAP_ADAPTER: 'none', SCANNER_ADAPTER: 'none' });
    expect(ok.isProduction).toBe(true);
    expect(ok.devLoginEnabled).toBe(false);
  });
  it('development enables dev login only with an explicit code', () => {
    expect(loadConfig({ NODE_ENV: 'development', AUTH_DEV_LOGIN_ENABLED: 'true' }).devLoginEnabled).toBe(false);
    expect(loadConfig({ NODE_ENV: 'development', AUTH_DEV_LOGIN_ENABLED: 'true', AUTH_DEV_CODE: 'abcdefgh' }).devLoginEnabled).toBe(true);
  });
});

describe('transition guard (chapter 15)', () => {
  it('rejects unknown transitions, wrong source states, unauthorized roles and missing second approval', () => {
    expect(() => assertTransitionAllowed(matchMachine, { transition: 'teleport', expectedVersion: 0, actorRoles: ['referee'] }, 'live')).toThrow(/unknown transition/);
    expect(() => assertTransitionAllowed(matchMachine, { transition: 'finalize', expectedVersion: 0, actorRoles: ['referee'] }, 'scheduled')).toThrow(/cannot finalize from scheduled/);
    expect(() => assertTransitionAllowed(matchMachine, { transition: 'finalize', expectedVersion: 0, actorRoles: ['reporter'] }, 'provisional')).toThrow(/role not allowed/);
    expect(() => assertTransitionAllowed(matchMachine, { transition: 'reopen', expectedVersion: 0, actorRoles: ['head_referee'] }, 'final')).toThrow(/independent approval/);
    expect(assertTransitionAllowed(matchMachine, { transition: 'reopen', expectedVersion: 0, actorRoles: ['head_referee'], approvalId: 'apr_1' }, 'final').to).toBe('disputed');
    expect(assertTransitionAllowed(eventMachine, { transition: 'publish', expectedVersion: 0, actorRoles: ['organizer'] }, 'draft').to).toBe('published');
  });
  it('applies optimistic concurrency on the stored document', async () => {
    const { applyTransition } = await import('../domain/transition.js');
    const now = new Date().toISOString();
    await t.c.events.insertOne({ _id: 'evt_t1', slug: 'evt-t1', name: 'x', organizerOrgId: 'org', visibility: 'public', state: 'draft', timeZone: 'Asia/Tehran', startsAt: null, endsAt: null, rulesSnapshot: null, config: defaultEventConfig(), createdBy: 'u', createdAt: now, updatedAt: now, version: 0 });
    const r = await applyTransition(eventMachine, t.c.events, 'evt_t1', { transition: 'publish', expectedVersion: 0, actorRoles: ['organizer'] });
    expect(r.doc.state).toBe('published');
    expect(r.doc.version).toBe(1);
    await expect(applyTransition(eventMachine, t.c.events, 'evt_t1', { transition: 'open_registration', expectedVersion: 0, actorRoles: ['organizer'] })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(applyTransition(eventMachine, t.c.events, 'evt_t1', { transition: 'publish', expectedVersion: 1, actorRoles: ['organizer'] })).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
  });
});
