import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testContainer } from '../test/harness.js';
import { runMigrations, migrationStatus } from './migrations.js';
import { seedDatabase, seedIds } from './seed.js';

let t: Awaited<ReturnType<typeof testContainer>>;
beforeAll(async () => {
  t = await testContainer();
});
afterAll(async () => {
  await t.drop();
});

describe('replica set and transactions', () => {
  it('is connected to a writable replica-set primary', async () => {
    const p = await t.dbh.ping();
    expect(p.ok).toBe(true);
    expect(p.replicaSet).toBe(true);
  });

  it('commits multi-document writes atomically', async () => {
    await t.dbh.withTransaction(async (session) => {
      await t.c.organizations.insertOne({ _id: 'org_tx_1', name: 'tx', slug: 'tx-1', createdAt: new Date().toISOString(), version: 0 }, { session });
      await t.c.teams.insertOne({ _id: 'team_tx_1', organizationId: 'org_tx_1', name: 'tx', tag: 'TX', nameHistory: [], createdAt: new Date().toISOString(), version: 0 }, { session });
    });
    expect(await t.c.organizations.countDocuments({ _id: 'org_tx_1' })).toBe(1);
    expect(await t.c.teams.countDocuments({ _id: 'team_tx_1' })).toBe(1);
  });

  it('rolls back every write when the transaction throws', async () => {
    await expect(
      t.dbh.withTransaction(async (session) => {
        await t.c.organizations.insertOne({ _id: 'org_tx_2', name: 'tx', slug: 'tx-2', createdAt: new Date().toISOString(), version: 0 }, { session });
        await t.c.teams.insertOne({ _id: 'team_tx_2', organizationId: 'org_tx_2', name: 'tx', tag: 'TX', nameHistory: [], createdAt: new Date().toISOString(), version: 0 }, { session });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await t.c.organizations.countDocuments({ _id: 'org_tx_2' })).toBe(0);
    expect(await t.c.teams.countDocuments({ _id: 'team_tx_2' })).toBe(0);
  });

  it('enforces unique indexes created by migrations', async () => {
    await t.c.organizations.insertOne({ _id: 'org_u_1', name: 'u', slug: 'unique-slug', createdAt: new Date().toISOString(), version: 0 });
    await expect(t.c.organizations.insertOne({ _id: 'org_u_2', name: 'u', slug: 'unique-slug', createdAt: new Date().toISOString(), version: 0 })).rejects.toMatchObject({ code: 11000 });
  });
});

describe('migrations and seed', () => {
  it('are idempotent on re-run', async () => {
    const second = await runMigrations(t.dbh.db);
    expect(second.applied).toEqual([]);
    expect(second.skipped.length).toBeGreaterThan(0);
    expect((await migrationStatus(t.dbh.db)).pending).toEqual([]);
    await seedDatabase(t.c, t.acl);
    await seedDatabase(t.c, t.acl);
    expect(await t.c.principals.countDocuments({ _id: seedIds.admin })).toBe(1);
    expect(await t.c.grants.countDocuments({ principalId: seedIds.admin, revokedAt: null })).toBe(1);
    const m = await t.c.matches.findOne({ _id: seedIds.matchA });
    expect(m?.sides.length).toBe(2);
  });
});
