/** Tables and helpers of the DS `06-people` section (bundle.js), shared by the people / registration / receipt components. */
import { fa, formatJalali, localeState, num, tr } from '../locale';
import type { IconName } from '../icons';

export type PeopleTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'live' | 'red' | 'green';
export type Pair = readonly [string, string];
export interface StateEntry { label: Pair; tone: PeopleTone; icon?: IconName }

/** Resolve a built-in label: ['fa', 'en'] pairs are picked for the current locale at render time. */
export const tx = (v: Pair | string | undefined): string => (Array.isArray(v) ? tr(v[0], v[1]) : (v as string | undefined) ?? '');

/** Count with a unit: «۷ عضو» / «7 members» (en singular when n is 1). */
export function cnt(n: number, faUnit: string, one: string, many?: string): string {
  const s = num(n);
  return tr(`${s} ${faUnit}`, `${s} ${n === 1 ? one : many || `${one}s`}`);
}

/** DS fmtDate kinds → formatJalali formats (Asia/Tehran). Empty → ''. */
export function fmtDate(iso: string | undefined, kind: 'date' | 'short' | 'time' | 'datetime' = 'date'): string {
  if (!iso) return '';
  if (Number.isNaN(new Date(iso).getTime())) return fa(iso);
  return formatJalali(iso, kind === 'short' ? 'dateShort' : kind);
}

/** Dotted clause numbers: «۴٫۲» with Persian digits, «4.2» otherwise. */
export const dotted = (s: string | number): string => (localeState.digits === 'fa' ? fa(String(s)).replace(/\./g, '٫') : fa(String(s)));

export const firstChar = (s?: string): string => (s ? (Array.from(String(s))[0] ?? '?') : '?');

/** Initial / logo crest attributes. cls carries the component prefix; chamfer is the Arena cut. */
export function crest(cls: string, size: number, chamfer: boolean) {
  return {
    class: [cls, chamfer ? (size >= 72 ? 'q-chamfer-lg' : size >= 48 ? 'q-chamfer-md' : 'q-chamfer-sm') : null],
    style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.42)}px` },
  };
}

/** Badge props for a state map entry; unknown keys fall back to a neutral badge with the raw key. */
export function stateBadge(map: Record<string, StateEntry>, state: string): { props: { tone: PeopleTone; icon?: IconName }; label: string } {
  const s = map[state];
  if (!s) return { props: { tone: 'neutral' }, label: state };
  return { props: s.icon ? { tone: s.tone, icon: s.icon } : { tone: s.tone }, label: tx(s.label) };
}

export const GID_STATES: Record<string, StateEntry> = {
  unverified: { label: ['تأییدنشده', 'Unverified'], tone: 'neutral', icon: 'minus' },
  pending: { label: ['در انتظار بررسی', 'Pending review'], tone: 'warning', icon: 'clock' },
  verified: { label: ['تأییدشده', 'Verified'], tone: 'success', icon: 'check-circle' },
  rejected: { label: ['ردشده', 'Rejected'], tone: 'danger', icon: 'x-circle' },
  disputed: { label: ['در اختلاف', 'Disputed'], tone: 'warning', icon: 'alert' },
};
export const ROLES: Record<string, Pair> = {
  owner: ['مالک', 'Owner'], manager: ['مدیر', 'Manager'], captain: ['کاپیتان', 'Captain'], player: ['بازیکن اصلی', 'Starter'],
  substitute: ['ذخیره', 'Substitute'], coach: ['مربی', 'Coach'], analyst: ['تحلیلگر', 'Analyst'],
};
export const RANK_TONE: Record<number, string> = { 1: 'gold', 2: 'silver', 3: 'bronze' };
export const KINDS: Record<string, Pair> = { player: ['بازیکن', 'Player'], team: ['تیم', 'Team'], organizer: ['برگزارکننده', 'Organizer'] };

export const ROSTER_STATES: Record<string, StateEntry> = {
  confirmed: { label: ['تأییدشده', 'Confirmed'], tone: 'success', icon: 'check-circle' },
  invited: { label: ['در انتظار تأیید عضو', 'Awaiting member confirmation'], tone: 'warning', icon: 'clock' },
  declined: { label: ['رد کرد', 'Declined'], tone: 'danger', icon: 'x-circle' },
};
export const CHECKIN_STATES: Record<string, StateEntry> = {
  checked_in: { label: ['حضور ثبت شد', 'Checked in'], tone: 'success', icon: 'check' },
  pending: { label: ['در انتظار اعلام حضور', 'Awaiting check-in'], tone: 'neutral', icon: 'clock' },
  absent: { label: ['غایب', 'No-show'], tone: 'danger', icon: 'x-circle' },
};

export const REC_KIND: Record<string, Pair> = {
  player: ['جذب بازیکن', 'Looking for a player'], coach: ['جذب مربی', 'Looking for a coach'],
  analyst: ['جذب تحلیلگر', 'Looking for an analyst'], manager: ['جذب مدیر', 'Looking for a manager'],
};

/* VERIFICATION_DISCLAIMER_FA / _EN, packages/core/src/organizer/organizer.ts */
export const ORG_DISCLAIMER: Pair = ['نشان تأیید فقط به معنای بررسی هویت و سوابق برگزارکننده توسط پلتفرم است. این نشان ضمانت مالی یا تضمین پرداخت جوایز نیست و به معنای وابستگی رسمی به ناشر بازی یا فدراسیون نیست.',
  'The verification badge is NOT a financial or prize guarantee and does NOT imply official affiliation with a game publisher or federation.'];
export const STAR = 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z';

export const GAME_STATES: Record<string, StateEntry> = {
  proposed: { label: ['پیشنهادی', 'Proposed'], tone: 'neutral' },
  under_review: { label: ['در حال بررسی', 'Under review'], tone: 'info', icon: 'clock' },
  ready: { label: ['آماده برگزاری', 'Ready'], tone: 'success', icon: 'check-circle' },
  suspended: { label: ['موقتاً غیرفعال', 'Suspended'], tone: 'warning', icon: 'pause' },
  archived: { label: ['آرشیوی', 'Archived'], tone: 'neutral', icon: 'inbox' },
};

export const POST_KIND: Record<string, { label: Pair; icon: IconName }> = {
  goal: { label: ['گل', 'Goal'], icon: 'target' },
  result: { label: ['نتیجه', 'Result'], icon: 'trophy' },
  announcement: { label: ['اطلاعیه', 'Notice'], icon: 'bell' },
  media: { label: ['رسانه', 'Media'], icon: 'image' },
};
export const POST_SRC: Record<string, Pair> = { official: ['رسمی', 'Official'], reporter: ['خبرنگار', 'Reporter'], automatic: ['خودکار از نتایج', 'Automatic from results'] };

export const CLAUSE_KIND: Record<string, StateEntry> = {
  mandatory: { label: ['اجباری', 'Mandatory'], tone: 'neutral', icon: 'lock' },
  configurable: { label: ['قابل تنظیم', 'Configurable'], tone: 'info', icon: 'settings' },
  human_review: { label: ['نیازمند بررسی انسانی', 'Needs human review'], tone: 'warning', icon: 'eye' },
};

export const DISPUTE_STEPS: readonly (readonly [string, Pair])[] = [
  ['filed', ['ثبت‌شده', 'Filed']], ['assigned', ['ارجاع‌شده', 'Assigned']], ['defense_received', ['دریافت دفاع', 'Defence received']],
  ['under_review', ['بررسی', 'Under review']], ['first_decision', ['رأی نخست', 'First decision']], ['appeal', ['تجدیدنظر', 'Appeal']], ['closed', ['مختومه', 'Closed']],
];
/** «۲ روز و ۳ ساعت مانده» / «2 days 3 hours left». */
export function remaining(ms: number): string {
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), hr = Math.floor((m % 1440) / 60), mi = m % 60;
  const u = (n: number, f: string, en: string) => tr(`${fa(n)} ${f}`, `${n} ${en}${n === 1 ? '' : 's'}`);
  const and = tr(' و ', ' '), left = tr(' مانده', ' left');
  if (d > 0) return u(d, 'روز', 'day') + (hr ? and + u(hr, 'ساعت', 'hour') : '') + left;
  if (hr > 0) return u(hr, 'ساعت', 'hour') + (mi ? and + u(mi, 'دقیقه', 'minute') : '') + left;
  return u(Math.max(mi, 1), 'دقیقه', 'minute') + left;
}

export interface RegAction { key: string; label: Pair | string; variant: 'primary' | 'green' | 'secondary' | 'ghost'; icon?: IconName }
export const REG: Record<string, StateEntry & { next: Pair; act?: RegAction }> = {
  draft: { label: ['پیش‌نویس', 'Draft'], tone: 'neutral', next: ['پیش‌نویس ذخیره شد؛ تأیید هم‌تیمی‌ها لازم است.', 'Draft saved; teammates must confirm.'], act: { key: 'confirm_roster', label: ['تأیید اعضا', 'Confirm members'], variant: 'green', icon: 'users' } },
  incomplete: { label: ['ناقص', 'Incomplete'], tone: 'warning', icon: 'alert', next: ['اطلاعات ناقص است؛ تکمیل کنید.', 'Information is incomplete; please complete it.'], act: { key: 'complete', label: ['تکمیل اطلاعات', 'Complete details'], variant: 'secondary', icon: 'edit' } },
  awaiting_payment: { label: ['انتظار پرداخت', 'Awaiting payment'], tone: 'warning', icon: 'wallet', next: ['ظرفیت برای شما نگه داشته شد؛ در مهلت تعیین‌شده پرداخت کنید.', 'A place is held for you; pay within the payment window.'], act: { key: 'pay', label: ['پرداخت', 'Pay'], variant: 'primary', icon: 'wallet' } },
  awaiting_review: { label: ['انتظار بررسی', 'Awaiting review'], tone: 'info', icon: 'clock', next: ['در انتظار بررسی برگزارکننده.', 'Awaiting organizer review.'] },
  awaiting_capacity: { label: ['انتظار ظرفیت', 'Awaiting capacity'], tone: 'info', icon: 'users', next: ['ظرفیت پر است؛ در فهرست انتظار قرار گرفتید.', 'Capacity is full; you are on the waitlist.'] },
  confirmed: { label: ['تأیید', 'Confirmed'], tone: 'success', icon: 'check-circle', next: ['ثبت‌نام قطعی شد.', 'Registration confirmed.'], act: { key: 'check_in', label: ['اعلام حضور', 'Check in'], variant: 'green', icon: 'check-circle' } },
  rejected: { label: ['رد', 'Rejected'], tone: 'danger', icon: 'x-circle', next: ['ثبت‌نام رد شد.', 'Registration rejected.'], act: { key: 're_review', label: ['درخواست بازبینی', 'Request re-review'], variant: 'secondary', icon: 'refresh' } },
  withdrawn: { label: ['انصراف', 'Withdrawn'], tone: 'neutral', next: ['انصراف ثبت شد.', 'Withdrawal recorded.'] },
  removed: { label: ['حذف', 'Removed'], tone: 'danger', icon: 'ban', next: ['این ثبت‌نام توسط برگزارکننده حذف شد.', 'The organizer removed this registration.'] },
};
export const REG_ACTIVE = ['draft', 'incomplete', 'awaiting_payment', 'awaiting_review', 'awaiting_capacity', 'confirmed'];

export const EQUIP: Record<string, StateEntry> = {
  declared: { label: ['اعلام شد؛ در انتظار بازرسی', 'Declared; awaiting inspection'], tone: 'warning', icon: 'clock' },
  approved: { label: ['تأییدشده', 'Approved'], tone: 'success', icon: 'check' },
  rejected: { label: ['ردشده', 'Rejected'], tone: 'danger', icon: 'x-circle' },
};

function prng(seed: string): () => number {
  let x = 2166136261;
  for (let i = 0; i < seed.length; i++) { x ^= seed.charCodeAt(i); x = Math.imul(x, 16777619); }
  return () => {
    x = (x + 0x6d2b79f5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Path of the deterministic pseudo-QR (not scannable): 25×25 modules, three finder patterns, timing lines. */
export function pseudoQrPath(seed?: string): string {
  const n = 25, rnd = prng(String(seed || 'qesb'));
  const O = [[0, 0], [n - 7, 0], [0, n - 7]] as const;
  const finder = (x: number, y: number): number => {
    for (const [ox, oy] of O) {
      const fx = x - ox, fy = y - oy;
      if (fx >= -1 && fx <= 7 && fy >= -1 && fy <= 7) {
        if (fx < 0 || fy < 0 || fx > 6 || fy > 6) return 0;
        return fx === 0 || fy === 0 || fx === 6 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4) ? 1 : 0;
      }
    }
    return -1;
  };
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const f = finder(x, y);
    const on = f >= 0 ? f === 1 : y === 6 ? x % 2 === 0 : x === 6 ? y % 2 === 0 : rnd() < 0.48;
    if (on) d += `M${x} ${y}h1v1h-1z`;
  }
  return d;
}

export const PAY: Record<string, StateEntry> = {
  created: { label: ['ایجادشده', 'Created'], tone: 'neutral' },
  awaiting_gateway: { label: ['انتظار درگاه', 'Awaiting gateway'], tone: 'info', icon: 'clock' },
  verified: { label: ['موفق تأییدشده', 'Verified'], tone: 'success', icon: 'check-circle' },
  failed: { label: ['ناموفق', 'Failed'], tone: 'danger', icon: 'x-circle' },
  unknown: { label: ['نامشخص', 'Unknown'], tone: 'warning', icon: 'alert' },
  awaiting_refund: { label: ['انتظار بازپرداخت', 'Awaiting refund'], tone: 'warning', icon: 'clock' },
  refunded_partial: { label: ['بازپرداخت جزئی', 'Partially refunded'], tone: 'info', icon: 'refresh' },
  refunded_full: { label: ['بازپرداخت کامل', 'Fully refunded'], tone: 'info', icon: 'refresh' },
};
export const PAY_NOTE: Record<string, Pair> = {
  verified: ['پرداخت با استعلام سرور از درگاه تأیید شد.', 'Payment confirmed by a server-side check with the gateway.'],
  failed: ['پرداخت ناموفق بود. مبلغی کسر نشده یا طبق قوانین بانک برمی‌گردد.', 'Payment failed. Nothing was charged, or the bank returns it under its rules.'],
  awaiting_gateway: ['در حال استعلام از درگاه… بستن این صفحه مشکلی ایجاد نمی‌کند؛ نتیجه در «ثبت‌نام‌های من» ثبت می‌شود.', 'Checking with the gateway… closing this page is safe; the result appears under My registrations.'],
  unknown: ['نتیجهٔ پرداخت هنوز از درگاه دریافت نشده است؛ پیش از پرداخت دوباره صبر کنید.', 'The gateway has not returned the payment result yet; wait before paying again.'],
};
/**
 * Negative toman amount split for rendering: the signed number stays LTR («−۱۲۰٬۰۰۰»), the unit follows the locale.
 * Never rounds (DATA-005): a rial remainder is appended like toman().
 */
export function negToman(rial: number): { amount: string; unit: string } {
  const r = Math.trunc(Math.abs(Number(rial) || 0));
  const rest = r % 10;
  return { amount: `−${num(Math.trunc(r / 10))}`, unit: tr(' تومان', ' Toman') + (rest ? ` ${tr('و', 'and')} ${fa(rest)} ${tr('ریال', 'Rial')}` : '') };
}

export const CERT_KIND: Record<string, Pair> = { placement: ['گواهی رتبه', 'Placement certificate'], attendance: ['گواهی حضور', 'Attendance certificate'] };
