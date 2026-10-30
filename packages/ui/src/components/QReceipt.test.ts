import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QReceipt from './QReceipt.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));
const items = [{ label: 'ورودی تیمی', amountRial: 2000000 }];

describe('QReceipt', () => {
  it('fa verified: table semantics, totals never rounded, negative LTR, status note', () => {
    const w = mount(QReceipt, { props: { items, discountRial: 200005, feeRial: 10000, orderId: 'ORD-9', date: '2026-12-03T15:00:00Z' } });
    expect(w.classes()).toEqual(['q-receipt', 'q-receipt--verified']);
    expect(w.attributes('aria-labelledby')).toBe(w.find('h3').attributes('id'));
    expect(w.find('h3').text()).toBe('رسید پرداخت');
    expect(w.find('.q-badge--success').text()).toBe('موفق تأییدشده');
    expect(w.find('caption.q-sr').text()).toBe('اقلام');
    expect(w.findAll('th[scope="col"]')).toHaveLength(2);
    expect(w.find('tfoot th').attributes('scope')).toBe('row');
    expect(w.find('tfoot .q-receipt__amt').text()).toBe('۱۸۰٬۹۹۹ تومان و ۵ ریال');
    const adj = w.find('.q-receipt__adj .q-receipt__amt');
    expect(adj.find('.q-ltr').text()).toBe('−۲۰٬۰۰۰');
    expect(adj.text()).toBe('−۲۰٬۰۰۰ تومان و ۵ ریال');
    expect(w.find('.q-receipt__mono').text()).toBe('ORD-9');
    expect(w.find('.q-receipt__note').attributes('role')).toBe('status');
    expect(w.find('.q-receipt__actions .q-btn--secondary').text()).toBe('دانلود رسید');
    expect(w.find('img.q-logo').exists()).toBe(true);
  });
  it('en failed: retry listener, no download; print listener; onDownload false', async () => {
    setLocale('en', { keepDocument: true });
    let retry = 0, print = 0;
    const w = mount(QReceipt, { props: { items, state: 'failed', onRetry: () => { retry++; }, onPrint: () => { print++; } } });
    expect(w.find('.q-receipt__note').text()).toContain('Payment failed.');
    expect(w.find('.q-btn--secondary').exists()).toBe(false);
    await w.find('.q-btn--primary').trigger('click');
    expect(retry).toBe(1);
    await w.find('.q-btn--ghost').trigger('click');
    expect(print).toBe(1);
    expect(mount(QReceipt, { props: { items, onDownload: false } }).find('.q-receipt__actions .q-btn').exists()).toBe(false);
    let dl = 0;
    const d = mount(QReceipt, { props: { items, totalRial: 5, onDownload: () => { dl++; } } });
    expect(d.find('tfoot .q-receipt__amt').text()).toBe('0 Toman and 5 Rial');
    await d.find('.q-btn--secondary').trigger('click');
    expect(dl).toBe(1);
    expect(mount(QReceipt, { props: { items, downloadHref: '/r.pdf' } }).find('a.q-btn').attributes('href')).toBe('/r.pdf');
  });
});
