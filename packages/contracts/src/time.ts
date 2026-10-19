import { z } from 'zod';

/**
 * DATA-004 / UX-004: storage is UTC (ISO-8601 'Z'); display is user time zone (default Asia/Tehran),
 * Persian calendar for the Persian locale. Digit normalization accepts Persian, Arabic-Indic and Latin digits.
 */
export const DEFAULT_TIME_ZONE = 'Asia/Tehran';
export type Locale = 'fa' | 'en';

/** Strict UTC instant string, e.g. 2026-10-18T09:30:00.000Z */
export const UtcInstantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'must be an ISO-8601 UTC instant ending with Z')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'invalid instant');

export const TimeZoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'unknown IANA time zone');

export function nowUtc(): string {
  return new Date().toISOString();
}

const digitMap: Record<string, string> = {};
for (let i = 0; i <= 9; i++) {
  digitMap['۰۱۲۳۴۵۶۷۸۹'[i]!] = String(i); // Persian
  digitMap['٠١٢٣٤٥٦٧٨٩'[i]!] = String(i); // Arabic-Indic
}
/** Normalizes any mixed-script digit string into ASCII digits. Also maps Arabic decimal/thousand separators. */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[۰-۹٠-٩]/g, (d) => digitMap[d] ?? d)
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

export function formatInstant(
  instant: string | Date,
  opts: { locale?: Locale; timeZone?: string; style?: 'date' | 'datetime' | 'time'; digits?: 'locale' | 'latn' } = {},
): string {
  const { locale = 'fa', timeZone = DEFAULT_TIME_ZONE, style = 'datetime', digits = 'locale' } = opts;
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const tag = locale === 'fa' ? `fa-IR-u-ca-persian-nu-${digits === 'latn' ? 'latn' : 'arabext'}` : 'en-GB-u-nu-latn';
  const base: Intl.DateTimeFormatOptions = { timeZone };
  const options: Intl.DateTimeFormatOptions =
    style === 'date'
      ? { ...base, year: 'numeric', month: 'long', day: 'numeric' }
      : style === 'time'
        ? { ...base, hour: '2-digit', minute: '2-digit' }
        : { ...base, year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat(tag, options).format(d);
}

/** Jalali (Persian calendar) parts for form inputs, derived from the platform Intl implementation (no third-party calendar lib). */
export function toJalaliParts(instant: string | Date, timeZone = DEFAULT_TIME_ZONE): { year: number; month: number; day: number } {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * Converts a wall-clock time typed in a form (`YYYY-MM-DDTHH:mm`, e.g. from <input type="datetime-local">) in the
 * given IANA zone to a UTC instant. The browser's own zone is irrelevant: an organizer abroad still means Tehran time.
 */
export function zonedWallTimeToUtc(local: string, timeZone = DEFAULT_TIME_ZONE): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(normalizeDigits(local));
  if (!m) throw new Error('expected YYYY-MM-DDTHH:mm');
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const offsetAt = (ms: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p['year']!, +p['month']! - 1, +p['day']!, +p['hour']!, +p['minute']!, +p['second']!) - ms;
  };
  // second pass corrects the offset when the first guess lands across a DST change
  return new Date(wall - offsetAt(wall - offsetAt(wall))).toISOString();
}
