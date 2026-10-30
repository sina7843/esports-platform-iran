import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QTabs, { type TabsItem } from './QTabs.vue';

afterEach(() => {
  setLocale('fa', { keepDocument: true });
  vi.restoreAllMocks();
});

const items: TabsItem[] = [
  { key: 'a', label: 'خلاصه', content: 'A' },
  { key: 'b', label: 'مسابقات', count: 120, content: 'B' },
  { key: 'c', label: 'غیرفعال', disabled: true, content: 'C' },
  { key: 'd', label: 'قوانین', content: 'D' },
];

describe('QTabs', () => {
  it('tablist / tab / tabpanel wiring, first enabled selected, counts', () => {
    const w = mount(QTabs, { props: { items, 'aria-label': 'بخش‌ها' } });
    expect(w.classes()).toEqual(['q-tabs', 'q-tabs--line']);
    const list = w.find('[role="tablist"]');
    expect(list.attributes('aria-label')).toBe('بخش‌ها');
    const tabs = w.findAll('[role="tab"]');
    expect(tabs[0]!.attributes('aria-selected')).toBe('true');
    expect(tabs[0]!.attributes('tabindex')).toBe('0');
    expect(tabs[1]!.attributes('tabindex')).toBe('-1');
    expect(tabs[1]!.find('.q-tabs__count').text()).toBe('۹۹+');
    const panels = w.findAll('[role="tabpanel"]');
    expect(panels[0]!.attributes('aria-labelledby')).toBe(tabs[0]!.attributes('id'));
    expect(tabs[0]!.attributes('aria-controls')).toBe(panels[0]!.attributes('id'));
    expect(panels[0]!.attributes('hidden')).toBeUndefined();
    expect(panels[1]!.attributes('hidden')).toBeDefined();
  });

  it('v-model + change on click', async () => {
    const w = mount(QTabs, { props: { items, variant: 'pill' as const, fill: true, modelValue: 'a', 'onUpdate:modelValue': (v: string | undefined) => w.setProps({ modelValue: v ?? '' }) } });
    expect(w.classes()).toEqual(['q-tabs', 'q-tabs--pill', 'q-tabs--fill']);
    await w.findAll('[role="tab"]')[3]!.trigger('click');
    expect(w.emitted('change')![0]).toEqual(['d']);
    expect(w.findAll('[role="tab"]')[3]!.classes()).toContain('is-selected');
  });

  it('LTR arrows skip disabled tabs, Home/End jump', async () => {
    const w = mount(QTabs, { props: { items }, attachTo: document.body });
    const tab = (i: number) => w.findAll('[role="tab"]')[i]!;
    await tab(0).trigger('keydown', { key: 'ArrowRight' });
    expect(w.emitted('change')!.at(-1)).toEqual(['b']);
    await tab(1).trigger('keydown', { key: 'ArrowRight' });
    expect(w.emitted('change')!.at(-1)).toEqual(['d']);
    expect(document.activeElement).toBe(tab(3).element);
    await tab(3).trigger('keydown', { key: 'Home' });
    expect(w.emitted('change')!.at(-1)).toEqual(['a']);
    await tab(0).trigger('keydown', { key: 'End' });
    expect(w.emitted('change')!.at(-1)).toEqual(['d']);
    w.unmount();
  });

  it('RTL: ArrowLeft goes to the next tab; manual activation only moves focus', async () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'rtl' } as CSSStyleDeclaration);
    const w = mount(QTabs, { props: { items, activation: 'manual' }, attachTo: document.body });
    await w.findAll('[role="tab"]')[0]!.trigger('keydown', { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(w.findAll('[role="tab"]')[1]!.element);
    expect(w.emitted('change')).toBeUndefined();
    w.unmount();
  });

  it('overflow scroll and panel slot', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QTabs, {
      props: { items: [{ key: 'x', label: 'X' }], overflow: 'scroll' },
      slots: { panel: '<template #panel="{ item }"><b>{{ item.key }}</b></template>' },
    });
    expect(w.classes()).toContain('q-tabs--scroll');
    expect(w.find('[role="tabpanel"] b').text()).toBe('x');
  });

  it('no panels without content', () => {
    const w = mount(QTabs, { props: { items: [{ key: 'x', label: 'X' }] } });
    expect(w.find('[role="tabpanel"]').exists()).toBe(false);
    expect(w.find('[role="tab"]').attributes('aria-controls')).toBeUndefined();
  });
});
