import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QSponsorStrip from './QSponsorStrip.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QSponsorStrip', () => {
  const sponsors = [{ name: 'Acme' }, { name: 'همراه', logoUrl: '/h.png' }];
  it('fa: label, placeholder and logo slots, synced status', () => {
    const w = mount(QSponsorStrip, { props: { sponsors, sync: { mode: 'synced' } } });
    expect(w.classes()).toEqual(['q-sponsor-strip']);
    expect(w.attributes('aria-label')).toBe('اسپانسر');
    const slots = w.findAll('.q-sponsor-strip__slot');
    expect(slots[0]!.classes()).toContain('q-stripes');
    expect(slots[0]!.find('bdi').classes()).toContain('q-ltr');
    expect(slots[1]!.find('img').attributes('alt')).toBe('همراه');
    const s = w.find('[role="status"]');
    expect(s.classes()).toContain('q-sponsor-strip__sync--synced');
    expect(s.text()).toBe('هماهنگ با پخش (تأخیر ۳۰ ثانیه)');
  });
  it('en: latest mode and custom delay', () => {
    setLocale('en', { keepDocument: true });
    expect(mount(QSponsorStrip, { props: { sponsors, sync: { mode: 'latest' } } }).find('[role="status"]').text()).toBe('Latest result');
    const w = mount(QSponsorStrip, { props: { sponsors, sync: { mode: 'synced', delaySeconds: 10 }, transparent: true } });
    expect(w.find('[role="status"]').text()).toBe('Synced to stream (10s delay)');
    expect(w.classes()).toContain('q-sponsor-strip--transparent');
    expect(mount(QSponsorStrip, { props: { sponsors } }).find('[role="status"]').exists()).toBe(false);
  });
});
