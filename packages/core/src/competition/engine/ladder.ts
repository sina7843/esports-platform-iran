import { EngineError } from './types.js';

/**
 * FMT-001 ladder: positions in seed order; a participant may challenge someone above within `ladder.challenge_range`
 * positions, one open challenge per participant. On a challenger win: `swap` exchanges the two positions, `insert`
 * puts the challenger in the defender's place and moves everyone in between down one.
 */
export function validateChallenge(ladder: string[], challenger: string, defender: string, range: number, open: Array<[string, string]>): void {
  const c = ladder.indexOf(challenger);
  const d = ladder.indexOf(defender);
  if (c < 0 || d < 0) throw new EngineError('INPUT_INVALID', 'both participants must be on the ladder');
  if (c === d) throw new EngineError('INPUT_INVALID', 'a participant cannot challenge itself');
  if (d > c) throw new EngineError('INPUT_INVALID', 'only a participant above can be challenged');
  if (c - d > range) throw new EngineError('INPUT_INVALID', `challenge range is ${range} positions`);
  if (open.some(([a, b]) => [a, b].includes(challenger) || [a, b].includes(defender))) throw new EngineError('INPUT_INVALID', 'one of the participants already has an open challenge');
}

export function applyChallenge(ladder: string[], challenger: string, defender: string, challengerWon: boolean, onWin: 'swap' | 'insert'): string[] {
  if (!challengerWon) return [...ladder];
  const out = [...ladder];
  const c = out.indexOf(challenger);
  const d = out.indexOf(defender);
  if (onWin === 'swap') [out[c], out[d]] = [out[d]!, out[c]!];
  else {
    out.splice(c, 1);
    out.splice(d, 0, challenger);
  }
  return out;
}
