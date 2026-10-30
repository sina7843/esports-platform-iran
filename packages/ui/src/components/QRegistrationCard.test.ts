import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QRegistrationCard from './QRegistrationCard.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QRegistrationCard', () => {
  it('fa awaiting_payment: badge, fee in toman, next note, pay action emits key', async () => {
    const w = mount(QRegistrationCard, { props: { event: 'جام', eventHref: '/events/1', game: 'Valorant', team: 'سیمرغ', state: 'awaiting_payment', trackingCode: 'REG-1', amountRial: 1200005 } });
    expect(w.classes()).toEqual(['q-registration-card', 'q-registration-card--awaiting_payment']);
    expect(w.attributes('aria-labelledby')).toBe(w.find('h3').attributes('id'));
    expect(w.find('.q-badge--warning').text()).toBe('انتظار پرداخت');
    expect(w.find('.q-registration-card__code').classes()).toContain('q-ltr');
    expect(w.find('dd.q-num').text()).toBe('۱۲۰٬۰۰۰ تومان و ۵ ریال');
    expect(w.find('.q-registration-card__next').text()).toBe('ظرفیت برای شما نگه داشته شد؛ در مهلت تعیین‌شده پرداخت کنید.');
    const pay = w.find('.q-btn--primary');
    expect(pay.text()).toBe('پرداخت');
    await pay.trigger('click');
    expect(w.emitted('action')?.[0]).toEqual(['pay']);
    expect(w.find('.q-registration-card__withdraw').exists()).toBe(false);
  });
  it('en: free fee, solo, withdraw listener, checked-in confirmed hides the action, null action', async () => {
    setLocale('en', { keepDocument: true });
    let withdrawn = 0;
    const w = mount(QRegistrationCard, { props: { event: 'Cup', kind: 'player', state: 'confirmed', amountRial: 0, onWithdraw: () => { withdrawn++; } }, slots: { default: '<p class="extra">x</p>' } });
    expect(w.find('dd.q-num').text()).toBe('Free');
    expect(w.find('.q-registration-card__sub').text()).toBe('Solo');
    expect(w.find('.q-registration-card__extra .extra').exists()).toBe(true);
    expect(w.find('.q-btn--green').text()).toBe('Check in');
    const wd = w.find('.q-registration-card__withdraw');
    expect(wd.text()).toBe('Withdraw');
    await wd.trigger('click');
    expect(withdrawn).toBe(1);
    const c = mount(QRegistrationCard, { props: { event: 'Cup', state: 'confirmed', checkedIn: true } });
    expect(c.find('.q-registration-card__done').text()).toBe('Checked in.');
    expect(c.find('.q-registration-card__actions').exists()).toBe(false);
    expect(mount(QRegistrationCard, { props: { event: 'Cup', state: 'draft', action: null } }).find('.q-registration-card__actions').exists()).toBe(false);
    const wd2 = mount(QRegistrationCard, { props: { event: 'Cup', state: 'withdrawn', onWithdraw: () => undefined } });
    expect(wd2.find('.q-registration-card__withdraw').exists()).toBe(false);
  });
});
