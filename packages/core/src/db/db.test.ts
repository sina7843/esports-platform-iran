import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testContainer } from '../test/harness.js';
import { orgDoc, teamDoc } from '../test/harness.js';
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
      await t.c.organizations.insertOne(orgDoc('org_tx_1', 'tx-1', 'tx'), { session });
      await t.c.teams.insertOne(teamDoc('team_tx_1', 'org_tx_1', 'TX', 'tx'), { session });
    });
    expect(await t.c.organizations.countDocuments({ _id: 'org_tx_1' })).toBe(1);
    expect(await t.c.teams.countDocuments({ _id: 'team_tx_1' })).toBe(1);
  });

  it('rolls back every write when the transaction throws', async () => {
    await expect(
      t.dbh.withTransaction(async (session) => {
        await t.c.organizations.insertOne(orgDoc('org_tx_2', 'tx-2', 'tx'), { session });
        await t.c.teams.insertOne(teamDoc('team_tx_2', 'org_tx_2', 'TX', 'tx'), { session });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await t.c.organizations.countDocuments({ _id: 'org_tx_2' })).toBe(0);
    expect(await t.c.teams.countDocuments({ _id: 'team_tx_2' })).toBe(0);
  });

  it('enforces unique indexes created by migrations', async () => {
    await t.c.organizations.insertOne(orgDoc('org_u_1', 'unique-slug', 'u'));
    await expect(t.c.organizations.insertOne(orgDoc('org_u_2', 'unique-slug', 'u'))).rejects.toMatchObject({ code: 11000 });
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

describe('0005 backfill of pre-ESP-02 documents', () => {
  it('adds owner, game, lists and historical display names to legacy documents', async () => {
    const { migrations } = await import('./migrations.js');
    const now = new Date().toISOString();
    const raw = t.dbh.db;
    await raw.collection('principals').insertOne({ _id: 'usr_legacy' as never, kind: 'user', displayName: 'Legacy User', locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, createdAt: now, updatedAt: now, version: 0 });
    await raw.collection('teams').insertOne({ _id: 'team_legacy' as never, organizationId: null, name: 'Old', tag: 'OLD', nameHistory: [], createdAt: now, version: 0 });
    await raw.collection('team_memberships').insertOne({ _id: 'mem_legacy' as never, teamId: 'team_legacy', principalId: 'usr_legacy', role: 'player', from: now, to: null });
    await migrations.find((m) => m.id === '0005_backfill_esp01_documents')!.up(raw);
    const team = await t.c.teams.findOne({ _id: 'team_legacy' });
    expect(team).toMatchObject({ ownerPrincipalId: 'system:unassigned', gameId: 'unassigned', links: [], sponsors: [], description: null });
    expect((await t.c.teamMemberships.findOne({ _id: 'mem_legacy' }))?.displayNameAtJoin).toBe('Legacy User');
    expect((await t.c.principals.findOne({ _id: 'usr_legacy' }))?.deletedAt).toBeNull();
  });
});
