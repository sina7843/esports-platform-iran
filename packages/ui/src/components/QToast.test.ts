import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QToast from './QToast.vue';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); setLocale('fa', { keepDocument: true }); });

describe('QToast', () => {
  it('renders tone, message, action; no × without a close listener', async () => {
    const onClick = vi.fn();
    const w = mount(QToast, { props: { tone: 'success', title: 'انجام شد', message: 'انصراف ثبت شد.', action: { label: 'بازگردانی', onClick } } });
    expect(w.classes()).toEqual(['q-toast', 'q-toast--success']);
    expect(w.attributes('role')).toBeUndefined();
    expect(w.find('.q-toast__text').text()).toBe('انصراف ثبت شد.');
    await w.find('.q-toast__action').trigger('click');
    expect(onClick).toHaveBeenCalled();
    expect(w.find('.q-toast__close').exists()).toBe(false);
  });
  it('danger role=alert; close label fa / en; duration auto-closes', async () => {
    const onClose = vi.fn();
    const w = mount(QToast, { props: { tone: 'danger', message: 'x', duration: 3000, onClose } });
    expect(w.attributes('role')).toBe('alert');
    expect(w.find('.q-toast__close').attributes('aria-label')).toBe('بستن اعلان');
    setLocale('en', { keepDocument: true });
    await w.vm.$nextTick();
    expect(w.find('.q-toast__close').attributes('aria-label')).toBe('Dismiss notification');
    vi.advanceTimersByTime(3000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
