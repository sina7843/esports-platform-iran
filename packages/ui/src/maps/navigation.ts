import type { IconName } from '../icons';
import { fa, tr } from '../locale';

/** Section helpers of bundle.js `03-navigation` (TopBar nav, connection chip, app name, counts, pages, filters, ActionBar status). */

export interface TopBarNavItem { key: string; label: string; href?: string }

/** Default TopBar links, built per call so labels follow the locale. */
export function topbarNav(): TopBarNavItem[] {
  return [
    { key: 'events', label: tr('رویدادها', 'Events'), href: '/events' },
    { key: 'rankings', label: tr('رده‌بندی', 'Rankings'), href: '/rankings' },
    { key: 'games', label: tr('بازی‌ها', 'Games'), href: '/games' },
    { key: 'news', label: tr('اخبار', 'News'), href: '/news' },
    { key: 'recruitment', label: tr('جذب و تمرین', 'Recruitment & scrims'), href: '/recruitment' },
    { key: 'organizers', label: tr('برگزارکنندگان', 'Organizers'), href: '/organizers' },
  ];
}

export function connOf(key: string): { label: string; tone: 'ok' | 'warn' | 'down' } {
  if (key === 'poll') return { label: tr('به‌روزرسانی دوره‌ای', 'Periodic refresh'), tone: 'warn' };
  if (key === 'offline') return { label: tr('آفلاین', 'Offline'), tone: 'down' };
  return { label: tr('زنده (SSE)', 'Live (SSE)'), tone: 'ok' };
}

export const appName = (): string => tr('پلتفرم ورزش‌های الکترونیکی', 'Esports Platform');
export const appArena = (): string => tr('میدان رقابت', 'The arena');

export const countText = (n: number): string => (n > 99 ? `${fa(99)}+` : fa(n));

/** Page numbers with gaps ('gap<k>') around the current page: 1 … 4 5 6 … 12. */
export function pageList(page: number, count: number, sib: number): (number | string)[] {
  const set = new Set<number>([1, count]);
  for (let i = page - sib; i <= page + sib; i++) if (i >= 1 && i <= count) set.add(i);
  const nums = [...set].sort((a, b) => a - b);
  const out: (number | string)[] = [];
  nums.forEach((n, k) => {
    if (k > 0) {
      const d = n - (nums[k - 1] ?? n);
      if (d === 2) out.push(n - 1);
      else if (d > 2) out.push(`gap${k}`);
    }
    out.push(n);
  });
  return out;
}

/** FilterBar first option when no allLabel: «همه وضعیت» / «Any status». */
export function allOf(label: string | null | undefined): string {
  const s = String(label ?? '');
  return tr(`همه ${s}`, `Any ${/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s}`);
}

export function abStatus(key: string): { cls: 'ok' | 'warn' | 'down'; icon?: IconName; text: string } {
  if (key === 'saving') return { cls: 'warn', text: tr('در حال ذخیره…', 'Saving…') };
  if (key === 'saved') return { cls: 'ok', icon: 'check-circle', text: tr('همهٔ تغییرات ذخیره شد', 'All changes saved') };
  if (key === 'error') return { cls: 'down', icon: 'alert', text: tr('ذخیره نشد؛ دوباره تلاش کنید', 'Not saved. Try again') };
  return { cls: 'warn', text: tr('تغییرات ذخیره نشده', 'Unsaved changes') };
}
