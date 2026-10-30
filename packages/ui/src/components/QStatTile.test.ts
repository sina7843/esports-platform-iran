import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QStatTile from './QStatTile.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QStatTile', () => {
  it('groups numbers and renders delta (fa / en)', async () => {
    const w = mount(QStatTile, { props: { label: 'ثبت‌نام‌ها', value: 12000, unit: 'نفر', icon: 'users', delta: 2, trend: 'up', deltaLabel: 'دو مورد بیشتر', caption: 'از فهرست بارگذاری‌شده' } });
    expect(w.classes()).toEqual(['q-stat-tile']);
    expect(w.find('.q-stat-tile__value').text()).toBe('۱۲٬۰۰۰');
    expect(w.find('.q-stat-tile__value').classes()).toEqual(['q-stat-tile__value', 'numeral', 'q-num']);
    expect(w.find('.q-stat-tile__delta').classes()).toContain('q-stat-tile__delta--success');
    expect(w.find('.q-stat-tile__delta .q-num').text()).toBe('۲');
    expect(w.find('.q-stat-tile__delta .q-sr').text()).toBe('دو مورد بیشتر');
    expect(w.find('.q-stat-tile__caption').exists()).toBe(true);
    setLocale('en', { keepDocument: true });
    await w.vm.$nextTick();
    expect(w.find('.q-stat-tile__value').text()).toBe('12,000');
  });
  it('decimals and string values; flat trend has no icon', () => {
    expect(mount(QStatTile, { props: { label: 'x', value: 12500.5 } }).find('.q-stat-tile__value').text()).toBe('۱۲٬۵۰۰٫۵');
    const w = mount(QStatTile, { props: { label: 'x', value: '—', delta: '+۰' } });
    expect(w.find('.q-stat-tile__value').text()).toBe('—');
    expect(w.find('.q-stat-tile__delta').classes()).toContain('q-stat-tile__delta--neutral');
    expect(w.find('.q-stat-tile__delta svg').exists()).toBe(false);
  });
});
