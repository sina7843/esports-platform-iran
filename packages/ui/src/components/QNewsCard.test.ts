import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QNewsCard from './QNewsCard.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));
const at = '2026-12-03T15:00:00Z';

describe('QNewsCard', () => {
  it('fa featured: h2, cover, datetime meta, read minutes, link', () => {
    const w = mount(QNewsCard, { props: { variant: 'featured', title: 'خبر', href: '/news/1', excerpt: 'خلاصه', category: 'لیگ', publishedAt: at, author: 'سارا', readMinutes: 4, coverText: 'IRAN' } });
    expect(w.classes()).toEqual(['q-news-card', 'q-news-card--featured']);
    const h = w.find('h2.q-news-card__title');
    expect(w.attributes('aria-labelledby')).toBe(h.attributes('id'));
    expect(h.find('a.q-news-card__link').attributes('href')).toBe('/news/1');
    expect(w.find('.q-news-card__cover').classes()).toContain('q-stripes');
    expect(w.find('time').text()).toBe('۱۲ آذر ۱۴۰۵ ساعت ۱۸:۳۰');
    expect(w.find('.q-news-card__meta').text()).toContain('نوشته سارا');
    expect(w.find('.q-news-card__meta').text()).toContain('۴ دقیقه مطالعه');
  });
  it('fa corrected note role=note', () => {
    const w = mount(QNewsCard, { props: { title: 'x', state: 'corrected', correctionNote: 'اصلاح شد' } });
    expect(w.find('h3').exists()).toBe(true);
    expect(w.find('.q-badge--warning').text()).toBe('اصلاحیه');
    expect(w.find('.q-news-card__notice--warning').attributes('role')).toBe('note');
  });
  it('en retracted: struck title, sr text, no link/cover/excerpt; low-data notice', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QNewsCard, { props: { title: 'Story', href: '/n', excerpt: 'e', coverText: 'X', state: 'retracted', retractionReason: 'wrong', publishedAt: at } });
    expect(w.classes()).toContain('q-news-card--retracted');
    expect(w.find('s bdi').text()).toBe('Story');
    expect(w.find('a').exists()).toBe(false);
    expect(w.find('.q-news-card__cover').exists()).toBe(false);
    expect(w.find('.q-news-card__excerpt').exists()).toBe(false);
    expect(w.find('h3 .q-sr').text()).toBe('(retracted)');
    expect(w.find('.q-news-card__notice--danger').text()).toBe('This post was withdrawn: wrong');
    expect(w.find('time').text()).toBe('3 December 2026');
    const l = mount(QNewsCard, { props: { title: 't', lowData: true, coverSrc: 'a.jpg', headingLevel: 4 } });
    expect(l.classes()).toContain('q-news-card--lowdata');
    expect(l.find('img').exists()).toBe(false);
    expect(l.find('h4').exists()).toBe(true);
    expect(l.find('.q-news-card__lowdata').text()).toBe('Image not loaded in low-data mode');
  });
});
