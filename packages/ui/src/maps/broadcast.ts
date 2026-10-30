import { fa, tr } from '../locale';
import type { IconName } from '../icons';

/** Section helpers of bundle.js `07-broadcast` (HallBoard … OpsPanel). Built-in words are [fa, en] pairs resolved at render time. */

export interface BroadcastTeam { name: string; short?: string; initial?: string }
type TeamLike = BroadcastTeam | string | null | undefined;
type Pair = readonly [string, string];

export function initialOf(t: TeamLike | { name: string; initial?: string }): string {
  if (!t) return '?';
  if (typeof t === 'string') return t.charAt(0);
  return t.initial || String(t.name || '?').charAt(0);
}
export const nameOf = (t: TeamLike): string => (t == null ? '' : typeof t === 'string' ? t : t.name);
export const shortOf = (t: TeamLike): string => (t == null ? '' : typeof t === 'string' ? t : (t.short || t.name));
/** 'lead' | 'trail' | 'even' for side 0 (home) or 1 (away); null without a score. */
export function lead(score: readonly [number, number] | undefined, side: 0 | 1): 'lead' | 'trail' | 'even' | null {
  if (!score) return null;
  const a = Number(score[0]);
  const b = Number(score[1]);
  if (a === b) return 'even';
  return (side === 0 ? a > b : b > a) ? 'lead' : 'trail';
}
// ASCII-only test without a control-character regex: every code unit below 128
export const latin = (s: unknown): boolean => { const v = String(s ?? ''); return v.length > 0 && [...v].every((c) => c.charCodeAt(0) < 128); };
export const tx = (v: Pair | string | undefined): string => (Array.isArray(v) ? tr(v[0], v[1]) : (v as string | undefined) ?? '');
export function scoreLabel(home: TeamLike, away: TeamLike, score?: readonly [number, number]): string {
  if (!score) return nameOf(home) + tr(' در برابر ', ' vs ') + nameOf(away);
  return `${nameOf(home)} ${fa(score[0])}${tr('، ', ', ')}${nameOf(away)} ${fa(score[1])}`;
}

export const HALL_CALLUP: Record<'called' | 'at_station' | 'ready', Pair> = {
  called: ['به ایستگاه بیایید', 'Come to your station'], at_station: ['در ایستگاه', 'At station'], ready: ['آماده', 'Ready'],
};

export type Severity = 'critical' | 'warning' | 'info';
export const SEV: Record<Severity, { tone: 'danger' | 'warning' | 'info'; icon: IconName; word: Pair }> = {
  critical: { tone: 'danger', icon: 'alert', word: ['بحرانی', 'Critical'] },
  warning: { tone: 'warning', icon: 'alert', word: ['هشدار', 'Warning'] },
  info: { tone: 'info', icon: 'info', word: ['اطلاع', 'Info'] },
};

export type Health = 'ok' | 'degraded' | 'down' | 'unconfigured';
export const HEALTH: Record<Health, { tone: 'success' | 'warning' | 'danger' | 'neutral'; icon: IconName; word: Pair }> = {
  ok: { tone: 'success', icon: 'check-circle', word: ['سالم', 'Healthy'] },
  degraded: { tone: 'warning', icon: 'alert', word: ['مختل', 'Degraded'] },
  down: { tone: 'danger', icon: 'x-circle', word: ['قطع', 'Down'] },
  unconfigured: { tone: 'neutral', icon: 'settings', word: ['پیکربندی‌نشده', 'Not configured'] },
};

export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export const PRIO: Record<Priority, readonly ['neutral' | 'warning' | 'danger', Pair]> = {
  low: ['neutral', ['کم', 'Low']], normal: ['neutral', ['عادی', 'Normal']], high: ['warning', ['زیاد', 'High']], urgent: ['danger', ['فوری', 'Urgent']],
};
/** «۵ ساعت و ۳۰ دقیقه مانده» / «۲ ساعت از مهلت گذشته». */
export function slaText(min: number): string {
  const m = Math.abs(Math.round(min));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  const span = hh > 0
    ? tr(`${fa(hh)} ساعت${mm ? ` و ${fa(mm)} دقیقه` : ''}`, `${hh} h${mm ? ` ${mm} min` : ''}`)
    : tr(`${fa(mm)} دقیقه`, `${mm} min`);
  return min < 0 ? span + tr(' از مهلت گذشته', ' overdue') : span + tr(' مانده', ' left');
}
