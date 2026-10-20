import { rngFrom, shuffle } from './rng.js';
import { EngineError, type StandingRow } from './types.js';
import { seedOrder, nextPow2 } from './elimination.js';

/**
 * DRAW-001/002: seeding and group draw. Every draw is reproducible from (input snapshot, method, seed string).
 * Separation by region/club is applied only when the rules set `draw.separate_by`; an impossible constraint is
 * reported, never silently relaxed.
 */
export interface DrawEntrant {
  id: string;
  seed?: number | null; // manual seeding
  rank?: number | null; // ranking seeding (lower = better)
  qualifierRank?: number | null; // qualifier seeding
  pot?: number | null; // explicit pot
  region?: string | null;
  club?: string | null;
}
export type DrawMethod = 'manual' | 'random' | 'ranking' | 'qualifier';
export interface DrawOutcome {
  order: string[];
  groups?: Record<string, string[]>;
  explanations: string[];
}

export function seedOrderFor(entrants: DrawEntrant[], method: DrawMethod, rng: () => number): { order: string[]; explanations: string[] } {
  const ids = entrants.map((e) => e.id);
  if (new Set(ids).size !== ids.length) throw new EngineError('INPUT_INVALID', 'duplicate entrant in draw input');
  const explanations: string[] = [];
  if (method === 'manual') {
    const seeds = entrants.map((e) => e.seed);
    if (seeds.some((s) => !Number.isInteger(s))) throw new EngineError('INPUT_INVALID', 'manual seeding needs a seed for every entrant');
    const sorted = [...seeds].sort((a, b) => a! - b!);
    if (!sorted.every((s, i) => s === i + 1)) throw new EngineError('INPUT_INVALID', `manual seeds must be 1..${entrants.length} without gaps or duplicates`);
    return { order: [...entrants].sort((a, b) => a.seed! - b.seed!).map((e) => e.id), explanations };
  }
  if (method === 'random') return { order: shuffle(ids, rng), explanations };
  const key = method === 'ranking' ? 'rank' : 'qualifierRank';
  // equal or missing values are ordered by the seeded generator, and that is recorded
  const tieBreak = new Map(shuffle(ids, rng).map((id, i) => [id, i]));
  const val = (e: DrawEntrant) => (e[key] ?? Number.MAX_SAFE_INTEGER) as number;
  const order = [...entrants].sort((a, b) => val(a) - val(b) || tieBreak.get(a.id)! - tieBreak.get(b.id)!);
  const groups = new Map<number, string[]>();
  for (const e of order) groups.set(val(e), [...(groups.get(val(e)) ?? []), e.id]);
  for (const [v, g] of groups) if (g.length > 1) explanations.push(`${g.length} entrants share ${key}=${v === Number.MAX_SAFE_INTEGER ? 'none' : v}; their order was drawn: ${g.join(', ')}`);
  return { order: order.map((e) => e.id), explanations };
}

const groupNames = (n: number) => Array.from({ length: n }, (_, i) => (i < 26 ? String.fromCharCode(65 + i) : `G${i + 1}`));

/** Pots: explicit pot numbers, else consecutive seed bands of `groups` entrants. One entrant per pot per group. */
export function drawGroups(entrants: DrawEntrant[], order: string[], count: number, separateBy: 'none' | 'region' | 'club', rng: () => number): { groups: Record<string, string[]>; explanations: string[] } {
  if (count < 1 || count > order.length) throw new EngineError('INPUT_INVALID', `cannot split ${order.length} entrants into ${count} groups`);
  const byId = new Map(entrants.map((e) => [e.id, e]));
  const explicit = entrants.every((e) => Number.isInteger(e.pot));
  const pots = new Map<number, string[]>();
  order.forEach((id, i) => {
    const p = explicit ? byId.get(id)!.pot! : Math.floor(i / count) + 1;
    pots.set(p, [...(pots.get(p) ?? []), id]);
  });
  const names = groupNames(count);
  const groups: Record<string, string[]> = Object.fromEntries(names.map((n) => [n, []]));
  const attr = (id: string) => (separateBy === 'none' ? null : (byId.get(id)?.[separateBy] ?? null));
  for (const p of [...pots.keys()].sort((a, b) => a - b)) {
    const members = shuffle(pots.get(p)!, rng);
    if (members.length > count) throw new EngineError('INPUT_INVALID', `pot ${p} has ${members.length} entrants for ${count} groups`);
    // groups that can still take one from this pot, in a drawn order
    const assign = (i: number, used: Set<string>): boolean => {
      if (i === members.length) return true;
      const id = members[i]!;
      for (const g of shuffle(names, rng)) {
        if (used.has(g)) continue;
        const a = attr(id);
        if (a && groups[g]!.some((x) => attr(x) === a)) continue;
        used.add(g);
        groups[g]!.push(id);
        if (assign(i + 1, used)) return true;
        groups[g]!.pop();
        used.delete(g);
      }
      return false;
    };
    if (!assign(0, new Set())) throw new EngineError('CONSTRAINT_UNSATISFIABLE', `separation by ${separateBy} cannot be satisfied for pot ${p}; an official must decide (DRAW-002)`, { pot: p, members });
  }
  return { groups, explanations: [] };
}

/**
 * Bracket placement: seeds 1..n go to the standard positions; byes fall to the top seeds. With a random draw and a
 * separation rule, the drawn order is re-drawn (deterministically) until no first-round match pairs the same
 * region/club; impossible → reported.
 */
export function bracketDraw(entrants: DrawEntrant[], method: DrawMethod, separateBy: 'none' | 'region' | 'club', seedString: string): DrawOutcome {
  const rng = rngFrom(seedString);
  let { order, explanations } = seedOrderFor(entrants, method, rng);
  if (separateBy !== 'none') {
    const byId = new Map(entrants.map((e) => [e.id, e]));
    const clash = (o: string[]) => {
      const pos = seedOrder(nextPow2(o.length));
      for (let i = 0; i < pos.length; i += 2) {
        const a = byId.get(o[pos[i]! - 1] ?? '');
        const b = byId.get(o[pos[i + 1]! - 1] ?? '');
        if (a && b && a[separateBy] && a[separateBy] === b[separateBy]) return true;
      }
      return false;
    };
    if (clash(order)) {
      if (method !== 'random') explanations = [...explanations, `seeded order keeps a first-round ${separateBy} pairing; seeding by ${method} takes precedence (rules order)`];
      else {
        let tries = 0;
        while (clash(order) && tries++ < 1000) order = shuffle(order, rng);
        if (clash(order)) throw new EngineError('CONSTRAINT_UNSATISFIABLE', `no random bracket avoids same-${separateBy} first-round matches`);
        explanations = [...explanations, `random order re-drawn ${tries} time(s) to separate by ${separateBy}`];
      }
    }
  }
  return { order, explanations };
}

/**
 * Advancement from group tables (mixed formats, STG-002): top `perGroup` of each group, then the best remaining across
 * groups. The order interleaves positions (all group winners, then all runners-up …) for the next phase's seeding.
 * A complete tie across the cut line is not decided by the engine.
 */
export function advanceFromGroups(tables: Record<string, StandingRow[]>, perGroup: number, bestRemaining: number): string[] {
  const out: string[] = [];
  for (const [g, rows] of Object.entries(tables)) {
    const cut = rows[perGroup - 1];
    const next = rows[perGroup];
    if (cut && next && cut.rank === next.rank) throw new EngineError('NEEDS_REVIEW', `group ${g}: complete tie across the qualification line (rank ${cut.rank}); apply the rules' extra match or official decision`);
  }
  for (let pos = 0; pos < perGroup; pos++) for (const g of Object.keys(tables).sort()) { const r = tables[g]![pos]; if (r) out.push(r.id); }
  if (bestRemaining > 0) {
    const rest = Object.keys(tables).sort().map((g) => tables[g]![perGroup]).filter((r): r is StandingRow => !!r);
    const score = (r: StandingRow) => [r.metrics['points'] ?? r.metrics['total_points'] ?? 0, r.metrics['score_diff'] ?? 0, r.metrics['score_for'] ?? 0];
    rest.sort((a, b) => { const x = score(a), y = score(b); return y[0]! - x[0]! || y[1]! - x[1]! || y[2]! - x[2]!; });
    const cutA = rest[bestRemaining - 1];
    const cutB = rest[bestRemaining];
    if (cutA && cutB && score(cutA).join() === score(cutB).join()) throw new EngineError('NEEDS_REVIEW', 'complete tie for the last best-remaining place; an official must decide');
    out.push(...rest.slice(0, bestRemaining).map((r) => r.id));
  }
  return out;
}
