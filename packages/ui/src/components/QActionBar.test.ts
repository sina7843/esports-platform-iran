import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QActionBar from './QActionBar.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QActionBar', () => {
  it('dirty default: region, status, buttons, emits', async () => {
    const w = mount(QActionBar, { props: { inline: true, detail: '۳ فیلد' } });
    expect(w.classes()).toEqual(['q-action-bar', 'q-action-bar--inline']);
    expect(w.attributes('role')).toBe('region');
    expect(w.attributes('aria-label')).toBe('ذخیرهٔ تغییرات');
    const note = w.find('.q-action-bar__note');
    expect(note.attributes('role')).toBe('status');
    expect(note.attributes('data-tone')).toBe('warn');
    expect(w.find('.q-action-bar__msg').text()).toBe('تغییرات ذخیره نشده');
    expect(w.find('.q-action-bar__detail').text()).toBe('۳ فیلد');
    const [cancel, save] = w.findAll('.q-btn');
    expect(cancel!.text()).toBe('انصراف');
    expect(save!.text()).toBe('ذخیره');
    await save!.trigger('click');
    await cancel!.trigger('click');
    expect(w.emitted('save')).toHaveLength(1);
    expect(w.emitted('cancel')).toHaveLength(1);
  });

  it('saving: busy primary, disabled cancel', () => {
    const w = mount(QActionBar, { props: { status: 'saving' } });
    const [cancel, save] = w.findAll('.q-btn');
    expect(cancel!.attributes('disabled')).toBeDefined();
    expect(save!.attributes('aria-busy')).toBe('true');
    expect(w.find('.q-action-bar__msg').text()).toBe('در حال ذخیره…');
  });

  it('saved / error in en', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QActionBar, { props: { status: 'saved' } });
    expect(w.find('.q-action-bar__msg').text()).toBe('All changes saved');
    expect(w.find('.q-action-bar__note').attributes('data-tone')).toBe('ok');
    expect(w.findAll('.q-btn')[1]!.attributes('disabled')).toBeDefined();
    expect(w.attributes('aria-label')).toBe('Save changes');
    const e = mount(QActionBar, { props: { status: 'error' }, slots: { message: 'Custom' } });
    expect(e.find('.q-action-bar__note').attributes('data-tone')).toBe('down');
    expect(e.find('.q-action-bar__msg').text()).toBe('Custom');
  });
});
