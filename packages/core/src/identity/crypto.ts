import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

/** Credential primitives on node:crypto only (no extra dependencies). */

export const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const hmacHex = (key: string, data: string): string => createHmac('sha256', key).update(data).digest('hex');

export const newOtpCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

// ---- passwords: scrypt, stored as `salt$hash` (hex)
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}$${scryptSync(password, salt, 64, SCRYPT).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string | null): boolean {
  // always spend the scrypt cost, even for unknown accounts (no timing oracle for enumeration)
  const [saltHex, hashHex] = (stored ?? `${'00'.repeat(16)}$${'00'.repeat(64)}`).split('$');
  const got = scryptSync(password, Buffer.from(saltHex!, 'hex'), 64, SCRYPT);
  const ok = timingSafeEqual(got, Buffer.from(hashHex!, 'hex'));
  return ok && stored !== null;
}

// ---- TOTP (RFC 6238 / RFC 4226, HMAC-SHA1, 6 digits, 30 s)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}
export const totpAt = (secret: Buffer, nowMs = Date.now()): string => hotp(secret, Math.floor(nowMs / 30_000));
/** ±1 step window (clock drift); all three candidates are compared so timing does not reveal which matched. */
export function verifyTotp(secret: Buffer, code: string, nowMs = Date.now()): boolean {
  return totpMatchStep(secret, code, nowMs) !== null;
}
/** Returns the matched time step (for replay protection) or null. */
export function totpMatchStep(secret: Buffer, code: string, nowMs = Date.now()): number | null {
  const step = Math.floor(nowMs / 30_000);
  let matched: number | null = null;
  for (const d of [-1, 0, 1]) if (safeEqual(hotp(secret, step + d), code)) matched = step + d;
  return matched;
}
export const newTotpSecret = (): string => base32Encode(randomBytes(20));
export const otpauthUri = (secretB32: string, label: string, issuer = 'Esports Platform'): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---- AES-256-GCM secret box; key derived from APP_SECRET (HKDF)
const boxKey = (appSecret: string) => Buffer.from(hkdfSync('sha256', appSecret, 'esp-salt-v1', 'esp-totp-secret-v1', 32));
export function seal(appSecret: string, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', boxKey(appSecret), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
}
export function unseal(appSecret: string, boxed: string): string {
  const [iv, tag, ct] = boxed.split('.').map((p) => Buffer.from(p, 'base64url')) as [Buffer, Buffer, Buffer];
  const d = createDecipheriv('aes-256-gcm', boxKey(appSecret), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => `${randomBytes(4).toString('hex')}-${randomBytes(4).toString('hex')}`);
}
