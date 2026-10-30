import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QScoreBug from './QScoreBug.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QScoreBug', () => {
  it('fa: group label, plate order, lead/trail, meta', () => {
    const w = mount(QScoreBug, { props: { home: { name: 'سیمرغ', short: 'SIM' }, away: 'پارس', score: [2, 1], live: true, map: 'Lotus', timer: '۱:۴۲', provisional: true, transparent: true } });
    expect(w.classes()).toEqual(['q-score-bug', 'q-score-bug--transparent']);
    expect(w.attributes('role')).toBe('group');
    expect(w.attributes('aria-label')).toBe('امتیاز: سیمرغ ۲، پارس ۱');
    const plate = [...w.find('.q-score-bug__plate').element.children].map((e) => e.className);
    expect(plate).toEqual(['q-score-bug__team', 'q-score-bug__score q-score-bug__score--lead', 'q-score-bug__sep', 'q-score-bug__score q-score-bug__score--trail', 'q-score-bug__team q-score-bug__team--away']);
    expect(w.findAll('.q-score-bug__name').map((n) => n.text())).toEqual(['SIM', 'پارس']);
    expect(w.find('.q-score-bug__live').text()).toBe('زنده');
    expect(w.find('.q-score-bug__map bdi').attributes('dir')).toBe('ltr');
    expect(w.find('.q-score-bug__prov').text()).toBe('نتیجه موقت');
  });
  it('en: no score shows dashes and no meta', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QScoreBug, { props: { home: 'Simorgh', away: 'Pars' } });
    expect(w.attributes('aria-label')).toBe('Score: Simorgh vs Pars');
    expect(w.findAll('.q-score-bug__score').map((s) => s.text())).toEqual(['–', '–']);
    expect(w.find('.q-score-bug__meta').exists()).toBe(false);
    expect(mount(QScoreBug, { props: { home: 'A', away: 'B', live: true } }).find('.q-score-bug__live').text()).toBe('Live');
  });
});
