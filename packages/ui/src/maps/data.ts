import { fa, localeState, num, tr } from '../locale';
import type { VNodeChild } from 'vue';
import type { IconName } from '../icons';

/** Section helpers of bundle.js `04-data` (JalaliDate … DiscoveryCard). */

export const range = (n: number): number[] => Array.from({ length: Math.max(0, n) }, (_, i) => i);
export const pad2 = (n: number): string => fa(n < 10 ? `0${n}` : String(n));
export const initial = (name?: string): string => Array.from(String(name ?? '').trim())[0] ?? '?';
/** DOM id from Vue's useId() (DS `uidOf(R.useId())`). */
export const uidOf = (raw: string): string => `q${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
/** React applies px to numeric lengths; Vue does not. */
export const px = (v: number | string | undefined): string | undefined => (typeof v === 'number' ? `${v}px` : v);

/* ---------- HeroAction → QButton (DS `actionButton(a, defaults)`) ---------- */
export interface QHeroAction {
  label: string;
  href?: string;
  onClick?: (e: MouseEvent) => void;
  icon?: IconName;
  iconEnd?: IconName | null;
  variant?: 'primary' | 'green' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  disabled?: boolean;
}
export interface ActionDefaults {
  variant: 'primary' | 'green' | 'secondary' | 'ghost';
  size: 'sm' | 'md' | 'lg' | 'xl';
  chamfer?: boolean;
  iconEnd?: IconName;
  flipIcon?: boolean;
}
/** QButton props for an action object; undefined keys are dropped (exactOptionalPropertyTypes). */
export function actionProps(a: QHeroAction, d: ActionDefaults): Record<string, unknown> {
  const iconEnd = a.iconEnd === undefined ? d.iconEnd : a.iconEnd ?? undefined;
  const out: Record<string, unknown> = {
    ...d, href: a.href, icon: a.icon, iconEnd, variant: a.variant || d.variant, size: a.size || d.size, disabled: a.disabled,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/* ---------- Countdown ---------- */
const enUnit = (n: number, u: string): string => `${n} ${u}${n === 1 ? '' : 's'}`;
/** Hidden sentence: «۳ روز و ۱۴ ساعت و ۲۲ دقیقه مانده» / «3 days, 14 hours and 22 minutes left». */
export function countdownSpoken(d: number, hr: number, mi: number, se: number, withSeconds: boolean): string {
  return tr(
    `${d ? `${fa(d)} روز و ` : ''}${fa(hr)} ساعت و ${fa(mi)} دقیقه${withSeconds ? ` و ${fa(se)} ثانیه` : ''} مانده`,
    `${[d ? enUnit(d, 'day') : null, enUnit(hr, 'hour'), enUnit(mi, 'minute'), withSeconds ? enUnit(se, 'second') : null]
      .filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1')} left`,
  );
}

/* ---------- Stepper ---------- */
export const stepDefault = (): string[] => [tr('اطلاعات تیم', 'Team details'), tr('تأیید اعضا', 'Teammates confirm'), tr('پرداخت', 'Payment'), tr('اعلام حضور', 'Check-in')];
export type StepState = 'done' | 'current' | 'upcoming';
export function stepSr(st: StepState): string {
  if (st === 'done') return tr('انجام شد', 'completed');
  if (st === 'current') return tr('مرحلهٔ فعلی', 'current step');
  return tr('پیش رو', 'upcoming');
}

/* ---------- DataTable ---------- */
/** QDataTable column (generic SFCs cannot export types). `render` may return a string or a VNode. */
export interface QDataTableColumn<R = Record<string, unknown>> {
  key: string;
  header: string;
  align?: 'start' | 'center' | 'end';
  width?: number | string;
  numeric?: boolean;
  sortable?: boolean;
  render?: (row: R, index: number) => VNodeChild;
  value?: (row: R) => unknown;
  sortValue?: (row: R) => string | number | null | undefined;
}
export interface QDataTableSort { key: string; dir: 'asc' | 'desc' }
export type QDataTableKey = string | number;
export function defaultCell(v: unknown, numeric?: boolean): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'number') return num(v);
  return numeric ? fa(v) : String(v);
}
export function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), localeState.locale);
}

/* ---------- Timeline ---------- */
export type TimelineTone = 'green' | 'warning' | 'info' | 'danger' | 'neutral';
export const TL: Record<string, { icon: IconName; tone: TimelineTone }> = {
  result: { icon: 'flag', tone: 'green' }, referee: { icon: 'bell', tone: 'warning' }, pause: { icon: 'pause', tone: 'warning' },
  resume: { icon: 'play', tone: 'green' }, start: { icon: 'play', tone: 'green' }, ready: { icon: 'check', tone: 'green' },
  correction: { icon: 'edit', tone: 'info' }, decision: { icon: 'gavel', tone: 'neutral' }, dispute: { icon: 'alert', tone: 'danger' },
  message: { icon: 'message', tone: 'neutral' }, system: { icon: 'info', tone: 'neutral' },
};

/* ---------- ChatPanel ---------- */
export const chatChannels = (): { value: string; label: string }[] => [
  { value: 'all', label: tr('هر دو طرف و داور', 'Both sides and referee') },
  { value: 'officials', label: tr('فقط داور', 'Referee only') },
];

/* ---------- DecisionBox ---------- */
export type DecisionState = 'pending' | 'approved' | 'rejected' | 'executed' | 'expired';
export function decState(s: DecisionState): { tone: 'success' | 'danger' | 'neutral' | 'warning'; label: string; icon: IconName } {
  if (s === 'approved') return { tone: 'success', label: tr('تأییدشده', 'Approved'), icon: 'check-circle' };
  if (s === 'rejected') return { tone: 'danger', label: tr('ردشده', 'Rejected'), icon: 'x-circle' };
  if (s === 'executed') return { tone: 'success', label: tr('اجراشده', 'Executed'), icon: 'check-circle' };
  if (s === 'expired') return { tone: 'neutral', label: tr('منقضی‌شده', 'Expired'), icon: 'clock' };
  return { tone: 'warning', label: tr('در انتظار تصمیم', 'Awaiting decision'), icon: 'clock' };
}
