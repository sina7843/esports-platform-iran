import { reactive } from 'vue';
import type { Locale } from '@esp/contracts';
import { setLocale as setUiLocale } from '@esp/ui';

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
  const base: Stored = { locale: 'fa', theme: 'dark', digits: 'fa', lowData: saveData };
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

/** The OS colour scheme, used when theme === 'system' (the QeSB tokens treat a missing data-theme as dark). */
function systemTheme(): 'light' | 'dark' {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
let watchingSystem = false;
function watchSystemTheme(): void {
  if (watchingSystem || typeof matchMedia !== 'function') return;
  const mq = matchMedia('(prefers-color-scheme: light)');
  mq.addEventListener?.('change', () => { if (settings.theme === 'system') applySettings(); });
  watchingSystem = true;
}

/** Applies lang/dir/theme to <html> and the @esp/ui locale. Persian is RTL; English flips to LTR. */
export function applySettings(): void {
  const root = document.documentElement;
  root.lang = settings.locale;
  root.dir = settings.locale === 'fa' ? 'rtl' : 'ltr';
  setUiLocale(settings.locale, { digits: settings.digits, keepDocument: true });
  if (settings.theme === 'system') {
    root.dataset.theme = systemTheme();
    watchSystemTheme();
  } else root.dataset.theme = settings.theme;
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
  applySettings();
}
export function setLowData(v: boolean): void {
  settings.lowData = v;
  persist();
}
