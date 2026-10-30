import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QTopBar from './QTopBar.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QTopBar', () => {
  it('public: default nav, guest sign-in, active link', () => {
    const w = mount(QTopBar, { props: { active: 'news' } });
    expect(w.classes()).toEqual(['q-top-bar', 'q-top-bar--public']);
    const links = w.findAll('.q-top-bar__nav .q-top-bar__link');
    expect(links.map((l) => l.text())).toEqual(['رویدادها', 'رده‌بندی', 'بازی‌ها', 'اخبار', 'جذب و تمرین', 'برگزارکنندگان']);
    expect(w.find('.q-top-bar__nav').attributes('aria-label')).toBe('ناوبری اصلی');
    expect(links[3]!.attributes('aria-current')).toBe('page');
    expect(links[3]!.classes()).toContain('is-active');
    const login = w.find('a.q-top-bar__login');
    expect(login.attributes('href')).toBe('/login');
    expect(login.text()).toBe('ورود');
    expect(w.find('.q-top-bar__brand').attributes('aria-label')).toBe('پلتفرم ورزش‌های الکترونیکی');
    expect(w.find('.q-top-bar__icon[aria-label="جست‌وجو"]').element.tagName).toBe('BUTTON');
    expect(w.find('.q-top-bar__icon--settings').attributes('aria-label')).toBe('تنظیمات نمایش');
    expect(w.find('[aria-label^="اعلان‌ها"]').exists()).toBe(false);
  });

  it('en strings', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QTopBar, { props: { variant: 'panel', connection: 'poll', lastUpdate: '18:32', notifications: 3 } });
    expect(w.find('.q-top-bar__conn').text()).toContain('Periodic refresh');
    expect(w.find('.q-top-bar__conn-last').text()).toBe('Last update 18:32');
    expect(w.find('[aria-label="Notifications, 3 unread"]').exists()).toBe(true);
    expect(w.find('.q-top-bar__menu').attributes('aria-label')).toBe('Menu');
    expect(w.find('.q-top-bar__login').text()).toBe('Sign in');
  });

  it('panel: menu button controls the side nav (v-model:menuOpen + menu emit), connection chip, bell', async () => {
    const w = mount(QTopBar, {
      props: { variant: 'panel' as const, connection: 'offline' as const, notifications: 120, menuControls: 'side-nav', menuOpen: false, 'onUpdate:menuOpen': (v: boolean | undefined): void => { void w.setProps({ menuOpen: !!v }); } },
    });
    expect(w.classes()).toContain('q-top-bar--panel');
    expect(w.find('.q-top-bar__nav').exists()).toBe(false);
    const menu = w.find('.q-top-bar__menu');
    expect(menu.classes()).toContain('q-top-bar__menu--always');
    expect(menu.attributes('aria-controls')).toBe('side-nav');
    expect(menu.attributes('aria-expanded')).toBe('false');
    expect(menu.attributes('aria-label')).toBe('منو');
    await menu.trigger('click');
    expect(w.emitted('menu')).toHaveLength(1);
    expect(w.emitted('update:menuOpen')![0]).toEqual([true]);
    expect(w.find('.q-top-bar__menu').attributes('aria-expanded')).toBe('true');
    expect(w.find('.q-top-bar__menu').attributes('aria-label')).toBe('بستن منو');
    const conn = w.find('.q-top-bar__conn');
    expect(conn.attributes('role')).toBe('status');
    expect(conn.attributes('data-tone')).toBe('down');
    expect(conn.text()).toContain('آفلاین');
    expect(w.find('.q-top-bar__count').text()).toBe('۹۹+');
    expect(w.find('[aria-label="اعلان‌ها، ۱۲۰ خوانده‌نشده"]').exists()).toBe(true);
  });

  it('public without @menu opens its own sheet; choosing a link emits navigate and closes it', async () => {
    const w = mount(QTopBar, { props: { items: [{ key: 'a', label: 'A', href: '/a' }] } });
    expect(w.find('.q-top-bar__sheet').exists()).toBe(false);
    await w.find('.q-top-bar__menu').trigger('click');
    const sheet = w.find('.q-top-bar__sheet');
    expect(sheet.exists()).toBe(true);
    expect(w.find('.q-top-bar__menu').attributes('aria-controls')).toBe(sheet.attributes('id'));
    await sheet.find('.q-top-bar__sheet-link').trigger('click');
    expect(w.emitted('navigate')![0]![0]).toBe('a');
    expect(w.find('.q-top-bar__sheet').exists()).toBe(false);
  });

  it('public with @menu does not open the sheet', async () => {
    let calls = 0;
    const w = mount(QTopBar, { props: { onMenu: () => { calls++; } } });
    await w.find('.q-top-bar__menu').trigger('click');
    expect(calls).toBe(1);
    expect(w.find('.q-top-bar__sheet').exists()).toBe(false);
  });

  it('signed-in user and link icons', async () => {
    const w = mount(QTopBar, {
      props: { user: { name: 'سارا', href: '/account' }, searchHref: '/search', notificationsHref: '/notifications', notifications: 2 },
    });
    expect(w.find('.q-top-bar__login').exists()).toBe(false);
    const u = w.find('a.q-top-bar__user');
    expect(u.attributes('href')).toBe('/account');
    expect(u.attributes('aria-label')).toBe('سارا');
    expect(u.find('.q-top-bar__avatar').text()).toBe('س');
    expect(w.find('a[href="/search"]').classes()).toContain('q-top-bar__icon');
    expect(w.find('a[href="/notifications"] .q-top-bar__count').text()).toBe('۲');
    await w.find('.q-top-bar__icon--settings').trigger('click');
    expect(w.emitted('settings')).toHaveLength(1);
  });

  it('login button without href when @login is bound', async () => {
    const w = mount(QTopBar, { props: { onLogin: () => undefined } });
    expect(w.find('button.q-top-bar__login').exists()).toBe(true);
  });
});
