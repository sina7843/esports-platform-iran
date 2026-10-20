/**
 * Competition engine data model (FMT, DRAW). Pure data: no database, no clock, no Math.random.
 * A plan is a list of slots. A slot is one match (two sources) or one lobby (n sources). Sources point at seeds,
 * fixed participants, winners/losers of earlier slots, group ranks, or byes, so advancement has explicit provenance.
 */
export const ENGINE_VERSION = 'esp-engine/1.0.0';

export type FormatId = 'single_elim' | 'double_elim' | 'round_robin' | 'groups' | 'swiss' | 'ladder' | 'multi_lobby' | 'record' | 'time_trial' | 'mixed';

export type SlotSource =
  | { kind: 'seed'; seed: number } // 1-based seed position from the draw
  | { kind: 'participant'; id: string }
  | { kind: 'winner'; slot: string }
  | { kind: 'loser'; slot: string }
  | { kind: 'group_rank'; group: string; rank: number }
  | { kind: 'bye' };

export interface Slot {
  key: string;
  /** W / L (double elimination), GF / GF2 (grand final and reset), P3 (third place), RR, G-<group>, SW, LB (lobby) */
  bracket: string;
  round: number;
  order: number;
  sources: SlotSource[];
  group?: string;
  leg?: number;
  /** GF2 is played only when the losers-bracket finalist wins GF and the rules say "reset". */
  conditional?: 'reset';
}

export interface Plan {
  format: FormatId;
  engine: string;
  algorithm: string;
  participants: number;
  slots: Slot[];
  groups?: Record<string, string[]>;
  meta: Record<string, unknown>;
}

/** Recorded outcome of one slot. `index` refers to the slot's sources order. */
export type SlotResult =
  | { kind: 'win'; winner: number; scores?: [number, number] | undefined; maps?: [number, number] | undefined; forfeit?: boolean | undefined }
  | { kind: 'draw'; scores?: [number, number] | undefined; maps?: [number, number] | undefined }
  | { kind: 'double_forfeit' }
  | { kind: 'placements'; placements: Array<{ id: string; placement: number; kills: number }> };

export type Resolved = string | 'BYE' | null; // participant id, an empty position, or not yet known

export interface SlotState {
  key: string;
  participants: Resolved[];
  status: 'waiting' | 'ready' | 'auto_advance' | 'done' | 'not_needed';
  winner: Resolved;
  loser: Resolved;
}

export interface StandingRow {
  id: string;
  rank: number;
  metrics: Record<string, number>;
  /** Equal on every rule criterion: the rules must say extra match / official decision (15.5 "تساوی کامل"). */
  unresolvedTie: boolean;
  group?: string;
}

export class EngineError extends Error {
  constructor(
    readonly code: 'RULE_MISSING' | 'RULE_INVALID' | 'INPUT_INVALID' | 'NEEDS_REVIEW' | 'CONSTRAINT_UNSATISFIABLE',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
