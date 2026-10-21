import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Container } from '../container.js';
import { testContainer } from '../test/harness.js';
import { playStage, win } from '../test/esp04-fixture.js';
import { seedCs2Training, CS2_TRAINING } from './cs2-training.js';

it('refuses production before reading or writing the database', async () => {
  await expect(seedCs2Training({ config: { isProduction: true } } as Container)).rejects.toThrow('refuses production/staging');
});

describe('CS2 educational dataset on a replica set', () => {
  let t: Awaited<ReturnType<typeof testContainer>>;
  beforeAll(async () => { t = await testContainer({ seed: true }); });
  afterAll(async () => { await t?.drop(); });

  it('creates 8 complete teams and a usable double-elimination bracket without approving real game rules', async () => {
    const summary = await seedCs2Training(t);
    expect(summary).toMatchObject({ teams: 8, players: 56, matches: 15 });
    expect(await t.c.principals.countDocuments({ seedLabel: CS2_TRAINING.label })).toBe(56);
    const teams = await t.c.teams.find({ gameId: CS2_TRAINING.gameId }).toArray();
    expect(teams).toHaveLength(8);
    for (const team of teams) expect(await t.c.teamMemberships.countDocuments({ teamId: team._id, to: null })).toBe(7);
    const parts = await t.c.participations.find({ eventId: CS2_TRAINING.eventId }).toArray();
    expect(parts).toHaveLength(8);
    expect(parts.every(p => p.snapshot.roster.length === 5 && p.registrationState === 'confirmed')).toBe(true);
    const matches = await t.c.matches.find({ eventId: CS2_TRAINING.eventId }).toArray();
    expect(matches.filter(m => m.state === 'scheduled')).toHaveLength(4);
    expect(matches.every(m => m.config?.bestOf === 3 && m.config.undecided.length === 0)).toBe(true);
    expect((await t.c.events.findOne({ _id: summary.eventId }))?.config).toMatchObject({ rated: false, prizes: [] });
    expect(await t.c.games.findOne({ _id: CS2_TRAINING.gameId })).toMatchObject({ state: 'under_review' });
    expect(await t.c.rulesPackages.findOne({ _id: CS2_TRAINING.rulesId })).toMatchObject({ testOnly: true, state: 'draft', reviewedAt: null });
    expect(await t.c.credentials.countDocuments({ _id: /^usr_training_cs2_v1_/ })).toBe(0);
  });

  it('can be rerun without duplicating teams or overwriting edits', async () => {
    await t.c.teams.updateOne({ _id: 'team_training_cs2_v1_1' }, { $set: { name: 'آموزش ویرایش‌شده' } });
    await seedCs2Training(t);
    expect(await t.c.teams.countDocuments({ gameId: CS2_TRAINING.gameId })).toBe(8);
    expect(await t.c.matches.countDocuments({ eventId: CS2_TRAINING.eventId })).toBe(15);
    expect((await t.c.teams.findOne({ _id: 'team_training_cs2_v1_1' }))?.name).toBe('آموزش ویرایش‌شده');
  });

  it('advances submitted and referee-finalized results through the winners and losers brackets', async () => {
    const played = await playStage(t, CS2_TRAINING.stageId, () => win(0));
    expect(played).toBeGreaterThanOrEqual(14);
    const structure = await t.c.stageStructures.findOne({ _id: CS2_TRAINING.stageId });
    expect(structure?.state).toBe('complete');
    expect(structure?.standings?.rows.filter(r => r.rank === 1)).toHaveLength(1);
  });
});
