import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterLink } from 'vue-router';
import QLink from './QLink.vue';
import { QLinkKey } from '../link';

describe('QLink', () => {
  it('plain <a> without a router', () => {
    const w = mount(QLink, { props: { href: '/x' }, attrs: { class: 'c', 'aria-label': 'l' }, slots: { default: 'go' } });
    expect(w.html()).toBe('<a class="c" aria-label="l" href="/x">go</a>');
  });
  it('internal href navigates through the router and keeps attrs + click on the <a>', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<i/>' } }, { path: '/x', component: { template: '<i/>' } }] });
    await router.push('/'); await router.isReady();
    const onClick = vi.fn();
    const w = mount(QLink, { props: { href: '/x' }, attrs: { class: 'c', onClick }, slots: { default: 'go' }, global: { plugins: [router], provide: { [QLinkKey as symbol]: RouterLink } } });
    const a = w.get('a');
    expect(a.classes()).toContain('c');
    expect(a.attributes('href')).toBe('/x');
    await a.trigger('click'); await flushPromises();
    expect(onClick).toHaveBeenCalledOnce();
    expect(router.currentRoute.value.path).toBe('/x');
  });
});
