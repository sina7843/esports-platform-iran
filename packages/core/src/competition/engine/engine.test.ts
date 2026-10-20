import { describe, expect, it } from 'vitest';
import {
  advanceFromGroups, applyChallenge, bracketDraw, circleRounds, doubleElimination, drawGroups, eliminationStandings, EngineError, generatePhase, generatePlan,
  lobbyRound, lobbyStandings, nextLobbyOrder, parseDecimal, recordStandings, resolveBracket, rngFrom, seedOrderFor, singleElimination, swissPair,
  tableStandings, timeTrialStandings, validateChallenge, validatePlacements, validateRules, type PlayedMatch, type Plan, type SlotResult,
} from './index.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const TABLE = { 'points.win': 3, 'points.draw': 1, 'points.loss': 0, 'tiebreak.order': ['head_to_head', 'score_diff', 'score_for'] };

/** Plays a bracket to the end with seeded random winners; checks per-round invariants on the way. */
function playBracket(plan: Plan, seeds: string[], seed: string) {
  const rng = rngFrom(seed);
  const results: Record<string, SlotResult> = {};
  let states = resolveBracket(plan, seeds, results);
  for (let guard = 0; guard < 10_000; guard++) {
    const ready = Object.values(states).filter((s) => s.status === 'ready');
    if (!ready.length) break;
    // invariant: nobody is in two ready matches at once (no double allocation)
    const busy = ready.flatMap((s) => s.participants);
    expect(new Set(busy).size).toBe(busy.length);
    for (const s of ready) results[s.key] = { kind: 'win', winner: rng() < 0.5 ? 0 : 1, scores: [1, 0] };
    states = resolveBracket(plan, seeds, results);
  }
  return { states, results };
}

describe('single elimination (FMT-001/002, AC-05)', () => {
  it.each([2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 33, 64, 100])('n=%i: byes to top seeds, one champion, everyone ranked once', (n) => {
    const plan = singleElimination(n, { thirdPlace: true });
    const seeds = ids(n);
    const P = plan.meta['size'] as number;
    const s0 = resolveBracket(plan, seeds, {});
    const byes = Object.values(s0).filter((s) => s.key.startsWith('W1-') && s.status === 'auto_advance').map((s) => s.winner);
    expect(byes.sort()).toEqual(seeds.slice(0, P - n).sort());
    const { states, results } = playBracket(plan, seeds, `se-${n}`);
    const rows = eliminationStandings(plan, states);
    expect(rows.map((r) => r.id).sort()).toEqual([...seeds].sort());
    expect(rows.filter((r) => r.rank === 1)).toHaveLength(1);
    // each non-champion lost exactly one real match (P3 participants lose at most two)
    const champ = rows[0]!.id;
    for (const id of seeds) {
      const losses = Object.entries(results).filter(([k, r]) => r.kind === 'win' && states[k]!.loser === id && k !== 'P3').length;
      expect(losses).toBe(id === champ ? 0 : 1);
    }
  });

  it('a draw is refused in elimination and a double forfeit gives the next opponent a bye', () => {
    const plan = singleElimination(4, { thirdPlace: false });
    expect(() => resolveBracket(plan, ids(4), { 'W1-1': { kind: 'draw' } })).toThrow(EngineError);
    const st = resolveBracket(plan, ids(4), { 'W1-1': { kind: 'double_forfeit' }, 'W1-2': { kind: 'win', winner: 0 } });
    expect(st['W2-1']!.status).toBe('auto_advance');
    expect(st['W2-1']!.winner).toBe(st['W1-2']!.winner);
  });
});

describe('double elimination (FMT-001/002)', () => {
  it.each([2, 3, 4, 5, 6, 8, 11, 16, 23, 32, 64])('n=%i reset: champion loses at most once, everyone else exactly twice', (n) => {
    const plan = doubleElimination(n, { grandFinal: 'reset' });
    const seeds = ids(n);
    const { states, results } = playBracket(plan, seeds, `de-${n}`);
    const rows = eliminationStandings(plan, states);
    expect(rows.map((r) => r.id).sort()).toEqual([...seeds].sort());
    const champ = rows.find((r) => r.rank === 1)!.id;
    for (const id of seeds) {
      const losses = Object.entries(results).filter(([k]) => states[k]!.loser === id && states[k]!.status === 'done').length;
      if (id === champ) expect(losses).toBeLessThanOrEqual(1);
      else expect(losses).toBe(2);
    }
    // GF2 is played exactly when the losers-bracket champion won GF
    const gf = states['GF']!;
    expect(states['GF2']!.status === 'not_needed').toBe(gf.winner === gf.participants[0]);
  });

  it('single grand final: no reset slot, GF decides', () => {
    const plan = doubleElimination(8, { grandFinal: 'single' });
    expect(plan.slots.some((s) => s.key === 'GF2')).toBe(false);
    const { states } = playBracket(plan, ids(8), 'de-single');
    expect(eliminationStandings(plan, states)[0]!.id).toBe(states['GF']!.winner);
  });
});

describe('round robin and groups (FMT-001/002)', () => {
  it.each([2, 3, 4, 5, 6, 7, 10, 11, 20])('n=%i: every pair meets once per leg, nobody twice in a round', (n) => {
    for (const legs of [1, 2]) {
      const plan = generatePlan('round_robin', { order: ids(n) }, { ...TABLE, 'rr.legs': legs });
      const meet = new Map<string, number>();
      const perRound = new Map<number, string[]>();
      for (const s of plan.slots) {
        const [a, b] = s.sources.map((x) => (x as { id: string }).id) as [string, string];
        expect(a).not.toBe(b);
        const k = [a, b].sort().join('|');
        meet.set(k, (meet.get(k) ?? 0) + 1);
        perRound.set(s.round, [...(perRound.get(s.round) ?? []), a, b]);
      }
      expect(meet.size).toBe((n * (n - 1)) / 2);
      expect([...meet.values()].every((v) => v === legs)).toBe(true);
      for (const list of perRound.values()) expect(new Set(list).size).toBe(list.length);
      expect(perRound.size).toBe((n % 2 === 0 ? n - 1 : n) * legs);
    }
  });

  it('circle rounds are balanced for odd counts (one rest per round)', () => {
    const r = circleRounds(ids(5));
    expect(r).toHaveLength(5);
    expect(r.every((p) => p.length === 2)).toBe(true);
  });

  it('group draw: pots spread across groups, separation honoured, impossible separation reported', () => {
    const entrants = ids(16).map((id, i) => ({ id, region: i % 4 === 0 ? 'tehran' : `r${i}` }));
    const rng = rngFrom('groups');
    const { groups } = drawGroups(entrants, ids(16), 4, 'region', rng);
    expect(Object.values(groups).flat().sort()).toEqual(ids(16).sort());
    expect(Object.values(groups).every((g) => g.length === 4)).toBe(true);
    for (const g of Object.values(groups)) expect(g.filter((id) => entrants.find((e) => e.id === id)!.region === 'tehran').length).toBeLessThanOrEqual(1);
    // top seeds (pot 1) land in different groups
    for (const g of Object.values(groups)) expect(g.filter((id) => ['p1', 'p2', 'p3', 'p4'].includes(id))).toHaveLength(1);
    const crowded = ids(8).map((id) => ({ id, club: 'same' }));
    expect(() => drawGroups(crowded, ids(8), 2, 'club', rngFrom('x'))).toThrow(/cannot be satisfied/);
  });
});

describe('table standings and tie-breaks (FMT-003/004)', () => {
  const m = (a: string, b: string, w: 0 | 1 | 'd', s: [number, number] = [1, 0]): PlayedMatch => ({ a, b, result: w === 'd' ? { kind: 'draw', scores: s } : { kind: 'win', winner: w, scores: s } });
  it('head-to-head only among the tied, then score difference; full ties are flagged, never invented', () => {
    const matches = [m('p1', 'p2', 0), m('p2', 'p3', 0), m('p3', 'p1', 0), m('p4', 'p1', 1), m('p4', 'p2', 1), m('p4', 'p3', 1)];
    const rows = tableStandings(ids(4), matches, TABLE);
    expect(rows[3]!.id).toBe('p4');
    expect(rows.slice(0, 3).every((r) => r.rank === 1 && r.unresolvedTie)).toBe(true); // 3-way cycle, identical everything
    const decided = tableStandings(ids(4), [...matches.slice(0, 2), m('p3', 'p1', 0, [5, 0]), ...matches.slice(3)], TABLE);
    expect(decided[0]).toMatchObject({ id: 'p3', rank: 1, unresolvedTie: false });
  });
  it('forfeits, double no-shows and withdrawals follow their own rules or go to an official', () => {
    const f: PlayedMatch = { a: 'p1', b: 'p2', result: { kind: 'win', winner: 0, forfeit: true } };
    expect(() => tableStandings(ids(2), [f], TABLE)).toThrow(/forfeit/);
    const rules = { ...TABLE, 'points.forfeit_win': 3, 'points.forfeit_loss': -1, 'forfeit.score': [3, 0] };
    expect(tableStandings(ids(2), [f], rules).find((r) => r.id === 'p2')!.metrics['points']).toBe(-1);
    expect(() => tableStandings(ids(2), [{ a: 'p1', b: 'p2', result: { kind: 'double_forfeit' } }], { ...rules, 'noshow.double': 'referee' })).toThrow(/official/);
    expect(() => tableStandings(ids(3), [m('p1', 'p3', 0)], rules, { withdrawn: ['p3'] })).toThrow(/withdrawal/);
    const voided = tableStandings(ids(3), [m('p1', 'p3', 0), m('p2', 'p3', 0)], { ...rules, 'withdrawal.previous_results': 'void' }, { withdrawn: ['p3'] });
    expect(voided.find((r) => r.id === 'p1')!.metrics['points']).toBe(0);
    expect(voided[voided.length - 1]!.id).toBe('p3');
  });
});

describe('Swiss (FMT-005)', () => {
  it.each([2, 3, 4, 7, 8, 9, 16, 21, 32, 64])('n=%i: no self/duplicate pairing, no rematch while one is avoidable, byes go to the lowest without one', (n) => {
    const rounds = Math.min(5, n - 1);
    const rng = rngFrom(`sw-${n}`);
    const points: Record<string, number> = {};
    const played: Array<[string, string]> = [];
    const byes: string[] = [];
    for (let r = 1; r <= rounds; r++) {
      const res = swissPair({ ids: ids(n), points, played, byes, method: r % 2 ? 'dutch' : 'monrad' });
      const flat = res.pairs.flat();
      expect(new Set(flat).size).toBe(flat.length);
      expect(flat.length + (res.bye ? 1 : 0)).toBe(n);
      const keys = new Set(played.map((p) => [...p].sort().join('|')));
      const rematches = res.pairs.filter((p) => keys.has([...p].sort().join('|')));
      expect(rematches.length > 0).toBe(res.explanations.some((e) => e.includes('rematch')));
      if (res.bye) {
        expect(byes).not.toContain(res.bye);
        byes.push(res.bye);
        points[res.bye] = (points[res.bye] ?? 0) + 3;
      }
      for (const [a, b] of res.pairs) {
        played.push([a, b]);
        const x = rng();
        if (x < 0.1) { points[a] = (points[a] ?? 0) + 1; points[b] = (points[b] ?? 0) + 1; } else points[x < 0.55 ? a : b] = (points[x < 0.55 ? a : b] ?? 0) + 3;
      }
    }
  });
  it('explains an unavoidable rematch instead of hiding it', () => {
    const res = swissPair({ ids: ids(2), points: {}, played: [['p1', 'p2']], byes: [], method: 'dutch' });
    expect(res.pairs).toEqual([['p1', 'p2']]);
    expect(res.explanations[0]).toMatch(/unavoidable/);
  });
  it('dutch pairs the top half against the bottom half of a score group', () => {
    expect(swissPair({ ids: ids(8), points: {}, played: [], byes: [], method: 'dutch' }).pairs).toEqual([['p1', 'p5'], ['p2', 'p6'], ['p3', 'p7'], ['p4', 'p8']]);
    expect(swissPair({ ids: ids(8), points: {}, played: [], byes: [], method: 'monrad' }).pairs).toEqual([['p1', 'p2'], ['p3', 'p4'], ['p5', 'p6'], ['p7', 'p8']]);
  });
});

describe('multi-lobby and record (AC-06)', () => {
  const LOBBY = { 'lobby.size': 4, 'lobby.rounds': 2, 'lobby.placement_points': [10, 6, 3, 1], 'lobby.kill_points': 1, 'lobby.tiebreak': ['wins', 'best_placement', 'kills'], 'lobby.assignment': 'reseed_by_standings' };
  it('lobbies cover everyone once per round; placement validation; points and tie-breaks from the rules', () => {
    const r1 = lobbyRound(ids(10), 1, 4);
    expect(r1).toHaveLength(3);
    const all = r1.flatMap((s) => s.sources.map((x) => (x as { id: string }).id));
    expect(new Set(all).size).toBe(10);
    expect(validatePlacements(['a', 'b', 'c'], [{ id: 'a', placement: 1, kills: 0 }, { id: 'b', placement: 1, kills: 0 }, { id: 'x', placement: 3, kills: 0 }])).toHaveLength(3);
    const results = [
      { round: 1, lobby: 'A', members: ['p1', 'p2', 'p3', 'p4'], placements: [{ id: 'p1', placement: 1, kills: 0 }, { id: 'p2', placement: 2, kills: 4 }, { id: 'p3', placement: 3, kills: 0 }, { id: 'p4', placement: 4, kills: 0 }] },
      { round: 2, lobby: 'A', members: ['p1', 'p2', 'p3', 'p4'], placements: [{ id: 'p2', placement: 1, kills: 0 }, { id: 'p1', placement: 2, kills: 4 }, { id: 'p4', placement: 3, kills: 0 }, { id: 'p3', placement: 4, kills: 0 }] },
    ];
    const rows = lobbyStandings(['p1', 'p2', 'p3', 'p4'], results, LOBBY);
    // p1 = 10 + 6 + 4 = 20, p2 = 6 + 4 + 10 = 20; equal wins (1) and best placement (1), equal kills 4 → shared
    expect(rows.slice(0, 2).map((r) => [r.rank, r.metrics['total_points'], r.unresolvedTie])).toEqual([[1, 20, true], [1, 20, true]]);
    expect(rows.slice(2).every((r) => r.rank === 3 && r.unresolvedTie)).toBe(true); // p3 and p4: 4 points each, equal on every criterion
    expect(nextLobbyOrder(['p4', 'p3', 'p2', 'p1'], rows, 'reseed_by_standings')).toEqual(['p1', 'p2', 'p3', 'p4']);
  });
  it('record values are exact at the declared precision; time trials rank DNF last', () => {
    expect(parseDecimal('12.34', 3)).toBe(12340);
    expect(() => parseDecimal('12.3456', 3)).toThrow(/decimal places/);
    const rules = { 'record.better': 'lower', 'record.precision': 3, 'record.max_attempts': 2, 'record.tiebreak': 'second_best' };
    const rows = recordStandings(['a', 'b', 'c'], [
      { id: 'a', attempt: 1, value: '9.580', at: '2026-01-01T00:00:00Z' }, { id: 'a', attempt: 2, value: '9.700', at: '2026-01-01T00:01:00Z' },
      { id: 'b', attempt: 1, value: '9.58', at: '2026-01-01T00:00:00Z' }, { id: 'b', attempt: 2, value: '9.650', at: '2026-01-01T00:02:00Z' },
      { id: 'c', attempt: 1, value: '0.1', at: '2026-01-01T00:00:00Z' },
    ], rules);
    expect(rows.map((r) => [r.id, r.rank])).toEqual([['c', 1], ['b', 2], ['a', 3]]); // 0.1 + 0.2 never meets float drift
    expect(() => recordStandings(['a'], [{ id: 'a', attempt: 3, value: '1', at: '2026-01-01T00:00:00Z' }], rules)).toThrow(/max_attempts/);
    const tt = timeTrialStandings(['a', 'b', 'c'], [
      { id: 'a', attempt: 1, timeMs: 60_000, penaltyMs: 5_000, dnf: false }, { id: 'b', attempt: 1, timeMs: 64_999, penaltyMs: 0, dnf: false }, { id: 'c', attempt: 1, timeMs: null, penaltyMs: 0, dnf: true },
    ], { 'time.max_attempts': 1, 'time.tiebreak': 'shared' });
    expect(tt.map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(tt[2]!.unresolvedTie).toBe(false);
  });
});

describe('draw, ladder, rules and mixed phases (DRAW-001..003, FMT-002)', () => {
  it('a draw is reproducible from its seed and differs with another seed', () => {
    const entrants = ids(12).map((id) => ({ id }));
    expect(bracketDraw(entrants, 'random', 'none', 'seed-1').order).toEqual(bracketDraw(entrants, 'random', 'none', 'seed-1').order);
    expect(bracketDraw(entrants, 'random', 'none', 'seed-1').order).not.toEqual(bracketDraw(entrants, 'random', 'none', 'seed-2').order);
    const ranked = seedOrderFor([{ id: 'x', rank: 2 }, { id: 'y', rank: 1 }, { id: 'z', rank: 2 }], 'ranking', rngFrom('r'));
    expect(ranked.order[0]).toBe('y');
    expect(ranked.explanations[0]).toMatch(/share rank=2/);
    expect(() => seedOrderFor([{ id: 'a', seed: 1 }, { id: 'b', seed: 1 }], 'manual', rngFrom('m'))).toThrow(/without gaps/);
  });
  it('ladder challenges respect range and the win rule', () => {
    const l = ['a', 'b', 'c', 'd'];
    expect(() => validateChallenge(l, 'd', 'a', 2, [])).toThrow(/range/);
    expect(() => validateChallenge(l, 'b', 'd', 2, [])).toThrow(/above/);
    expect(applyChallenge(l, 'd', 'b', true, 'insert')).toEqual(['a', 'd', 'b', 'c']);
    expect(applyChallenge(l, 'd', 'b', true, 'swap')).toEqual(['a', 'd', 'c', 'b']);
  });
  it('missing or invalid rules are refused before anything is generated', () => {
    expect(validateRules('swiss', { 'swiss.rounds': 0 }).missing).toContain('points.win');
    expect(() => generatePlan('round_robin', { order: ids(4) }, { 'rr.legs': 1 })).toThrow(/ruleset lacks/);
    expect(() => generatePlan('multi_lobby', { order: ids(4) }, { 'lobby.size': 4, 'lobby.rounds': 1, 'lobby.placement_points': [3, 2], 'lobby.kill_points': 0, 'lobby.tiebreak': ['kills'], 'lobby.assignment': 'snake_by_seed' })).toThrow(/one value per placement/);
  });
  it('mixed: groups advance by position (ties across the line refused) into a prefixed playoff phase', () => {
    const groups = { A: ['p1', 'p4'], B: ['p2', 'p3'] };
    const rows = (g: string[]) => g.map((id, i) => ({ id, rank: i + 1, metrics: { points: 3 - i * 3 }, unresolvedTie: false }));
    const advanced = advanceFromGroups({ A: rows(groups.A), B: rows(groups.B) }, 1, 0);
    expect(advanced).toEqual(['p1', 'p2']);
    expect(() => advanceFromGroups({ A: [{ id: 'p1', rank: 1, metrics: {}, unresolvedTie: true }, { id: 'p4', rank: 1, metrics: {}, unresolvedTie: true }] }, 1, 0)).toThrow(/complete tie/);
    const playoff = generatePhase({ key: 'playoff', format: 'single_elim', advance: null }, 1, { order: advanced }, { 'elim.third_place': false });
    expect(playoff.slots[0]!.key).toBe('P2:W1-1');
  });
  it('a phase-prefixed double elimination still finds its grand final and champion', () => {
    const plan = generatePhase({ key: 'po', format: 'double_elim', advance: null }, 1, { order: ids(6) }, { 'elim.grand_final': 'reset' });
    expect(plan.slots.some((s) => s.key === 'P2:GF2')).toBe(true);
    const { states } = playBracket(plan, ids(6), 'mixed-de');
    const rows = eliminationStandings(plan, states);
    expect(rows.filter((r) => r.rank === 1)).toHaveLength(1);
    expect(rows).toHaveLength(6);
  });
  it('scales to large fields without allocating anyone twice', () => {
    const plan = doubleElimination(1000, { grandFinal: 'reset' });
    const { states } = playBracket(plan, ids(1000), 'large');
    expect(eliminationStandings(plan, states)).toHaveLength(1000);
    const se = singleElimination(4096, { thirdPlace: false });
    expect(se.slots).toHaveLength(4095);
  });
});
