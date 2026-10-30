import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setLocale } from '../locale';
import QDialog from './QDialog.vue';

afterEach(() => {
  setLocale('fa', { keepDocument: true });
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

const body = '<input id="f1" /><button id="f2">ok</button>';

describe('QDialog', () => {
  it('closed renders nothing', () => {
    const w = mount(QDialog, { props: { open: false, title: 't' } });
    expect(w.find('.q-dialog').exists()).toBe(false);
  });

  it('structure, a11y wiring, class on the panel', () => {
    const w = mount(QDialog, {
      props: { open: true, title: 'حذف تیم', description: 'توضیح', icon: 'alert', tone: 'danger', size: 'lg', inline: true, 'onUpdate:open': () => undefined },
      attrs: { class: 'mine' },
      slots: { default: 'متن', footer: '<button>ok</button>' },
    });
    expect(w.classes()).toEqual(['q-dialog', 'q-dialog--inline']);
    const panel = w.find('.q-dialog__panel');
    expect(panel.classes()).toEqual(['q-dialog__panel', 'q-dialog__panel--lg', 'mine']);
    expect(panel.attributes('role')).toBe('dialog');
    expect(panel.attributes('aria-modal')).toBeUndefined();
    expect(w.find(`#${panel.attributes('aria-labelledby')}`).text()).toBe('حذف تیم');
    expect(w.find(`#${panel.attributes('aria-describedby')}`).text()).toBe('توضیح');
    expect(w.find('.q-dialog__icon--danger').exists()).toBe(true);
    expect(w.find('.q-dialog__body').text()).toBe('متن');
    expect(w.find('.q-dialog__foot button').exists()).toBe(true);
    expect(w.find('.q-dialog__close').attributes('aria-label')).toBe('بستن');
  });

  it('modal: focus in, Tab wraps, Escape closes (close + update:open), scroll lock, focus returns', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const w = mount(QDialog, {
      attachTo: document.body,
      props: { open: true, title: 't', 'onUpdate:open': (v: boolean) => w.setProps({ open: v }) },
      slots: { default: body },
    });
    await nextTick();
    const panel = w.find('.q-dialog__panel');
    expect(panel.attributes('aria-modal')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    const close = w.find('.q-dialog__close').element as HTMLElement;
    expect(document.activeElement).toBe(close);
    const last = w.find('#f2').element as HTMLElement;
    last.focus();
    await panel.trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    await panel.trigger('keydown', { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    await panel.trigger('keydown', { key: 'Escape' });
    expect(w.emitted('close')).toHaveLength(1);
    expect(w.emitted('update:open')![0]).toEqual([false]);
    await nextTick();
    expect(w.find('.q-dialog').exists()).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(opener);
    w.unmount();
  });

  it('scrim click closes; en label; dismissible=false and no listener disable closing', async () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QDialog, { props: { open: true, title: 't', inline: true, onClose: () => undefined } });
    expect(w.find('.q-dialog__close').attributes('aria-label')).toBe('Close');
    await w.find('.q-dialog__scrim').trigger('click');
    expect(w.emitted('close')).toHaveLength(1);
    const fixed = mount(QDialog, { props: { open: true, title: 't', inline: true, dismissible: false, onClose: () => undefined } });
    expect(fixed.find('.q-dialog__close').exists()).toBe(false);
    await fixed.find('.q-dialog__panel').trigger('keydown', { key: 'Escape' });
    expect(fixed.emitted('close')).toBeUndefined();
    const bare = mount(QDialog, { props: { open: true, title: 't', inline: true } });
    expect(bare.find('.q-dialog__close').exists()).toBe(false);
  });
});
