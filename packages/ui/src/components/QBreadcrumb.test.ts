import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QBreadcrumb from './QBreadcrumb.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

const items = [
  { label: 'خانه', href: '/' }, { label: 'رویدادها', href: '/events' }, { label: 'لیگ', href: '/events/1' },
  { label: 'مرحله', href: '/events/1/stages' }, { label: 'گروه الف' },
];

describe('QBreadcrumb', () => {
  it('ordered list, links, current page, flipped separators', () => {
    const w = mount(QBreadcrumb, { props: { items: items.slice(0, 3) } });
    expect(w.classes()).toEqual(['q-breadcrumb']);
    expect(w.attributes('aria-label')).toBe('مسیر صفحه');
    expect(w.findAll('li.q-breadcrumb__item')).toHaveLength(3);
    expect(w.findAll('a.q-breadcrumb__link').map((a) => a.attributes('href'))).toEqual(['/', '/events']);
    const cur = w.find('.q-breadcrumb__current');
    expect(cur.text()).toBe('لیگ');
    expect(cur.attributes('aria-current')).toBe('page');
    const seps = w.findAll('svg.q-breadcrumb__sep');
    expect(seps).toHaveLength(2);
    expect(seps[0]!.classes()).toContain('q-icon-flip');
  });

  it('collapses the middle into «…» with maxItems', () => {
    const w = mount(QBreadcrumb, { props: { items, maxItems: 3 } });
    const lis = w.findAll('li');
    expect(lis).toHaveLength(3);
    expect(lis[1]!.find('.q-breadcrumb__gap').attributes('title')).toBe('رویدادها / لیگ / مرحله');
    expect(lis[2]!.text()).toBe('گروه الف');
  });

  it('en label', () => {
    setLocale('en', { keepDocument: true });
    expect(mount(QBreadcrumb, { props: { items } }).attributes('aria-label')).toBe('Breadcrumb');
  });
});
