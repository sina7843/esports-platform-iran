import { allMachines, toLocaleDigits } from '@esp/contracts';
import { settings } from './settings';
import { fa, type MessageKey } from './locales/fa';
import { en } from './locales/en';

export type { MessageKey };

/** Reactive because it reads `settings.locale` — safe to call in templates and computed values. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const msg = (settings.locale === 'fa' ? fa : en)[key] ?? key;
  return params ? msg.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? '')) : msg;
}

/** Digits per the user's setting; English locale always uses Latin digits. */
export function digitLocale(): 'fa' | 'en' {
  return settings.locale === 'fa' && settings.digits === 'fa' ? 'fa' : 'en';
}
export function num(v: string | number): string {
  return toLocaleDigits(v, digitLocale());
}

/** States of ESP-04 records that are not chapter-15 machines (draws, slots, stations, servers, reviews, imports …). */
const faStates: Record<string, string> = {
  planned: 'برنامه‌ریزی‌شده', drawn: 'قرعه‌خورده', finished: 'پایان‌یافته', preview: 'پیش‌نمایش', confirmed: 'تأییدشده', locked: 'قفل', superseded: 'جایگزین‌شده',
  waiting: 'در انتظار', auto_advance: 'صعود خودکار', not_needed: 'لازم نشد', done: 'انجام‌شده', complete: 'کامل', waiting_referee: 'در انتظار داور',
  applied: 'اعمال‌شده', partially_applied: 'بخشی اعمال‌شده', conflict: 'متعارض', resolved: 'رسیدگی‌شده', acknowledged: 'دیده‌شده', closed: 'بسته',
  agreed: 'موافقت‌شده', healthy: 'سالم', degraded: 'کند', down: 'خارج از دسترس', unknown: 'نامشخص', in_use: 'در حال استفاده', faulty: 'معیوب',
  maintenance: 'آماده‌سازی', available: 'آزاد', loaned: 'تحویل‌شده', revoked: 'باطل', called: 'فراخوان', at_station: 'در ایستگاه', used: 'استفاده‌شده',
  // ESP-05
  previewed: 'پیش‌نمایش', blocked_dependency: 'متوقف (وابستگی شروع‌شده)', applying: 'در حال اعمال', appealed: 'در تجدیدنظر', expired: 'منقضی', triaged: 'غربال‌شده',
  investigating: 'در بررسی', referred: 'ارجاع‌شده به پرونده', proposed: 'پیشنهادشده', retired: 'بازنشسته', verified: 'تأییدشده', corrected: 'اصلاح‌شده', running: 'در حال اجرا',
};
// ESP-07 (administration, support, privacy, providers); entries already defined above or by a machine win
const faStates07: Record<string, string> = {
  suspended: 'معلق', open: 'باز', pending: 'در انتظار', in_progress: 'در حال انجام', resolved: 'حل‌شده', closed: 'بسته', selected: 'انتخاب‌شده', candidate: 'نامزد', rejected: 'ردشده',
  on_hold: 'معلق (توقیف)', in_review: 'در بررسی', completed: 'تکمیل‌شده', not_tested: 'آزمون‌نشده', passed: 'قبول', failed: 'ناموفق', dead: 'صف مرده', skipped: 'ردشده', ok: 'موفق', approved: 'تأییدشده',
  active: 'فعال', revoked: 'باطل', delivered: 'تحویل‌شده',
};
for (const [k, v] of Object.entries(faStates07)) faStates[k] ??= v;
for (const m of allMachines) {
  for (const [k, v] of Object.entries(m.statesFa as Record<string, string>)) faStates[k] ??= v;
}
export function stateLabel(state: string): string {
  if (settings.locale === 'fa') return faStates[state] ?? state;
  const s = state.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const approvalFa: Record<string, string> = { pending: 'در انتظار', approved: 'تأییدشده', rejected: 'ردشده', expired: 'منقضی', executed: 'اجراشده' };
export function approvalLabel(state: string): string {
  return settings.locale === 'fa' ? (approvalFa[state] ?? state) : state.charAt(0).toUpperCase() + state.slice(1);
}

/** Honor label: known placements are translated; a special award keeps its own title (e.g. "MVP"). */
export function honorLabel(label: string): string {
  const key = `hon.label.${label}` as MessageKey;
  return key in fa ? t(key) : label;
}
