import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QProgress from './QProgress.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QProgress', () => {
  it('capacity bar with progressbar aria and «۱۱ از ۱۶ تیم»', async () => {
    const w = mount(QProgress, { props: { value: 11, max: 16, unit: 'تیم', label: 'ظرفیت' } });
    expect(w.classes()).toEqual(['q-progress', 'q-progress--brand', 'q-progress--thin']);
    const bar = w.find('[role=progressbar]');
    expect(bar.classes()).toEqual(['q-progress__track']);
    expect(bar.attributes('aria-label')).toBe('ظرفیت');
    expect(bar.attributes('aria-valuenow')).toBe('11');
    expect(bar.attributes('aria-valuemax')).toBe('16');
    expect(bar.attributes('aria-valuetext')).toBe('۱۱ از ۱۶ تیم');
    expect(w.find('.q-progress__head').attributes('aria-hidden')).toBe('true');
    expect(w.find('.q-progress__value').text()).toBe('۱۱ از ۱۶ تیم');
    expect(w.find('.q-progress__fill').attributes('style')).toContain('inline-size: 68.75%');
    setLocale('en', { keepDocument: true });
    await w.vm.$nextTick();
    expect(w.find('.q-progress__value').text()).toBe('11 of 16 تیم');
  });
  it('segments, indeterminate and aria-label passthrough to the bar', () => {
    const s = mount(QProgress, { props: { segments: 4, value: 2, showValue: false }, attrs: { 'aria-label': 'مراحل', class: 'x' } });
    expect(s.classes()).toContain('x');
    expect(s.attributes('aria-label')).toBeUndefined();
    const segs = s.findAll('.q-progress__seg');
    expect(segs).toHaveLength(4);
    expect(segs[1]!.classes()).toContain('q-progress__seg--on');
    expect(segs[2]!.classes()).toContain('q-progress__seg--current');
    expect(s.find('[role=progressbar]').attributes('aria-label')).toBe('مراحل');
    expect(s.find('.q-progress__head').exists()).toBe(false);
    const ind = mount(QProgress, { props: { indeterminate: true, tone: 'warning', size: 'thick' } });
    expect(ind.find('[role=progressbar]').attributes('aria-valuenow')).toBeUndefined();
    expect(ind.find('.q-progress__fill').classes()).toContain('q-progress__fill--indeterminate');
  });
});
