import { safeReturnPath } from '@esp/contracts';
import { normalizeDigits } from '@esp/contracts';

/** Persian/Arabic-Indic/Latin digits are processed identically (UX-004). */
export function isIranMobile(value: string): boolean {
  return /^09\d{9}$/.test(normalizeDigits(value.trim()));
}

export function isNonNegativeInt(value: string): boolean {
  return /^\d{1,15}$/.test(normalizeDigits(value.trim()));
}

/** Gregorian YYYY-MM-DD to a noon-UTC ISO instant (avoids a day shift in Asia/Tehran); null when invalid. */
export function dateToIso(value: string): string | null {
  const v = normalizeDigits(value.trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d.toISOString();
}

/** Strict UTC instant, e.g. 2026-12-31T00:00:00Z */
export function isUtcInstant(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** UX-007: only same-origin relative paths are honored after login (no open redirect). */
export function safeRedirect(value: unknown): string {
  // UX-007: one shared rule with the API (no scheme, no protocol-relative, no backslash, no control characters)
  return safeReturnPath(Array.isArray(value) ? value[0] : value);
}
