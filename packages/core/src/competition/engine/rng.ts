import { createHash } from 'node:crypto';

/**
 * DRAW-001/003: reproducible randomness. A draw stores its seed string; replaying the same seed over the same input
 * snapshot yields the same result. sfc32 seeded from SHA-256 of the seed string (no Math.random anywhere in the engine).
 */
export function rngFrom(seed: string): () => number {
  const h = createHash('sha256').update(seed).digest();
  let a = h.readUInt32LE(0), b = h.readUInt32LE(4), c = h.readUInt32LE(8), d = h.readUInt32LE(12);
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with the seeded generator; returns a new array. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * FMT-003: exact decimal values without float ambiguity. "12.340" with 3 decimals → 12340 (scaled integer).
 * More digits than the declared precision is an error, never silently rounded.
 */
export function parseDecimal(input: string | number, decimals: number): number {
  const s = String(input).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`not a decimal number: ${s}`);
  const frac = m[3] ?? '';
  if (frac.length > decimals) throw new Error(`more than ${decimals} decimal places: ${s}`);
  const v = Number(m[2]! + frac.padEnd(decimals, '0'));
  if (!Number.isSafeInteger(v)) throw new Error(`value out of range: ${s}`);
  return m[1] === '-' ? -v : v;
}

export function formatDecimal(scaled: number, decimals: number): string {
  if (decimals === 0) return String(scaled);
  const neg = scaled < 0;
  const s = String(Math.abs(scaled)).padStart(decimals + 1, '0');
  return `${neg ? '-' : ''}${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}
