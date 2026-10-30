import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QRosterList, { type QRosterListMember } from './QRosterList.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));
const members: QRosterListMember[] = [
  { id: 1, name: 'کیان', roles: ['owner', 'player'], gameId: { value: 'Kian#IR1', state: 'verified' }, roster: 'confirmed', checkIn: 'pending' },
  { id: 2, name: 'سارا', roles: ['captain'] },
];

describe('QRosterList', () => {
  it('fa header, labelled list, roles, badges with sr prefixes', () => {
    const w = mount(QRosterList, { props: { members } });
    expect(w.classes()).toEqual(['q-roster-list']);
    expect(w.find('.q-roster-list__title').text()).toBe('اعضای فعلی');
    expect(w.find('.q-roster-list__count').text()).toBe('۲ نفر');
    expect(w.find('.q-roster-list__list').attributes('aria-label')).toBe('اعضای فعلی');
    expect(w.find('.q-roster-list__cols').attributes('aria-hidden')).toBe('true');
    expect(w.findAll('.q-roster-list__role--lead')).toHaveLength(2);
    expect(w.find('.q-roster-list__role').text()).toBe('مالک');
    expect(w.find('.q-roster-list__gid-value').classes()).toContain('q-ltr');
    expect(w.find('.q-roster-list__gid .q-badge').text()).toBe('شناسهٔ بازی: تأییدشده');
    expect(w.find('.q-roster-list__states').text()).toContain('ترکیب: تأییدشده');
    expect(w.find('.q-roster-list__states').text()).toContain('حضور: در انتظار اعلام حضور');
  });
  it('en, no-states modifier, hidden header, empty state and row-actions slot', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QRosterList, { props: { members: [members[1]!], title: false }, slots: { 'row-actions': '<button class="act">x</button>' } });
    expect(w.classes()).toContain('q-roster-list--no-states');
    expect(w.find('.q-roster-list__head').exists()).toBe(false);
    expect(w.find('.q-roster-list__role').text()).toBe('Captain');
    expect(w.find('.q-roster-list__actions .act').exists()).toBe(true);
    const e = mount(QRosterList, { props: { members: [] } });
    expect(e.find('.q-roster-list__empty').text()).toBe('No members in this team yet.');
    expect(e.find('.q-roster-list__count').text()).toBe('0 members');
  });
});
