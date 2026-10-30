import { afterEach, describe, expect, it } from 'vitest';
import { dec, fa, formatJalali, num, setLocale, toman } from './locale';

// Expected strings are the DS reference (bundle.js QeSB helpers run in Node), except toman() which never rounds.
const at = '2026-12-03T15:00:00Z';
afterEach(() => setLocale('fa', { keepDocument: true }));

describe('locale helpers', () => {
  it('fa (Persian digits)', () => {
    setLocale('fa', { keepDocument: true });
    expect(toman(1200000)).toBe('۱۲۰٬۰۰۰ تومان');
    expect(num(120000)).toBe('۱۲۰٬۰۰۰');
    expect(dec(0.06)).toBe('۰٫۰۶');
    expect(dec(4.6)).toBe('۴٫۶');
    expect(dec(12345.5)).toBe('۱۲٬۳۴۵٫۵');
    expect(fa('1405')).toBe('۱۴۰۵');
    expect(formatJalali(at, 'datetime')).toBe('۱۲ آذر ۱۴۰۵ ساعت ۱۸:۳۰');
    expect(formatJalali(at, 'date')).toBe('۱۲ آذر ۱۴۰۵');
    expect(formatJalali(at, 'dateShort')).toBe('۱۲ آذر');
    expect(formatJalali(at, 'numeric')).toBe('۱۴۰۵/۰۹/۱۲');
    expect(formatJalali(at, 'time')).toBe('۱۸:۳۰');
    expect(formatJalali(at, 'relative', { now: '2026-12-03T17:00:00Z' })).toBe('۲ ساعت پیش');
    expect(formatJalali(null)).toBe('—');
  });
  it('fa with Latin digits', () => {
    setLocale('fa', { digits: 'latn', keepDocument: true });
    expect(num(120000)).toBe('120,000');
    expect(dec(0.06)).toBe('0.06');
    expect(fa('۱۴۰۵')).toBe('1405');
    expect(formatJalali(at, 'datetime')).toBe('12 آذر 1405 ساعت 18:30');
  });
  it('en', () => {
    setLocale('en', { keepDocument: true });
    expect(toman(1200000)).toBe('120,000 Toman');
    expect(num(120000)).toBe('120,000');
    expect(dec(0.06)).toBe('0.06');
    expect(formatJalali(at, 'datetime')).toBe('3 December 2026 at 18:30');
    expect(formatJalali(at, 'relative', { now: '2026-12-03T17:00:00Z' })).toBe('2 hours ago');
  });
  it('toman never rounds (DATA-005)', () => {
    setLocale('fa', { keepDocument: true });
    expect(toman(1200005)).toBe('۱۲۰٬۰۰۰ تومان و ۵ ریال');
    setLocale('en', { keepDocument: true });
    expect(toman(15)).toBe('1 Toman and 5 Rial');
  });
  it('sets <html lang dir> unless keepDocument', () => {
    setLocale('en');
    expect(document.documentElement.dir).toBe('ltr');
    setLocale('fa');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('fa');
  });
});
