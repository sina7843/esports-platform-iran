import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import QTooltip from './QTooltip.vue';

describe('QTooltip', () => {
  it('bubble role=tooltip; trigger gets aria-describedby', async () => {
    const w = mount(QTooltip, { props: { content: 'به وقت تهران' }, slots: { default: '<button aria-describedby="x">?</button>' } });
    expect(w.classes()).toEqual(['q-tooltip', 'q-tooltip--top']);
    const bubble = w.find('[role=tooltip]');
    expect(bubble.classes()).toContain('q-tooltip__bubble');
    expect(bubble.text()).toBe('به وقت تهران');
    expect(w.find('button').attributes('aria-describedby')).toBe(`x ${bubble.attributes('id')}`);
  });
  it('opens on hover/focus, closes on leave/blur/Escape; open forces it', async () => {
    const w = mount(QTooltip, { props: { content: 'x', placement: 'bottom' }, slots: { default: '<button>?</button>' } });
    expect(w.classes()).toContain('q-tooltip--bottom');
    await w.trigger('mouseenter');
    expect(w.classes()).toContain('q-tooltip--open');
    await w.trigger('keydown', { key: 'Escape' });
    expect(w.classes()).not.toContain('q-tooltip--open');
    await w.find('button').trigger('focusin');
    expect(w.classes()).toContain('q-tooltip--open');
    await w.find('button').trigger('focusout');
    expect(w.classes()).not.toContain('q-tooltip--open');
    await w.setProps({ open: true });
    expect(w.classes()).toContain('q-tooltip--open');
  });
});
