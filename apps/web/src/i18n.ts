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

const faStates: Record<string, string> = {};
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
