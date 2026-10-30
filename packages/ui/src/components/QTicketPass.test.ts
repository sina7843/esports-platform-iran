import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QTicketPass from './QTicketPass.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QTicketPass', () => {
  it('fa sample pass: QR role=img label, deterministic pseudo-QR, venue rows, equipment', () => {
    const props = { event: 'لن تهران', attendee: { name: 'کیان', team: 'سیمرغ', role: 'بازیکن' }, code: 'LAN-7Q4K', gate: 'B', venue: { name: 'سالن', station: 'تئاتر شهر' }, equipment: [{ item: 'ماوس' }] };
    const w = mount(QTicketPass, { props });
    expect(w.classes()).toEqual(['q-ticket-pass']);
    expect(w.attributes('aria-labelledby')).toBe(w.find('h3').attributes('id'));
    const qr = w.find('.q-ticket-pass__qr');
    expect(qr.attributes('role')).toBe('img');
    expect(qr.attributes('aria-label')).toBe('کد QR نمونه — قابل اسکن نیست');
    expect(w.find('.q-ticket-pass__sample').text()).toBe('نمونه');
    const d = w.find('.q-ticket-pass__qr-svg path').attributes('d');
    expect(d).toMatch(/^M0 0h1v1h-1z/);
    expect(mount(QTicketPass, { props }).find('.q-ticket-pass__qr-svg path').attributes('d')).toBe(d);
    expect(w.find('.q-ticket-pass__code').classes()).toContain('q-ltr');
    expect(w.findAll('.q-ticket-pass__venue dt').map((x) => x.text())).toEqual(['محل برگزاری', 'ورودی', 'ایستگاه']);
    expect(w.find('.q-ticket-pass__equip .q-badge--warning').text()).toBe('اعلام شد؛ در انتظار بازرسی');
    expect(w.find('.q-ticket-pass__tear').attributes('aria-hidden')).toBe('true');
  });
  it('en real QR via slot with sample=false', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QTicketPass, { props: { event: 'LAN', attendee: { name: 'K' }, sample: false, qrLabel: 'Gate QR' }, slots: { qr: '<svg class="real"></svg>' } });
    expect(w.find('.q-ticket-pass__qr').attributes('aria-label')).toBe('Gate QR');
    expect(w.find('.real').exists()).toBe(true);
    expect(w.find('.q-ticket-pass__qr-svg').exists()).toBe(false);
    expect(w.find('.q-ticket-pass__sample').exists()).toBe(false);
    expect(w.find('.q-ticket-pass__eyebrow').text()).toBe('Entry card');
    expect(w.find('.q-ticket-pass__rotate').text()).toBe('The code changes every minute and each code is accepted only once at the gate.');
    expect(mount(QTicketPass, { props: { event: 'LAN', attendee: { name: 'K' }, sample: false } }).find('.q-ticket-pass__qr').attributes('aria-label')).toBe('Entry card QR code');
  });
});
