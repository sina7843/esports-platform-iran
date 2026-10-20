import { describe, expect, it } from 'vitest';
import { decay, glicko2 } from './glicko2.js';

describe('Glicko-2 (RANK-002 proposal)', () => {
  it("matches Glickman's worked example", () => {
    const r = glicko2({ rating: 1500, rd: 200, vol: 0.06 }, [
      { rating: 1400, rd: 30, score: 1 },
      { rating: 1550, rd: 100, score: 0 },
      { rating: 1700, rd: 300, score: 0 },
    ], 0.5);
    expect(r.rating).toBeCloseTo(1464.06, 1);
    expect(r.rd).toBeCloseTo(151.52, 1);
    expect(r.vol).toBeCloseTo(0.05999, 4);
  });
  it('an empty period only widens the deviation; decay is capped', () => {
    const s = glicko2({ rating: 1600, rd: 50, vol: 0.06 }, [], 0.5);
    expect(s.rating).toBe(1600);
    expect(s.rd).toBeGreaterThan(50);
    expect(decay({ rating: 1600, rd: 340, vol: 0.06 }, 100, 350).rd).toBe(350);
  });
});
