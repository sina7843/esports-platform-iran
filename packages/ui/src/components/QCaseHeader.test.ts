import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QCaseHeader from './QCaseHeader.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));
const base = { caseId: 'DSP-2041', title: 'اعتراض به نتیجه', parties: [{ name: 'سیمرغ' }, { name: 'عقاب' }] };

describe('QCaseHeader', () => {
  it('fa: id, state badge, parties, steps with aria-current, deadline soon', () => {
    const w = mount(QCaseHeader, { props: { ...base, state: 'under_review', deadline: { at: '2026-12-03T15:00:00Z' }, now: '2026-12-03T12:30:00Z' }, slots: { actions: '<button class="x">x</button>' } });
    expect(w.classes()).toEqual(['q-case-header']);
    expect(w.attributes('aria-labelledby')).toBe(w.find('h2').attributes('id'));
    expect(w.find('.q-case-header__id').classes()).toContain('q-ltr');
    expect(w.find('.q-badge--green').text()).toBe('بررسی');
    expect(w.find('.q-case-header__parties').attributes('role')).toBe('group');
    expect(w.find('.q-case-header__vs').text()).toBe('در برابر');
    expect(w.findAll('.q-case-header__party small').map((s) => s.text())).toEqual(['معترض', 'طرف مقابل']);
    const steps = w.findAll('.q-case-header__step');
    expect(steps).toHaveLength(7);
    expect(w.findAll('.q-case-header__step--done')).toHaveLength(3);
    expect(steps[3]!.attributes('aria-current')).toBe('step');
    expect(steps[3]!.find('.q-sr').text()).toBe('(مرحلهٔ فعلی)');
    expect(steps[4]!.find('.q-case-header__marker').text()).toBe('۵');
    expect(w.find('.q-case-header__deadline--soon strong').text()).toBe('۲ ساعت و ۳۰ دقیقه مانده');
    expect(w.find('.q-case-header__none').text()).toBe('هنوز ارجاع نشده');
    expect(w.find('.q-case-header__actions .x').exists()).toBe(true);
  });
  it('en: closed case marks all done, passed deadline', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QCaseHeader, { props: { ...base, state: 'closed', deadline: { at: '2026-12-01T00:00:00Z' }, now: '2026-12-03T00:00:00Z', referee: 'Ali', match: 'A vs B', matchHref: '/m/1' } });
    expect(w.find('.q-case-header__eyebrow').text()).toBe('Dispute case');
    expect(w.find('.q-badge--neutral').text()).toBe('Closed');
    expect(w.findAll('.q-case-header__step--done')).toHaveLength(7);
    expect(w.find('[aria-current]').exists()).toBe(false);
    expect(w.find('.q-case-header__deadline--over strong').text()).toBe('Deadline passed');
    expect(w.find('.q-case-header__meta a').attributes('href')).toBe('/m/1');
    const ok = mount(QCaseHeader, { props: { ...base, state: 'filed', deadline: { at: '2026-12-05T01:00:00Z' }, now: '2026-12-03T00:00:00Z' } });
    expect(ok.find('.q-case-header__deadline--ok strong').text()).toBe('2 days 1 hour left');
  });
});
