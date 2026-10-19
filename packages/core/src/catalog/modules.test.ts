import { describe, expect, it } from 'vitest';
import { CompetitionFamilies, GameModuleDescriptorSchema } from '@esp/contracts';
import { gameModules, getGameModule, moduleFixtures } from './modules/index.js';

describe('game modules contract (GAME-005)', () => {
  it('has exactly one TEST ONLY module per competition family with a valid descriptor', () => {
    expect(Object.keys(gameModules).sort()).toEqual([...CompetitionFamilies].sort());
    for (const m of Object.values(gameModules)) {
      expect(GameModuleDescriptorSchema.safeParse(m.descriptor).success).toBe(true);
      expect(m.descriptor.testOnly).toBe(true);
      expect(m.descriptor.tieBreakOrder.length).toBeGreaterThan(0);
    }
    expect(getGameModule('__proto__')).toBeUndefined();
    expect(getGameModule('toString')).toBeUndefined();
  });

  it.each(CompetitionFamilies)('%s accepts valid and rejects contradictory fixtures', (family) => {
    const m = gameModules[family]!;
    const fx = moduleFixtures[family]!;
    for (const v of fx.valid) expect(m.validateResult(v), JSON.stringify(v)).toEqual({ ok: true, errors: [] });
    for (const v of fx.invalid) {
      const r = m.validateResult(v);
      expect(r.ok, JSON.stringify(v)).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    }
    expect(m.validateResult(null).ok).toBe(false);
  });

  it('ranks with documented tie-break and shared ranks', () => {
    const h = gameModules['head_to_head']!.rank([
      { a: 'x', b: 'y', scoreA: 2, scoreB: 0, winner: 'a' },
      { a: 'y', b: 'z', scoreA: 1, scoreB: 1, winner: 'draw' },
    ]);
    expect(h[0]!.id).toBe('x');
    const lobby = gameModules['multi_lobby']!.rank([{ placements: [{ id: 'p1', placement: 1, kills: 0 }, { id: 'p2', placement: 2, kills: 5 }] }]);
    expect(lobby[0]!.id).toBe('p2'); // synthetic points: 1+5 vs 2
    const tt = gameModules['time_trial']!.rank([{ id: 'a', timeMs: 1000, penaltyMs: 0, dnf: false }, { id: 'b', timeMs: null, penaltyMs: 0, dnf: true }, { id: 'c', timeMs: 900, penaltyMs: 200, dnf: false }]);
    expect(tt.map((r) => r.id)).toEqual(['a', 'c', 'b']);
    const tie = gameModules['score']!.rank([{ id: 'a', score: 5, maxScore: 10 }, { id: 'b', score: 5, maxScore: 10 }]);
    expect(tie.map((r) => r.rank)).toEqual([1, 1]);
  });
});
