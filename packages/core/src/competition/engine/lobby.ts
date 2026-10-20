import { ENGINE_VERSION, EngineError, type Plan, type Slot, type StandingRow } from './types.js';
import type { RuleValues } from './rules.js';

/** Snake distribution of an ordered list into `count` lobbies (1→A, 2→B, …, back again) for balanced lobbies. */
export function snake(ordered: string[], count: number): string[][] {
  const out: string[][] = Array.from({ length: count }, () => []);
  ordered.forEach((id, i) => {
    const row = Math.floor(i / count);
    const col = i % count;
    out[row % 2 === 0 ? col : count - 1 - col]!.push(id);
  });
  return out;
}

/**
 * FMT-001 multi-lobby: each round splits the field into ceil(n / lobby.size) lobbies. Round 1 snakes by seed;
 * later rounds follow `lobby.assignment` (keep the snake by seed, or reseed by current standings).
 */
export function lobbyRound(orderedIds: string[], round: number, size: number): Slot[] {
  if (orderedIds.length < 2) throw new EngineError('INPUT_INVALID', 'a lobby needs at least 2 participants');
  const count = Math.ceil(orderedIds.length / size);
  return snake(orderedIds, count).map((ids, i) => ({ key: `LB${round}-${i + 1}`, bracket: 'LB', round, order: i + 1, sources: ids.map((id) => ({ kind: 'participant' as const, id })) }));
}

export function multiLobbyPlan(seedOrdered: string[], rules: RuleValues): Plan {
  const size = rules['lobby.size'] as number;
  return { format: 'multi_lobby', engine: ENGINE_VERSION, algorithm: 'multi_lobby/snake/1', participants: seedOrdered.length, slots: lobbyRound(seedOrdered, 1, size), meta: { size, rounds: rules['lobby.rounds'], assignment: rules['lobby.assignment'] } };
}

export interface LobbyResult {
  round: number;
  lobby: string;
  members: string[];
  placements: Array<{ id: string; placement: number; kills: number }>;
}

/** Placements must be a permutation of 1..k over exactly the lobby members (no gaps, no duplicates, no outsiders). */
export function validatePlacements(members: string[], placements: LobbyResult['placements']): string[] {
  const errors: string[] = [];
  const ids = placements.map((p) => p.id);
  if (new Set(ids).size !== ids.length) errors.push('a participant appears twice');
  const missing = members.filter((m) => !ids.includes(m));
  const extra = ids.filter((i) => !members.includes(i));
  if (missing.length) errors.push(`missing placements for ${missing.join(', ')}`);
  if (extra.length) errors.push(`not in this lobby: ${extra.join(', ')}`);
  const ps = placements.map((p) => p.placement).sort((a, b) => a - b);
  if (!ps.every((p, i) => p === i + 1)) errors.push(`placements must be 1..${placements.length} without gaps or duplicates`);
  if (placements.some((p) => !Number.isInteger(p.kills) || p.kills < 0)) errors.push('kills must be non-negative integers');
  return errors;
}

/** AC-06: lobby standings from the rules' placement and kill points, tie-breaks partitioned in `lobby.tiebreak` order. */
export function lobbyStandings(ids: string[], results: LobbyResult[], rules: RuleValues, seedOf: Record<string, number> = {}): StandingRow[] {
  const table = rules['lobby.placement_points'] as number[];
  const killPts = rules['lobby.kill_points'] as number;
  const m = new Map(ids.map((id) => [id, { total_points: 0, wins: 0, best_placement: Number.MAX_SAFE_INTEGER, kills: 0, last_round_placement: Number.MAX_SAFE_INTEGER, last_round: 0, lobbies: 0 }]));
  for (const r of results) {
    const errs = validatePlacements(r.members, r.placements);
    if (errs.length) throw new EngineError('INPUT_INVALID', `lobby ${r.lobby}: ${errs.join('; ')}`);
    for (const p of r.placements) {
      const row = m.get(p.id);
      if (!row) throw new EngineError('INPUT_INVALID', `unknown participant ${p.id}`);
      row.total_points += (table[p.placement - 1] ?? 0) + p.kills * killPts;
      row.wins += p.placement === 1 ? 1 : 0;
      row.best_placement = Math.min(row.best_placement, p.placement);
      row.kills += p.kills;
      row.lobbies += 1;
      if (r.round >= row.last_round) {
        row.last_round = r.round;
        row.last_round_placement = p.placement;
      }
    }
  }
  const criteria = ['total_points', ...((rules['lobby.tiebreak'] as string[]) ?? []).filter((k) => k !== 'total_points')];
  const ascending = new Set(['best_placement', 'last_round_placement']);
  const value = (id: string, k: string) => (k === 'seed' ? -(seedOf[id] ?? Number.MAX_SAFE_INTEGER) : ascending.has(k) ? -(m.get(id)! as Record<string, number>)[k]! : (m.get(id)! as Record<string, number>)[k]!);
  let buckets: string[][] = [[...ids]];
  for (const k of criteria) {
    buckets = buckets.flatMap((b) => {
      if (b.length < 2) return [b];
      const vals = [...new Set(b.map((id) => value(id, k)))].sort((x, y) => y - x);
      return vals.map((v) => b.filter((id) => value(id, k) === v).sort());
    });
  }
  const rows: StandingRow[] = [];
  let rank = 1;
  for (const b of buckets) {
    for (const id of b) {
      const r = m.get(id)!;
      rows.push({ id, rank, unresolvedTie: b.length > 1, metrics: { total_points: r.total_points, wins: r.wins, best_placement: r.best_placement === Number.MAX_SAFE_INTEGER ? 0 : r.best_placement, kills: r.kills, lobbies: r.lobbies } });
    }
    rank += b.length;
  }
  return rows;
}

/** Order for the next round's lobbies: by seed (snake stays seed-balanced) or by current standings. */
export function nextLobbyOrder(seedOrdered: string[], standings: StandingRow[], assignment: 'snake_by_seed' | 'reseed_by_standings'): string[] {
  if (assignment === 'snake_by_seed') return seedOrdered;
  const pos = new Map(standings.map((s, i) => [s.id, i]));
  return [...seedOrdered].sort((a, b) => (pos.get(a) ?? 1e9) - (pos.get(b) ?? 1e9));
}
