import { EngineError, type FormatId } from './types.js';

/**
 * FMT-002/003/004: every scoring, tie-break and structural value comes from the frozen ruleset (plus organizer
 * settings inside the clause bounds). Nothing is defaulted here: a missing key is refused up front, or — for keys
 * only needed when an event happens (a forfeit, a withdrawal) — referred to an official at that moment.
 */
export type RuleValues = Record<string, unknown>;

export const TIEBREAKS = ['points', 'wins', 'head_to_head', 'score_diff', 'score_for', 'map_diff', 'maps_won', 'buchholz', 'median_buchholz', 'sonneborn_berger', 'seed'] as const;
export type Tiebreak = (typeof TIEBREAKS)[number];
export const LOBBY_TIEBREAKS = ['total_points', 'wins', 'best_placement', 'kills', 'last_round_placement', 'seed'] as const;

type Spec = { type: 'int' | 'bool' | 'enum' | 'int_array' | 'enum_array'; min?: number; options?: readonly string[] };
const SPEC: Record<string, Spec> = {
  'points.win': { type: 'int', min: 0 },
  'points.draw': { type: 'int', min: 0 },
  'points.loss': { type: 'int', min: 0 },
  'points.forfeit_win': { type: 'int', min: 0 },
  'points.forfeit_loss': { type: 'int' },
  'tiebreak.order': { type: 'enum_array', options: TIEBREAKS },
  'forfeit.score': { type: 'int_array', min: 0 },
  'withdrawal.previous_results': { type: 'enum', options: ['keep', 'void'] },
  'noshow.double': { type: 'enum', options: ['both_loss', 'replay', 'referee'] },
  'elim.third_place': { type: 'bool' },
  'elim.grand_final': { type: 'enum', options: ['reset', 'single'] },
  'rr.legs': { type: 'int', min: 1 },
  'groups.count': { type: 'int', min: 1 },
  'groups.advance_per_group': { type: 'int', min: 1 },
  'groups.best_remaining': { type: 'int', min: 0 },
  'swiss.rounds': { type: 'int', min: 1 },
  'swiss.pairing': { type: 'enum', options: ['dutch', 'monrad'] },
  'swiss.bye_points': { type: 'int', min: 0 },
  'ladder.challenge_range': { type: 'int', min: 1 },
  'ladder.on_win': { type: 'enum', options: ['swap', 'insert'] },
  'lobby.size': { type: 'int', min: 2 },
  'lobby.rounds': { type: 'int', min: 1 },
  'lobby.placement_points': { type: 'int_array', min: 0 },
  'lobby.kill_points': { type: 'int', min: 0 },
  'lobby.tiebreak': { type: 'enum_array', options: LOBBY_TIEBREAKS },
  'lobby.assignment': { type: 'enum', options: ['snake_by_seed', 'reseed_by_standings'] },
  'record.better': { type: 'enum', options: ['higher', 'lower'] },
  'record.precision': { type: 'int', min: 0 },
  'record.max_attempts': { type: 'int', min: 1 },
  'record.tiebreak': { type: 'enum', options: ['second_best', 'earliest', 'shared'] },
  'time.max_attempts': { type: 'int', min: 1 },
  'time.tiebreak': { type: 'enum', options: ['second_best', 'shared'] },
  'draw.separate_by': { type: 'enum', options: ['none', 'region', 'club'] },
};

/** Keys a format cannot even generate or rank without. */
export const REQUIRED: Record<FormatId, string[]> = {
  single_elim: ['elim.third_place'],
  double_elim: ['elim.grand_final'],
  round_robin: ['rr.legs', 'points.win', 'points.draw', 'points.loss', 'tiebreak.order'],
  groups: ['groups.count', 'groups.advance_per_group', 'rr.legs', 'points.win', 'points.draw', 'points.loss', 'tiebreak.order'],
  swiss: ['swiss.rounds', 'swiss.pairing', 'points.win', 'points.draw', 'points.loss', 'tiebreak.order'],
  ladder: ['ladder.challenge_range', 'ladder.on_win'],
  multi_lobby: ['lobby.size', 'lobby.rounds', 'lobby.placement_points', 'lobby.kill_points', 'lobby.tiebreak', 'lobby.assignment'],
  record: ['record.better', 'record.precision', 'record.max_attempts', 'record.tiebreak'],
  time_trial: ['time.max_attempts', 'time.tiebreak'],
  mixed: [],
};

export function validateRules(format: FormatId, values: RuleValues): { ok: boolean; missing: string[]; invalid: Array<{ key: string; message: string }> } {
  const missing = REQUIRED[format].filter((k) => values[k] === undefined || values[k] === null);
  const invalid: Array<{ key: string; message: string }> = [];
  for (const [k, v] of Object.entries(values)) {
    const s = SPEC[k];
    if (!s || v === undefined || v === null) continue;
    const bad = (message: string) => invalid.push({ key: k, message });
    if (s.type === 'int' && (!Number.isInteger(v) || (s.min !== undefined && (v as number) < s.min))) bad(`must be an integer${s.min !== undefined ? ` >= ${s.min}` : ''}`);
    if (s.type === 'bool' && typeof v !== 'boolean') bad('must be true or false');
    if (s.type === 'enum' && !s.options!.includes(String(v))) bad(`must be one of ${s.options!.join(', ')}`);
    if (s.type === 'int_array' && (!Array.isArray(v) || !v.every((x) => Number.isInteger(x) && (s.min === undefined || (x as number) >= s.min)))) bad('must be a list of integers');
    if (s.type === 'enum_array' && (!Array.isArray(v) || v.length === 0 || !v.every((x) => s.options!.includes(String(x))))) bad(`must be a non-empty list of ${s.options!.join(', ')}`);
  }
  if (format === 'multi_lobby' && Array.isArray(values['lobby.placement_points']) && Number.isInteger(values['lobby.size']) && (values['lobby.placement_points'] as number[]).length < (values['lobby.size'] as number)) {
    invalid.push({ key: 'lobby.placement_points', message: 'needs one value per placement up to lobby.size' });
  }
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

export function assertRules(format: FormatId, values: RuleValues): void {
  const r = validateRules(format, values);
  if (r.missing.length) throw new EngineError('RULE_MISSING', `ruleset lacks ${r.missing.join(', ')} for ${format}`, { missing: r.missing });
  if (r.invalid.length) throw new EngineError('RULE_INVALID', `invalid rule values: ${r.invalid.map((i) => `${i.key} ${i.message}`).join('; ')}`, { invalid: r.invalid });
}

/** Read a rule needed only when a specific event happens; absence refers the decision to an official. */
export function ruleAtUse<T>(values: RuleValues, key: string, situation: string): T {
  const v = values[key];
  if (v === undefined || v === null) throw new EngineError('NEEDS_REVIEW', `no rule "${key}" for ${situation}; an official must decide`, { key, situation });
  return v as T;
}

export const int = (values: RuleValues, key: string) => values[key] as number;
