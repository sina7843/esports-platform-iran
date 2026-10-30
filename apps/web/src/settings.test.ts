import { describe, expect, it, vi } from 'vitest';
import { num } from '@esp/ui';
import { setDigits, setLocale, setTheme, settings } from './settings';
import { t } from './i18n';

describe('locale switch', () => {
  it('flips <html> between rtl/fa and ltr/en', () => {
    const root = document.documentElement;
    setLocale('en');
    expect(root.dir).toBe('ltr');
    expect(root.lang).toBe('en');
    expect(t('nav.home')).toBe('Home');
    setLocale('fa');
    expect(root.dir).toBe('rtl');
    expect(root.lang).toBe('fa');
    expect(t('nav.home')).toBe('خانه');
  });

  it('theme: dark default, explicit light/dark, system resolved from matchMedia', () => {
    expect(settings.theme).toBe('dark');
    setTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    const mm = vi.spyOn(globalThis, 'matchMedia');
    mm.mockReturnValue({ matches: true, addEventListener() {} } as unknown as MediaQueryList);
    setTheme('system');
    expect(document.documentElement.dataset.theme).toBe('light');
    mm.mockReturnValue({ matches: false, addEventListener() {} } as unknown as MediaQueryList);
    setTheme('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
    mm.mockRestore();
    setTheme('dark');
  });

  it('digits and locale reach @esp/ui', () => {
    setDigits('latn');
    expect(num(1200)).toBe('1,200');
    setDigits('fa');
    expect(num(1200)).toBe('۱٬۲۰۰');
    setLocale('en');
    expect(num(1200)).toBe('1,200');
    setLocale('fa');
  });
});
