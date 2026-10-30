import { fa, localeState, toman, tr } from '../locale';
import type { IconName } from '../icons';

/** Section helpers of bundle.js `05-competition` (EventCard … PickBanBoard), read at render time. */

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'live' | 'red' | 'green';
/** [tone, fa, en, icon] */
export type StatusEntry = readonly [Tone, string, string, IconName?];

export type EventCardStatus = 'draft' | 'in_review' | 'published' | 'registration_open' | 'registration_closed' | 'preparing'
  | 'active' | 'paused' | 'finished' | 'closed' | 'cancelled' | 'archived' | 'open' | 'live' | 'scheduled';
/** The 11 match states from packages/contracts (MatchStates). */
export type MatchCardState = 'awaiting_sides' | 'scheduled' | 'awaiting_readiness' | 'ready' | 'pre_game_selection' | 'live'
  | 'paused' | 'provisional' | 'disputed' | 'final' | 'cancelled';
export type EventCardPresence = 'online' | 'offline' | 'hybrid' | 'lan';

/** List separator: «، » in Persian, ", " in English. */
export const sep = (): string => tr('، ', ', ');
/** English plural; Persian nouns stay singular after a number. */
export const pl = (n: number, faWord: string, one: string, many: string): string => tr(faWord, n === 1 ? one : many);
export const cap1 = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const EVENT_STATUS: Record<string, StatusEntry> = {
  draft: ['neutral', 'پیش‌نویس', 'Draft'], in_review: ['warning', 'در بررسی', 'In review'], published: ['info', 'به‌زودی', 'Coming soon'],
  registration_open: ['success', 'ثبت‌نام باز', 'Registration open'], registration_closed: ['neutral', 'ثبت‌نام بسته', 'Registration closed'],
  preparing: ['info', 'آماده‌سازی', 'Preparing'], active: ['live', 'در حال برگزاری', 'Live now'], paused: ['warning', 'متوقف', 'Paused'],
  finished: ['neutral', 'پایان‌یافته', 'Finished'], closed: ['neutral', 'بسته‌شده', 'Closed'], cancelled: ['danger', 'لغوشده', 'Cancelled'], archived: ['neutral', 'آرشیوی', 'Archived'],
  /* aliases */ open: ['success', 'ثبت‌نام باز', 'Registration open'], live: ['live', 'در حال برگزاری', 'Live now'], scheduled: ['info', 'به‌زودی', 'Coming soon'],
};
export const MATCH_STATE: Record<string, StatusEntry> = {
  awaiting_sides: ['neutral', 'انتظار طرفین', 'Awaiting sides', 'users'], scheduled: ['info', 'برنامه‌ریزی‌شده', 'Scheduled', 'calendar'],
  awaiting_readiness: ['info', 'انتظار آمادگی', 'Awaiting readiness', 'clock'], ready: ['success', 'آماده', 'Ready', 'check'],
  pre_game_selection: ['info', 'انتخاب‌های پیش از بازی', 'Pre-game selection', 'target'], live: ['live', 'زنده', 'Live'],
  paused: ['warning', 'متوقف', 'Paused', 'pause'], provisional: ['warning', 'نتیجه موقت (در انتظار تأیید)', 'Provisional result (awaiting confirmation)', 'clock'],
  disputed: ['warning', 'در اختلاف', 'Disputed', 'alert'], final: ['neutral', 'نهایی', 'Final', 'check-circle'], cancelled: ['danger', 'لغوشده', 'Cancelled', 'x-circle'],
};
export const STAGE_STATUS: Record<string, StatusEntry> = {
  draft: ['neutral', 'پیش‌نویس', 'Draft'], scheduled: ['info', 'برنامه‌ریزی‌شده', 'Scheduled'], pending: ['info', 'برنامه‌ریزی‌شده', 'Scheduled'],
  draw: ['info', 'قرعه منتشرشده', 'Draw published'], active: ['live', 'در حال برگزاری', 'Live now'], live: ['live', 'در حال برگزاری', 'Live now'],
  paused: ['warning', 'متوقف', 'Paused'], finished: ['neutral', 'پایان‌یافته', 'Finished'], final: ['neutral', 'پایان‌یافته', 'Finished'], cancelled: ['danger', 'لغوشده', 'Cancelled'],
};
/* fmt.* */
export const FORMAT: Record<string, readonly [string, string]> = {
  single_elim: ['حذفی تک‌شکست', 'Single elimination'], double_elim: ['حذفی دوشکست', 'Double elimination'], round_robin: ['دوره‌ای', 'Round robin'],
  groups: ['گروهی', 'Groups'], swiss: ['سوئیسی', 'Swiss'], ladder: ['نردبانی', 'Ladder'], multi_lobby: ['چندلابی', 'Multi-lobby'],
  record: ['رکوردی', 'Record'], time_trial: ['زمان‌محور', 'Time trial'], mixed: ['ترکیبی', 'Mixed'],
};
/* reg.presence.* — lan is the product's alias for an in-person LAN event. */
export const PRESENCE: Record<string, readonly [string, string]> = { online: ['آنلاین', 'Online'], offline: ['حضوری', 'In person'], hybrid: ['ترکیبی', 'Hybrid'], lan: ['حضوری', 'LAN'] };
export const SCORED: Record<string, true> = { live: true, paused: true, provisional: true, disputed: true, final: true };

export const formatLabel = (f: string): string => { const e = FORMAT[f]; return e ? tr(e[0], e[1]) : f; };
export function matchStateLabel(st?: string): string {
  const e = st ? MATCH_STATE[st] : undefined;
  return e ? tr(e[1], e[2]) : (st ?? '');
}
/** Props for QBadge from a status map (DS `statusBadge`): unknown keys fall back to a neutral badge with the key. */
export function statusBadge(map: Record<string, StatusEntry>, key?: string, label?: string, tone?: Tone): { props: { tone: Tone; icon?: IconName }; label: string } {
  const m: StatusEntry = (key ? map[key] : undefined) ?? ['neutral', key ?? '', key ?? ''];
  const icon = m[3];
  return { props: icon ? { tone: tone || m[0], icon } : { tone: tone || m[0] }, label: label || tr(m[1], m[2]) };
}
export const tbd = (): string => tr('در انتظار', 'TBD');
export function initialOf(t?: { initial?: string | undefined; name?: string | undefined } | null): string {
  return (t && (t.initial || (t.name ? Array.from(t.name)[0] : ''))) || tr('؟', '?');
}
export function presenceText(mode?: string, city?: string): string {
  const e = mode ? PRESENCE[mode] : undefined;
  const m = e ? tr(e[0], e[1]) : (mode ?? '');
  return city ? `${m} · ${city}` : m;
}
export const feeText = (rial?: number): string => (!rial ? tr('رایگان', 'Free') : toman(rial));
export const capacityText = (c: { filled: number; total: number; unit?: string | undefined; text?: string | undefined }): string =>
  c.text || `${fa(c.filled)}${tr(' از ', ' of ')}${fa(c.total)} ${c.unit || tr('تیم', 'teams')}`;
/** «+۳» / «−۲» / «۰» (true minus sign). */
export function signed(n: number): string {
  if (n > 0) return `+${fa(n)}`;
  if (n < 0) return `−${fa(Math.abs(n))}`;
  return fa(0);
}
export const lead = (a?: number, b?: number): number => (a == null || b == null || a === b ? 0 : a > b ? 1 : -1);

/* ---------- EventHeader countdown ---------- */
export interface Countdown { days: number; hours: number; minutes: number }
export function splitCountdown(r: { countdown?: Countdown | undefined; deadline?: string | undefined }, now: number): Countdown | null {
  if (r.countdown) return r.countdown;
  if (!r.deadline) return null;
  const ms = Math.max(0, new Date(r.deadline).getTime() - now);
  const m = Math.floor(ms / 60000);
  return { days: Math.floor(m / 1440), hours: Math.floor(m / 60) % 24, minutes: m % 60 };
}
export const pad2 = (n: number): string => fa(n < 10 ? `0${n}` : String(n));
export function countdownAria(cd: Countdown): string {
  return tr(
    `${fa(cd.days)} روز و ${fa(cd.hours)} ساعت و ${fa(cd.minutes)} دقیقه تا پایان ثبت‌نام`,
    `${cd.days} ${cd.days === 1 ? 'day' : 'days'}, ${cd.hours} ${cd.hours === 1 ? 'hour' : 'hours'} and ${cd.minutes} ${cd.minutes === 1 ? 'minute' : 'minutes'} until registration closes`,
  );
}

/* ---------- Bracket ---------- */
export const bracketHint = (): string => tr('با کلیدهای جهت بین مسابقه‌ها حرکت کنید و با Enter اتاق مسابقه را باز کنید.', 'Use the arrow keys to move between matches and Enter to open the match room.');
/** Round title: the given label, else Final / Semi-finals / Quarter-finals when the match count halves to the end, else «دور n». */
export function roundName(rounds: ReadonlyArray<{ label?: string | undefined; matches: readonly unknown[] }>, ri: number): string {
  const rd = rounds[ri];
  if (rd?.label) return rd.label;
  const fromEnd = rounds.length - 1 - ri;
  const n = rd?.matches.length ?? 0;
  if (n === 2 ** fromEnd) {
    if (fromEnd === 0) return tr('فینال', 'Final');
    if (fromEnd === 1) return tr('نیمه‌نهایی', 'Semi-finals');
    if (fromEnd === 2) return tr('یک‌چهارم نهایی', 'Quarter-finals');
  }
  return tr('دور ', 'Round ') + fa(ri + 1);
}
interface SlotSide { name?: string | undefined; score?: number | undefined }
export function bracketSlotLabel(round: string, m: { top?: SlotSide; bottom?: SlotSide; state?: string; winner?: 'top' | 'bottom' | null | undefined; time?: string | undefined }): string {
  const a = m.top?.name || tbd();
  const b = m.bottom?.name || tbd();
  const s = matchStateLabel(m.state);
  const sc = m.top?.score != null && m.bottom?.score != null ? ` ${fa(m.top.score)} – ${fa(m.bottom.score)}` : '';
  const w = m.winner ? sep() + tr('برنده: ', 'winner: ') + (m.winner === 'top' ? a : b) : '';
  return `${round} — ${a} / ${b}${sc} — ${s}${w}${m.time && !sc ? sep() + m.time : ''}`;
}

/* ---------- StandingsTable / LeaderboardRow ---------- */
/** [fa letter, en letter, fa word, en word, class] — fa loss letter is «ش» (شکست) so it differs from «ب» (برد). */
export const FORM: Record<'W' | 'D' | 'L', readonly [string, string, string, string, string]> = {
  W: ['ب', 'W', 'برد', 'Win', 'w'], D: ['م', 'D', 'مساوی', 'Draw', 'd'], L: ['ش', 'L', 'باخت', 'Loss', 'l'],
};
export const MEDAL = ['gold', 'silver', 'bronze'] as const;
export const MEDAL_NAME: ReadonlyArray<readonly [string, string]> = [['رتبه اول', 'First place'], ['رتبه دوم', 'Second place'], ['رتبه سوم', 'Third place']];
export const isEn = (): boolean => localeState.locale === 'en';

/* ---------- PickBanBoard (room.tok.*; the DS keeps «نقشه» in Persian) ---------- */
export const KIND: Record<string, readonly [string, string]> = { ban: ['حذف نقشه', 'Map ban'], pick: ['انتخاب نقشه', 'Map pick'], side: ['انتخاب طرف', 'Side choice'], decider: ['نقشه تعیین‌کننده', 'Decider map'] };
export const KIND_SHORT: Record<string, readonly [string, string]> = { ban: ['حذف', 'Ban'], pick: ['انتخاب', 'Pick'], side: ['طرف', 'Side'], decider: ['تعیین‌کننده', 'Decider'] };
export const RESOLVED: Record<string, readonly [string, string]> = { rule: ['طبق قانون پس از اتمام زمان', 'by rule after timeout'], referee: ['توسط داور', 'by referee'] };
export function kindLabel(map: Record<string, readonly [string, string]>, k?: string): string {
  const e = k ? map[k] : undefined;
  return e ? tr(e[0], e[1]) : (k ?? '');
}
export function resolvedLabel(r: string, capital: boolean): string {
  const e = RESOLVED[r];
  if (!e) return r;
  const s = tr(e[0], e[1]);
  return capital && isEn() ? cap1(s) : s;
}
