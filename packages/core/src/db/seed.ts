import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import type { Collections, EventDoc, PrincipalDoc, RulesSnapshot } from './collections.js';
import type { Acl } from '../acl/acl.js';
import { newId } from '../ids.js';

/**
 * Synthetic seed (OPS-005): clearly labeled TEST ONLY data for local development and automated tests.
 * Fixed ids make seeded data addressable from tests and the dev login double. Never run in production.
 */
export const SEED_LABEL = 'TEST ONLY — synthetic seed, not an approved game, rule package or real organization';

export const seedIds = {
  admin: 'usr_seed_admin',
  organizer: 'usr_seed_organizer',
  organizerB: 'usr_seed_organizer_b',
  referee: 'usr_seed_referee',
  refereeB: 'usr_seed_referee_b',
  captain: 'usr_seed_captain',
  player: 'usr_seed_player',
  reporter: 'usr_seed_reporter',
  finance: 'usr_seed_finance',
  finance2: 'usr_seed_finance_2',
  orgA: 'org_seed_a',
  orgB: 'org_seed_b',
  teamA: 'team_seed_a',
  teamB: 'team_seed_b',
  eventA: 'evt_seed_a',
  eventB: 'evt_seed_b',
  disciplineA: 'dsc_seed_a',
  stageA: 'stg_seed_a',
  matchA: 'mch_seed_a',
  matchB: 'mch_seed_b',
  participationA1: 'ptc_seed_a1',
  participationA2: 'ptc_seed_a2',
} as const;

function principal(id: string, displayName: string, locale: 'fa' | 'en' = 'fa'): PrincipalDoc {
  const now = new Date().toISOString();
  return { _id: id, kind: 'user', displayName, locale, timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, createdAt: now, updatedAt: now, version: 0, seedLabel: SEED_LABEL };
}

function rules(label: string): RulesSnapshot {
  const clauses: RulesSnapshot['clauses'] = [
    { key: 'roster.min', kind: 'mandatory', value: 5, citation: 'TEST ONLY synthetic clause 1' },
    { key: 'roster.substitutes', kind: 'configurable', value: 2, citation: 'TEST ONLY synthetic clause 2' },
    { key: 'pause.max_per_map', kind: 'configurable', value: 2, citation: 'TEST ONLY synthetic clause 3' },
    { key: 'dispute.window_minutes', kind: 'configurable', value: 30, citation: 'TEST ONLY synthetic clause 4' },
    { key: 'age.minimum', kind: 'human_review', value: null, citation: 'TEST ONLY: value must come from the approved package' },
  ];
  return { packageId: 'rules_seed_synthetic', version: '0.0.1-test', sourceRef: 'synthetic://test-only', reviewedAt: null, label, clauses, hash: createHash('sha256').update(JSON.stringify(clauses)).digest('hex') };
}

export async function seedDatabase(c: Collections, acl: Acl, logger?: Logger): Promise<void> {
  const now = new Date().toISOString();
  const people: PrincipalDoc[] = [
    principal(seedIds.admin, 'مدیر پلتفرم (seed)'),
    principal(seedIds.organizer, 'برگزارکننده الف (seed)'),
    principal(seedIds.organizerB, 'برگزارکننده ب (seed)'),
    principal(seedIds.referee, 'داور الف (seed)'),
    principal(seedIds.refereeB, 'داور ب (seed)'),
    principal(seedIds.captain, 'کاپیتان تیم الف (seed)'),
    principal(seedIds.player, 'بازیکن (seed)', 'en'),
    principal(seedIds.reporter, 'خبرنگار (seed)'),
    principal(seedIds.finance, 'مسئول مالی ۱ (seed)'),
    principal(seedIds.finance2, 'مسئول مالی ۲ (seed)'),
  ];
  for (const p of people) await c.principals.updateOne({ _id: p._id }, { $setOnInsert: p }, { upsert: true });

  await c.organizations.updateOne({ _id: seedIds.orgA }, { $setOnInsert: { _id: seedIds.orgA, name: 'سازمان الف (TEST ONLY)', slug: 'seed-org-a', createdAt: now, version: 0, seedLabel: SEED_LABEL } }, { upsert: true });
  await c.organizations.updateOne({ _id: seedIds.orgB }, { $setOnInsert: { _id: seedIds.orgB, name: 'سازمان ب (TEST ONLY)', slug: 'seed-org-b', createdAt: now, version: 0, seedLabel: SEED_LABEL } }, { upsert: true });
  await c.teams.updateOne({ _id: seedIds.teamA }, { $setOnInsert: { _id: seedIds.teamA, organizationId: seedIds.orgA, name: 'تیم الف', tag: 'TMA', nameHistory: [{ name: 'تیم الف', tag: 'TMA', from: now, to: null }], createdAt: now, version: 0, seedLabel: SEED_LABEL } }, { upsert: true });
  await c.teams.updateOne({ _id: seedIds.teamB }, { $setOnInsert: { _id: seedIds.teamB, organizationId: null, name: 'Team B', tag: 'TMB', nameHistory: [{ name: 'Team B', tag: 'TMB', from: now, to: null }], createdAt: now, version: 0, seedLabel: SEED_LABEL } }, { upsert: true });
  await c.teamMemberships.updateOne({ teamId: seedIds.teamA, principalId: seedIds.captain }, { $setOnInsert: { _id: newId('mem'), teamId: seedIds.teamA, principalId: seedIds.captain, role: 'captain', from: now, to: null } }, { upsert: true });
  await c.teamMemberships.updateOne({ teamId: seedIds.teamB, principalId: seedIds.player }, { $setOnInsert: { _id: newId('mem'), teamId: seedIds.teamB, principalId: seedIds.player, role: 'player', from: now, to: null } }, { upsert: true });

  const evA: EventDoc = { _id: seedIds.eventA, slug: 'seed-event-a', name: 'رویداد نمونه الف (TEST ONLY)', organizerOrgId: seedIds.orgA, visibility: 'public', state: 'published', timeZone: 'Asia/Tehran', startsAt: null, endsAt: null, rulesSnapshot: rules('TEST ONLY synthetic package A'), createdBy: seedIds.organizer, createdAt: now, updatedAt: now, version: 0, seedLabel: SEED_LABEL };
  const evB: EventDoc = { _id: seedIds.eventB, slug: 'seed-event-b', name: 'رویداد نمونه ب (TEST ONLY)', organizerOrgId: seedIds.orgB, visibility: 'private', state: 'draft', timeZone: 'Asia/Tehran', startsAt: null, endsAt: null, rulesSnapshot: rules('TEST ONLY synthetic package B'), createdBy: seedIds.organizerB, createdAt: now, updatedAt: now, version: 0, seedLabel: SEED_LABEL };
  await c.events.updateOne({ _id: evA._id }, { $setOnInsert: evA }, { upsert: true });
  await c.events.updateOne({ _id: evB._id }, { $setOnInsert: evB }, { upsert: true });
  await c.disciplines.updateOne({ _id: seedIds.disciplineA }, { $setOnInsert: { _id: seedIds.disciplineA, eventId: seedIds.eventA, gameId: 'game_seed_synthetic', gameVersion: 'test', platform: 'pc', mode: '5v5', name: 'رشته نمونه (TEST ONLY)', rulesSnapshot: rules('TEST ONLY discipline package'), createdAt: now, version: 0 } }, { upsert: true });
  await c.stages.updateOne({ _id: seedIds.stageA }, { $setOnInsert: { _id: seedIds.stageA, eventId: seedIds.eventA, disciplineId: seedIds.disciplineA, order: 1, name: 'مرحله ۱', format: 'single_elim', state: 'planned', dependsOnStageIds: [], createdAt: now, version: 0 } }, { upsert: true });
  await c.participations.updateOne({ _id: seedIds.participationA1 }, { $setOnInsert: { _id: seedIds.participationA1, eventId: seedIds.eventA, disciplineId: seedIds.disciplineA, kind: 'team', snapshot: { displayName: 'تیم الف', teamId: seedIds.teamA, roster: [{ principalId: seedIds.captain, displayName: 'کاپیتان تیم الف (seed)', role: 'captain' }] }, acceptedRules: { packageId: 'rules_seed_synthetic', version: '0.0.1-test', hash: evA.rulesSnapshot!.hash, acceptedAt: now, acceptedBy: seedIds.captain }, registrationState: 'confirmed', createdAt: now, updatedAt: now, version: 0 } }, { upsert: true });
  await c.participations.updateOne({ _id: seedIds.participationA2 }, { $setOnInsert: { _id: seedIds.participationA2, eventId: seedIds.eventA, disciplineId: seedIds.disciplineA, kind: 'team', snapshot: { displayName: 'Team B', teamId: seedIds.teamB, roster: [{ principalId: seedIds.player, displayName: 'بازیکن (seed)', role: 'player' }] }, acceptedRules: { packageId: 'rules_seed_synthetic', version: '0.0.1-test', hash: evA.rulesSnapshot!.hash, acceptedAt: now, acceptedBy: seedIds.player }, registrationState: 'confirmed', createdAt: now, updatedAt: now, version: 0 } }, { upsert: true });
  await c.matches.updateOne(
    { _id: seedIds.matchA },
    {
      $setOnInsert: {
        _id: seedIds.matchA,
        eventId: seedIds.eventA,
        disciplineId: seedIds.disciplineA,
        stageId: seedIds.stageA,
        kind: 'head_to_head',
        sides: [
          { participationId: seedIds.participationA1, displayName: 'تیم الف', origin: { kind: 'seed', ref: '1' }, roster: [{ principalId: seedIds.captain, displayName: 'کاپیتان تیم الف (seed)', role: 'captain', present: true }] },
          { participationId: seedIds.participationA2, displayName: 'Team B', origin: { kind: 'seed', ref: '2' }, roster: [{ principalId: seedIds.player, displayName: 'بازیکن (seed)', role: 'player', present: true }] },
        ],
        state: 'scheduled',
        scheduledAt: null,
        estimated: true,
        lobby: { host: 'seed-lobby', password: 'seed-secret-lobby-password', releasedAt: null },
        rulesSnapshot: rules('TEST ONLY match package'),
        resultVersion: 0,
        createdAt: now,
        updatedAt: now,
        version: 0,
      },
    },
    { upsert: true },
  );
  await c.matches.updateOne({ _id: seedIds.matchB }, { $setOnInsert: { _id: seedIds.matchB, eventId: seedIds.eventB, disciplineId: 'dsc_seed_b', stageId: 'stg_seed_b', kind: 'head_to_head', sides: [], state: 'awaiting_sides', scheduledAt: null, estimated: true, lobby: { host: 'seed-lobby-b', password: 'other-event-secret', releasedAt: null }, rulesSnapshot: null, resultVersion: 0, createdAt: now, updatedAt: now, version: 0 } }, { upsert: true });
  await c.gameUnits.updateOne({ matchId: seedIds.matchA, order: 1 }, { $setOnInsert: { _id: newId('gu'), matchId: seedIds.matchA, order: 1, kind: 'map', label: 'Map 1', state: 'pending', values: {}, provenance: null, resultVersion: 0, createdAt: now, version: 0 } }, { upsert: true });

  const actor = { principalId: 'system:seed', requestId: 'seed' };
  const grants: Array<Parameters<Acl['grant']>[0]> = [
    { principalId: seedIds.admin, role: 'platform_admin', scope: { type: 'site', id: 'site' }, expiresAt: null, reason: 'seed' },
    { principalId: seedIds.organizer, role: 'organizer', scope: { type: 'organization', id: seedIds.orgA }, expiresAt: null, reason: 'seed' },
    { principalId: seedIds.organizerB, role: 'organizer', scope: { type: 'organization', id: seedIds.orgB }, expiresAt: null, reason: 'seed' },
    { principalId: seedIds.referee, role: 'referee', scope: { type: 'event', id: seedIds.eventA }, expiresAt: null, reason: 'seed' },
    { principalId: seedIds.refereeB, role: 'referee', scope: { type: 'event', id: seedIds.eventB }, expiresAt: null, reason: 'seed' },
    { principalId: seedIds.captain, role: 'team_captain', scope: { type: 'team', id: seedIds.teamA }, expiresAt: null, reason: 'seed' },
    { principalId: seedIds.captain, role: 'player', scope: { type: 'site', id: 'site' }, expiresAt: null, reason: 'seed' },
    { principalId: seedIds.player, role: 'player', scope: { type: 'site', id: 'site' }, expiresAt: null, reason: 'seed' },
    { principalId: seedIds.reporter, role: 'reporter', scope: { type: 'event', id: seedIds.eventA }, expiresAt: null, reason: 'seed' },
    { principalId: seedIds.finance, role: 'finance_officer', scope: { type: 'site', id: 'site' }, expiresAt: null, reason: 'seed' },
    { principalId: seedIds.finance2, role: 'finance_officer', scope: { type: 'site', id: 'site' }, expiresAt: null, reason: 'seed' },
  ];
  for (const g of grants) {
    const exists = await c.grants.findOne({ principalId: g.principalId, role: g.role, 'scope.type': g.scope.type, 'scope.id': g.scope.id, revokedAt: null });
    if (!exists) await acl.grant(g, actor);
  }
  logger?.info({ principals: people.length, grants: grants.length }, 'seed applied (TEST ONLY)');
}
