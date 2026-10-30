import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import QMenu, { type MenuItem } from './QMenu.vue';

const items: MenuItem[] = [
  { type: 'label', label: 'زبان' },
  { key: 'fa', label: 'فارسی', checked: true, radio: true },
  { key: 'en', label: 'English', checked: false, radio: true },
  { type: 'separator' },
  { key: 'edit', label: 'ویرایش', icon: 'edit', shortcut: 'Ctrl+E' },
  { key: 'off', label: 'غیرفعال', disabled: true },
  { key: 'del', label: 'حذف', danger: true },
];

describe('QMenu', () => {
  it('trigger a11y; closed by default', () => {
    const w = mount(QMenu, { props: { label: 'نمایش', items } });
    expect(w.classes()).toEqual(['q-menu']);
    const t = w.find('.q-menu__trigger');
    expect(t.attributes('aria-haspopup')).toBe('menu');
    expect(t.attributes('aria-expanded')).toBe('false');
    expect(t.attributes('aria-controls')).toBeUndefined();
    expect(w.find('[role="menu"]').exists()).toBe(false);
  });

  it('opens on click, roles and checks, focuses first item; v-model:open + openChange', async () => {
    const w = mount(QMenu, { props: { label: 'نمایش', items, align: 'end' }, attachTo: document.body });
    expect(w.classes()).toContain('q-menu--end');
    await w.find('.q-menu__trigger').trigger('click');
    await nextTick();
    expect(w.emitted('update:open')![0]).toEqual([true]);
    expect(w.emitted('openChange')![0]).toEqual([true]);
    const menu = w.find('[role="menu"]');
    expect(menu.attributes('aria-labelledby')).toBe(w.find('.q-menu__trigger').attributes('id'));
    expect(w.find('.q-menu__trigger').attributes('aria-controls')).toBe(menu.attributes('id'));
    expect(w.find('.q-menu__label').attributes('role')).toBe('presentation');
    expect(w.find('[role="separator"]').exists()).toBe(true);
    const radios = w.findAll('[role="menuitemradio"]');
    expect(radios[0]!.attributes('aria-checked')).toBe('true');
    expect(radios[0]!.classes()).toContain('is-checked');
    expect(w.find('.q-menu__kbd').text()).toBe('Ctrl+E');
    expect(w.find('.q-menu__item--danger').exists()).toBe(true);
    expect(w.find('[aria-disabled="true"]').text()).toBe('غیرفعال');
    expect(document.activeElement).toBe(radios[0]!.element);
    w.unmount();
  });

  it('keyboard: ArrowDown/Up skip disabled, End, typeahead, Escape returns focus', async () => {
    const w = mount(QMenu, { props: { label: 'نمایش', items }, attachTo: document.body });
    const trig = w.find('.q-menu__trigger');
    await trig.trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    const list = w.find('[role="menu"]');
    expect(document.activeElement!.textContent).toBe('حذف');
    await list.trigger('keydown', { key: 'ArrowUp' });
    expect(document.activeElement!.textContent).toContain('ویرایش');
    await list.trigger('keydown', { key: 'Home' });
    expect(document.activeElement!.textContent).toBe('فارسی');
    await list.trigger('keydown', { key: 'e' });
    expect(document.activeElement!.textContent).toBe('English');
    await list.trigger('keydown', { key: 'Escape' });
    expect(w.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trig.element);
    w.unmount();
  });

  it('select: plain item closes; checkable stays open; disabled ignored', async () => {
    let called = 0;
    const w = mount(QMenu, { props: { label: 'x', items: [...items, { key: 'cb', label: 'cb', onSelect: () => { called++; } }], defaultOpen: true } });
    await w.findAll('[role="menuitemradio"]')[1]!.trigger('click');
    expect(w.emitted('select')![0]).toEqual(['en']);
    expect(w.find('[role="menu"]').exists()).toBe(true);
    await w.find('[aria-disabled="true"]').trigger('click');
    expect(w.emitted('select')).toHaveLength(1);
    await w.findAll('[role="menuitem"]').at(-1)!.trigger('click');
    expect(called).toBe(1);
    expect(w.find('[role="menu"]').exists()).toBe(false);
  });

  it('outside mousedown closes; iconOnly label', async () => {
    const w = mount(QMenu, { props: { label: 'بیشتر', icon: 'more', iconOnly: true, items, defaultOpen: true }, attachTo: document.body });
    expect(w.find('.q-menu__trigger').attributes('aria-label')).toBe('بیشتر');
    expect(w.find('.q-menu__caret').exists()).toBe(false);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await nextTick();
    expect(w.find('[role="menu"]').exists()).toBe(false);
    w.unmount();
  });
});
