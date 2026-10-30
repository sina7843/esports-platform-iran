import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QVerifiedMark from './QVerifiedMark.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QVerifiedMark', () => {
  it('is an image with the default label in fa', () => {
    const w = mount(QVerifiedMark);
    expect(w.classes()).toEqual(['q-verified-mark']);
    expect(w.attributes('role')).toBe('img');
    expect(w.attributes('aria-label')).toBe('تأییدشده');
    expect(w.find('svg').attributes('width')).toBe('18');
    expect(w.find('svg').attributes('aria-hidden')).toBe('true');
  });
  it('en label, custom label and visible text', () => {
    setLocale('en', { keepDocument: true });
    expect(mount(QVerifiedMark).attributes('aria-label')).toBe('Verified');
    expect(mount(QVerifiedMark, { props: { label: 'Verified team' } }).attributes('aria-label')).toBe('Verified team');
    const t = mount(QVerifiedMark, { props: { text: 'Verified organizer', size: 16 }, attrs: { title: 't' } });
    expect(t.classes()).toContain('q-verified-mark--text');
    expect(t.attributes('role')).toBeUndefined();
    expect(t.attributes('aria-label')).toBeUndefined();
    expect(t.attributes('title')).toBe('t');
    expect(t.find('.q-verified-mark__text').text()).toBe('Verified organizer');
  });
});
