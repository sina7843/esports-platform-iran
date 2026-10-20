import { EngineError, ENGINE_VERSION, type Plan, type Resolved, type Slot, type SlotResult, type SlotSource, type SlotState, type StandingRow } from './types.js';

/** Standard bracket order: seed 1 meets the lowest seed, top two seeds can only meet in the final. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}
export const nextPow2 = (n: number) => (n <= 1 ? 1 : 2 ** Math.ceil(Math.log2(n)));

function firstRound(P: number, prefix: string, bracket: string): Slot[] {
  const order = seedOrder(P);
  const out: Slot[] = [];
  for (let i = 0; i < P / 2; i++) out.push({ key: `${prefix}1-${i + 1}`, bracket, round: 1, order: i + 1, sources: [{ kind: 'seed', seed: order[2 * i]! }, { kind: 'seed', seed: order[2 * i + 1]! }] });
  return out;
}

function winnersRounds(P: number, prefix = 'W', bracket = 'W'): Slot[] {
  const slots = firstRound(P, prefix, bracket);
  const rounds = Math.log2(P);
  for (let r = 2; r <= rounds; r++) {
    const count = P / 2 ** r;
    for (let i = 1; i <= count; i++) slots.push({ key: `${prefix}${r}-${i}`, bracket, round: r, order: i, sources: [{ kind: 'winner', slot: `${prefix}${r - 1}-${2 * i - 1}` }, { kind: 'winner', slot: `${prefix}${r - 1}-${2 * i}` }] });
  }
  return slots;
}

/** FMT-001/002: single elimination with byes for the top seeds and an optional third-place match. */
export function singleElimination(n: number, opts: { thirdPlace: boolean }): Plan {
  if (n < 2) throw new EngineError('INPUT_INVALID', 'single elimination needs at least 2 participants');
  const P = nextPow2(n);
  const slots = winnersRounds(P);
  const k = Math.log2(P);
  if (opts.thirdPlace && k >= 2) slots.push({ key: 'P3', bracket: 'P3', round: k, order: 2, sources: [{ kind: 'loser', slot: `W${k - 1}-1` }, { kind: 'loser', slot: `W${k - 1}-2` }] });
  return { format: 'single_elim', engine: ENGINE_VERSION, algorithm: 'single_elim/standard-seeding/1', participants: n, slots, meta: { size: P, rounds: k, thirdPlace: opts.thirdPlace && k >= 2 } };
}

/**
 * FMT-001/002: double elimination. Losers drop into the losers bracket; drop order alternates (reversed on odd
 * drop rounds) so early rematches are pushed back. Grand final: WB champion vs LB champion; with policy "reset" a
 * second final (GF2) is played only if the LB champion wins the first.
 */
export function doubleElimination(n: number, opts: { grandFinal: 'reset' | 'single' }): Plan {
  if (n < 2) throw new EngineError('INPUT_INVALID', 'double elimination needs at least 2 participants');
  const P = nextPow2(n);
  const k = Math.log2(P);
  const slots = winnersRounds(P);
  let lbChampion: SlotSource = { kind: 'loser', slot: `W${k}-1` };
  if (k >= 2) {
    // LB round 1: losers of WB round 1 paired
    for (let j = 1; j <= P / 4; j++) slots.push({ key: `L1-${j}`, bracket: 'L', round: 1, order: j, sources: [{ kind: 'loser', slot: `W1-${2 * j - 1}` }, { kind: 'loser', slot: `W1-${2 * j}` }] });
    for (let m = 1; m <= k - 1; m++) {
      const r = 2 * m;
      const count = P / 2 ** (m + 1);
      for (let j = 1; j <= count; j++) {
        const dropIndex = m % 2 === 1 ? count + 1 - j : j;
        slots.push({ key: `L${r}-${j}`, bracket: 'L', round: r, order: j, sources: [{ kind: 'winner', slot: `L${r - 1}-${j}` }, { kind: 'loser', slot: `W${m + 1}-${dropIndex}` }] });
      }
      if (m <= k - 2) {
        for (let j = 1; j <= count / 2; j++) slots.push({ key: `L${r + 1}-${j}`, bracket: 'L', round: r + 1, order: j, sources: [{ kind: 'winner', slot: `L${r}-${2 * j - 1}` }, { kind: 'winner', slot: `L${r}-${2 * j}` }] });
      }
    }
    lbChampion = { kind: 'winner', slot: `L${2 * (k - 1)}-1` };
  }
  const gfRound = k + 1;
  slots.push({ key: 'GF', bracket: 'GF', round: gfRound, order: 1, sources: [{ kind: 'winner', slot: `W${k}-1` }, lbChampion] });
  if (opts.grandFinal === 'reset') slots.push({ key: 'GF2', bracket: 'GF', round: gfRound + 1, order: 1, sources: [{ kind: 'winner', slot: `W${k}-1` }, lbChampion], conditional: 'reset' });
  return { format: 'double_elim', engine: ENGINE_VERSION, algorithm: 'double_elim/alternating-drop/1', participants: n, slots, meta: { size: P, rounds: k, lbRounds: Math.max(0, 2 * (k - 1)), grandFinal: opts.grandFinal } };
}

/**
 * Resolves every slot of a bracket from seeds and recorded results. Byes advance automatically; a double forfeit
 * eliminates both (the next opponent gets a bye). Pure and deterministic: the same input always gives the same state.
 */
export function resolveBracket(plan: Plan, seeds: Array<string | null>, results: Record<string, SlotResult>): Record<string, SlotState> {
  const byKey = new Map(plan.slots.map((s) => [s.key, s]));
  const gfKey = plan.slots.find((s) => s.bracket === 'GF' && !s.conditional)?.key ?? 'GF';
  const memo = new Map<string, SlotState>();
  const visiting = new Set<string>();
  const source = (s: SlotSource): Resolved => {
    switch (s.kind) {
      case 'seed':
        return seeds[s.seed - 1] ?? 'BYE';
      case 'participant':
        return s.id;
      case 'bye':
        return 'BYE';
      case 'winner':
        return state(s.slot).winner;
      case 'loser':
        return state(s.slot).loser;
      case 'group_rank':
        return null; // filled by the mixed/groups adapter before resolution
    }
  };
  const state = (key: string): SlotState => {
    const hit = memo.get(key);
    if (hit) return hit;
    if (visiting.has(key)) throw new EngineError('INPUT_INVALID', `cycle in bracket at ${key}`);
    visiting.add(key);
    const slot = byKey.get(key);
    if (!slot) throw new EngineError('INPUT_INVALID', `unknown slot ${key}`);
    const ps = slot.sources.map(source);
    let st: SlotState;
    const r = results[key];
    if (slot.conditional === 'reset') {
      const gf = state(gfKey);
      if (gf.status !== 'done' && gf.status !== 'auto_advance') st = { key, participants: ps, status: 'waiting', winner: null, loser: null };
      else if (gf.winner === ps[0] || gf.status === 'auto_advance') st = { key, participants: ps, status: 'not_needed', winner: gf.winner, loser: gf.loser };
      else st = decide(key, ps, r);
    } else st = decide(key, ps, r);
    visiting.delete(key);
    memo.set(key, st);
    return st;
  };
  for (const s of plan.slots) state(s.key);
  return Object.fromEntries(memo);
}

function decide(key: string, ps: Resolved[], r: SlotResult | undefined): SlotState {
  const [a, b] = ps;
  if (a === null || b === null) {
    // a known bye on one side still has to wait for the other side to be known
    return { key, participants: ps, status: 'waiting', winner: null, loser: null };
  }
  if (a === 'BYE' && b === 'BYE') return { key, participants: ps, status: 'auto_advance', winner: 'BYE', loser: 'BYE' };
  if (a === 'BYE') return { key, participants: ps, status: 'auto_advance', winner: b!, loser: 'BYE' };
  if (b === 'BYE') return { key, participants: ps, status: 'auto_advance', winner: a!, loser: 'BYE' };
  if (a === b) throw new EngineError('INPUT_INVALID', `participant ${a} would play itself in ${key}`);
  if (!r) return { key, participants: ps, status: 'ready', winner: null, loser: null };
  if (r.kind === 'double_forfeit') return { key, participants: ps, status: 'done', winner: 'BYE', loser: 'BYE' };
  if (r.kind !== 'win') throw new EngineError('INPUT_INVALID', `elimination slot ${key} needs a winner (draws are not allowed)`);
  const w = r.winner === 0 ? a! : b!;
  return { key, participants: ps, status: 'done', winner: w, loser: w === a ? b! : a! };
}

/** Final placement from the bracket: later elimination ranks higher; same elimination stage shares the rank. */
export function eliminationStandings(plan: Plan, states: Record<string, SlotState>): StandingRow[] {
  const depth = (s: Slot) => {
    if (s.bracket === 'W') return plan.format === 'double_elim' ? 0 : s.round * 10;
    if (s.bracket === 'P3') return (s.round - 1) * 10 + 5;
    if (s.bracket === 'L') return s.round * 10;
    return 1000 + s.round * 10; // GF, GF2
  };
  const routed = new Set<string>();
  for (const s of plan.slots) for (const src of s.sources) if (src.kind === 'loser' || src.kind === 'winner') routed.add(`${src.kind}:${src.slot}`);
  const played = (st: SlotState | undefined) => !!st && (st.status === 'done' || st.status === 'auto_advance');
  const best = new Map<string, number>();
  const note = (id: Resolved, d: number) => {
    if (id && id !== 'BYE') best.set(id, Math.max(best.get(id) ?? -1, d));
  };
  for (const s of plan.slots) {
    const st = states[s.key];
    if (!played(st)) continue;
    if (!routed.has(`loser:${s.key}`)) note(st!.loser, depth(s));
    if (s.bracket === 'P3') note(st!.winner, depth(s) + 1);
  }
  // champion: winner of the terminal match (GF2 when played, GF when the reset is not needed, else the final)
  // located by role, not by key text: mixed stages prefix keys with their phase ("P2:W2-1")
  let champion: Resolved;
  const slotOf = (pred: (s: Slot) => boolean) => plan.slots.find(pred);
  const gf = states[slotOf((s) => s.bracket === 'GF' && !s.conditional)?.key ?? ''];
  const gf2 = states[slotOf((s) => s.bracket === 'GF' && s.conditional === 'reset')?.key ?? ''];
  if (gf2) champion = gf2.status === 'done' || gf2.status === 'not_needed' ? gf2.winner : null;
  else if (gf) champion = played(gf) ? gf.winner : null;
  else {
    const rounds = Math.max(...plan.slots.filter((s) => s.bracket === 'W').map((s) => s.round));
    const final = states[slotOf((s) => s.bracket === 'W' && s.round === rounds)?.key ?? ''];
    champion = played(final) ? final!.winner : null;
  }
  const rows: StandingRow[] = [];
  if (champion && champion !== 'BYE') {
    best.delete(champion);
    rows.push({ id: champion, rank: 1, metrics: { depth: 1_000_000 }, unresolvedTie: false });
  }
  const sorted = [...best].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  for (const [id, d] of sorted) rows.push({ id, rank: rows.filter((r) => (r.metrics['depth'] ?? 0) > d).length + 1, metrics: { depth: d }, unresolvedTie: false });
  return rows;
}
