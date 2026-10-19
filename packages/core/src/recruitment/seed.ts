import { SEED_LABEL, seedIds } from '../db/seed-ids.js';
import type { Collections } from '../db/collections.js';
import type { Acl } from '../acl/acl.js';
import { newId } from '../ids.js';

export const teamsSeedIds = { ad: 'rad_seed_1', scrim: 'scr_seed_1' } as const;

/** TEST ONLY, idempotent: team owners for the two seed teams, one open recruitment ad, one open scrim. */
export async function seedTeamsDomain(c: Collections, acl: Acl): Promise<void> {
  const now = new Date().toISOString();
  const actor = { principalId: 'system:seed', requestId: 'seed' };
  const owners = [
    { principalId: seedIds.organizer, teamId: seedIds.teamA, name: 'مالک تیم الف (seed)' },
    { principalId: seedIds.player, teamId: seedIds.teamB, name: 'بازیکن (seed)' },
  ];
  for (const o of owners) {
    const hasMembership = await c.teamMemberships.findOne({ teamId: o.teamId, principalId: o.principalId, to: null });
    if (!hasMembership) await c.teamMemberships.insertOne({ _id: newId('mem'), teamId: o.teamId, principalId: o.principalId, role: 'owner', from: now, to: null, endedReason: null, endedBy: null, displayNameAtJoin: o.name });
    else if (hasMembership.role !== 'owner') await c.teamMemberships.updateOne({ _id: hasMembership._id }, { $set: { role: 'owner' } });
    const g = { principalId: o.principalId, role: 'team_owner' as const, scope: { type: 'team' as const, id: o.teamId } };
    if (!(await c.grants.findOne({ principalId: g.principalId, role: g.role, 'scope.type': 'team', 'scope.id': o.teamId, revokedAt: null }))) await acl.grant({ ...g, expiresAt: null, reason: 'seed' }, actor);
  }
  await c.recruitmentAds.updateOne(
    { _id: teamsSeedIds.ad },
    { $setOnInsert: { _id: teamsSeedIds.ad, teamId: seedIds.teamA, kind: 'player', gameId: 'game_seed_synthetic', role: 'entry', level: 'advanced', city: 'تهران', activityHours: '20-24', description: `${SEED_LABEL} — آگهی نمونه`, state: 'open', createdBy: seedIds.organizer, createdAt: now, closedAt: null, version: 0 } },
    { upsert: true },
  );
  const start = new Date(Date.now() + 30 * 864e5).toISOString();
  const end = new Date(Date.now() + 31 * 864e5).toISOString();
  await c.scrims.updateOne(
    { _id: teamsSeedIds.scrim },
    { $setOnInsert: { _id: teamsSeedIds.scrim, requesterTeamId: seedIds.teamB, gameId: 'game_seed_synthetic', level: 'advanced', windowStart: start, windowEnd: end, server: 'seed-server', conditions: SEED_LABEL, state: 'open', proposal: null, result: null, createdBy: seedIds.player, createdAt: now, version: 0 } },
    { upsert: true },
  );
}
