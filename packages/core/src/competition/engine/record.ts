import { EngineError, type StandingRow } from './types.js';
import { formatDecimal, parseDecimal } from './rng.js';
import type { RuleValues } from './rules.js';

/**
 * FMT-001/003, AC-06: record and time-based competitions with exact precision.
 *  - record: values are decimal strings at `record.precision` places, stored as scaled integers; higher or lower is
 *    better per `record.better`; ties by `record.tiebreak` (second best attempt, earliest achievement, or shared).
 *  - time_trial: integer milliseconds plus penalties; DNF ranks after every finisher; ties by second best or shared.
 * Attempts above the allowed maximum are refused, never silently dropped.
 */
export interface RecordAttempt {
  id: string;
  attempt: number;
  value: string | number;
  at: string;
}
export interface TimeAttempt {
  id: string;
  attempt: number;
  timeMs: number | null;
  penaltyMs: number;
  dnf: boolean;
}

function partition(ids: string[], keys: Array<(id: string) => number>): string[][] {
  let buckets = [ids];
  for (const key of keys) {
    buckets = buckets.flatMap((b) => {
      if (b.length < 2) return [b];
      const vals = [...new Set(b.map(key))].sort((x, y) => y - x);
      return vals.map((v) => b.filter((id) => key(id) === v).sort());
    });
  }
  return buckets;
}
function toRows(buckets: string[][], metrics: (id: string) => Record<string, number>, isLast?: (id: string) => boolean): StandingRow[] {
  const rows: StandingRow[] = [];
  let rank = 1;
  for (const b of buckets) {
    for (const id of b) rows.push({ id, rank, unresolvedTie: b.length > 1 && !(isLast?.(id) ?? false), metrics: metrics(id) });
    rank += b.length;
  }
  return rows;
}

export function recordStandings(ids: string[], attempts: RecordAttempt[], rules: RuleValues): StandingRow[] {
  const decimals = rules['record.precision'] as number;
  const max = rules['record.max_attempts'] as number;
  const higher = rules['record.better'] === 'higher';
  const per = new Map(ids.map((id) => [id, [] as Array<{ v: number; at: number }>]));
  for (const a of attempts) {
    const list = per.get(a.id);
    if (!list) throw new EngineError('INPUT_INVALID', `unknown participant ${a.id}`);
    if (a.attempt < 1 || a.attempt > max) throw new EngineError('INPUT_INVALID', `attempt ${a.attempt} exceeds record.max_attempts=${max}`);
    const at = Date.parse(a.at);
    if (Number.isNaN(at)) throw new EngineError('INPUT_INVALID', 'attempt time must be an ISO instant');
    list.push({ v: parseDecimal(a.value, decimals), at });
  }
  // sign so that "bigger key = better" for both directions
  const sign = higher ? 1 : -1;
  const sorted = new Map([...per].map(([id, l]) => [id, [...l].sort((x, y) => sign * (y.v - x.v) || x.at - y.at)]));
  const none = Number.MIN_SAFE_INTEGER;
  const best = (id: string) => (sorted.get(id)![0] ? sign * sorted.get(id)![0]!.v : none);
  const keys: Array<(id: string) => number> = [best];
  const tb = rules['record.tiebreak'];
  if (tb === 'second_best') keys.push((id) => (sorted.get(id)![1] ? sign * sorted.get(id)![1]!.v : none));
  if (tb === 'earliest') keys.push((id) => (sorted.get(id)![0] ? -sorted.get(id)![0]!.at : none));
  return toRows(partition(ids, keys), (id) => ({ best: sorted.get(id)![0]?.v ?? 0, attempts: sorted.get(id)!.length, precision: decimals }));
}

export const displayRecord = (scaled: number, rules: RuleValues) => formatDecimal(scaled, rules['record.precision'] as number);

export function timeTrialStandings(ids: string[], attempts: TimeAttempt[], rules: RuleValues): StandingRow[] {
  const max = rules['time.max_attempts'] as number;
  const per = new Map(ids.map((id) => [id, [] as number[]]));
  for (const a of attempts) {
    const list = per.get(a.id);
    if (!list) throw new EngineError('INPUT_INVALID', `unknown participant ${a.id}`);
    if (a.attempt < 1 || a.attempt > max) throw new EngineError('INPUT_INVALID', `attempt ${a.attempt} exceeds time.max_attempts=${max}`);
    if (!Number.isInteger(a.penaltyMs) || a.penaltyMs < 0) throw new EngineError('INPUT_INVALID', 'penalty must be whole milliseconds >= 0');
    if (a.dnf) {
      if (a.timeMs !== null) throw new EngineError('INPUT_INVALID', 'a DNF attempt has no time');
      continue;
    }
    if (a.timeMs === null || !Number.isInteger(a.timeMs) || a.timeMs < 0) throw new EngineError('INPUT_INVALID', 'a finished attempt needs whole milliseconds >= 0');
    list.push(a.timeMs + a.penaltyMs);
  }
  const sorted = new Map([...per].map(([id, l]) => [id, [...l].sort((x, y) => x - y)]));
  const dnfKey = Number.MIN_SAFE_INTEGER;
  const keys: Array<(id: string) => number> = [(id) => (sorted.get(id)![0] !== undefined ? -sorted.get(id)![0]! : dnfKey)];
  if (rules['time.tiebreak'] === 'second_best') keys.push((id) => (sorted.get(id)![1] !== undefined ? -sorted.get(id)![1]! : dnfKey));
  const isDnf = (id: string) => sorted.get(id)!.length === 0;
  return toRows(partition(ids, keys), (id) => ({ best_ms: sorted.get(id)![0] ?? 0, finishes: sorted.get(id)!.length, dnf: isDnf(id) ? 1 : 0 }), isDnf);
}
