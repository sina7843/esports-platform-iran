import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import QSkeleton from './QSkeleton.vue';

describe('QSkeleton', () => {
  it('line by default, aria-hidden, px sizes', () => {
    const w = mount(QSkeleton, { props: { width: 120, height: '1rem' } });
    expect(w.classes()).toEqual(['q-skeleton', 'q-skeleton--line']);
    expect(w.attributes('aria-hidden')).toBe('true');
    expect(w.attributes('style')).toContain('width: 120px');
  });
  it('circle, lines, card, table-row', () => {
    expect(mount(QSkeleton, { props: { variant: 'circle' } }).attributes('style')).toContain('width: 40px');
    const lines = mount(QSkeleton, { props: { lines: 3 } });
    expect(lines.classes()).toEqual(['q-skeleton-lines']);
    expect(lines.findAll('.q-skeleton--line')).toHaveLength(3);
    expect(lines.findAll('.q-skeleton--line')[2]!.attributes('style')).toContain('60%');
    const card = mount(QSkeleton, { props: { variant: 'card' } });
    expect(card.classes()).toEqual(['q-skeleton-card']);
    expect(card.find('.q-skeleton--block').attributes('style')).toContain('96px');
    expect(card.find('.q-skeleton--bar').exists()).toBe(true);
    const row = mount(QSkeleton, { props: { variant: 'table-row' } });
    expect(row.classes()).toEqual(['q-skeleton-row']);
    expect(row.attributes('aria-hidden')).toBe('true');
    expect(row.findAll('.q-skeleton')).toHaveLength(4);
  });
});
