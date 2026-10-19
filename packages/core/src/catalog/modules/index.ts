import { z } from 'zod';
import type { CompetitionFamily, GameModuleDescriptor } from '@esp/contracts';

/**
 * GAME-005 / chapter 1.3: one generic module per competition family.
 * TEST ONLY: these are synthetic structural modules, NOT a publisher-approved rule set. They define the shape of a
 * game-unit result, its validation, ranking and tie-break order; scoring constants (e.g. lobby points) are synthetic.
 */
export interface RankEntry {
  id: string;
  rank: number;
  metrics: Record<string, number>;
}
export interface GameModule {
  descriptor: GameModuleDescriptor;
  resultSchema: z.ZodTypeAny;
  validateResult(values: unknown): { ok: boolean; errors: string[] };
  /** Ranks participants from validated units. Equal metric vectors share a rank (no hidden tie-break). */
  rank(units: unknown[]): RankEntry[];
}

const id = z.string().min(1).max(64);
const nat = z.number().int().min(0);

/** Orders entries by metric vectors (desc by default; `asc` lists keys that sort ascending) with shared ranks on full ties. */
function order(rows: Array<{ id: string; metrics: Record<string, number> }>, keys: string[], asc: string[] = []): RankEntry[] {
  const sorted = [...rows].sort((a, b) => {
    for (const k of keys) {
      const d = (a.metrics[k] ?? 0) - (b.metrics[k] ?? 0);
      if (d !== 0) return asc.includes(k) ? d : -d;
    }
    return a.id.localeCompare(b.id);
  });
  const same = (a: RankEntry['metrics'], b: RankEntry['metrics']) => keys.every((k) => (a[k] ?? 0) === (b[k] ?? 0));
  const out: RankEntry[] = [];
  sorted.forEach((r, i) => out.push({ id: r.id, metrics: r.metrics, rank: i > 0 && same(out[i - 1]!.metrics, r.metrics) ? out[i - 1]!.rank : i + 1 }));
  return out;
}

function make(family: CompetitionFamily, label: string, scoringModel: string, tieBreakOrder: string[], fields: GameModuleDescriptor['resultFields'], schema: z.ZodTypeAny, rank: GameModule['rank']): GameModule {
  const descriptor: GameModuleDescriptor = { id: family, family, label: `${label} (TEST ONLY generic module)`, testOnly: true, resultFields: fields, scoringModel, tieBreakOrder };
  return {
    descriptor,
    resultSchema: schema,
    validateResult(values) {
      const r = schema.safeParse(values);
      return r.success ? { ok: true, errors: [] } : { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
    },
    rank,
  };
}

const f = (key: string, type: GameModuleDescriptor['resultFields'][number]['type'], required: boolean, description: string) => ({ key, type, required, description });

// ---- head_to_head / team: one game between two sides
const sideGame = z
  .object({ a: id, b: id, scoreA: nat, scoreB: nat, winner: z.enum(['a', 'b', 'draw']) })
  .superRefine((v, ctx) => {
    if (v.a === v.b) ctx.addIssue({ code: 'custom', path: ['b'], message: 'a side cannot play itself' });
    const expected = v.scoreA > v.scoreB ? 'a' : v.scoreB > v.scoreA ? 'b' : 'draw';
    if (v.winner !== expected) ctx.addIssue({ code: 'custom', path: ['winner'], message: `winner contradicts scores (expected ${expected})` });
  });
type SideGame = z.infer<typeof sideGame>;
function rankSides(units: unknown[], extra: (g: SideGame & { mapsA?: number; mapsB?: number }) => [number, number]): RankEntry[] {
  const t = new Map<string, Record<string, number>>();
  const row = (k: string) => t.get(k) ?? t.set(k, { wins: 0, diff: 0, pointsFor: 0 }).get(k)!;
  for (const u of units as Array<SideGame & { mapsA?: number; mapsB?: number }>) {
    const [xa, xb] = extra(u);
    const A = row(u.a);
    const B = row(u.b);
    if (u.winner === 'a') A['wins']! += 1;
    if (u.winner === 'b') B['wins']! += 1;
    A['diff']! += xa - xb;
    B['diff']! += xb - xa;
    A['pointsFor']! += xa;
    B['pointsFor']! += xb;
  }
  return order([...t].map(([k, m]) => ({ id: k, metrics: m })), ['wins', 'diff', 'pointsFor']);
}
const h2h = make(
  'head_to_head',
  'Head to head',
  'win = higher score; draw only on equal scores',
  ['wins', 'score_difference', 'points_for'],
  [f('a', 'string', true, 'side A id'), f('b', 'string', true, 'side B id'), f('scoreA', 'int', true, 'score of A (>=0)'), f('scoreB', 'int', true, 'score of B (>=0)'), f('winner', 'string', true, 'a | b | draw, must agree with the scores')],
  sideGame,
  (u) => rankSides(u, (g) => [g.scoreA, g.scoreB]),
);
const teamGame = z
  .object({ a: id, b: id, scoreA: nat, scoreB: nat, mapsA: nat, mapsB: nat, winner: z.enum(['a', 'b', 'draw']) })
  .superRefine((v, ctx) => {
    if (v.a === v.b) ctx.addIssue({ code: 'custom', path: ['b'], message: 'a side cannot play itself' });
    const expected = v.mapsA > v.mapsB ? 'a' : v.mapsB > v.mapsA ? 'b' : 'draw';
    if (v.winner !== expected) ctx.addIssue({ code: 'custom', path: ['winner'], message: `winner contradicts maps won (expected ${expected})` });
  });
const team = make(
  'team',
  'Team series',
  'series winner = more maps won; scores are round totals used only for tie-break',
  ['wins', 'map_difference', 'maps_won'],
  [f('a', 'string', true, 'team A id'), f('b', 'string', true, 'team B id'), f('mapsA', 'int', true, 'maps won by A'), f('mapsB', 'int', true, 'maps won by B'), f('scoreA', 'int', true, 'round total A'), f('scoreB', 'int', true, 'round total B'), f('winner', 'string', true, 'a | b | draw, agrees with maps')],
  teamGame,
  (u) => rankSides(u, (g) => [g.mapsA ?? 0, g.mapsB ?? 0]),
);

// ---- multi_lobby: placements are a permutation of 1..n
const lobby = z
  .object({ placements: z.array(z.object({ id, placement: z.number().int().min(1), kills: nat })).min(2) })
  .superRefine((v, ctx) => {
    const n = v.placements.length;
    const ps = v.placements.map((p) => p.placement).sort((x, y) => x - y);
    if (!ps.every((p, i) => p === i + 1)) ctx.addIssue({ code: 'custom', path: ['placements'], message: `placements must be a permutation of 1..${n} without gaps or duplicates` });
    if (new Set(v.placements.map((p) => p.id)).size !== n) ctx.addIssue({ code: 'custom', path: ['placements'], message: 'duplicate participant in lobby' });
  });
const multiLobby = make(
  'multi_lobby',
  'Multi-lobby placement',
  'synthetic points = (lobby size - placement + 1) + kills, summed over lobbies',
  ['total_points', 'best_placement', 'kills'],
  [f('placements', 'string', true, 'array of {id, placement (permutation 1..n), kills}')],
  lobby,
  (units) => {
    const t = new Map<string, Record<string, number>>();
    for (const u of units as Array<z.infer<typeof lobby>>) {
      const n = u.placements.length;
      for (const p of u.placements) {
        const m = t.get(p.id) ?? t.set(p.id, { total_points: 0, best_placement: 999, kills: 0 }).get(p.id)!;
        m['total_points']! += n - p.placement + 1 + p.kills;
        m['best_placement'] = Math.min(m['best_placement']!, p.placement);
        m['kills']! += p.kills;
      }
    }
    return order([...t].map(([k, m]) => ({ id: k, metrics: m })), ['total_points', 'best_placement', 'kills'], ['best_placement']);
  },
);

// ---- record: best verified value, earliest achievement wins ties
const record = z.object({ id, value: z.number().finite().min(0), achievedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO instant'), attempts: z.number().int().min(1) });
const recordMod = make(
  'record',
  'Record attempt',
  'best (highest) value per participant; earlier achievement wins ties',
  ['best_value', 'earliest_achievedAt'],
  [f('id', 'string', true, 'participant id'), f('value', 'number', true, 'achieved value (>=0)'), f('achievedAt', 'string', true, 'ISO instant'), f('attempts', 'int', true, 'attempts used (>=1)')],
  record,
  (units) => {
    const best = new Map<string, { value: number; at: number }>();
    for (const u of units as Array<z.infer<typeof record>>) {
      const at = Date.parse(u.achievedAt);
      const c = best.get(u.id);
      if (!c || u.value > c.value || (u.value === c.value && at < c.at)) best.set(u.id, { value: u.value, at });
    }
    return order([...best].map(([k, b]) => ({ id: k, metrics: { best_value: b.value, at: b.at } })), ['best_value', 'at'], ['at']);
  },
);

// ---- time_trial: lower total time wins; DNF has no time
const trial = z
  .object({ id, timeMs: nat.nullable(), penaltyMs: nat.default(0), dnf: z.boolean() })
  .superRefine((v, ctx) => {
    if (v.dnf && v.timeMs !== null) ctx.addIssue({ code: 'custom', path: ['timeMs'], message: 'a DNF cannot have a finishing time' });
    if (!v.dnf && v.timeMs === null) ctx.addIssue({ code: 'custom', path: ['timeMs'], message: 'a finisher needs a time' });
  });
const timeTrial = make(
  'time_trial',
  'Time trial',
  'total = timeMs + penaltyMs, lower is better; DNF ranks last',
  ['total_time', 'raw_time'],
  [f('id', 'string', true, 'participant id'), f('timeMs', 'duration_ms', false, 'finish time in ms (>=0), null for DNF'), f('penaltyMs', 'duration_ms', false, 'penalties in ms (>=0)'), f('dnf', 'boolean', true, 'did not finish')],
  trial,
  (units) => {
    const best = new Map<string, { total: number; raw: number }>();
    for (const u of units as Array<z.infer<typeof trial>>) {
      const total = u.dnf ? Number.MAX_SAFE_INTEGER : (u.timeMs ?? 0) + (u.penaltyMs ?? 0);
      const c = best.get(u.id);
      if (!c || total < c.total) best.set(u.id, { total, raw: u.dnf ? Number.MAX_SAFE_INTEGER : (u.timeMs ?? 0) });
    }
    return order([...best].map(([k, b]) => ({ id: k, metrics: { total_time: b.total, raw_time: b.raw } })), ['total_time', 'raw_time'], ['total_time', 'raw_time']);
  },
);

// ---- score: bounded score
const scored = z.object({ id, score: nat, maxScore: z.number().int().min(1), tiebreakScore: nat.default(0) }).superRefine((v, ctx) => {
  if (v.score > v.maxScore) ctx.addIssue({ code: 'custom', path: ['score'], message: 'score exceeds maxScore' });
});
const scoreMod = make(
  'score',
  'Scored performance',
  'highest score wins; tiebreakScore breaks ties',
  ['score', 'tiebreak_score'],
  [f('id', 'string', true, 'participant id'), f('score', 'int', true, 'score (0..maxScore)'), f('maxScore', 'int', true, 'maximum attainable (>=1)'), f('tiebreakScore', 'int', false, 'secondary score (>=0)')],
  scored,
  (units) => {
    const t = new Map<string, Record<string, number>>();
    for (const u of units as Array<z.infer<typeof scored>>) {
      const m = t.get(u.id) ?? t.set(u.id, { score: 0, tiebreak_score: 0 }).get(u.id)!;
      m['score']! += u.score;
      m['tiebreak_score']! += u.tiebreakScore ?? 0;
    }
    return order([...t].map(([k, m]) => ({ id: k, metrics: m })), ['score', 'tiebreak_score']);
  },
);

export const gameModules: Record<string, GameModule> = Object.fromEntries([h2h, team, multiLobby, recordMod, timeTrial, scoreMod].map((m) => [m.descriptor.id, m]));
export const getGameModule = (moduleId: string): GameModule | undefined => (Object.hasOwn(gameModules, moduleId) ? gameModules[moduleId] : undefined);
export const listGameModules = (): GameModuleDescriptor[] => Object.values(gameModules).map((m) => m.descriptor);

/** Valid / contradictory fixtures for the contract tests (one pair per module). */
export const moduleFixtures: Record<string, { valid: unknown[]; invalid: unknown[] }> = {
  head_to_head: { valid: [{ a: 'x', b: 'y', scoreA: 2, scoreB: 1, winner: 'a' }, { a: 'x', b: 'y', scoreA: 1, scoreB: 1, winner: 'draw' }], invalid: [{ a: 'x', b: 'y', scoreA: -1, scoreB: 0, winner: 'b' }, { a: 'x', b: 'y', scoreA: 1, scoreB: 2, winner: 'a' }, { a: 'x', b: 'x', scoreA: 1, scoreB: 0, winner: 'a' }] },
  team: { valid: [{ a: 't1', b: 't2', mapsA: 2, mapsB: 1, scoreA: 30, scoreB: 25, winner: 'a' }], invalid: [{ a: 't1', b: 't2', mapsA: 2, mapsB: 1, scoreA: 30, scoreB: 25, winner: 'b' }, { a: 't1', b: 't2', mapsA: -1, mapsB: 1, scoreA: 0, scoreB: 0, winner: 'b' }] },
  multi_lobby: { valid: [{ placements: [{ id: 'p1', placement: 1, kills: 3 }, { id: 'p2', placement: 2, kills: 0 }, { id: 'p3', placement: 3, kills: 1 }] }], invalid: [{ placements: [{ id: 'p1', placement: 1, kills: 0 }, { id: 'p2', placement: 1, kills: 0 }] }, { placements: [{ id: 'p1', placement: 1, kills: 0 }, { id: 'p2', placement: 3, kills: 0 }] }, { placements: [{ id: 'p1', placement: 1, kills: -2 }, { id: 'p2', placement: 2, kills: 0 }] }] },
  record: { valid: [{ id: 'p1', value: 12.5, achievedAt: '2026-01-01T00:00:00.000Z', attempts: 2 }], invalid: [{ id: 'p1', value: -1, achievedAt: '2026-01-01T00:00:00.000Z', attempts: 1 }, { id: 'p1', value: 1, achievedAt: 'not a date', attempts: 1 }, { id: 'p1', value: 1, achievedAt: '2026-01-01T00:00:00.000Z', attempts: 0 }] },
  time_trial: { valid: [{ id: 'p1', timeMs: 61000, penaltyMs: 500, dnf: false }, { id: 'p2', timeMs: null, dnf: true }], invalid: [{ id: 'p1', timeMs: -5, dnf: false }, { id: 'p1', timeMs: 1000, dnf: true }, { id: 'p1', timeMs: null, dnf: false }] },
  score: { valid: [{ id: 'p1', score: 80, maxScore: 100 }], invalid: [{ id: 'p1', score: 101, maxScore: 100 }, { id: 'p1', score: -1, maxScore: 100 }] },
};
