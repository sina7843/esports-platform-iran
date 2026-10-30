import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QAvatar from './QAvatar.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QAvatar', () => {
  it('user circle with initial, verified and online (fa)', () => {
    const w = mount(QAvatar, { props: { name: 'سینا', verified: true, online: true } });
    expect(w.classes()).toEqual(['q-avatar', 'q-avatar--40']);
    const face = w.find('.q-avatar__face');
    expect(face.classes()).toContain('q-avatar__face--circle');
    expect(face.attributes('role')).toBe('img');
    expect(face.attributes('aria-label')).toBe('سینا');
    expect(face.text()).toBe('س');
    expect(w.find('.q-avatar__verified .q-sr').text()).toBe('تأییدشده');
    expect(w.find('.q-avatar__online .q-sr').text()).toBe('آنلاین');
  });
  it('team chamfer by size, image, decorative, en strings, invalid size → 40', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QAvatar, { props: { name: 'simorgh', kind: 'team', size: 72, src: '/a.png', decorative: true, verified: true } });
    const face = w.find('.q-avatar__face');
    expect(face.classes()).toContain('q-chamfer-lg');
    expect(face.attributes('aria-hidden')).toBe('true');
    expect(face.attributes('role')).toBeUndefined();
    expect(w.find('img').attributes('alt')).toBe('');
    expect(w.find('.q-avatar__verified .q-sr').text()).toBe('Verified');
    const odd = mount(QAvatar, { props: { name: 'x', size: 50 as never } });
    expect(odd.classes()).toContain('q-avatar--40');
    expect(odd.find('.q-avatar__face').text()).toBe('X');
  });
});
