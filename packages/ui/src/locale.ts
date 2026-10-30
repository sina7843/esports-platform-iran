import { computed, reactive } from 'vue';

/**
 * Locale, digits, numbers, money and dates — the Vue equivalent of the DS core helpers (bundle.js `Q.setLocale`, `Q.tr`,
 * `Q.fa`, `Q.num`, `Q.dec`, `Q.toman`, `Q.dateTag`, `Q.formatJalali`). State is reactive, so components re-render when the
 * language or the digit preference changes. Differences on purpose: `toman()` never rounds (DATA-005) and dates always go
 * through Intl with the product's `formatInstant` tags in Asia/Tehran.
 */
export type QLocale = 'fa' | 'en';
export type QDigits = 'fa' | 'latn';

export const localeState = reactive<{ locale: QLocale; digits: QDigits }>({ locale: 'fa', digits: 'fa' });

export function setLocale(locale: QLocale | string, opts: { digits?: QDigits | string; keepDocument?: boolean } = {}): void {
  localeState.locale = locale === 'en' ? 'en' : 'fa';
  localeState.digits = localeState.locale === 'en' ? 'latn' : opts.digits === 'latn' ? 'latn' : 'fa';
  if (typeof document !== 'undefined' && !opts.keepDocument) {
    document.documentElement.lang = localeState.locale;
    document.documentElement.dir = dir();
  }
}

export const dir = (): 'rtl' | 'ltr' => (localeState.locale === 'en' ? 'ltr' : 'rtl');
export const isRtl = (): boolean => localeState.locale !== 'en';

/** Pick the string for the current locale: tr('ثبت‌نام', 'Register'). Falls back to Persian. */
export function tr(fa: string, en?: string | null): string {
  return localeState.locale === 'en' && en != null ? en : fa;
}

/** Intl tag for dates, matching formatInstant() in @esp/contracts. */
export function dateTag(): string {
  return localeState.locale === 'en' ? 'en-GB-u-nu-latn' : `fa-IR-u-ca-persian-nu-${localeState.digits === 'latn' ? 'latn' : 'arabext'}`;
}

const FA = '۰۱۲۳۴۵۶۷۸۹';
/** Digits only (years, codes, scores): «۱۴۰۵» in fa, Latin when the user chose Latin digits or in en. */
export function fa(v: unknown): string {
  const s = String(v ?? '');
  if (localeState.digits === 'latn') return s.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)));
  return s.replace(/[0-9]/g, (d) => FA[Number(d)] ?? d);
}

function group(intDigits: string, sep: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Grouped integer: «۱۲۰٬۰۰۰» (fa) · «120,000» (fa + Latin digits, and en). */
export function num(n: number): string {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return '';
  const neg = x < 0 ? '-' : '';
  const body = String(Math.abs(x));
  if (localeState.locale === 'en' || localeState.digits === 'latn') return neg + group(body, ',');
  return fa(neg + group(body, '٬'));
}

/** Locale decimal: «۰٫۰۶» / «0.06», grouped like num(). `digits` fixes the decimals; omitted → up to 2, trailing zeros dropped. */
export function dec(n: number | string | null | undefined, digits?: number): string {
  if (n == null || n === '') return '';
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  const max = digits ?? 2;
  let fixed = Math.abs(x).toFixed(max); // the one place a fixed-point conversion is allowed (DS helper)
  if (digits == null) fixed = fixed.replace(/\.?0+$/, '');
  const [i = '0', f] = fixed.split('.');
  const neg = x < 0 && Number(fixed) !== 0 ? '-' : '';
  if (localeState.locale === 'en' || localeState.digits === 'latn') return neg + group(i, ',') + (f ? `.${f}` : '');
  return fa(neg + group(i, '٬') + (f ? `٫${f}` : ''));
}

/** Integer rial → «۱۲۰٬۰۰۰ تومان» / «120,000 Toman». Never rounds: a rial remainder is shown («… و ۵ ریال»), like formatToman. */
export function toman(rial: number): string {
  const r = Math.trunc(Number(rial) || 0);
  const t = Math.trunc(r / 10);
  const rest = Math.abs(r % 10);
  const base = num(t) + tr(' تومان', ' Toman');
  return rest === 0 ? base : `${base} ${tr('و', 'and')} ${fa(rest)} ${tr('ریال', 'Rial')}`;
}

/* ---------- dates ---------- */
export const TIME_ZONE = 'Asia/Tehran';
export type DateFormat = 'date' | 'dateShort' | 'numeric' | 'time' | 'datetime' | 'relative';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(opts: Intl.DateTimeFormatOptions, tz: string): Intl.DateTimeFormat {
  const tag = dateTag();
  const k = tag + JSON.stringify(opts) + tz;
  let f = fmtCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat(tag, { timeZone: tz, ...opts }); fmtCache.set(k, f); }
  return f;
}
const REL: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
function relative(ms: number, now: number): string {
  const diff = (ms - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return tr('همین حالا', 'just now');
  for (let i = 0; i < REL.length; i++) {
    const [unit, sec] = REL[i]!;
    if (abs >= sec * 0.95 || i === REL.length - 1) {
      const n = Math.max(1, Math.round(abs / sec)) * (diff < 0 ? -1 : 1);
      return fa(new Intl.RelativeTimeFormat(dateTag(), { numeric: 'auto' }).format(n, unit));
    }
  }
  return '';
}

/** ISO instant → locale text in Tehran time: Jalali + Persian digits in fa, Gregorian en-GB in en. Empty → «—». */
export function formatJalali(
  iso: string | Date | null | undefined,
  format: DateFormat = 'datetime',
  opts: { now?: string | number | Date; timeZone?: string } = {},
): string {
  if (iso == null || iso === '') return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const tz = opts.timeZone ?? TIME_ZONE;
  switch (format) {
    case 'date': return dtf({ year: 'numeric', month: 'long', day: 'numeric' }, tz).format(d);
    case 'dateShort': return dtf({ month: 'long', day: 'numeric' }, tz).format(d);
    case 'numeric': return dtf({ year: 'numeric', month: '2-digit', day: '2-digit' }, tz).format(d);
    case 'time': return dtf({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, tz).format(d);
    case 'relative': return relative(d.getTime(), opts.now != null ? +new Date(opts.now) : Date.now());
    default: return dtf({ year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, tz).format(d);
  }
}
export const formatDate = formatJalali;

/** Class-string builder (DS `Q.cx`). */
export function cx(...parts: unknown[]): string {
  return parts.filter(Boolean).join(' ');
}

/** For views: reactive locale state plus the helpers. */
export function useLocale() {
  return {
    locale: computed(() => localeState.locale),
    digits: computed(() => localeState.digits),
    dir: computed(dir),
    isRtl: computed(isRtl),
    tr, fa, num, dec, toman, dateTag, formatJalali, formatDate, cx,
  };
}
