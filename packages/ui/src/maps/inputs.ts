import { normalizeDigits } from '@esp/contracts';
import { dateTag, dec, localeState, num, tr } from '../locale';
import type { IconName } from '../icons';

/* Section-local helpers of bundle.js 01-inputs (text matching, file sizes, FileUpload scan states, DateField calendar math). */

/** Input parsing only: Persian / Arabic-Indic digits → ASCII (display goes through fa / num). */
export const toAscii = (s: unknown): string => normalizeDigits(String(s ?? ''));
/** Normalise text for matching: digits to ASCII, Arabic ي/ك to Persian ی/ک, lower case, no ZWNJ. */
export const norm = (s: unknown): string => toAscii(s).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ').toLowerCase().trim();
export const pad2 = (n: number): string => (n < 10 ? '0' : '') + n;

export function sizeLabel(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024) return num(bytes) + tr(' بایت', ' B');
  if (bytes < 1024 * 1024) return num(Math.round(bytes / 1024)) + tr(' کیلوبایت', ' KB');
  return dec(Math.round(bytes / 104857.6) / 10) + tr(' مگابایت', ' MB');
}

/* ---------- FileUpload ---------- */
export type FileUploadScanState = 'pending' | 'clean' | 'infected' | 'failed' | 'skipped_dev';
type Pair = readonly [string, string];
export const SCAN: Record<FileUploadScanState, { tone: 'warning' | 'success' | 'danger' | 'neutral'; icon: IconName; label: Pair }> = {
  pending: { tone: 'warning', icon: 'clock', label: ['در حال بررسی', 'Scanning'] },
  clean: { tone: 'success', icon: 'check-circle', label: ['سالم', 'Clean'] },
  infected: { tone: 'danger', icon: 'alert', label: ['آلوده', 'Infected'] },
  failed: { tone: 'danger', icon: 'x-circle', label: ['ناموفق', 'Failed'] },
  skipped_dev: { tone: 'neutral', icon: 'info', label: ['بدون بررسی (محیط توسعه)', 'Not scanned (development)'] },
};
export const SCAN_NOTE: Partial<Record<FileUploadScanState, Pair>> = {
  pending: ['پس از بررسی امنیتی برای داوران قابل مشاهده است.', 'Visible to referees after the security scan.'],
  infected: ['فایل قرنطینه شد و برای کسی نمایش داده نمی‌شود.', 'The file was quarantined and is not shown to anyone.'],
  failed: ['بررسی انجام نشد؛ دوباره تلاش کنید.', 'The scan did not run; try again.'],
  skipped_dev: ['در محیط توسعه بررسی امنیتی انجام نمی‌شود.', 'Files are not scanned in the development environment.'],
};
export const trPair = (pair?: Pair): string => (pair ? tr(pair[0], pair[1]) : '');

/* ---------- DateField (Jalali in fa, Gregorian in en), Tehran time ---------- */
export type Cal = 'persian' | 'gregory';
export interface CalDay { cal: Cal; y: number; m: number; d: number }
export interface HM { hh: number; mm: number }
const TZ = 'Asia/Tehran';
export const DAY = 86400000;
const FMT = new Map<string, Intl.DateTimeFormat>();
function fmt(tag: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${tag}|${JSON.stringify(opts)}`;
  let f = FMT.get(k);
  if (!f) { f = new Intl.DateTimeFormat(tag, { timeZone: TZ, ...opts }); FMT.set(k, f); }
  return f;
}
function parts(f: Intl.DateTimeFormat, date: Date): Record<string, string> {
  const o: Record<string, string> = {};
  for (const x of f.formatToParts(date)) o[x.type] = x.value;
  return o;
}
/** Tehran calendar date of an instant in `cal`. */
export function calOf(cal: Cal, date: Date): CalDay {
  const o = parts(fmt(`en-US-u-ca-${cal}-nu-latn`, { year: 'numeric', month: 'numeric', day: 'numeric' }), date);
  return { cal, y: parseInt(o.year ?? '0', 10), m: parseInt(o.month ?? '0', 10), d: parseInt(o.day ?? '0', 10) };
}
type YMD = { y: number; m: number; d: number };
export const jCmp = (a: YMD, b: YMD): number => (a.y - b.y) || (a.m - b.m) || (a.d - b.d);
/** Noon UTC (15:30 Tehran) of the day y/m/d in `cal`. Persian: approximate, then walk to it with Intl. */
export function calDate(cal: Cal, y: number, m: number, d: number): Date {
  if (cal === 'gregory') return new Date(Date.UTC(y, m - 1, d, 12));
  let g = new Date(Date.UTC(y + 621, 2, 21, 12) + Math.round((m - 1) * 30.6 + d - 1) * DAY);
  const want = { y, m, d };
  let c: number;
  let guard = 0;
  while ((c = jCmp(calOf(cal, g), want)) !== 0 && guard++ < 60) g = new Date(g.getTime() + (c < 0 ? DAY : -DAY));
  return g;
}
export function monthLen(cal: Cal, y: number, m: number): number {
  if (cal === 'gregory') return new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = calDate(cal, y, m, 1);
  let n = 29;
  while (n < 31 && calOf(cal, new Date(first.getTime() + n * DAY)).m === m) n++;
  return n;
}
/** «چهارشنبه ۱۸ آذر ۱۴۰۵» / «Wednesday 9 December 2026». */
export function longText(date: Date): string {
  const f = fmt(dateTag(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (localeState.locale === 'en') return f.format(date);
  const o = parts(f, date);
  return `${o.weekday} ${o.day} ${o.month} ${o.year}`;
}
/** «آذر ۱۴۰۵» / «December 2026». */
export function monthTitle(date: Date): string {
  const f = fmt(dateTag(), { month: 'long', year: 'numeric' });
  if (localeState.locale === 'en') return f.format(date);
  const o = parts(f, date);
  return `${o.month} ${o.year}`;
}
export const timeText = (date: Date): string => fmt(dateTag(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
export function hmOf(date: Date): HM {
  const o = parts(fmt('en-US-u-nu-latn', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), date);
  return { hh: parseInt(o.hour ?? '0', 10) % 24, mm: parseInt(o.minute ?? '0', 10) };
}
/** ISO for a Tehran wall time (Iran has used a fixed +03:30 offset since 2022). Date only → 'YYYY-MM-DD'. */
export function isoOf(j: CalDay, hm: HM | null): string {
  const g = calDate(j.cal, j.y, j.m, j.d);
  const day = `${g.getUTCFullYear()}-${pad2(g.getUTCMonth() + 1)}-${pad2(g.getUTCDate())}`;
  return hm ? `${day}T${pad2(hm.hh)}:${pad2(hm.mm)}:00+03:30` : day;
}
export function parseIso(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
// Column order: fa grid starts on Saturday, en grid on Monday. [initial, full name] per column.
export const WEEK_FA: readonly Pair[] = [['ش', 'شنبه'], ['ی', 'یکشنبه'], ['د', 'دوشنبه'], ['س', 'سه‌شنبه'], ['چ', 'چهارشنبه'], ['پ', 'پنجشنبه'], ['ج', 'جمعه']];
export const WEEK_EN: readonly Pair[] = [['M', 'Monday'], ['T', 'Tuesday'], ['W', 'Wednesday'], ['T', 'Thursday'], ['F', 'Friday'], ['S', 'Saturday'], ['S', 'Sunday']];
