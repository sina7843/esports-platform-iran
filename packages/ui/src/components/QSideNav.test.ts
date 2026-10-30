import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setLocale } from '../locale';
import QSideNav, { type SideNavSection } from './QSideNav.vue';

afterEach(() => {
  setLocale('fa', { keepDocument: true });
  document.body.innerHTML = '';
});

const sections: SideNavSection[] = [
  { title: 'عمومی', items: [{ key: 'home', label: 'خانه', icon: 'home', href: '/' }, { key: 'events', label: 'رویدادها', href: '/events' }] },
  { title: 'نقش‌ها', items: [{ key: 'tickets', label: 'تیکت‌ها', icon: 'inbox', href: '/admin/tickets', count: 6 }] },
];

describe('QSideNav', () => {
  it('rail: labelled nav, sections, active item, counts', () => {
    const w = mount(QSideNav, { props: { sections, active: 'tickets', id: 'side-nav' }, attrs: { class: 'extra' } });
    expect(w.element.tagName).toBe('NAV');
    expect(w.classes()).toEqual(['q-side-nav', 'extra']);
    expect(w.attributes('id')).toBe('side-nav');
    expect(w.attributes('aria-label')).toBe('ناوبری پنل');
    const sec = w.findAll('section.q-side-nav__section');
    expect(sec).toHaveLength(2);
    expect(sec[0]!.attributes('aria-labelledby')).toBe(sec[0]!.find('h2').attributes('id'));
    const active = w.find('.q-side-nav__item.is-active');
    expect(active.attributes('aria-current')).toBe('page');
    expect(active.attributes('href')).toBe('/admin/tickets');
    expect(active.find('.q-side-nav__count').classes()).toContain('q-badge--green');
    expect(active.find('.q-side-nav__count').text()).toBe('۶');
  });

  it('collapsed: labels stay for screen readers with the count, title tooltip, pip', () => {
    const w = mount(QSideNav, { props: { sections, collapsed: true } });
    expect(w.classes()).toContain('q-side-nav--collapsed');
    const item = w.findAll('.q-side-nav__item')[2]!;
    expect(item.attributes('title')).toBe('تیکت‌ها (۶)');
    expect(item.find('.q-side-nav__label').classes()).toContain('q-sr');
    expect(item.find('.q-side-nav__pip').exists()).toBe(true);
    expect(w.find('.q-side-nav__title').classes()).toContain('q-sr');
  });

  it('en label and navigate emit', async () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QSideNav, { props: { sections } });
    expect(w.attributes('aria-label')).toBe('Panel navigation');
    await w.find('.q-side-nav__item').trigger('click');
    expect(w.emitted('navigate')![0]![0]).toBe('home');
  });

  it('drawer: wraps the nav, Escape closes (v-model:open + close), focus returns to the opener', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const w = mount(QSideNav, {
      attachTo: document.body,
      props: { sections, mode: 'drawer' as const, open: false, id: 'side-nav', 'onUpdate:open': (v: boolean) => w.setProps({ open: v }) },
    });
    expect(w.find('.q-drawer').exists()).toBe(false);
    await w.setProps({ open: true });
    await nextTick();
    expect(w.find('.q-drawer.q-drawer--start').exists()).toBe(true);
    expect(w.find('nav#side-nav').classes()).toContain('q-side-nav--drawer');
    expect(w.find('.q-drawer__title').text()).toBe('میدان رقابت');
    expect(w.find('.q-drawer__panel').attributes('style')).toContain('width: 300px');
    expect(w.find('.q-drawer__panel').element.contains(document.activeElement)).toBe(true);
    await w.find('.q-drawer__panel').trigger('keydown', { key: 'Escape' });
    expect(w.emitted('close')).toHaveLength(1);
    expect(w.emitted('update:open')!.at(-1)).toEqual([false]);
    await nextTick();
    expect(w.find('.q-drawer').exists()).toBe(false);
    expect(document.activeElement).toBe(opener);
    w.unmount();
  });
});
