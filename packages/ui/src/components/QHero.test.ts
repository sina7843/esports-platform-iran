import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QHero from './QHero.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QHero', () => {
  it('defaults: eyebrow, accented title, labelled section', () => {
    const w = mount(QHero);
    expect(w.classes()).toEqual(['q-hero']);
    const h1 = w.find('h1');
    expect(w.attributes('aria-labelledby')).toBe(h1.attributes('id'));
    expect(h1.text()).toBe('رقابت از اینجا شروع می‌شود.');
    expect(w.find('.q-hero__accent--red').text()).toBe('شروع');
    expect(w.find('.q-hero__eyebrow').text()).toBe('خانه ورزش‌های الکترونیکی ایران');
    expect(w.find('.q-hero__actions').exists()).toBe(false);
  });
  it('actions from objects and the search form', async () => {
    let clicked = 0;
    const got: string[] = [];
    const w = mount(QHero, {
      props: {
        eyebrow: false, headingLevel: 2, title: 'Play now', accentWord: 'now', accent: 'green',
        primaryAction: { label: 'Go', onClick: () => { clicked++; } }, secondaryAction: { label: 'More', href: '/more' },
        search: { onSubmit: (q: string) => { got.push(q); } },
      },
      slots: { media: '<div class="m">m</div>' },
    });
    expect(w.find('.q-hero__eyebrow').exists()).toBe(false);
    expect(w.find('h2 .q-hero__accent--green').text()).toBe('now');
    expect(w.classes()).toContain('q-hero--media');
    expect(w.find('.q-hero__media .m').exists()).toBe(true);
    const p = w.find('.q-hero__actions button');
    expect(p.classes()).toEqual(['q-btn', 'q-btn--primary', 'q-btn--xl', 'q-chamfer-md']);
    await p.trigger('click');
    expect(clicked).toBe(1);
    expect(w.find('.q-hero__actions a.q-btn--green').attributes('href')).toBe('/more');
    expect(w.find('form').attributes('role')).toBe('search');
    await w.find('input').setValue('team');
    await w.find('form').trigger('submit');
    expect(got).toEqual(['team']);
    expect(w.emitted('search')).toEqual([['team']]);
  });
  it('en defaults', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QHero, { props: { search: true } });
    expect(w.find('.q-hero__accent').text()).toBe('starts');
    expect(w.find('label.q-sr').text()).toBe('Search');
    expect(w.find('input').attributes('placeholder')).toBe('Team, player, event or news…');
    expect(w.find('.q-hero__search-btn').text()).toBe('Search');
  });
});
