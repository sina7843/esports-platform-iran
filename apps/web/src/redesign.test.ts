import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import AppShell from './components/AppShell.vue';
import EventsView from './views/EventsView.vue';
import { setLocale } from './settings';
import { resetSession } from './session';

vi.mock('./realtime', () => ({
  startRealtime: () => () => {},
  connection: { online: true, reachable: true, mode: 'sse', lastUpdate: null },
}));

beforeEach(() => {
  setLocale('fa'); resetSession();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

async function routerAt(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<div />' } },
    { path: '/events', component: EventsView },
    { path: '/account', component: { template: '<div />' }, meta: { requiresAuth: true, layout: 'panel' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div />' } },
  ] });
  await router.push(path); await router.isReady(); return router;
}

describe('arena navigation and event discovery', () => {
  it('public shell: top bar + footer with the eNAMAD seal, no side nav', async () => {
    const router = await routerAt('/');
    const w = mount(AppShell, { attachTo: document.body, global: { plugins: [router] } });
    expect(w.find('.q-top-bar').exists()).toBe(true);
    expect(w.find('#side-nav').exists()).toBe(false);
    const seal = w.get('.q-footer__seal a');
    expect(seal.attributes('href')).toContain('trustseal.enamad.ir/?id=8145123');
    expect(seal.attributes('referrerpolicy')).toBe('origin');
    expect(w.get('main#main').classes()).toContain('k-main');
    w.unmount();
  });

  it('panel shell: side nav drawer on phones opens from the menu button, closes on Escape and returns focus', async () => {
    const router = await routerAt('/account');
    const w = mount(AppShell, { attachTo: document.body, global: { plugins: [router] } });
    await flushPromises();
    expect(w.find('.k-panel').exists()).toBe(true);
    expect(w.find('.q-footer').exists()).toBe(false);
    const trigger = w.get('[aria-controls="side-nav"]');
    await trigger.trigger('click'); await flushPromises();
    expect(w.get('main').attributes('inert')).toBeDefined();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(w.get('main').attributes('inert')).toBeUndefined();
    w.unmount();
  });

  it('filters loaded events in both views and keeps loading the next page available', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      calls++;
      return Promise.resolve(new Response(JSON.stringify({ items: calls === 1 ? [
        { id: 'a', name: 'جام بنفش', state: 'active', startsAt: null, endsAt: null, timeZone: 'Asia/Tehran' },
        { id: 'b', name: 'جام بهار', state: 'finished', startsAt: null, endsAt: null, timeZone: 'Asia/Tehran' },
      ] : [{ id: 'c', name: 'جام بنفش دوم', state: 'active', startsAt: null, endsAt: null, timeZone: 'Asia/Tehran' }], page: { nextCursor: calls === 1 ? 'next' : null } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }));
    const router = await routerAt('/events');
    const w = mount(EventsView, { global: { plugins: [router] } }); await flushPromises();
    expect(w.findAll('.event-card')).toHaveLength(2);
    await w.get('#event-search').setValue('بنفش');
    expect(w.findAll('.event-card')).toHaveLength(1);
    const more = w.findAll('button').find(b => b.text().includes('بیشتر'));
    expect(more).toBeDefined(); await more!.trigger('click'); await flushPromises();
    expect(w.findAll('.event-card')).toHaveLength(2);
    await w.get('#event-state').setValue('finished');
    expect(w.text()).toContain('رویدادی با این جست‌وجو پیدا نشد.');
    await w.get('#event-state').setValue('active');
    await w.findAll('.view-toggle button')[1]!.trigger('click');
    expect(w.findAll('tbody tr')).toHaveLength(2);
    expect(w.find('a[href="/events/c"]').exists()).toBe(true);
    w.unmount();
  });
});
