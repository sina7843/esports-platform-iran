import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QAlert from './QAlert.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QAlert', () => {
  it('info by default with role=status, title, body, actions', async () => {
    const onClick = vi.fn();
    const w = mount(QAlert, { props: { title: 'پرداخت در انتظار', actions: [{ label: 'بررسی' }, { label: 'جزئیات', onClick }] }, slots: { default: 'متن' } });
    expect(w.classes()).toEqual(['q-alert', 'q-alert--info']);
    expect(w.attributes('role')).toBe('status');
    expect(w.find('.q-alert__title').text()).toBe('پرداخت در انتظار');
    expect(w.find('.q-alert__text').text()).toBe('متن');
    const btns = w.findAll('.q-alert__actions .q-btn');
    expect(btns[0]!.classes()).toEqual(['q-btn', 'q-btn--secondary', 'q-btn--sm']);
    expect(btns[1]!.classes()).toContain('q-btn--ghost');
    await btns[1]!.trigger('click');
    expect(onClick).toHaveBeenCalled();
    expect(w.find('.q-alert__close').exists()).toBe(false);
  });
  it('danger uses role=alert; dismissible hides itself (fa / en label)', async () => {
    const w = mount(QAlert, { props: { tone: 'danger', dismissible: true } });
    expect(w.attributes('role')).toBe('alert');
    expect(w.find('.q-alert__close').attributes('aria-label')).toBe('بستن پیام');
    setLocale('en', { keepDocument: true });
    await w.vm.$nextTick();
    expect(w.find('.q-alert__close').attributes('aria-label')).toBe('Dismiss message');
    await w.find('.q-alert__close').trigger('click');
    expect(w.emitted('dismiss')).toHaveLength(1);
    expect(w.find('.q-alert').exists()).toBe(false);
  });
  it('controlled open stays until the parent closes it; bound @dismiss shows ×', async () => {
    const w = mount(QAlert, { props: { tone: 'warning', open: true, onDismiss: () => {} } });
    await w.find('.q-alert__close').trigger('click');
    expect(w.find('.q-alert').exists()).toBe(true);
    await w.setProps({ open: false });
    expect(w.find('.q-alert').exists()).toBe(false);
  });
});
