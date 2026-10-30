import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QPageHeader from './QPageHeader.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QPageHeader', () => {
  it('breadcrumb, h1, status badge, description, slots', () => {
    const w = mount(QPageHeader, {
      props: {
        title: 'لیگ پاییزه', description: 'توضیح', compact: true, eyebrow: 'رویداد',
        breadcrumb: [{ label: 'رویدادها', href: '/events' }, { label: 'لیگ پاییزه' }],
        status: { label: 'ثبت‌نام باز', tone: 'success', dot: true },
      },
      slots: { actions: '<button class="act">ثبت‌نام</button>', meta: 'برگزارکننده' },
    });
    expect(w.classes()).toEqual(['q-page-header', 'q-page-header--compact']);
    expect(w.find('nav.q-breadcrumb').exists()).toBe(true);
    expect(w.find('h1.q-page-header__title').text()).toBe('لیگ پاییزه');
    const badge = w.find('.q-page-header__title-row .q-badge');
    expect(badge.classes()).toContain('q-badge--success');
    expect(badge.text()).toBe('ثبت‌نام باز');
    expect(w.find('.q-page-header__eyebrow .q-tricolor').exists()).toBe(true);
    expect(w.find('.q-page-header__desc').text()).toBe('توضیح');
    expect(w.find('.q-page-header__meta').text()).toBe('برگزارکننده');
    expect(w.find('.q-page-header__actions .act').exists()).toBe(true);
  });

  it('title slot wins; optional parts are omitted', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QPageHeader, { props: { title: 'x' }, slots: { title: '<em>Rich</em>' } });
    expect(w.find('h1 em').text()).toBe('Rich');
    expect(w.find('.q-breadcrumb').exists()).toBe(false);
    expect(w.find('.q-page-header__desc').exists()).toBe(false);
    expect(w.find('.q-page-header__actions').exists()).toBe(false);
    expect(w.find('.q-badge').exists()).toBe(false);
  });
});
