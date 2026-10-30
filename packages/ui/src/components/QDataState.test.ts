import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QDataState from './QDataState.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QDataState', () => {
  it('content renders the default slot', () => {
    const w = mount(QDataState, { slots: { default: '<p class="c">data</p>' } });
    expect(w.find('.c').exists()).toBe(true);
  });
  it('loading: role=status, aria-busy, sr message, cards skeleton by default, rows on request', async () => {
    const w = mount(QDataState, { props: { loading: true } });
    expect(w.classes()).toEqual(['q-data-state', 'q-data-state--loading']);
    expect(w.attributes('role')).toBe('status');
    expect(w.attributes('aria-busy')).toBe('true');
    expect(w.attributes('style')).toContain('min-block-size: 384px');
    expect(w.find('.q-sr').text()).toBe('در حال بارگذاری…');
    expect(w.findAll('.q-data-state__cards .q-skeleton-card')).toHaveLength(3);
    await w.setProps({ skeleton: 'rows' });
    expect(w.findAll('.q-data-state__rows .q-skeleton-row')).toHaveLength(4);
    setLocale('en', { keepDocument: true });
    await w.vm.$nextTick();
    expect(w.find('.q-sr').text()).toBe('Loading…');
  });
  it('error: role=alert, request ID code, retry only with @retry; priority offline > error', async () => {
    const w = mount(QDataState, { props: { error: new Error('x'), loading: true, requestId: 'req_1', detail: 'سرور پاسخ نداد', onRetry: () => {} } });
    expect(w.classes()).toEqual(expect.arrayContaining(['q-empty-state', 'q-empty-state--danger', 'q-data-state', 'q-data-state--error']));
    expect(w.attributes('role')).toBe('alert');
    expect(w.find('.q-empty-state__title').text()).toBe('خطا در دریافت اطلاعات.');
    expect(w.find('.q-data-state__detail').text()).toBe('سرور پاسخ نداد');
    expect(w.find('.q-data-state__rid').text()).toContain('شناسه درخواست: ');
    expect(w.find('.q-data-state__rid code').text()).toBe('req_1');
    const retry = w.find('.q-empty-state__action .q-btn');
    expect(retry.text()).toBe('تلاش دوباره');
    await retry.trigger('click');
    expect(w.emitted('retry')).toHaveLength(1);
    await w.setProps({ offline: true });
    expect(w.classes()).toContain('q-data-state--offline');
    expect(w.find('.q-empty-state__title').text()).toBe('اتصال اینترنت برقرار نیست.');
    const noRetry = mount(QDataState, { props: { error: true } });
    expect(noRetry.find('.q-empty-state__action').exists()).toBe(false);
  });
  it('forbidden (en), empty with custom texts, later state', async () => {
    setLocale('en', { keepDocument: true });
    const f = mount(QDataState, { props: { forbidden: true, onRetry: () => {} } });
    expect(f.find('.q-empty-state__title').text()).toBe('No access');
    expect(f.find('.q-data-state__detail').text()).toBe('You do not have access to this area.');
    expect(f.find('.q-empty-state__action').exists()).toBe(false); // no retry on forbidden
    setLocale('fa', { keepDocument: true });
    const e = mount(QDataState, { props: { empty: true, emptyTitle: 'هنوز رویدادی نیست', emptyBody: 'بعداً سر بزنید' }, slots: { emptyAction: '<a class="act">ساخت</a>' } });
    expect(e.find('.q-empty-state__title').text()).toBe('هنوز رویدادی نیست');
    expect(e.find('.q-empty-state__body').text()).toBe('بعداً سر بزنید');
    expect(e.find('.act').exists()).toBe(true);
    const l = mount(QDataState, { props: { state: 'later' } });
    expect(l.classes()).toEqual(expect.arrayContaining(['q-empty-state--info', 'q-data-state--later']));
    expect(l.find('.q-empty-state__title').text()).toBe('این بخش در مرحله بعد تکمیل می‌شود');
    expect(l.attributes('role')).toBeUndefined();
  });
});
