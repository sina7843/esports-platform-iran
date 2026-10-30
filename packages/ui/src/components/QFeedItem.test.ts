import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QFeedItem from './QFeedItem.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QFeedItem', () => {
  it('unread link row with hidden label and relative time', () => {
    const w = mount(QFeedItem, { props: { title: 'پیام تازه', href: '/inbox/1', unread: true, time: '2026-12-03T15:00:00Z', now: '2026-12-03T17:00:00Z', as: 'li' } });
    expect(w.element.tagName).toBe('LI');
    expect(w.classes()).toEqual(['q-feed-item', 'q-feed-item--unread', 'q-feed-item--interactive']);
    expect(w.find('h3 .q-sr').text()).toBe('خوانده‌نشده:');
    expect(w.find('a.q-feed-item__link').attributes('href')).toBe('/inbox/1');
    expect(w.find('time').text()).toBe('۲ ساعت پیش');
    expect(w.find('.q-feed-item__dot').attributes('aria-hidden')).toBe('true');
  });
  it('avatar initial and read state; static title without a listener', () => {
    const w = mount(QFeedItem, { props: { title: 'x', avatar: 'Sara', body: 'b' } });
    expect(w.classes()).toEqual(['q-feed-item', 'q-feed-item--read']);
    expect(w.find('.q-feed-item__avatar').text()).toBe('S');
    expect(w.find('.q-feed-item__link').exists()).toBe(false);
    expect(w.find('.q-feed-item__body').text()).toBe('b');
  });
  it('a click listener makes the title a button; action clicks do not trigger it', async () => {
    let n = 0;
    const w = mount(QFeedItem, { props: { title: 'x', onClick: () => { n++; } }, slots: { actions: '<button class="act">a</button>' } });
    expect(w.classes()).toContain('q-feed-item--interactive');
    await w.find('button.q-feed-item__link').trigger('click');
    await w.find('button.act').trigger('click');
    expect(n).toBe(1);
  });
  it('en unread label', () => {
    setLocale('en', { keepDocument: true });
    expect(mount(QFeedItem, { props: { title: 'x', unread: true } }).find('.q-sr').text()).toBe('Unread:');
  });
});
