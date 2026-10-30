import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setLocale } from '../locale';
import QProfileHeader from './QProfileHeader.vue';

afterEach(() => { setLocale('fa', { keepDocument: true }); document.body.innerHTML = ''; });

describe('QProfileHeader', () => {
  it('fa structure, labelled section, verified label per kind, empty career', () => {
    const w = mount(QProfileHeader, { props: { name: 'کیان', handle: '@kian', verified: true, honours: [{ label: 'قهرمان', rank: 1 }], facts: [{ label: 'شهر', value: 'تهران' }] } });
    expect(w.classes()).toEqual(['q-profile-header', 'q-profile-header--player']);
    const h = w.find('h1.q-profile-header__name');
    expect(w.attributes('aria-labelledby')).toBe(h.attributes('id'));
    expect(w.find('.q-profile-header__avatar').classes()).not.toContain('q-chamfer-lg');
    expect(w.find('.q-verified-mark').attributes('aria-label')).toBe('هویت تأییدشده');
    expect(w.find('.q-profile-header__sub').text()).toContain('بازیکن');
    expect(w.find('.q-profile-header__handle').classes()).toContain('q-ltr');
    expect(w.find('.q-profile-header__honour--gold').text()).toBe('قهرمان');
    expect(w.find('.q-profile-header__career--empty').text()).toBe('کارنامه‌ای ثبت نشده است');
    expect(w.find('.q-profile-header__facts dd').text()).toBe('تهران');
  });

  it('en team kind, heading level, hidden career and follow', async () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QProfileHeader, { props: { kind: 'team', name: 'Simorgh', verified: true, headingLevel: 2, hideCareer: true } });
    expect(w.find('h2').exists()).toBe(true);
    expect(w.find('.q-profile-header__avatar').classes()).toContain('q-chamfer-lg');
    expect(w.find('.q-verified-mark').attributes('aria-label')).toBe('Verified team');
    expect(w.find('.q-profile-header__career').exists()).toBe(false);
    await w.find('.q-profile-header__follow').trigger('click');
    expect(w.emitted('update:following')?.[0]).toEqual([true]);
    expect(w.find('.q-profile-header__follow').text()).toBe('Following');
    expect(mount(QProfileHeader, { props: { name: 'x', careerSummary: false } }).find('.q-profile-header__career').exists()).toBe(false);
    expect(mount(QProfileHeader, { props: { name: 'x', careerSummary: 'Gold' } }).find('.q-profile-header__career').text()).toBe('Gold');
    expect(mount(QProfileHeader, { props: { name: 'x', onFollowChange: false } }).find('.q-profile-header__follow').exists()).toBe(false);
  });

  it('menu: aria, keyboard, Escape returns focus, default items emit report/block', async () => {
    const w = mount(QProfileHeader, { props: { name: 'x' }, attachTo: document.body });
    const btn = w.find('.q-profile-header__menu > button');
    expect(btn.attributes('aria-label')).toBe('گزینه‌های بیشتر');
    expect(btn.attributes('aria-haspopup')).toBe('menu');
    expect(btn.attributes('aria-expanded')).toBe('false');
    await btn.trigger('click');
    await nextTick();
    const list = w.find('[role="menu"]');
    expect(btn.attributes('aria-controls')).toBe(list.attributes('id'));
    const items = w.findAll('[role="menuitem"]');
    expect(items.map((i) => i.text())).toEqual(['گزارش تخلف', 'مسدودکردن']);
    expect(items[1]!.classes()).toContain('q-profile-header__menu-item--danger');
    expect(document.activeElement).toBe(items[0]!.element);
    await list.trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]!.element);
    await list.trigger('keydown', { key: 'Home' });
    expect(document.activeElement).toBe(items[0]!.element);
    await list.trigger('keydown', { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[1]!.element);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(w.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(btn.element);
    await btn.trigger('click');
    await w.findAll('[role="menuitem"]')[1]!.trigger('click');
    expect(w.emitted('block')).toHaveLength(1);
    await btn.trigger('click');
    await w.findAll('[role="menuitem"]')[0]!.trigger('click');
    expect(w.emitted('report')).toHaveLength(1);
    w.unmount();
  });

  it('custom menu items and actions slot', async () => {
    let hit = 0;
    const w = mount(QProfileHeader, {
      props: { name: 'x', defaultMenuOpen: true, menuItems: [{ label: 'A', onSelect: () => { hit++; } }] },
      slots: { actions: '<button class="extra">e</button>' },
    });
    expect(w.find('.q-profile-header__actions .extra').exists()).toBe(true);
    await w.find('[role="menuitem"]').trigger('click');
    expect(hit).toBe(1);
    expect(mount(QProfileHeader, { props: { name: 'x', menuItems: [] } }).find('.q-profile-header__menu').exists()).toBe(false);
  });
});
