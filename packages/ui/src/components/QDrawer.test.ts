import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setLocale } from '../locale';
import QDrawer from './QDrawer.vue';

afterEach(() => {
  setLocale('fa', { keepDocument: true });
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('QDrawer', () => {
  it('structure and a11y; class on the root', () => {
    const w = mount(QDrawer, {
      props: { open: true, title: 'فیلترها', side: 'end', inline: true, width: 320, onClose: () => undefined },
      attrs: { class: 'mine' }, slots: { default: 'بدنه', footer: '<button>اعمال</button>' },
    });
    expect(w.classes()).toEqual(['q-drawer', 'q-drawer--end', 'q-drawer--inline', 'mine']);
    expect(w.attributes('style')).toContain('height: 480px');
    const panel = w.find('.q-drawer__panel');
    expect(panel.attributes('role')).toBe('dialog');
    expect(panel.attributes('style')).toContain('width: 320px');
    expect(w.find(`#${panel.attributes('aria-labelledby')}`).text()).toBe('فیلترها');
    expect(w.find('.q-drawer__body').text()).toBe('بدنه');
    expect(w.find('.q-drawer__foot button').exists()).toBe(true);
    expect(w.find('.q-drawer__head .q-btn').attributes('aria-label')).toBe('بستن');
  });

  it('modal: focus trap, Escape, scrim, focus return', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const w = mount(QDrawer, {
      attachTo: document.body,
      props: { open: true, title: 't', 'onUpdate:open': (v: boolean) => w.setProps({ open: v }) },
      slots: { default: '<a href="/x" id="l">x</a>' },
    });
    await nextTick();
    const panel = w.find('.q-drawer__panel');
    expect(panel.attributes('aria-modal')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    const close = w.find('.q-drawer__head .q-btn').element;
    expect(document.activeElement).toBe(close);
    await panel.trigger('keydown', { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(w.find('#l').element);
    await panel.trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    await panel.trigger('keydown', { key: 'Escape' });
    expect(w.emitted('close')).toHaveLength(1);
    await nextTick();
    expect(w.find('.q-drawer').exists()).toBe(false);
    expect(document.activeElement).toBe(opener);
    await w.setProps({ open: true });
    await w.find('.q-drawer__scrim').trigger('click');
    expect(w.emitted('close')).toHaveLength(2);
    w.unmount();
  });

  it('en label; no close button without a listener', () => {
    setLocale('en', { keepDocument: true });
    expect(mount(QDrawer, { props: { open: true, inline: true, title: 't', onClose: () => undefined } }).find('.q-btn').attributes('aria-label')).toBe('Close');
    expect(mount(QDrawer, { props: { open: true, inline: true, title: 't' } }).find('.q-btn').exists()).toBe(false);
  });
});
