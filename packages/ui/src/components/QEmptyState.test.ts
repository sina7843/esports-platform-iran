import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QEmptyState from './QEmptyState.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QEmptyState', () => {
  it('default title and inbox icon (fa / en); no body', async () => {
    const w = mount(QEmptyState);
    expect(w.classes()).toEqual(['q-empty-state', 'q-empty-state--neutral']);
    expect(w.find('.q-empty-state__title').text()).toBe('موردی برای نمایش وجود ندارد.');
    expect(w.find('.q-empty-state__body').exists()).toBe(false);
    setLocale('en', { keepDocument: true });
    await w.vm.$nextTick();
    expect(w.find('.q-empty-state__title').text()).toBe('Nothing to show.');
  });
  it('later variant: info tone with the later-stage texts', () => {
    const w = mount(QEmptyState, { props: { variant: 'later', compact: true, bordered: false } });
    expect(w.classes()).toEqual(['q-empty-state', 'q-empty-state--info', 'q-empty-state--compact', 'q-empty-state--plain']);
    expect(w.find('.q-empty-state__title').text()).toBe('این بخش در مرحله بعد تکمیل می‌شود');
    expect(w.find('.q-empty-state__body').text()).toBe('داده‌ی واقعی این بخش هنوز وجود ندارد و داده‌ی نمایشی ساخته نمی‌شود.');
  });
  it('action button emits action; role falls through', async () => {
    const w = mount(QEmptyState, { props: { title: 'هنوز تیمی نیست', body: 'متن', actionLabel: 'ساخت تیم', actionIcon: 'plus' }, attrs: { role: 'status' } });
    expect(w.attributes('role')).toBe('status');
    expect(w.find('.q-empty-state__body').text()).toBe('متن');
    const b = w.find('.q-empty-state__action .q-btn');
    expect(b.classes()).toEqual(['q-btn', 'q-btn--green', 'q-btn--md']);
    await b.trigger('click');
    expect(w.emitted('action')).toHaveLength(1);
  });
});
