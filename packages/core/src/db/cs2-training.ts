import type { Clause } from '@esp/contracts';
import type { Container } from '../container.js';
import type { GrantDoc, RulesSnapshot } from './collections.js';
import { defaultDisciplineConfig, defaultEventConfig } from '../events/defaults.js';
import { createDefaultProfile } from '../profiles/defaults.js';
import { hashClauses } from '../rules/rules.js';
import { StructureService } from '../competition/structure.js';
import { seedIds } from './seed-ids.js';

export const CS2_TRAINING = {
  label: 'TEST ONLY — CS2 training v1; synthetic teams, maps and rules; not publisher-approved',
  eventId: 'evt_training_cs2_v1', gameId: 'game_training_cs2_v1',
  disciplineId: 'dsc_training_cs2_v1', stageId: 'stg_training_cs2_v1',
  rulesId: 'rpk_training_cs2_v1', drawId: 'drw_training_cs2_v1',
} as const;
const teamId = (n: number) => `team_training_cs2_v1_${n}`;
const playerId = (n: number, p: number) => `usr_training_cs2_v1_t${n}_p${p}`;
const participationId = (n: number) => `ptc_training_cs2_v1_${n}`;

/** Explicit training values, never represented as official CS2 rules or the current map pool. */
export function cs2TrainingClauses(): Clause[] {
  const values: Record<string, Clause['value']> = {
    'roster.min': 5, 'roster.substitutes': 2, 'elim.grand_final': 'reset', 'match.bo': 3,
    'maps.pool': Array.from({ length: 7 }, (_, i) => `TRAINING-MAP-${i + 1}`),
    'veto.sequence': ['ban:0', 'ban:1', 'pick:0', 'pick:1', 'ban:1', 'ban:0', 'decider'],
    'veto.turn_seconds': 30, 'veto.timeout_action': 'referee',
    'pause.tactical_per_side': 2, 'pause.tactical_seconds': 30,
    'pause.technical_per_side': 2, 'pause.technical_seconds': 300,
    'disconnect.return_seconds': 120, 'disconnect.on_expiry': 'referee',
    'match.countdown_seconds': 10, 'match.draw_allowed': false,
    'match.rounds_per_map': 24, 'match.overtime': 'TEST ONLY: MR3, starting money 10000',
    'match.replay': 'TEST ONLY: referee decides', 'match.win_condition': 'TEST ONLY: best of 3 maps',
    'side.rule': 'TEST ONLY: opposite team chooses side after map pick',
    'dispute.window_minutes': 30, 'forfeit.score': [2, 0], 'noshow.double': 'referee',
  };
  return Object.entries(values).map(([key, value]) => ({ key, value, kind: 'mandatory', allowed: null, citation: CS2_TRAINING.label, textOriginal: null, textFa: null }));
}

/** No secrets, notifications, real phone numbers, fees, prizes, or changes to existing seed users. */
export async function seedCs2Training(ct: Container) {
  if (ct.config.isProduction) throw new Error('CS2 training refuses production/staging');
  const c = ct.c;
  const baseGame = await c.games.findOne({ _id: 'game_seed_synthetic' });
  const baseTeam = await c.teams.findOne({ _id: seedIds.teamA });
  if (!baseGame || !baseTeam) throw new Error('Run the base TEST ONLY seed first');
  const now = new Date().toISOString();
  const clauses = cs2TrainingClauses();
  const hash = hashClauses(clauses);
  const snapshot: RulesSnapshot = {
    packageId: CS2_TRAINING.rulesId, version: 'training-v1', sourceRef: 'synthetic://cs2-training-v1',
    reviewedAt: null, label: CS2_TRAINING.label,
    clauses: clauses.map(({ key, kind, value, citation }) => ({ key, kind, value, citation })), hash,
  };
  await ct.dbh.withTransaction(async (session) => {
    const existing = await c.events.findOne({ _id: CS2_TRAINING.eventId }, { session });
    if (existing) {
      if (existing.seedLabel !== CS2_TRAINING.label) throw new Error('Training ID collision; existing event left unchanged');
      return;
    }
    const grant = async (id: string, principalId: string, role: GrantDoc['role'], scope: GrantDoc['scope']) => {
      await c.grants.insertOne({ _id: id, principalId, role, scope, grantedBy: 'system:cs2-training', grantedAt: now, expiresAt: null, revokedAt: null, revokedBy: null, reason: CS2_TRAINING.label }, { session });
    };
    await c.games.insertOne({ ...baseGame, _id: CS2_TRAINING.gameId, slug: 'cs2-training-v1', title: 'Counter-Strike 2 — تمرین (TEST ONLY)', publisher: 'TEST ONLY — simulation', state: 'under_review', references: [], capabilities: {}, stateHistory: [{ from: null, to: 'under_review', by: 'system:cs2-training', at: now, reason: CS2_TRAINING.label, evidence: null }], seedLabel: CS2_TRAINING.label, createdAt: now, updatedAt: now, version: 0 }, { session });
    await c.rulesPackages.insertOne({
      _id: CS2_TRAINING.rulesId, gameId: CS2_TRAINING.gameId, scope: { kind: 'event', ref: CS2_TRAINING.eventId },
      title: 'قوانین تمرین نرم‌افزار CS2 (TEST ONLY)', versionLabel: 'training-v1', state: 'draft',
      sourceUrl: null, sourceText: CS2_TRAINING.label, sourcePublishedAt: null, sourceRetrievedAt: null,
      reviewedAt: null, nextReviewDueAt: null, applicability: CS2_TRAINING.label, originalLanguage: 'fa',
      translationFa: { text: null, reviewed: false, reviewer: null, reviewedAt: null }, clauses, clausesHash: hash,
      conflicts: [], humanReviewAcks: [], publisherRights: { reviewed: false, restrictions: null, reviewedBy: null },
      adaptedFrom: null, supersedes: null, supersededBy: null, amendment: null, testOnly: true,
      history: [{ state: 'draft', by: 'system:cs2-training', at: now, note: CS2_TRAINING.label }],
      createdBy: seedIds.organizer, createdAt: now, updatedAt: now, version: 0,
    }, { session });
    await c.events.insertOne({
      _id: CS2_TRAINING.eventId, slug: 'cs2-training-v1', name: 'جام آموزشی CS2 — TEST ONLY', organizerOrgId: seedIds.orgA,
      visibility: 'private', state: 'preparing', timeZone: 'Asia/Tehran', startsAt: null, endsAt: null,
      rulesSnapshot: snapshot, config: { ...defaultEventConfig(), rated: false, description: `${CS2_TRAINING.label}. ۸ تیم، هر تیم ۵ بازیکن اصلی و ۲ ذخیره؛ دوحذفی با فینال مجدد احتمالی. بدون پرداخت و جایزه.`, cancellationTerms: 'TEST ONLY', disputeTerms: 'TEST ONLY' },
      createdBy: seedIds.organizer, createdAt: now, updatedAt: now, version: 0, seedLabel: CS2_TRAINING.label,
    }, { session });
    await c.disciplines.insertOne({
      _id: CS2_TRAINING.disciplineId, eventId: CS2_TRAINING.eventId, gameId: CS2_TRAINING.gameId,
      gameVersion: 'training-v1', platform: 'pc', mode: '5v5', name: 'CS2 5v5 — TEST ONLY', rulesSnapshot: snapshot,
      config: { ...defaultDisciplineConfig(), rulesPackageId: CS2_TRAINING.rulesId, capacity: 8, minParticipants: 8 }, createdAt: now, version: 0,
    }, { session });
    await c.stages.insertOne({ _id: CS2_TRAINING.stageId, eventId: CS2_TRAINING.eventId, disciplineId: CS2_TRAINING.disciplineId, name: 'جدول دوحذفی آموزشی — TEST ONLY', order: 1, format: 'double_elim', state: 'drawn', dependsOnStageIds: [], presence: 'online', links: [], startException: null, createdAt: now, version: 0 }, { session });
    for (let n = 1; n <= 8; n++) {
      const roster = [];
      for (let p = 1; p <= 7; p++) {
        const principalId = playerId(n, p);
        const name = `بازیکن آزمایشی ${n}-${p}`;
        const role = p === 1 ? 'captain' : p > 5 ? 'substitute' : 'player';
        await c.principals.insertOne({ _id: principalId, kind: 'user', displayName: name, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0, seedLabel: CS2_TRAINING.label }, { session });
        const profile = createDefaultProfile(principalId, `training_cs2_t${n}_p${p}`);
        profile.bio = CS2_TRAINING.label;
        profile.notificationPrefs = { ...profile.notificationPrefs, channels: { inApp: true, sms: false, email: false, push: false } };
        profile.games = [{ gameId: CS2_TRAINING.gameId, roles: [], declaredLevel: null, verifiedLevel: null, equipment: null, activityHours: null }];
        await c.profiles.insertOne(profile, { session });
        await c.teamMemberships.insertOne({ _id: `mem_training_cs2_v1_${n}_${p}`, teamId: teamId(n), principalId, role, from: now, to: null, endedReason: null, endedBy: null, displayNameAtJoin: name }, { session });
        await grant(`grt_training_cs2_v1_player_${n}_${p}`, principalId, 'player', { type: 'site', id: 'site' });
        if (p === 1) {
          await grant(`grt_training_cs2_v1_captain_${n}`, principalId, 'team_captain', { type: 'team', id: teamId(n) });
          await grant(`grt_training_cs2_v1_owner_${n}`, principalId, 'team_owner', { type: 'team', id: teamId(n) });
        }
        if (p <= 5) roster.push({ principalId, displayName: name, role });
      }
      const name = `تیم آموزشی ${n} — TEST ONLY`;
      await c.teams.insertOne({ ...baseTeam, _id: teamId(n), gameId: CS2_TRAINING.gameId, name, tag: `CT${n}`, organizationId: null, ownerPrincipalId: playerId(n, 1), description: CS2_TRAINING.label, nameHistory: [{ name, tag: `CT${n}`, from: now, to: null }], ownerHistory: [{ principalId: playerId(n, 1), from: now, to: null }], seedLabel: CS2_TRAINING.label, createdAt: now, updatedAt: now, version: 0 }, { session });
      await c.participations.insertOne({ _id: participationId(n), eventId: CS2_TRAINING.eventId, disciplineId: CS2_TRAINING.disciplineId, kind: 'team', snapshot: { displayName: name, teamId: teamId(n), roster }, acceptedRules: { packageId: snapshot.packageId, version: snapshot.version, hash, acceptedAt: now, acceptedBy: playerId(n, 1) }, registrationState: 'confirmed', createdAt: now, updatedAt: now, version: 0 }, { session });
    }
    const order = Array.from({ length: 8 }, (_, i) => participationId(i + 1));
    await c.draws.insertOne({ _id: CS2_TRAINING.drawId, stageId: CS2_TRAINING.stageId, eventId: CS2_TRAINING.eventId, number: 1, method: 'manual', separateBy: 'none', groupCount: null, seedString: 'cs2-training-v1', engine: 'TEST ONLY manual seed', input: order.map((id, i) => ({ participationId: id, displayName: `تیم آموزشی ${i + 1}`, seed: i + 1, rank: null, qualifierRank: null, pot: null, region: null, club: null, provenance: { source: CS2_TRAINING.label } })), outcome: { order, groups: null, explanations: [CS2_TRAINING.label] }, state: 'published', reason: CS2_TRAINING.label, supersedes: null, history: [{ at: now, by: 'system:cs2-training', action: 'fixture', note: CS2_TRAINING.label }], createdBy: seedIds.organizer, createdAt: now, version: 0 }, { session });
    await grant('grt_training_cs2_v1_referee', seedIds.referee, 'referee', { type: 'event', id: CS2_TRAINING.eventId });
  });
  // Resume safely if a previous run stopped between fixture commit and structure generation.
  const structures = new StructureService(ct);
  if (!(await c.stageStructures.findOne({ _id: CS2_TRAINING.stageId }))) await structures.generate(CS2_TRAINING.stageId, seedIds.organizer, 'cs2-training-v1');
  else await structures.sync(CS2_TRAINING.stageId, 'cs2-training-v1');
  return { eventId: CS2_TRAINING.eventId, stageId: CS2_TRAINING.stageId, teams: 8, players: 56, matches: await c.matches.countDocuments({ eventId: CS2_TRAINING.eventId }) };
}
