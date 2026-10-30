import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setLocale } from '../locale';
import QBracket, { type QBracketRound } from './QBracket.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

const rounds: QBracketRound[] = [
  { matches: [
    { id: 'a', state: 'final', top: { name: 'سیمرغ', seed: 1, score: 2 }, bottom: { name: 'دماوند', seed: 4, score: 0 }, winner: 'top' },
    { id: 'b', state: 'live', top: { name: 'پارس' }, bottom: { name: 'البرز' } },
  ] },
  { matches: [{ id: 'f', state: 'scheduled', time: '۲۰:۰۰', top: {}, bottom: {} }] },
];

describe('QBracket', () => {
  it('fa: round names, paired slots, roving tabindex and labels', () => {
    const w = mount(QBracket, { props: { rounds, layout: 'full' } });
    expect(w.classes()).toEqual(['q-bracket']);
    expect(w.find('.q-bracket__section').attributes('aria-label')).toBe('جدول مسابقات');
    expect(w.findAll('.q-bracket__round').map((r) => r.attributes('aria-label'))).toEqual(['نیمه‌نهایی', 'فینال']);
    expect(w.findAll('.q-bracket__pair')).toHaveLength(1);
    const btns = w.findAll('button.q-bracket__match');
    expect(btns.map((b) => b.attributes('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(btns[0]!.attributes('aria-label')).toBe('نیمه‌نهایی — سیمرغ / دماوند ۲ – ۰ — نهایی، برنده: سیمرغ');
    const hint = w.find('p.q-sr');
    expect(btns[0]!.attributes('aria-describedby')).toBe(hint.attributes('id'));
    expect(hint.text()).toContain('با کلیدهای جهت');
    expect(btns[1]!.classes()).toContain('q-bracket__match--live');
    expect(btns[2]!.findAll('.q-bracket__name').map((n) => n.text())).toEqual(['در انتظار', 'در انتظار']);
    expect(w.find('.q-bracket__team--win .q-bracket__seed').text()).toBe('۱');
  });
  it('keyboard: arrows move focus (RTL-aware), Enter/click emits open', async () => {
    const host = document.createElement('div');
    host.dir = 'rtl';
    host.style.direction = 'rtl';
    document.body.appendChild(host);
    const w = mount(QBracket, { props: { rounds, layout: 'full', onOpen: vi.fn() }, attachTo: host });
    const btns = () => w.findAll('button.q-bracket__match');
    await btns()[0]!.trigger('keydown', { key: 'ArrowDown' });
    await nextTick();
    expect(btns()[1]!.attributes('tabindex')).toBe('0');
    expect(document.activeElement).toBe(btns()[1]!.element);
    await btns()[1]!.trigger('keydown', { key: 'ArrowLeft' }); // forward in RTL
    await nextTick();
    expect(btns()[2]!.attributes('tabindex')).toBe('0');
    await btns()[2]!.trigger('click');
    expect(w.emitted('open')![0]![0]).toMatchObject({ id: 'f' });
    w.unmount();
  });
  it('en + stepped: one round with nav controls', async () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QBracket, { props: { rounds, layout: 'stepped', 'aria-label': 'Main bracket' } });
    expect(w.find('.q-bracket__section').attributes('aria-label')).toBe('Main bracket');
    expect(w.findAll('.q-bracket__round')).toHaveLength(1);
    expect(w.find('.q-bracket__scroll').classes()).toContain('q-bracket__scroll--narrow');
    const nav = w.findAll('.q-bracket__nav button');
    expect(nav[0]!.attributes('aria-label')).toBe('Previous round');
    expect(nav[0]!.attributes('disabled')).toBeDefined();
    expect(w.find('select option').text()).toBe('Semi-finals');
    await nav[1]!.trigger('click');
    expect(w.find('.q-bracket__round').attributes('aria-label')).toBe('Final');
    expect(w.find('.q-bracket__time').text()).toBe('۲۰:۰۰');
  });
});
