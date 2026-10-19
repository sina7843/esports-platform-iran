import { randomBytes } from 'node:crypto';

/**
 * Stable, sortable identifiers (ULID layout: 48-bit ms timestamp + 80-bit randomness, Crockford base32).
 * Used for every domain entity so ids sort by creation time and never collide across collections.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now: number = Date.now()): string {
  let time = now;
  let t = '';
  for (let i = 0; i < 10; i++) {
    t = ALPHABET[time % 32] + t;
    time = Math.floor(time / 32);
  }
  const rnd = randomBytes(16);
  let r = '';
  for (let i = 0; i < 16; i++) r += ALPHABET[rnd[i]! % 32];
  return t + r;
}

export function newId(prefix?: string): string {
  return prefix ? `${prefix}_${ulid()}` : ulid();
}
