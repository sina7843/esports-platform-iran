import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import { STATUS_MACHINES, STATUS_STATES, resolveStatus } from '../maps/display';
import QStatusBadge from './QStatusBadge.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QStatusBadge', () => {
  it('maps state → tone + label (fa / en)', async () => {
    const w = mount(QStatusBadge, { props: { state: 'registration_open' } });
    expect(w.classes()).toEqual(['q-badge', 'q-badge--success', 'q-status-badge']);
    expect(w.text()).toBe('ثبت‌نام باز');
    setLocale('en', { keepDocument: true });
    await w.vm.$nextTick();
    expect(w.text()).toBe('Registration open');
  });
  it('machine disambiguates shared names; live gets the live dot', () => {
    expect(mount(QStatusBadge, { props: { state: 'pending', machine: 'approval' } }).text()).toBe('در انتظار');
    expect(mount(QStatusBadge, { props: { state: 'pending' } }).text()).toBe('در انتظار'); // first machine that defines it
    const live = mount(QStatusBadge, { props: { state: 'live', machine: 'match' } });
    expect(live.classes()).toContain('q-badge--live');
    expect(live.find('.q-live-dot').exists()).toBe(true);
  });
  it('unknown state: raw key in fa, sentence case in en; overrides', () => {
    expect(resolveStatus('needs_coffee').label).toBe('needs_coffee');
    setLocale('en', { keepDocument: true });
    expect(resolveStatus('needs_coffee').label).toBe('Needs coffee');
    expect(STATUS_MACHINES.ticket.label).toBe('Entry ticket');
    expect(STATUS_STATES.reschedule.agreed?.tone).toBe('info');
    const w = mount(QStatusBadge, { props: { state: 'final', label: 'Official', tone: 'info', icon: 'check' } });
    expect(w.classes()).toContain('q-badge--info');
    expect(w.text()).toBe('Official');
    expect(w.find('svg').exists()).toBe(true);
  });
});
