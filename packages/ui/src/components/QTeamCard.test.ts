import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QTeamCard from './QTeamCard.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QTeamCard', () => {
  it('renders the DS structure in fa', () => {
    const w = mount(QTeamCard, { props: { name: 'سیمرغ', tag: 'SMRG', verified: true, members: 7, city: 'تهران', games: ['Valorant'], href: '/teams/1' } });
    expect(w.classes()).toContain('q-team-card');
    expect(w.find('.q-team-card__crest.q-chamfer-md').text()).toBe('س');
    expect(w.find('.q-team-card__tag').classes()).toContain('q-ltr');
    expect(w.find('.q-team-card__meta').text()).toContain('۷ عضو');
    expect(w.find('.q-verified-mark').attributes('aria-label')).toBe('تیم تأییدشده');
    expect(w.find('.q-team-card__more').text()).toBe('صفحهٔ تیم');
    const f = w.find('.q-team-card__follow');
    expect(f.attributes('aria-pressed')).toBe('false');
    expect(f.attributes('aria-label')).toBe('دنبال‌کردن سیمرغ');
  });

  it('en strings and uncontrolled follow toggle emits', async () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QTeamCard, { props: { name: 'Simorgh', members: 1 } });
    expect(w.find('.q-team-card__meta').text()).toContain('1 member');
    const f = w.find('.q-team-card__follow');
    await f.trigger('click');
    expect(f.attributes('aria-pressed')).toBe('true');
    expect(f.text()).toBe('Following');
    expect(w.emitted('update:following')?.[0]).toEqual([true]);
  });

  it('@follow-change listener fires; controlled value wins; false hides the toggle', async () => {
    const calls: boolean[] = [];
    const w = mount(QTeamCard, { props: { name: 'X', following: true, onFollowChange: (v: boolean) => calls.push(v) } });
    await w.find('.q-team-card__follow').trigger('click');
    expect(calls).toEqual([false]);
    expect(w.find('.q-team-card__follow').attributes('aria-pressed')).toBe('true');
    const hidden = mount(QTeamCard, { props: { name: 'X', onFollowChange: false } });
    expect(hidden.find('.q-team-card__follow').exists()).toBe(false);
    expect(hidden.find('.q-team-card__actions').exists()).toBe(false);
  });

  it('slots win over props', () => {
    const w = mount(QTeamCard, { props: { name: 'X', footer: 'p' }, slots: { footer: '<b>slot</b>', actions: '<i>a</i>' } });
    expect(w.find('.q-team-card__footer').html()).toContain('<b>slot</b>');
    expect(w.find('.q-team-card__actions i').exists()).toBe(true);
  });
});
