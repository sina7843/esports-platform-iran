import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QAvatarGroup from './QAvatarGroup.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));
const items = ['الف', 'ب', 'پ', 'ت', 'ث', 'ج', 'چ'].map((name) => ({ name }));

describe('QAvatarGroup', () => {
  it('shows max avatars and a «+N» chip (fa / en)', async () => {
    const w = mount(QAvatarGroup, { props: { items, label: 'اعضای تیم' } });
    expect(w.classes()).toEqual(['q-avatar-group', 'q-avatar-group--32']);
    expect(w.attributes('role')).toBe('group');
    expect(w.attributes('aria-label')).toBe('اعضای تیم');
    expect(w.findAll('.q-avatar')).toHaveLength(4);
    const more = w.find('.q-avatar-group__more');
    expect(more.attributes('aria-label')).toBe('۳ مورد دیگر');
    expect(more.text()).toBe('+۳');
    setLocale('en', { keepDocument: true });
    await w.vm.$nextTick();
    expect(w.find('.q-avatar-group__more').attributes('aria-label')).toBe('3 more');
  });
  it('team kind cuts the stack', () => {
    const w = mount(QAvatarGroup, { props: { items: items.slice(0, 2), kind: 'team', size: 40 } });
    expect(w.classes()).toContain('q-avatar-group--cut');
    expect(w.find('.q-avatar-group__more').exists()).toBe(false);
  });
});
