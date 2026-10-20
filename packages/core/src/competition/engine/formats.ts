import { assertRules, type RuleValues } from './rules.js';
import { doubleElimination, singleElimination } from './elimination.js';
import { groupStage, roundRobin } from './table.js';
import { swissPair } from './swiss.js';
import { multiLobbyPlan } from './lobby.js';
import { ENGINE_VERSION, EngineError, type FormatId, type Plan } from './types.js';

/**
 * Format adapter registry (FMT-001). Each adapter: rules validation → plan generation; resolution, advancement and
 * standings live in the family modules (elimination.ts, table.ts, swiss.ts, lobby.ts, record.ts, ladder.ts).
 * A format is only "available" here when generator, validator, advancement and standings all exist.
 */
export const FORMATS: Record<FormatId, { label: string; generator: string; standings: string }> = {
  single_elim: { label: 'Single elimination', generator: 'singleElimination', standings: 'eliminationStandings' },
  double_elim: { label: 'Double elimination', generator: 'doubleElimination', standings: 'eliminationStandings' },
  round_robin: { label: 'Round robin', generator: 'roundRobin', standings: 'tableStandings' },
  groups: { label: 'Groups', generator: 'groupStage', standings: 'tableStandings per group' },
  swiss: { label: 'Swiss', generator: 'swissPair per round', standings: 'tableStandings' },
  ladder: { label: 'Ladder', generator: 'challenges', standings: 'ladder positions' },
  multi_lobby: { label: 'Multi-lobby', generator: 'lobbyRound per round', standings: 'lobbyStandings' },
  record: { label: 'Record', generator: 'attempts', standings: 'recordStandings' },
  time_trial: { label: 'Time trial', generator: 'attempts', standings: 'timeTrialStandings' },
  mixed: { label: 'Mixed (phases)', generator: 'phase adapters', standings: 'phase standings' },
};

export interface MixedPhase {
  key: string;
  format: Exclude<FormatId, 'mixed'>;
  /** participants advancing to the next phase; groups use perGroup + bestRemaining */
  advance: { perGroup?: number; bestRemaining?: number; top?: number } | null;
}

export function generatePlan(format: FormatId, input: { order: string[]; groups?: Record<string, string[]> }, rules: RuleValues): Plan {
  assertRules(format, rules);
  const n = input.order.length;
  switch (format) {
    case 'single_elim':
      return singleElimination(n, { thirdPlace: rules['elim.third_place'] === true });
    case 'double_elim':
      return doubleElimination(n, { grandFinal: rules['elim.grand_final'] as 'reset' | 'single' });
    case 'round_robin':
      return roundRobin(input.order, rules['rr.legs'] as number);
    case 'groups':
      if (!input.groups) throw new EngineError('INPUT_INVALID', 'groups need a group draw first');
      return groupStage(input.groups, rules['rr.legs'] as number);
    case 'swiss': {
      if (n < 2) throw new EngineError('INPUT_INVALID', 'Swiss needs at least 2 participants');
      const r = swissPair({ ids: input.order, points: {}, played: [], byes: [], method: rules['swiss.pairing'] as 'dutch' | 'monrad' });
      return {
        format, engine: ENGINE_VERSION, algorithm: `swiss/${rules['swiss.pairing'] as string}/1`, participants: n,
        slots: r.pairs.map(([a, b], i) => ({ key: `SW1-${i + 1}`, bracket: 'SW', round: 1, order: i + 1, sources: [{ kind: 'participant' as const, id: a }, { kind: 'participant' as const, id: b }] })),
        meta: { rounds: rules['swiss.rounds'], byes: r.bye ? { 1: r.bye } : {}, explanations: r.explanations.length ? { 1: r.explanations } : {} },
      };
    }
    case 'ladder':
      return { format, engine: ENGINE_VERSION, algorithm: 'ladder/challenge/1', participants: n, slots: [], meta: { ladder: input.order, range: rules['ladder.challenge_range'], onWin: rules['ladder.on_win'] } };
    case 'multi_lobby':
      return multiLobbyPlan(input.order, rules);
    case 'record':
    case 'time_trial':
      return { format, engine: ENGINE_VERSION, algorithm: `${format}/attempts/1`, participants: n, slots: [], meta: { entrants: input.order } };
    case 'mixed':
      throw new EngineError('INPUT_INVALID', 'a mixed stage generates each phase with that phase format (generatePhase)');
  }
}

/** Mixed stage: each phase is generated with its own adapter; slot keys are prefixed so phases never collide. */
export function generatePhase(phase: MixedPhase, index: number, input: { order: string[]; groups?: Record<string, string[]> }, rules: RuleValues): Plan {
  const p = generatePlan(phase.format, input, rules);
  return { ...p, format: 'mixed', algorithm: `mixed/${p.algorithm}`, slots: p.slots.map((s) => ({ ...s, key: `P${index + 1}:${s.key}`, sources: s.sources.map((src) => (src.kind === 'winner' || src.kind === 'loser' ? { ...src, slot: `P${index + 1}:${src.slot}` } : src)) })), meta: { ...p.meta, phase: index + 1, phaseKey: phase.key, phaseFormat: phase.format } };
}
