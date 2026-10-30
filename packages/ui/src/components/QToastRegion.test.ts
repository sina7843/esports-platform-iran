import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import { useToast } from '../composables/useToast';
import QToastRegion from './QToastRegion.vue';

afterEach(() => { setLocale('fa', { keepDocument: true }); useToast().clear(); });

describe('QToastRegion', () => {
  it('labelled polite live region (fa / en)', async () => {
    const w = mount(QToastRegion, { props: { inline: true } });
    expect(w.element.tagName).toBe('SECTION');
    expect(w.classes()).toEqual(['q-toast-region', 'q-toast-region--inline']);
    expect(w.attributes('aria-live')).toBe('polite');
    expect(w.attributes('aria-relevant')).toBe('additions');
    expect(w.attributes('aria-label')).toBe('اعلان‌ها');
    setLocale('en', { keepDocument: true });
    await w.vm.$nextTick();
    expect(w.attributes('aria-label')).toBe('Notifications');
  });
  it('renders toasts from useToast(); @dismiss gives each a close that reports its id', async () => {
    const { toasts, push, dismiss } = useToast();
    const id = push({ tone: 'success', message: 'درخواست ثبت شد.' });
    push({ tone: 'danger', message: 'خطا' });
    const w = mount(QToastRegion, { props: { toasts, onDismiss: dismiss } });
    expect(w.findAll('.q-toast')).toHaveLength(2);
    await w.find('.q-toast__close').trigger('click');
    expect(w.emitted('dismiss')?.[0]).toEqual([id]);
    expect(toasts).toHaveLength(1);
  });
  it('slot children when no toasts prop', () => {
    const w = mount(QToastRegion, { slots: { default: '<p class="child">x</p>' } });
    expect(w.find('.child').exists()).toBe(true);
  });
});
