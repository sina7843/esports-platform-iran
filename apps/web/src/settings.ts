import { reactive } from 'vue';
import type { Locale } from '@esp/contracts';

export type ThemeSetting = 'light' | 'dark' | 'system';
export type DigitsSetting = 'fa' | 'latn';

const KEY = 'esp.settings.v1';
export const TIME_ZONE = 'Asia/Tehran';

interface Stored {
  locale: Locale;
  theme: ThemeSetting;
  digits: DigitsSetting;
  /** AUD-003: low-data mode (no images until asked, no autoplay, slower live refresh) */
  lowData: boolean;
}

function load(): Stored {
  const saveData = typeof navigator !== 'undefined' && !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  const base: Stored = { locale: 'fa', theme: 'system', digits: 'fa', lowData: saveData };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Stored>;
    return {
      locale: p.locale === 'en' ? 'en' : 'fa',
      theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : 'system',
      digits: p.digits === 'latn' ? 'latn' : 'fa',
      lowData: typeof p.lowData === 'boolean' ? p.lowData : saveData,
    };
  } catch {
    return base;
  }
}

export const settings = reactive<Stored>(load());

/** Applies lang/dir/theme to <html>. Persian is RTL; English flips to LTR. */
export function applySettings(): void {
  const root = document.documentElement;
  root.lang = settings.locale;
  root.dir = settings.locale === 'fa' ? 'rtl' : 'ltr';
  if (settings.theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = settings.theme;
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...settings }));
  } catch {
    /* storage may be blocked; settings still apply for this session */
  }
}

export function setLocale(l: Locale): void {
  settings.locale = l;
  persist();
  applySettings();
}
export function setTheme(t: ThemeSetting): void {
  settings.theme = t;
  persist();
  applySettings();
}
export function setDigits(d: DigitsSetting): void {
  settings.digits = d;
  persist();
}
export function setLowData(v: boolean): void {
  settings.lowData = v;
  persist();
}
