import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QRecruitmentCard from './QRecruitmentCard.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QRecruitmentCard', () => {
  it('fa open ad: labelled, badge, facts, apply emits', async () => {
    const w = mount(QRecruitmentCard, { props: { team: { name: 'سیمرغ' }, game: 'Valorant', role: 'Duelist', level: 'حرفه‌ای', description: 'TEST ONLY', postedAt: '2026-12-03T15:00:00Z' } });
    expect(w.classes()).toEqual(['q-recruitment-card']);
    expect(w.attributes('aria-labelledby')).toBe(w.find('h3').attributes('id'));
    expect(w.find('h3').text()).toBe('جذب بازیکن · Duelist');
    expect(w.find('.q-recruitment-card__head .q-badge--success').text()).toBe('باز');
    expect(w.find('.q-recruitment-card__desc').attributes('dir')).toBe('auto');
    expect(w.find('.q-recruitment-card__date').text()).toBe('ثبت ۱۲ آذر');
    expect(w.find('dt').text()).toBe('سطح');
    await w.find('.q-btn--green').trigger('click');
    expect(w.emitted('apply')).toHaveLength(1);
  });
  it('en closed and applied states', () => {
    setLocale('en', { keepDocument: true });
    const c = mount(QRecruitmentCard, { props: { team: { name: 'S' }, kind: 'coach', state: 'closed' } });
    expect(c.classes()).toContain('q-recruitment-card--closed');
    expect(c.find('h3').text()).toBe('Looking for a coach');
    expect(c.find('.q-badge').text()).toBe('Closed');
    expect(c.find('button').attributes('disabled')).toBeDefined();
    expect(c.find('button').text()).toBe('This ad is closed');
    const a = mount(QRecruitmentCard, { props: { team: { name: 'S' }, applied: true } });
    expect(a.find('.q-recruitment-card__foot .q-badge').text()).toBe('Application submitted.');
  });
});
