import { ENGINE_VERSION, EngineError, type Plan, type Slot, type SlotResult, type StandingRow } from './types.js';
import { ruleAtUse, type RuleValues, type Tiebreak } from './rules.js';

/** Circle-method rounds: every participant meets every other exactly once per leg; odd counts give one rest per round. */
export function circleRounds(ids: string[]): Array<Array<[string, string]>> {
  const list: Array<string | null> = [...ids];
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const rounds: Array<Array<[string, string]>> = [];
  const rot = list.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const cur = [list[0]!, ...rot];
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < n / 2; i++) {
      const a = cur[i];
      const b = cur[n - 1 - i];
      if (a && b) pairs.push(r % 2 === 0 || i > 0 ? [a, b] : [b, a]); // alternate home side of the fixed participant
    }
    rounds.push(pairs);
    rot.unshift(rot.pop()!);
  }
  return rounds;
}

function rrSlots(ids: string[], legs: number, prefix: string, bracket: string, group?: string): Slot[] {
  const base = circleRounds(ids);
  const slots: Slot[] = [];
  for (let leg = 1; leg <= legs; leg++) {
    base.forEach((pairs, r) => {
      const round = (leg - 1) * base.length + r + 1;
      pairs.forEach(([a, b], i) => {
        const [x, y] = leg % 2 === 1 ? [a, b] : [b, a]; // return leg swaps home/away
        slots.push({ key: `${prefix}R${round}-${i + 1}`, bracket, round, order: i + 1, leg, sources: [{ kind: 'participant', id: x }, { kind: 'participant', id: y }], ...(group ? { group } : {}) });
      });
    });
  }
  return slots;
}

export function roundRobin(ids: string[], legs: number): Plan {
  if (ids.length < 2) throw new EngineError('INPUT_INVALID', 'round robin needs at least 2 participants');
  return { format: 'round_robin', engine: ENGINE_VERSION, algorithm: 'round_robin/circle/1', participants: ids.length, slots: rrSlots(ids, legs, '', 'RR'), meta: { legs } };
}

/** Groups are drawn first (see draw.ts); each group plays a round robin. */
export function groupStage(groups: Record<string, string[]>, legs: number): Plan {
  const slots: Slot[] = [];
  for (const [g, ids] of Object.entries(groups)) {
    if (ids.length < 2) throw new EngineError('INPUT_INVALID', `group ${g} needs at least 2 participants`);
    slots.push(...rrSlots(ids, legs, `G${g}-`, `G-${g}`, g));
  }
  return { format: 'groups', engine: ENGINE_VERSION, algorithm: 'groups/circle/1', participants: Object.values(groups).flat().length, slots, groups, meta: { legs, groups: Object.keys(groups) } };
}

export interface PlayedMatch {
  a: string;
  b: string | 'BYE';
  result: SlotResult;
}

/**
 * FMT-003/004: table standings. Points come from the rules; forfeits, byes and double no-shows use their own rule
 * keys (absent → an official decides). Ties are split by `tiebreak.order`; head-to-head is evaluated only among
 * the tied participants. Anything still equal shares the rank and is flagged.
 */
export function tableStandings(ids: string[], matches: PlayedMatch[], rules: RuleValues, opts: { withdrawn?: string[]; seedOf?: Record<string, number> } = {}): StandingRow[] {
  const withdrawn = new Set(opts.withdrawn ?? []);
  let ms = matches;
  if (withdrawn.size) {
    const policy = ruleAtUse<string>(rules, 'withdrawal.previous_results', 'a withdrawal');
    if (policy === 'void') ms = ms.filter((m) => !withdrawn.has(m.a) && !(m.b !== 'BYE' && withdrawn.has(m.b)));
  }
  const pts = { win: rules['points.win'] as number, draw: rules['points.draw'] as number, loss: rules['points.loss'] as number };
  const zero = () => ({ played: 0, wins: 0, draws: 0, losses: 0, points: 0, score_for: 0, score_against: 0, maps_won: 0, maps_lost: 0 });
  const t = new Map(ids.map((id) => [id, zero()]));
  const opponents = new Map(ids.map((id) => [id, [] as Array<{ id: string; outcome: 'w' | 'd' | 'l' }>]));
  const row = (id: string) => {
    const r = t.get(id);
    if (!r) throw new EngineError('INPUT_INVALID', `match references unknown participant ${id}`);
    return r;
  };
  for (const m of ms) {
    if (m.b === 'BYE') {
      const r = row(m.a);
      r.points += ruleAtUse<number>(rules, 'swiss.bye_points', 'a bye');
      r.wins += 1;
      continue;
    }
    if (m.a === m.b) throw new EngineError('INPUT_INVALID', `${m.a} cannot play itself`);
    const A = row(m.a);
    const B = row(m.b);
    A.played += 1;
    B.played += 1;
    const res = m.result;
    if (res.kind === 'double_forfeit') {
      const policy = ruleAtUse<string>(rules, 'noshow.double', 'a double no-show');
      if (policy !== 'both_loss') throw new EngineError('NEEDS_REVIEW', `double no-show handled by "${policy}"; an official must record the outcome`);
      const lossPts = ruleAtUse<number>(rules, 'points.forfeit_loss', 'a forfeit');
      A.losses += 1;
      B.losses += 1;
      A.points += lossPts;
      B.points += lossPts;
      continue;
    }
    if (res.kind === 'placements') throw new EngineError('INPUT_INVALID', 'placements belong to lobby formats');
    let scores = res.scores;
    let maps = res.maps;
    if (res.kind === 'win' && res.forfeit) {
      const fs = ruleAtUse<number[]>(rules, 'forfeit.score', 'a forfeit');
      const w: [number, number] = [fs[0] ?? 0, fs[1] ?? 0];
      scores = res.winner === 0 ? w : [w[1], w[0]];
      maps = scores;
    }
    const [sa, sb] = scores ?? [0, 0];
    const [ma, mb] = maps ?? [0, 0];
    A.score_for += sa; A.score_against += sb; B.score_for += sb; B.score_against += sa;
    A.maps_won += ma; A.maps_lost += mb; B.maps_won += mb; B.maps_lost += ma;
    if (res.kind === 'draw') {
      A.draws += 1; B.draws += 1; A.points += pts.draw; B.points += pts.draw;
      opponents.get(m.a)!.push({ id: m.b, outcome: 'd' });
      opponents.get(m.b)!.push({ id: m.a, outcome: 'd' });
    } else {
      const [W, L, wid, lid] = res.winner === 0 ? [A, B, m.a, m.b] : [B, A, m.b, m.a];
      W.wins += 1; L.losses += 1;
      W.points += res.forfeit ? ruleAtUse<number>(rules, 'points.forfeit_win', 'a forfeit') : pts.win;
      L.points += res.forfeit ? ruleAtUse<number>(rules, 'points.forfeit_loss', 'a forfeit') : pts.loss;
      opponents.get(wid)!.push({ id: lid, outcome: 'w' });
      opponents.get(lid)!.push({ id: wid, outcome: 'l' });
    }
  }
  const metric = (id: string, k: Tiebreak, subset: Set<string>): number => {
    const r = t.get(id)!;
    switch (k) {
      case 'points': return r.points;
      case 'wins': return r.wins;
      case 'score_diff': return r.score_for - r.score_against;
      case 'score_for': return r.score_for;
      case 'map_diff': return r.maps_won - r.maps_lost;
      case 'maps_won': return r.maps_won;
      case 'buchholz': return opponents.get(id)!.reduce((s, o) => s + t.get(o.id)!.points, 0);
      case 'median_buchholz': {
        const v = opponents.get(id)!.map((o) => t.get(o.id)!.points).sort((x, y) => x - y);
        return v.length > 2 ? v.slice(1, -1).reduce((s, x) => s + x, 0) : v.reduce((s, x) => s + x, 0);
      }
      case 'sonneborn_berger': // doubled to stay integral: 2 × beaten opponents' points + drawn opponents' points
        return opponents.get(id)!.reduce((s, o) => s + (o.outcome === 'w' ? 2 : o.outcome === 'd' ? 1 : 0) * t.get(o.id)!.points, 0);
      case 'head_to_head': {
        let p = 0;
        for (const m of ms) {
          if (m.b === 'BYE' || !subset.has(m.a) || !subset.has(m.b) || (m.a !== id && m.b !== id)) continue;
          if (m.result.kind === 'draw') p += pts.draw;
          else if (m.result.kind === 'win' && (m.result.winner === 0 ? m.a : m.b) === id) p += pts.win;
        }
        return p;
      }
      case 'seed': return -(opts.seedOf?.[id] ?? Number.MAX_SAFE_INTEGER); // lower seed number ranks higher
    }
  };
  const order = ['points', ...((rules['tiebreak.order'] as Tiebreak[]) ?? []).filter((k) => k !== 'points')] as Tiebreak[];
  const active = ids.filter((id) => !withdrawn.has(id));
  let buckets: string[][] = [active];
  for (const k of order) {
    buckets = buckets.flatMap((b) => {
      if (b.length < 2) return [b];
      const subset = new Set(b);
      const vals = new Map(b.map((id) => [id, metric(id, k, subset)]));
      const distinct = [...new Set(vals.values())].sort((x, y) => y - x);
      return distinct.map((v) => b.filter((id) => vals.get(id) === v).sort());
    });
  }
  const rows: StandingRow[] = [];
  let rank = 1;
  for (const b of buckets) {
    for (const id of b) {
      const r = t.get(id)!;
      rows.push({ id, rank, unresolvedTie: b.length > 1, metrics: { ...r, score_diff: r.score_for - r.score_against, map_diff: r.maps_won - r.maps_lost, buchholz: metric(id, 'buchholz', new Set()), sonneborn_berger: metric(id, 'sonneborn_berger', new Set()) } });
    }
    rank += b.length;
  }
  // withdrawn participants are listed last, unranked relative to each other
  for (const id of ids.filter((x) => withdrawn.has(x))) rows.push({ id, rank, unresolvedTie: false, metrics: { ...t.get(id)!, withdrawn: 1 } });
  return rows;
}
