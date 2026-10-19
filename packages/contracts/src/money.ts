import { z } from 'zod';

/**
 * DATA-005: amounts are stored and computed as integer Iranian Rial (IRR).
 * Display uses Toman (1 Toman = 10 Rial) with an explicit unit label.
 * No floating point anywhere; `bigint`-safe range guarded by MAX_SAFE_INTEGER.
 */
export const RialSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export type Rial = number;

export const MoneySchema = z.object({
  amount: RialSchema,
  currency: z.literal('IRR'),
});
export type Money = z.infer<typeof MoneySchema>;

export function rial(amount: number): Money {
  return { amount: RialSchema.parse(amount), currency: 'IRR' };
}

/** Toman integer part and remaining rial (0..9). Toman never rounds silently. */
export function rialToToman(amount: Rial): { toman: number; rial: number } {
  RialSchema.parse(amount);
  return { toman: Math.floor(amount / 10), rial: amount % 10 };
}

export function tomanToRial(toman: number): Rial {
  return RialSchema.parse(toman * 10);
}

const faDigits = '۰۱۲۳۴۵۶۷۸۹';
export function toLocaleDigits(input: string | number, locale: 'fa' | 'en'): string {
  const s = String(input);
  return locale === 'fa' ? s.replace(/[0-9]/g, (d) => faDigits[Number(d)] ?? d) : s;
}

export function groupThousands(n: number, locale: 'fa' | 'en'): string {
  const sep = locale === 'fa' ? '٬' : ',';
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Labeled display: "۱۲٬۳۴۵ تومان" / "12,345 Toman"; non-zero remainder rials are shown explicitly. */
export function formatToman(amount: Rial, locale: 'fa' | 'en' = 'fa'): string {
  const { toman, rial: rest } = rialToToman(amount);
  const unit = locale === 'fa' ? 'تومان' : 'Toman';
  const base = `${toLocaleDigits(groupThousands(toman, locale), locale)} ${unit}`;
  if (rest === 0) return base;
  const rialUnit = locale === 'fa' ? 'ریال' : 'Rial';
  return `${base} ${locale === 'fa' ? 'و' : 'and'} ${toLocaleDigits(rest, locale)} ${rialUnit}`;
}

export function formatRial(amount: Rial, locale: 'fa' | 'en' = 'fa'): string {
  RialSchema.parse(amount);
  const unit = locale === 'fa' ? 'ریال' : 'Rial';
  return `${toLocaleDigits(groupThousands(amount, locale), locale)} ${unit}`;
}
