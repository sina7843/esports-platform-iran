import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QRulesClause from './QRulesClause.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QRulesClause', () => {
  it('fa: number, anchor, kind, version, amended, body slot wins', () => {
    const w = mount(QRulesClause, {
      props: { number: '4.2', anchor: 'veto.order', title: 'ترتیب حذف', body: 'متن', kind: 'mandatory', version: 'v1.3.0', amended: { version: 'v1.3.0', note: 'تغییر' } },
      slots: { default: 'اسلات' },
    });
    expect(w.classes()).toEqual(['q-rules-clause', 'q-rules-clause--amended']);
    expect(w.attributes('id')).toBe('veto.order');
    expect(w.attributes('aria-labelledby')).toBe(w.find('h3').attributes('id'));
    expect(w.find('.q-rules-clause__num').text()).toBe('بند ۴٫۲');
    const a = w.find('.q-rules-clause__anchor');
    expect(a.attributes('href')).toBe('#veto.order');
    expect(a.attributes('aria-label')).toBe('پیوند به بند ۴٫۲');
    expect(w.find('.q-badge').text()).toBe('اجباری');
    expect(w.find('.q-rules-clause__body').text()).toBe('اسلات');
    expect(w.find('.q-rules-clause__amend').attributes('role')).toBe('note');
    expect(w.find('.q-rules-clause__amend').text()).toBe('اصلاح‌شده در v1.3.0؛ تغییر');
  });
  it('en acceptance: native checkbox with label, uncontrolled toggle emits', async () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QRulesClause, { props: { number: '1', title: 't', body: 'b', requireAcceptance: true, acceptedAt: '2026-12-03T15:00:00Z' } });
    expect(w.find('.q-rules-clause__num').text()).toBe('Clause 1');
    const input = w.find('input[type="checkbox"]');
    expect(w.find('label').attributes('for')).toBe(input.attributes('id'));
    expect(w.find('label').text()).toBe('I have read and accept this clause');
    await input.setValue(true);
    expect(w.emitted('acceptChange')?.[0]).toEqual([true]);
    expect(w.emitted('update:accepted')?.[0]).toEqual([true]);
    expect(w.find('.q-rules-clause__accept--on').exists()).toBe(true);
    expect(w.find('label').text()).toBe('Accepted');
    expect(w.find('.q-rules-clause__accepted-at time').text()).toBe('3 December 2026 at 18:30');
  });
  it('controlled accepted stays until the parent updates; locked disables', async () => {
    const w = mount(QRulesClause, { props: { number: '1', title: 't', requireAcceptance: true, accepted: false } });
    await w.find('input').setValue(true);
    expect(w.emitted('acceptChange')?.[0]).toEqual([true]);
    expect((w.find('input').element as HTMLInputElement).checked).toBe(false);
    const l = mount(QRulesClause, { props: { number: '1', title: 't', requireAcceptance: true, acceptLocked: true, defaultAccepted: true } });
    expect(l.find('input').attributes('disabled')).toBeDefined();
    expect((l.find('input').element as HTMLInputElement).checked).toBe(true);
  });
});
