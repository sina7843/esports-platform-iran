import { describe, expect, it } from 'vitest';
import { setLocale, setTheme } from './settings';
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

  it('theme: explicit sets data-theme, system removes it', () => {
    setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    setTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
