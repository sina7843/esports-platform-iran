import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QStepper from './QStepper.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QStepper', () => {
  it('default steps with states, aria-current and hidden status words', () => {
    const w = mount(QStepper, { props: { current: 1 } });
    expect(w.classes()).toEqual(['q-stepper', 'q-stepper--horizontal']);
    expect(w.find('ol').attributes('aria-label')).toBe('مراحل ثبت‌نام');
    const li = w.findAll('li');
    expect(li).toHaveLength(4);
    expect(li[0]!.classes()).toContain('q-stepper__step--done');
    expect(li[0]!.find('svg').exists()).toBe(true);
    expect(li[1]!.attributes('aria-current')).toBe('step');
    expect(li[1]!.find('.q-sr').text()).toBe('، مرحلهٔ فعلی');
    expect(li[2]!.find('.q-stepper__marker').text()).toBe('۳');
  });
  it('en, custom steps and aria-label', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QStepper, { props: { steps: ['A', { label: 'B', description: 'd' }], orientation: 'vertical', ariaLabel: 'Flow' } });
    expect(w.classes()).toContain('q-stepper--vertical');
    expect(w.find('ol').attributes('aria-label')).toBe('Flow');
    expect(w.find('.q-stepper__desc').text()).toBe('d');
    expect(w.findAll('.q-sr').map((s) => s.text())).toEqual([', current step', ', upcoming']);
    expect(mount(QStepper).find('.q-stepper__label').text()).toBe('Team details');
  });
});
