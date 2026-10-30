import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setLocale } from '../locale';
import QConfirmDialog from './QConfirmDialog.vue';

afterEach(() => {
  setLocale('fa', { keepDocument: true });
  document.body.innerHTML = '';
});

describe('QConfirmDialog', () => {
  it('alertdialog, reason gating, consequences, second approval, confirm with trimmed reason', async () => {
    const w = mount(QConfirmDialog, {
      props: { open: true, inline: true, title: 'لغو رویداد', message: 'برگشت‌ناپذیر است', consequences: ['الف', 'ب'], secondApproval: true },
    });
    const panel = w.find('.q-dialog__panel');
    expect(panel.attributes('role')).toBe('alertdialog');
    expect(panel.classes()).toEqual(['q-dialog__panel', 'q-dialog__panel--sm', 'q-confirm-dialog']);
    expect(w.find('.q-dialog__icon--danger').exists()).toBe(true);
    expect(w.find('.q-confirm-dialog__message').text()).toBe('برگشت‌ناپذیر است');
    expect(w.findAll('.q-confirm-dialog__list li')).toHaveLength(2);
    expect(w.find('.q-confirm-dialog__note').text()).toBe('این اقدام به تأیید دوم نیاز دارد');
    const ta = w.find('textarea');
    expect(ta.attributes('required')).toBeDefined();
    expect(ta.attributes('aria-required')).toBe('true');
    expect(w.find(`#${ta.attributes('aria-describedby')}`).text()).toBe('تا دلیل را ننویسید، دکمهٔ تأیید فعال نمی‌شود.');
    expect(w.find(`label[for="${ta.attributes('id')}"]`).text()).toBe('دلیل را بنویسید *');
    const [cancel, ok] = w.findAll('.q-dialog__foot .q-btn');
    expect(cancel!.text()).toBe('انصراف');
    expect(ok!.classes()).toContain('q-btn--danger');
    expect(ok!.attributes('disabled')).toBeDefined();
    await ta.setValue('  تخلف  ');
    expect(w.emitted('reasonChange')![0]).toEqual(['  تخلف  ']);
    expect(w.findAll('.q-dialog__foot .q-btn')[1]!.attributes('disabled')).toBeUndefined();
    await w.findAll('.q-dialog__foot .q-btn')[1]!.trigger('click');
    expect(w.emitted('confirm')![0]).toEqual(['تخلف']);
    await w.findAll('.q-dialog__foot .q-btn')[0]!.trigger('click');
    expect(w.emitted('close')).toHaveLength(1);
    expect(w.emitted('update:open')![0]).toEqual([false]);
  });

  it('focus starts in the reason field (modal)', async () => {
    const w = mount(QConfirmDialog, { attachTo: document.body, props: { open: true, title: 't' } });
    await nextTick();
    expect(document.activeElement).toBe(w.find('textarea').element);
    w.unmount();
  });

  it('primary tone + optional reason, en strings', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QConfirmDialog, { props: { open: true, inline: true, title: 'Publish', tone: 'primary', reasonOptional: true } });
    expect(w.find('.q-dialog__panel').classes()).toContain('q-confirm-dialog--primary');
    expect(w.find('.q-dialog__icon--info').exists()).toBe(true);
    expect(w.find('label').text()).toBe('Reason (optional)');
    expect(w.find('textarea').attributes('required')).toBeUndefined();
    expect(w.find('.q-confirm-dialog__hint').text()).toBe('A reason is optional; if you write one, it is kept in the record.');
    const ok = w.findAll('.q-dialog__foot .q-btn')[1]!;
    expect(ok.classes()).toContain('q-btn--primary');
    expect(ok.text()).toBe('Confirm');
    expect(ok.attributes('disabled')).toBeUndefined();
    expect(w.find('.q-dialog__close').attributes('aria-label')).toBe('Close');
  });

  it('requireReason=false hides the field', () => {
    const w = mount(QConfirmDialog, { props: { open: true, inline: true, title: 't', requireReason: false } });
    expect(w.find('textarea').exists()).toBe(false);
  });
});
