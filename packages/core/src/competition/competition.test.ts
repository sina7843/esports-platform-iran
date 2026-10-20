import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testContainer, rid } from '../test/harness.js';
import { clause } from '../test/esp03-fixture.js';
import { competition, drawAndGenerate, playStage, TABLE_RULES, toLive, win } from '../test/esp04-fixture.js';
import { seedIds } from '../db/seed-ids.js';
import { DrawService } from './draws.js';
import { StructureService } from './structure.js';
import { MatchResultService } from './results.js';
import type { MatchDoc } from '../db/collections.js';

let t: Awaited<ReturnType<typeof testContainer>>;
let structure: StructureService;
let draws: DrawService;
let results: MatchResultService;
beforeAll(async () => {
  t = await testContainer({ seed: true });
  structure = new StructureService(t);
  draws = new DrawService(t);
  results = new MatchResultService(t);
});
afterAll(async () => {
  await t.drop();
});

const manual = (ids: string[]) => ({ method: 'manual' as const, attributes: Object.fromEntries(ids.map((id, i) => [id, { seed: i + 1 }])) });
/** the better seed (lower index in the seed list) wins */
const favourite = (seeds: string[]) => (m: MatchDoc) => win(seeds.indexOf(m.participantIds![0]!) < seeds.indexOf(m.participantIds![1]!) ? 0 : 1);

describe('draw lifecycle (DRAW-001..003)', () => {
  it('preview → confirm → lock → publish only in order; the published draw is reproducible; redraw needs a reason and stops once play starts', async () => {
    const fx = await competition(t, { clauses: [clause('elim.third_place', false)], stages: [{ name: 'S', format: 'single_elim' }], n: 6 });
    const [stageId] = fx.stageIds as [string];
    const d = await draws.preview(stageId, { method: 'random' }, seedIds.organizer, rid());
    await expect(draws.publish(d._id, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
    await expect(draws.preview(stageId, { method: 'random' }, seedIds.organizerB, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const d2 = await draws.preview(stageId, { method: 'random' }, seedIds.organizer, rid());
    expect((await t.c.draws.findOne({ _id: d._id }))!.state).toBe('superseded');
    await draws.confirm(d2._id, seedIds.organizer, rid());
    await draws.lock(d2._id, seedIds.organizer, rid());
    await draws.publish(d2._id, seedIds.organizer, rid());
    expect(await draws.verify(d2._id)).toEqual({ reproducible: true });
    expect((await draws.list(stageId, null, rid())).map((x) => x._id)).toEqual([d2._id]); // public sees only the published draw
    await structure.generate(stageId, seedIds.organizer, rid());
    await expect(draws.redraw(stageId, 'no', { method: 'random' }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const re = await draws.redraw(stageId, 'entrant data was wrong', { method: 'random' }, seedIds.organizer, rid());
    expect(re.discardedMatches).toBeGreaterThan(0);
    expect(re.draw.reason).toBe('entrant data was wrong');
    await draws.confirm(re.draw._id, seedIds.organizer, rid());
    await draws.lock(re.draw._id, seedIds.organizer, rid());
    await draws.publish(re.draw._id, seedIds.organizer, rid());
    await structure.generate(stageId, seedIds.organizer, rid());
    const m = (await t.c.matches.findOne({ stageId, state: 'scheduled' }))!;
    await toLive(t, m);
    await expect(draws.redraw(stageId, 'too late now', { method: 'random' }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('missing format rules refuse generation instead of guessing (FMT-003)', async () => {
    const fx = await competition(t, { clauses: [], stages: [{ name: 'RR', format: 'round_robin' }], n: 4 });
    await expect(drawAndGenerate(t, fx.stageIds[0]!)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});

describe('single and double elimination (AC-05)', () => {
  it('seeds with byes advance with provenance, nobody plays twice at once, champion and final standings are versioned', async () => {
    const fx = await competition(t, { clauses: [clause('elim.third_place', true)], stages: [{ name: 'SE', format: 'single_elim' }], n: 6 });
    const stageId = fx.stageIds[0]!;
    const { structure: st } = await drawAndGenerate(t, stageId, manual(fx.participants));
    expect(st.seeds).toEqual(fx.participants);
    // P=8, 7 slots, the two top seeds have first-round byes → 5 matches exist
    expect(await t.c.matches.countDocuments({ stageId })).toBe(6); // 5 + third-place match
    // a provisional result is not consumed
    const first = (await t.c.matches.findOne({ stageId, state: 'scheduled' }))!;
    const live = await toLive(t, first);
    await results.submit(live._id, win(0), [], live.sides[0]!.roster[0]!.principalId, rid());
    await t.consumer.drain();
    const next = await t.c.matches.findOne({ stageId, 'slot.sources.slot': first.slot!.key, 'slot.bracket': 'W' });
    expect(next!.state).toBe('awaiting_sides');
    await results.finalize(live._id, null, seedIds.referee, rid());
    await t.consumer.drain();
    await playStage(t, stageId, favourite(fx.participants));
    const final = (await t.c.stageStructures.findOne({ _id: stageId }))!;
    expect(final.state).toBe('complete');
    expect(final.standings!.rows[0]!.id).toBe(fx.participants[0]);
    expect(final.standings!.rows.map((r) => r.id).sort()).toEqual([...fx.participants].sort());
    const rv = await t.c.resultVersions.findOne({ targetType: 'standing', targetId: stageId, 'data.final': true });
    expect(rv).toBeTruthy();
    // every advanced side has an origin pointing at the slot it came from
    const sf = await t.c.matches.find({ stageId, 'slot.round': 2 }).toArray();
    for (const m of sf) for (const s of m.sides) expect(['advance', 'seed']).toContain(s.origin.kind);
    expect(sf.flatMap((m) => m.sides).some((s) => s.origin.kind === 'advance' && s.origin.ref.startsWith('winner:W1-'))).toBe(true);
    expect((await t.c.stages.findOne({ _id: stageId }))!.state).toBe('finished');
  });

  it('double elimination with reset: the reset slot is cancelled when the winners-bracket champion wins the grand final', async () => {
    const fx = await competition(t, { clauses: [clause('elim.grand_final', 'reset')], stages: [{ name: 'DE', format: 'double_elim' }], n: 5 });
    const stageId = fx.stageIds[0]!;
    await drawAndGenerate(t, stageId, manual(fx.participants));
    await playStage(t, stageId, favourite(fx.participants));
    const gf2 = await t.c.matches.findOne({ stageId, 'slot.key': 'GF2' });
    expect(gf2!.state).toBe('cancelled');
    expect(gf2!.cancelReason).toMatch(/reset not needed/);
    const st = (await t.c.stageStructures.findOne({ _id: stageId }))!;
    expect(st.state).toBe('complete');
    expect(st.standings!.rows[0]!.id).toBe(fx.participants[0]);
    expect(st.standings!.rows).toHaveLength(5);
  });
});

describe('table, Swiss, lobby, record, ladder (AC-06)', () => {
  it('Swiss over three rounds: next round only after the current one is final, byes recorded once', async () => {
    const fx = await competition(t, { clauses: [...TABLE_RULES(), clause('swiss.rounds', 3), clause('swiss.pairing', 'dutch'), clause('swiss.bye_points', 3)], stages: [{ name: 'SW', format: 'swiss' }], n: 7 });
    const stageId = fx.stageIds[0]!;
    await drawAndGenerate(t, stageId, manual(fx.participants));
    await expect(structure.nextRound(stageId, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    for (let r = 1; r <= 3; r++) {
      await playStage(t, stageId, favourite(fx.participants));
      if (r < 3) await structure.nextRound(stageId, seedIds.organizer, rid());
    }
    const st = (await t.c.stageStructures.findOne({ _id: stageId }))!;
    expect(Object.keys(st.progress.byes)).toHaveLength(3);
    expect(new Set(Object.values(st.progress.byes)).size).toBe(3);
    expect(st.state).toBe('complete');
    expect(st.standings!.rows[0]!.id).toBe(fx.participants[0]);
    await expect(structure.nextRound(stageId, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('multi-lobby rounds and record attempts rank by the rules (AC-06)', async () => {
    const lobbyRules = [clause('lobby.size', 4), clause('lobby.rounds', 2), clause('lobby.placement_points', [10, 6, 3, 1]), clause('lobby.kill_points', 1), clause('lobby.tiebreak', ['wins', 'best_placement', 'kills']), clause('lobby.assignment', 'reseed_by_standings')];
    const fx = await competition(t, { clauses: lobbyRules, stages: [{ name: 'LB', format: 'multi_lobby' }], n: 8 });
    const stageId = fx.stageIds[0]!;
    await drawAndGenerate(t, stageId, manual(fx.participants));
    const place = (m: MatchDoc) => ({ kind: 'placements' as const, placements: [...m.participantIds!].sort((a, b) => fx.participants.indexOf(a) - fx.participants.indexOf(b)).map((id, i) => ({ id, placement: i + 1, kills: 0 })) });
    await playStage(t, stageId, place);
    await structure.nextRound(stageId, seedIds.organizer, rid());
    await playStage(t, stageId, place);
    const st = (await t.c.stageStructures.findOne({ _id: stageId }))!;
    expect(st.state).toBe('complete');
    expect(st.standings!.rows.map((r) => r.id).slice(0, 2).sort()).toEqual(fx.participants.slice(0, 2).sort());
    // invalid placements are refused before they can become a result
    const fx2 = await competition(t, { clauses: lobbyRules, stages: [{ name: 'LB', format: 'multi_lobby' }], n: 4 });
    await drawAndGenerate(t, fx2.stageIds[0]!, manual(fx2.participants));
    const lm = await toLive(t, (await t.c.matches.findOne({ stageId: fx2.stageIds[0]! }))!);
    await expect(results.submit(lm._id, { kind: 'placements', placements: lm.participantIds!.map((id) => ({ id, placement: 1, kills: 0 })) }, [], seedIds.referee, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('record attempts at declared precision; time trial DNF last', async () => {
    const fx = await competition(t, { clauses: [clause('record.better', 'higher'), clause('record.precision', 2), clause('record.max_attempts', 2), clause('record.tiebreak', 'second_best')], stages: [{ name: 'REC', format: 'record' }], n: 3 });
    const stageId = fx.stageIds[0]!;
    await drawAndGenerate(t, stageId, manual(fx.participants));
    const vals: Record<string, string[]> = { [fx.participants[0]!]: ['10.50', '10.00'], [fx.participants[1]!]: ['10.5', '10.20'], [fx.participants[2]!]: ['9.99', '1'] };
    await playStage(t, stageId, (m) => ({ kind: 'attempts', attempts: vals[m.participantIds![0]!]!.map((v, i) => ({ attempt: i + 1, value: v, timeMs: null, penaltyMs: 0, dnf: false, at: new Date(Date.now() + i * 1000).toISOString() })) }));
    const rows = (await t.c.stageStructures.findOne({ _id: stageId }))!.standings!.rows;
    expect(rows.map((r) => r.id)).toEqual([fx.participants[1], fx.participants[0], fx.participants[2]]); // equal best 10.50, second best decides
    const fx2 = await competition(t, { clauses: [clause('record.better', 'higher'), clause('record.precision', 2), clause('record.max_attempts', 1), clause('record.tiebreak', 'shared')], stages: [{ name: 'R', format: 'record' }], n: 2 });
    await drawAndGenerate(t, fx2.stageIds[0]!);
    const m = await toLive(t, (await t.c.matches.findOne({ stageId: fx2.stageIds[0]!, state: 'scheduled' }))!);
    await expect(results.submit(m._id, { kind: 'attempts', attempts: [{ attempt: 1, value: '1.234', timeMs: null, penaltyMs: 0, dnf: false, at: new Date().toISOString() }] }, [], seedIds.referee, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('ladder challenge moves positions only on a final result', async () => {
    const fx = await competition(t, { clauses: [clause('ladder.challenge_range', 2), clause('ladder.on_win', 'insert')], stages: [{ name: 'LD', format: 'ladder' }], n: 4 });
    const stageId = fx.stageIds[0]!;
    await drawAndGenerate(t, stageId, manual(fx.participants));
    const [p1, p2, p3, p4] = fx.participants as [string, string, string, string];
    await expect(structure.challenge(stageId, p4, p1, fx.principals[3]!, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(structure.challenge(stageId, p3, p1, fx.principals[0]!, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await structure.challenge(stageId, p3, p1, fx.principals[2]!, rid());
    await expect(structure.challenge(stageId, p4, p3, fx.principals[3]!, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' }); // p3 has an open challenge
    await playStage(t, stageId, () => win(0));
    expect((await t.c.stageStructures.findOne({ _id: stageId }))!.progress.ladder).toEqual([p3, p1, p2, p4]);
  });
});

describe('mixed structure and multi-stage path (FMT-001, STG-002, AC-05, 7.x acceptance 6)', () => {
  it('online groups → playoff phase, then transfer to an offline final stage without duplicates', async () => {
    const clauses = [...TABLE_RULES(), clause('groups.count', 2), clause('groups.advance_per_group', 2), clause('elim.third_place', false)];
    const fx = await competition(t, {
      clauses,
      stages: [
        { name: 'مقدماتی آنلاین', format: 'mixed', presence: 'online', phases: [{ key: 'groups', format: 'groups', advance: { perGroup: 2 } }, { key: 'playoff', format: 'single_elim', advance: null }] },
        { name: 'فینال حضوری', format: 'single_elim', presence: 'offline', links: [{ fromStageId: 'PREV', kind: 'qualifier', slots: 2, points: 'reset', factor: null }] },
      ],
      n: 8,
    });
    const [online, lan] = fx.stageIds as [string, string];
    await drawAndGenerate(t, online, manual(fx.participants));
    const st0 = (await t.c.stageStructures.findOne({ _id: online }))!;
    expect(Object.values(st0.groups!).every((g) => g.length === 4)).toBe(true);
    await expect(structure.nextPhase(online, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await playStage(t, online, favourite(fx.participants));
    const ph = await structure.nextPhase(online, seedIds.organizer, rid());
    expect(ph.entrants).toHaveLength(4);
    expect(new Set(ph.entrants).size).toBe(4);
    await playStage(t, online, favourite(fx.participants));
    const done = (await t.c.stageStructures.findOne({ _id: online }))!;
    expect(done.state).toBe('complete');
    // transfer top 2 into the LAN final, twice → idempotent, origin recorded
    expect(await structure.transfer(online, lan, seedIds.organizer, rid())).toEqual({ created: 2, existing: 0 });
    expect(await structure.transfer(online, lan, seedIds.organizer, rid())).toEqual({ created: 0, existing: 2 });
    const entries = await t.c.stageEntries.find({ stageId: lan }).toArray();
    expect(entries.every((e) => e.origin.kind === 'stage_rank' && e.origin.ref === online)).toBe(true);
    const { structure: finalSt } = await drawAndGenerate(t, lan, { method: 'qualifier', attributes: Object.fromEntries(entries.map((e) => [e.participationId, { qualifierRank: e.origin.rank }])) });
    expect(finalSt.seeds.sort()).toEqual(entries.map((e) => e.participationId).sort());
    await playStage(t, lan, favourite(fx.participants));
    expect((await t.c.stageStructures.findOne({ _id: lan }))!.state).toBe('complete');
  });

  it('withdrawal: remaining matches become forfeits; previous results follow the rules', async () => {
    const fx = await competition(t, { clauses: [...TABLE_RULES(), clause('points.forfeit_win', 3), clause('points.forfeit_loss', 0), clause('forfeit.score', [2, 0]), clause('withdrawal.previous_results', 'keep')], stages: [{ name: 'RR', format: 'round_robin' }], n: 4 });
    const stageId = fx.stageIds[0]!;
    await drawAndGenerate(t, stageId, manual(fx.participants));
    await expect(structure.withdraw(stageId, fx.participants[3]!, 'injury', fx.principals[0]!, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await structure.withdraw(stageId, fx.participants[3]!, 'medical withdrawal', seedIds.organizer, rid());
    await t.consumer.drain();
    const forfeits = await t.c.matches.find({ stageId, participantIds: fx.participants[3]!, state: 'final' }).toArray();
    expect(forfeits).toHaveLength(3);
    expect(forfeits.every((m) => m.outcome?.kind === 'win' && m.outcome.forfeit)).toBe(true);
    await playStage(t, stageId, favourite(fx.participants));
    const st = (await t.c.stageStructures.findOne({ _id: stageId }))!;
    expect(st.standings!.rows[st.standings!.rows.length - 1]!.id).toBe(fx.participants[3]);
    expect(st.state).toBe('complete');
  });
});
