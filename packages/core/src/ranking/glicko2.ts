/**
 * Glicko-2 (Glickman, "Example of the Glicko-2 system", 2013). PROPOSAL ONLY: no rating system is called official
 * until the competition owner approves it (RANK-006). Pure functions; integer-free on purpose (ratings are floats and
 * are rounded only for display).
 */
export interface GlickoState {
  rating: number;
  rd: number;
  vol: number;
}
export interface GlickoResult {
  rating: number;
  rd: number;
  score: number; // 1 win, 0.5 draw, 0 loss
}

const SCALE = 173.7178;
const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu: number, muj: number, phij: number) => 1 / (1 + Math.exp(-g(phij) * (mu - muj)));

/** One rating period. No games → only the deviation grows. */
export function glicko2(player: GlickoState, results: GlickoResult[], tau: number, epsilon = 0.000001): GlickoState {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.vol;
  if (!results.length) return { rating: player.rating, rd: Math.sqrt(phi * phi + sigma * sigma) * SCALE, vol: sigma };
  let vInv = 0;
  let sum = 0;
  for (const r of results) {
    const muj = (r.rating - 1500) / SCALE;
    const phij = r.rd / SCALE;
    const e = E(mu, muj, phij);
    vInv += g(phij) ** 2 * e * (1 - e);
    sum += g(phij) * (r.score - e);
  }
  const v = 1 / vInv;
  const delta = v * sum;
  const a = Math.log(sigma * sigma);
  const f = (x: number) => (Math.exp(x) * (delta * delta - phi * phi - v - Math.exp(x))) / (2 * (phi * phi + v + Math.exp(x)) ** 2) - (x - a) / (tau * tau);
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > epsilon) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else fA /= 2;
    B = C;
    fB = fC;
  }
  const sigmaNew = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + sigmaNew * sigmaNew);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * sum;
  return { rating: muNew * SCALE + 1500, rd: phiNew * SCALE, vol: sigmaNew };
}

/** Inactivity: each whole empty period grows the deviation (capped at the initial deviation). */
export function decay(s: GlickoState, emptyPeriods: number, maxRd: number): GlickoState {
  if (emptyPeriods <= 0) return s;
  const phi = s.rd / SCALE;
  return { ...s, rd: Math.min(maxRd, Math.sqrt(phi * phi + emptyPeriods * s.vol * s.vol) * SCALE) };
}
