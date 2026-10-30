import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QLivePost from './QLivePost.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QLivePost', () => {
  it('fa: time, kind, live badge, score group label, media thumbs', () => {
    const w = mount(QLivePost, { props: { kind: 'goal', time: '2026-12-03T15:00:00Z', source: 'official', title: 'گل!', newest: true, mediaCount: 5, score: { home: 'سیمرغ', away: 'عقاب', homeScore: 2, awayScore: 1, final: false } } });
    expect(w.classes()).toEqual(['q-live-post', 'q-live-post--newest']);
    expect(w.attributes('aria-labelledby')).toBe(w.find('h3').attributes('id'));
    expect(w.find('time.q-live-post__time').text()).toBe('۱۸:۳۰');
    expect(w.find('.q-live-post__kind').text()).toBe('گل');
    expect(w.find('.q-live-post__src').text()).toBe('رسمی');
    expect(w.find('.q-badge--live').text()).toBe('زنده');
    const s = w.find('.q-live-post__score');
    expect(s.attributes('role')).toBe('group');
    expect(s.attributes('aria-label')).toBe('نتیجه: سیمرغ ۲، عقاب ۱');
    expect(s.find('.q-live-post__pts--lead').text()).toBe('۲');
    expect(s.find('.q-badge--warning').text()).toBe('نتیجه موقت');
    expect(w.findAll('.q-live-post__thumb')).toHaveLength(3);
    expect(w.find('.q-live-post__thumb').attributes('aria-label')).toBe('تصویر ۱');
  });
  it('en: low data shows the media button, which reveals thumbs; withdrawn replaces body', async () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QLivePost, { props: { timeText: '12\'', body: 'b', mediaCount: 2, lowData: true, pinned: true } });
    expect(w.attributes('aria-labelledby')).toBeUndefined();
    expect(w.find('.q-live-post__kind').text()).toBe('Notice');
    expect(w.find('.q-badge--neutral').text()).toBe('Pinned');
    const b = w.find('.q-live-post__show');
    expect(b.text()).toBe('Show 2 images');
    await b.trigger('click');
    expect(w.findAll('.q-live-post__thumb')).toHaveLength(2);
    const x = mount(QLivePost, { props: { body: 'b', withdrawn: 'error', edited: 'typo', score: { home: 'A', away: 'B', homeScore: 1, awayScore: 1 } } });
    expect(x.classes()).toContain('q-live-post--withdrawn');
    expect(x.find('.q-live-post__withdrawn').attributes('role')).toBe('note');
    expect(x.find('.q-live-post__withdrawn').text()).toBe('This post was withdrawn: error');
    expect(x.find('.q-live-post__body').exists()).toBe(false);
    expect(x.find('.q-live-post__score').exists()).toBe(false);
    expect(x.find('[title="typo"]').text()).toBe('Edited');
  });
});
