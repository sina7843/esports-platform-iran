import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QCode from './QCode.vue';

const writeText = vi.fn(() => Promise.resolve());
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => { vi.useRealTimers(); writeText.mockClear(); setLocale('fa', { keepDocument: true }); });

describe('QCode', () => {
  it('inline, LTR, copy button labelled and «کپی شد» for 2 s', async () => {
    const w = mount(QCode, { props: { copy: true, label: 'شناسه درخواست' }, slots: { default: 'req_123' } });
    expect(w.classes()).toEqual(['q-code', 'q-code--inline']);
    expect(w.find('code').classes()).toEqual(['q-code__inline', 'q-ltr']);
    const btn = w.find('button');
    expect(btn.attributes('aria-label')).toBe('کپی شناسه درخواست');
    await btn.trigger('click');
    expect(writeText).toHaveBeenCalledWith('req_123');
    expect(w.emitted('copy')?.[0]).toEqual(['req_123']);
    expect(btn.attributes('aria-label')).toBe('کپی شد');
    expect(w.find('[role=status]').text()).toBe('کپی شد');
    vi.advanceTimersByTime(2000);
    await w.vm.$nextTick();
    expect(w.find('[role=status]').text()).toBe('');
  });
  it('block with bar label and en copy text', async () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QCode, { props: { block: true, copy: true, wrap: true, label: 'ICS', value: 'https://x/ics' } });
    expect(w.classes()).toEqual(['q-code', 'q-code--block', 'q-code--wrap']);
    expect(w.find('pre').classes()).toEqual(['q-code__pre', 'q-ltr']);
    expect(w.find('pre code').text()).toBe('https://x/ics');
    expect(w.find('.q-code__copy span').text()).toBe('Copy');
    await w.find('.q-code__copy').trigger('click');
    expect(w.find('.q-code__copy span').text()).toBe('Copied');
  });
});
