import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QDecisionBox from './QDecisionBox.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QDecisionBox', () => {
  it('pending: badge, amount, facts, required reason', () => {
    const w = mount(QDecisionBox, { props: { rial: 1200000, requestedBy: 'علی', action: 'refund.request' } });
    expect(w.classes()).toEqual(['q-decision-box', 'q-decision-box--pending']);
    expect(w.attributes('aria-labelledby')).toBe(w.find('h3').attributes('id'));
    expect(w.find('.q-badge').text()).toBe('در انتظار تصمیم');
    expect(w.find('.q-decision-box__code').text()).toBe('refund.request');
    expect(w.find('.q-money--xl').exists()).toBe(true);
    expect(w.find('.q-decision-box__fact dt').text()).toBe('درخواست‌دهنده');
    const ta = w.find('textarea');
    expect(ta.attributes('aria-required')).toBe('true');
    expect(w.find('label').attributes('for')).toBe(ta.attributes('id'));
  });
  it('approve without a reason shows the alert, focuses the field and does not emit', async () => {
    const w = mount(QDecisionBox, { attachTo: document.body });
    await w.findAll('button')[0]!.trigger('click');
    expect(w.emitted('approve')).toBeUndefined();
    const ta = w.find('textarea');
    expect(ta.attributes('aria-invalid')).toBe('true');
    const err = w.find('[role="alert"]');
    expect(ta.attributes('aria-describedby')).toBe(err.attributes('id'));
    expect(err.text()).toBe('نوشتن دلیل الزامی است.');
    expect(document.activeElement).toBe(ta.element);
    await ta.setValue('  ok  ');
    expect(w.emitted('reasonChange')?.at(-1)).toEqual(['  ok  ']);
    await w.findAll('button')[1]!.trigger('click');
    expect(w.emitted('reject')).toEqual([['ok']]);
    w.unmount();
  });
  it('reasonRequired=reject lets approve pass empty; cancel only with a listener', async () => {
    const w = mount(QDecisionBox, { props: { reasonRequired: 'reject', onCancel: () => {} } });
    expect(w.find('.q-decision-box__req').text()).toBe('(برای رد الزامی)');
    await w.findAll('button')[0]!.trigger('click');
    expect(w.emitted('approve')).toEqual([['']]);
    expect(w.findAll('button')).toHaveLength(3);
    await w.findAll('button')[2]!.trigger('click');
    expect(w.emitted('cancel')).toHaveLength(1);
    expect(mount(QDecisionBox).findAll('button')).toHaveLength(2);
  });
  it('minReasonLength message in fa', async () => {
    const w = mount(QDecisionBox, { props: { minReasonLength: 5, reason: 'abc' } });
    await w.findAll('button')[0]!.trigger('click');
    expect(w.find('[role="alert"]').text()).toBe('دلیل باید دست‌کم ۵ نویسه باشد.');
  });
  it('blocked and busy disable the buttons', () => {
    const w = mount(QDecisionBox, { props: { canDecide: false, blockedText: 'خودتان درخواست داده‌اید' } });
    expect(w.find('.q-decision-box__blocked').text()).toBe('خودتان درخواست داده‌اید');
    expect(w.findAll('button').every((b) => b.attributes('disabled') !== undefined)).toBe(true);
    const busy = mount(QDecisionBox, { props: { busy: 'approve' } });
    expect(busy.findAll('button')[0]!.attributes('aria-busy')).toBe('true');
    expect(busy.findAll('button')[1]!.attributes('disabled')).toBeDefined();
  });
  it('decided state in en', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QDecisionBox, { props: { state: 'rejected', decision: { by: 'Sara', reason: 'dup' }, requiresSecond: true } });
    expect(w.find('.q-badge').text()).toBe('Rejected');
    expect(w.find('textarea').exists()).toBe(false);
    expect(w.find('.q-decision-box__reason').text()).toBe('Reason: dup');
    expect(w.find('.q-decision-box__meta').text()).toBe('Rejected by: Sara');
    expect(w.find('.q-decision-box__second-text').text()).toBe('This action needs a second person’s approval.');
  });
});
