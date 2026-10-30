import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import QAccordion, { type AccordionItem } from './QAccordion.vue';

const items: AccordionItem[] = [
  { key: 'a', title: 'ماده ۱', content: 'متن ۱', prefix: '۱', meta: 'جدید' },
  { key: 'b', title: 'ماده ۲', content: 'متن ۲' },
  { key: 'c', title: 'ماده ۳', content: 'متن ۳', disabled: true },
];

describe('QAccordion', () => {
  it('headings, triggers and regions wired; closed by default', () => {
    const w = mount(QAccordion, { props: { items, headingLevel: 2 } });
    expect(w.classes()).toEqual(['q-accordion']);
    expect(w.findAll('h2.q-accordion__heading')).toHaveLength(3);
    const btn = w.find('.q-accordion__trigger');
    const panel = w.find('.q-accordion__panel');
    expect(btn.attributes('aria-expanded')).toBe('false');
    expect(btn.attributes('aria-controls')).toBe(panel.attributes('id'));
    expect(panel.attributes('role')).toBe('region');
    expect(panel.attributes('aria-labelledby')).toBe(btn.attributes('id'));
    expect(panel.attributes('hidden')).toBeDefined();
    expect(w.find('.q-accordion__prefix').text()).toBe('۱');
    expect(w.find('.q-accordion__meta').text()).toBe('جدید');
    expect(w.findAll('.q-accordion__trigger')[2]!.attributes('disabled')).toBeDefined();
  });

  it('single: opens one, collapses on second click; v-model + change', async () => {
    const w = mount(QAccordion, { props: { items, defaultValue: 'a' } });
    expect(w.find('.q-accordion__item').classes()).toContain('is-open');
    const b = () => w.findAll('.q-accordion__trigger');
    await b()[1]!.trigger('click');
    expect(w.emitted('change')![0]).toEqual(['b']);
    expect(w.emitted('update:modelValue')![0]).toEqual(['b']);
    expect(b()[0]!.attributes('aria-expanded')).toBe('false');
    expect(b()[1]!.attributes('aria-expanded')).toBe('true');
    await b()[1]!.trigger('click');
    expect(w.emitted('change')![1]).toEqual([null]);
  });

  it('single non-collapsible keeps the item open', async () => {
    const w = mount(QAccordion, { props: { items, collapsible: false, defaultValue: 'a' } });
    await w.find('.q-accordion__trigger').trigger('click');
    expect(w.emitted('change')![0]).toEqual(['a']);
  });

  it('multiple: key array', async () => {
    const w = mount(QAccordion, { props: { items, type: 'multiple' } });
    await w.findAll('.q-accordion__trigger')[0]!.trigger('click');
    await w.findAll('.q-accordion__trigger')[1]!.trigger('click');
    expect(w.emitted('change')!.at(-1)).toEqual([['a', 'b']]);
    await w.findAll('.q-accordion__trigger')[0]!.trigger('click');
    expect(w.emitted('change')!.at(-1)).toEqual([['b']]);
  });
});
