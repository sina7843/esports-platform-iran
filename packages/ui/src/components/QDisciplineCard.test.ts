import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QDisciplineCard from './QDisciplineCard.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QDisciplineCard', () => {
  const props = {
    name: 'Valorant', platform: 'PC', mode: '5v5', capacity: 16, remaining: 5,
    rules: { label: 'قوانین والورانت', version: '2', href: '/rules/2' },
    stages: [{ name: 'گروهی', format: 'groups', state: 'live' }, { name: 'حذفی', format: 'single_elim', state: 'scheduled', href: '/s/2' }],
  };
  it('fa: labelled section, facts, stages table', () => {
    const w = mount(QDisciplineCard, { props, slots: { default: '<button>ثبت‌نام</button>' } });
    expect(w.attributes('aria-labelledby')).toBe(w.find('h3').attributes('id'));
    expect(w.find('.q-discipline-card__pm bdi').text()).toBe('PC / 5v5');
    expect(w.findAll('dd').map((d) => d.text())).toEqual(['تیمی', '۵ جای خالی از ۱۶', 'رایگان']);
    const region = w.find('[role="region"]');
    expect(region.attributes('aria-label')).toBe('مراحل Valorant');
    expect(region.attributes('tabindex')).toBe('0');
    expect(w.findAll('tbody td')[1]!.text()).toBe('گروهی');
    expect(w.find('.q-badge--live').text()).toBe('در حال برگزاری');
    expect(w.find('a.q-discipline-card__stage').attributes('href')).toBe('/s/2');
    expect(w.find('.q-discipline-card__ver').text()).toBe('v2');
    expect(w.find('.q-discipline-card__actions button').exists()).toBe(true);
  });
  it('en strings; no actions without slot', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QDisciplineCard, { props: { ...props, participantKind: 'player' as const } });
    expect(w.findAll('dd')[0]!.text()).toBe('Solo');
    expect(w.findAll('dd')[1]!.text()).toBe('5 of 16 places left');
    expect(w.find('.q-discipline-card__link').text()).toBe('Full rules version');
    expect(w.findAll('tbody td')[4]!.text()).toBe('Single elimination');
    expect(w.find('.q-discipline-card__actions').exists()).toBe(false);
  });
});
