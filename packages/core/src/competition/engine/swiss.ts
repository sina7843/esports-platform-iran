import { EngineError } from './types.js';

/**
 * FMT-005: Swiss pairing. Order = points desc, then seed asc. Method from the rules:
 *  - dutch: inside a score group the top half meets the bottom half (1 v h+1, 2 v h+2 …); floaters drop to the
 *    nearest lower score group;
 *  - monrad: adjacent pairing in standings order (1 v 2, 3 v 4 …).
 * No rematches unless mathematically unavoidable; any unavoidable rematch or repeated bye is returned as an
 * explanation that is stored with the round. Deterministic: same input → same pairs.
 */
export interface SwissInput {
  ids: string[]; // seed order (index 0 = seed 1)
  points: Record<string, number>;
  played: Array<[string, string]>;
  byes: string[];
  method: 'dutch' | 'monrad';
}
export interface SwissRound {
  pairs: Array<[string, string]>;
  bye: string | null;
  explanations: string[];
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function swissPair(input: SwissInput): SwissRound {
  const seed = new Map(input.ids.map((id, i) => [id, i]));
  const order = [...input.ids].sort((a, b) => (input.points[b] ?? 0) - (input.points[a] ?? 0) || seed.get(a)! - seed.get(b)!);
  const played = new Set(input.played.map(([a, b]) => pairKey(a, b)));
  const explanations: string[] = [];
  let pool = order;
  let bye: string | null = null;
  if (order.length % 2 === 1) {
    const hadBye = new Set(input.byes);
    bye = [...order].reverse().find((id) => !hadBye.has(id)) ?? order[order.length - 1]!;
    if (hadBye.has(bye)) explanations.push(`every participant already had a bye; ${bye} (lowest ranked) receives a second one`);
    pool = order.filter((id) => id !== bye);
  }
  const groupIndex = (id: string) => pool.filter((x) => (input.points[x] ?? 0) === (input.points[id] ?? 0)).indexOf(id);
  const groupSize = (id: string) => pool.filter((x) => (input.points[x] ?? 0) === (input.points[id] ?? 0)).length;
  const prefers = (p: string, candidates: string[]): string[] => {
    const pp = input.points[p] ?? 0;
    return [...candidates].sort((a, b) => {
      const da = Math.abs(pp - (input.points[a] ?? 0));
      const db = Math.abs(pp - (input.points[b] ?? 0));
      if (da !== db) return da - db;
      if (input.method === 'dutch' && (input.points[a] ?? 0) === pp && (input.points[b] ?? 0) === pp) {
        const h = Math.floor(groupSize(p) / 2);
        const ideal = groupIndex(p) + h;
        return Math.abs(groupIndex(a) - ideal) - Math.abs(groupIndex(b) - ideal) || pool.indexOf(a) - pool.indexOf(b);
      }
      return pool.indexOf(a) - pool.indexOf(b);
    });
  };
  let exhausted = false;
  const attempt = (allowRematch: boolean): Array<[string, string]> | null => {
    let budget = 200_000;
    exhausted = false;
    const out: Array<[string, string]> = [];
    const free = new Set(pool);
    const dfs = (): boolean => {
      if (--budget < 0) {
        exhausted = true;
        return false;
      }
      const p = pool.find((x) => free.has(x));
      if (!p) return true;
      free.delete(p);
      const cands = prefers(p, pool.filter((x) => free.has(x)));
      const ordered = allowRematch ? [...cands.filter((c) => !played.has(pairKey(p, c))), ...cands.filter((c) => played.has(pairKey(p, c)))] : cands.filter((c) => !played.has(pairKey(p, c)));
      for (const c of ordered) {
        free.delete(c);
        out.push([p, c]);
        if (dfs()) return true;
        out.pop();
        free.add(c);
      }
      free.add(p);
      return false;
    };
    return dfs() ? out : null;
  };
  let pairs = attempt(false);
  // a search that ran out of budget proves nothing: never claim a rematch is "unavoidable" without proof
  if (!pairs && exhausted) throw new EngineError('NEEDS_REVIEW', 'Swiss pairing search exceeded its budget; an official must pair this round');
  if (!pairs) {
    pairs = attempt(true);
    if (!pairs) throw new EngineError('NEEDS_REVIEW', 'no Swiss pairing found within the search budget; an official must pair this round');
    for (const [a, b] of pairs) if (played.has(pairKey(a, b))) explanations.push(`rematch ${a} v ${b} is unavoidable: no complete pairing without repeat opponents exists`);
  }
  return { pairs, bye, explanations };
}
