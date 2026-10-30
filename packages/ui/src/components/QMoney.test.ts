import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QMoney from './QMoney.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QMoney', () => {
  it('amount in toman with the exact rial title', () => {
    const w = mount(QMoney, { props: { rial: 1200000 } });
    expect(w.classes()).toEqual(['q-money', 'q-money--md', 'q-money--amount']);
    expect(w.find('.q-money__value').text()).toBe('۱۲۰٬۰۰۰');
    expect(w.find('.q-money__unit').text()).toBe('تومان');
    expect(w.find('.q-money__amount').attributes('title')).toBe('۱٬۲۰۰٬۰۰۰ ریال');
  });
  it('never rounds: the rial remainder stays', () => {
    const w = mount(QMoney, { props: { rial: 1200005 } });
    expect(w.find('.q-money__value').text()).toBe('۱۲۰٬۰۰۰');
    expect(w.find('.q-money__unit').text()).toBe('تومان و ۵ ریال');
  });
  it('negative is LTR with a minus sign', () => {
    const v = mount(QMoney, { props: { rial: -50000 } }).find('.q-money__value');
    expect(v.classes()).toContain('q-ltr');
    expect(v.text()).toBe('−۵٬۰۰۰');
  });
  it('free fee and prize note, fa and en', () => {
    expect(mount(QMoney, { props: { rial: 0, kind: 'fee' } }).text()).toBe('رایگان');
    expect(mount(QMoney, { props: { rial: 10, kind: 'prize' } }).find('.q-money__note').text()).toBe('بدون تضمین');
    expect(mount(QMoney, { props: { rial: 10, kind: 'prize', note: false } }).find('.q-money__note').exists()).toBe(false);
    setLocale('en', { keepDocument: true });
    expect(mount(QMoney, { props: { rial: 0, kind: 'fee' } }).text()).toBe('Free');
    expect(mount(QMoney, { props: { rial: 10, kind: 'prize' } }).find('.q-money__note').text()).toBe('Not guaranteed');
    const xl = mount(QMoney, { props: { rial: 1200000, size: 'xl' } });
    expect(xl.classes()).toContain('q-money--xl');
    expect(xl.find('.q-money__value').text()).toBe('120,000');
    expect(xl.find('.q-money__unit').text()).toBe('Toman');
  });
});
