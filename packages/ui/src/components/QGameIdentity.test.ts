import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QGameIdentity from './QGameIdentity.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QGameIdentity', () => {
  it('fa row, state badge, edit label and @edit', async () => {
    let edits = 0;
    const w = mount(QGameIdentity, { props: { game: 'Valorant', value: 'Kian#IR1', state: 'verified', onEdit: () => { edits++; } } });
    expect(w.classes()).toEqual(['q-game-identity', 'q-game-identity--verified']);
    expect(w.find('.q-game-identity__value').classes()).toContain('q-ltr');
    expect(w.find('.q-badge').text()).toBe('تأییدشده');
    const b = w.find('.q-game-identity__edit');
    expect(b.attributes('aria-label')).toBe('ویرایش شناسه Valorant');
    await b.trigger('click');
    expect(edits).toBe(1);
    expect(w.find('.q-game-identity__note').exists()).toBe(false);
  });
  it('en disputed note with role=note; onEdit false hides edit', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QGameIdentity, { props: { game: 'Valorant', value: 'x', state: 'disputed', onEdit: false } });
    expect(w.find('.q-game-identity__edit').exists()).toBe(false);
    expect(w.find('.q-badge').text()).toBe('Disputed');
    const n = w.find('.q-game-identity__note');
    expect(n.attributes('role')).toBe('note');
    expect(n.text()).toContain('manual review');
    expect(mount(QGameIdentity, { props: { game: 'G', value: 'x' } }).find('.q-game-identity__edit').attributes('aria-label')).toBe('Edit G ID');
  });
});
