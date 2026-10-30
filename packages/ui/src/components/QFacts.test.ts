import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QFacts from './QFacts.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QFacts', () => {
  it('dl grid with localised numbers, ltr isolate and hints', async () => {
    const w = mount(QFacts, { props: { items: [{ label: 'تیم‌ها', value: 16, icon: 'users' }, { label: 'منطقه', value: 'Asia/Tehran', ltr: true, hint: 'UTC+3:30' }] } });
    expect(w.classes()).toEqual(['q-facts', 'q-facts--cols-3']);
    expect(w.findAll('.q-facts__item')).toHaveLength(2);
    expect(w.find('dd').text()).toBe('۱۶');
    expect(w.find('dt svg').exists()).toBe(true);
    expect(w.find('.q-ltr').text()).toBe('Asia/Tehran');
    expect(w.find('.q-facts__hint').text()).toBe('UTC+3:30');
    setLocale('en', { keepDocument: true });
    await w.vm.$nextTick();
    expect(w.find('dd').text()).toBe('16');
  });
  it('list variant, dense, invalid columns → 3', () => {
    expect(mount(QFacts, { props: { items: [], variant: 'list', dense: true } }).classes()).toEqual(['q-facts', 'q-facts--list', 'q-facts--dense']);
    expect(mount(QFacts, { props: { items: [], columns: 4 } }).classes()).toContain('q-facts--cols-4');
  });
});
