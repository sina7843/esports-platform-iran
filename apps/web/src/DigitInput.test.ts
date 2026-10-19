import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import DigitInput from './components/DigitInput.vue';
import { isIranMobile } from './validators';

describe('DigitInput', () => {
  it('normalizes Persian digits to ASCII in the model', async () => {
    const w = mount(DigitInput, { props: { id: 'm', modelValue: '' } });
    await w.get('input').setValue('۰۹۱۲۳۴۵۶۷۸۹');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['09123456789']);
  });

  it('normalizes Arabic-Indic digits too', async () => {
    const w = mount(DigitInput, { props: { id: 'm', modelValue: '' } });
    await w.get('input').setValue('٠٩١٢٣٤٥٦٧٨٩');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['09123456789']);
  });

  it('displays Persian digits for an ASCII model when the digits setting is fa', () => {
    const w = mount(DigitInput, { props: { id: 'm', modelValue: '0912' } });
    expect((w.get('input').element as HTMLInputElement).value).toBe('۰۹۱۲');
  });
});

describe('isIranMobile', () => {
  it('accepts Persian and Latin digits identically', () => {
    expect(isIranMobile('۰۹۱۲۳۴۵۶۷۸۹')).toBe(true);
    expect(isIranMobile('09123456789')).toBe(true);
  });
  it('rejects wrong prefix or length', () => {
    expect(isIranMobile('08123456789')).toBe(false);
    expect(isIranMobile('0912345678')).toBe(false);
    expect(isIranMobile('۰۹۱۲۳۴۵۶۷۸۹۰')).toBe(false);
  });
});
