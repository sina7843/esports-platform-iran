import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QPagination from './QPagination.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QPagination', () => {
  it('numbered: nav, pages with gaps, current page, prev disabled', () => {
    const w = mount(QPagination, { props: { pageCount: 12, defaultPage: 5, showSummary: true } });
    expect(w.element.tagName).toBe('NAV');
    expect(w.classes()).toEqual(['q-pagination', 'q-pagination--numbered']);
    expect(w.attributes('aria-label')).toBe('صفحه‌بندی');
    expect(w.findAll('.q-pagination__pages > li').map((l) => l.text())).toEqual(['۱', '…', '۴', '۵', '۶', '…', '۱۲']);
    const cur = w.find('.q-pagination__page.is-current');
    expect(cur.attributes('aria-current')).toBe('page');
    expect(cur.attributes('aria-label')).toBe('صفحهٔ ۵');
    expect(w.find('.q-pagination__summary').text()).toBe('صفحهٔ ۵ از ۱۲');
    expect(w.findAll('.q-pagination__step svg').every((s) => s.classes().includes('q-icon-flip'))).toBe(true);
  });

  it('v-model:page + change; bounds', async () => {
    const w = mount(QPagination, { props: { pageCount: 3, page: 1, 'onUpdate:page': (v: number | undefined) => w.setProps({ page: v ?? 1 }) } });
    const [prev, next] = w.findAll('.q-pagination__step');
    expect(prev!.attributes('disabled')).toBeDefined();
    expect(prev!.attributes('aria-label')).toBe('صفحهٔ قبل');
    await next!.trigger('click');
    expect(w.emitted('change')![0]).toEqual([2]);
    await w.findAll('.q-pagination__page')[2]!.trigger('click');
    expect(w.emitted('change')![1]).toEqual([3]);
    expect(w.findAll('.q-pagination__step')[1]!.attributes('disabled')).toBeDefined();
  });

  it('en strings', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QPagination, { props: { pageCount: 2 } });
    expect(w.attributes('aria-label')).toBe('Pagination');
    expect(w.findAll('.q-pagination__step-label').map((s) => s.text())).toEqual(['Previous', 'Next']);
    expect(w.find('.q-pagination__page').attributes('aria-label')).toBe('Page 1');
  });

  it('cursor: more button, live count, meter, done label', async () => {
    const w = mount(QPagination, { props: { mode: 'cursor', shown: 24, total: 118 } });
    expect(w.classes()).toEqual(['q-pagination', 'q-pagination--cursor']);
    const count = w.find('.q-pagination__count');
    expect(count.attributes('aria-live')).toBe('polite');
    expect(count.text()).toBe('۲۴ از ۱۱۸');
    expect(w.find('.q-pagination__meter span').attributes('style')).toContain('width: 20%');
    await w.find('button.q-btn').trigger('click');
    expect(w.emitted('more')).toHaveLength(1);
    expect(w.find('button.q-btn').text()).toBe('نمایش بیشتر');
    await w.setProps({ shown: 118 });
    expect(w.find('button.q-btn').exists()).toBe(false);
    expect(w.find('.q-pagination__count').text()).toBe('همهٔ ۱۱۸ مورد نمایش داده شد');
  });

  it('cursor: hasMore absent is not false; countLabel string / false; en', async () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QPagination, { props: { mode: 'cursor', shown: 24 } });
    expect(w.find('button.q-btn').text()).toBe('Load more');
    expect(w.find('.q-pagination__count').text()).toBe('24 of …');
    await w.setProps({ countLabel: '24 items' });
    expect(w.find('.q-pagination__count').text()).toBe('24 items');
    await w.setProps({ countLabel: false });
    expect(w.find('.q-pagination__count').text()).toBe('');
    await w.setProps({ hasMore: false });
    expect(w.find('.q-pagination__count').text()).toBe('All 24 items shown');
  });
});
