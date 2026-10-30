import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QPickBanBoard, { type QPickBanBoardMap, type QPickBanBoardStep } from './QPickBanBoard.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

const teams = [{ name: 'سیمرغ' }, { name: 'پارس' }];
const sequence: QPickBanBoardStep[] = [{ kind: 'ban', side: 0 }, { kind: 'ban', side: 1 }, { kind: 'decider', side: null }];
const maps: QPickBanBoardMap[] = [
  { id: 'a', name: 'Lotus', status: 'available' }, { id: 'b', name: 'Bind', status: 'available' }, { id: 'c', name: 'Haven', status: 'available' },
];

describe('QPickBanBoard', () => {
  it('fa: my turn, ban emits select and auto-assigns the decider (uncontrolled)', async () => {
    const w = mount(QPickBanBoard, { props: { teams, sequence, maps, viewerSide: 0, secondsLeft: 30 } });
    expect(w.classes()).toEqual(expect.arrayContaining(['q-card', 'q-pick-ban-board']));
    expect(w.find('.q-pick-ban-board__turn--mine').exists()).toBe(true);
    expect(w.find('.q-pick-ban-board__step').text()).toBe('گام ۱ از ۳');
    expect(w.find('.q-pick-ban-board__turn .h4').text()).toBe('نوبت سیمرغ — حذف نقشه');
    expect(w.find('[role="timer"]').attributes('aria-label')).toBe('زمان باقی‌مانده نوبت: ۳۰ ثانیه');
    const btns = w.findAll('button.q-pick-ban-board__btn');
    expect(btns).toHaveLength(3);
    expect(btns[0]!.attributes('aria-label')).toBe('حذف Lotus');
    expect(w.find('[aria-current="step"]').text()).toContain('حذف · سیمرغ');
    await btns[0]!.trigger('click');
    expect(w.emitted('select')![0]).toEqual([maps[0], sequence[0]]);
    expect(w.find('.q-pick-ban-board__tile--banned .q-pick-ban-board__tag').text()).toBe('حذف · سیمرغ');
    expect(w.findAll('button.q-pick-ban-board__btn')).toHaveLength(0); // the opponent's turn
    expect(w.find('.q-pick-ban-board__btn[aria-disabled="true"]').exists()).toBe(true);
  });
  it('controlled: emits change + update models and keeps the props', async () => {
    const after1: QPickBanBoardMap[] = [{ ...maps[0]!, status: 'banned', by: 0 }, maps[1]!, maps[2]!];
    const w = mount(QPickBanBoard, { props: { teams, sequence, maps: after1, step: 1, viewerSide: 1, onChange: () => {} } });
    await w.findAll('button.q-pick-ban-board__btn')[0]!.trigger('click');
    const [next, ns] = w.emitted('change')![0] as [QPickBanBoardMap[], number];
    expect(ns).toBe(3);
    expect(next.map((m) => m.status)).toEqual(['banned', 'banned', 'decider']);
    expect(w.emitted('update:step')).toEqual([[3]]);
    expect(w.findAll('.q-pick-ban-board__tile--banned')).toHaveLength(1); // props are not mutated
  });
  it('en: waiting for referee, complete, resolved labels, note', () => {
    setLocale('en', { keepDocument: true });
    const r = mount(QPickBanBoard, { props: { teams, sequence, maps, state: 'waiting_referee' } });
    expect(r.find('.q-pick-ban-board__turn .h4').text()).toBe('Waiting for the referee’s decision');
    expect(r.find('[role="timer"]').exists()).toBe(false);
    expect(r.find('.q-pick-ban-board__alert').attributes('role')).toBe('status');
    const c = mount(QPickBanBoard, { props: { teams, sequence: [{ kind: 'ban', side: 0, resolvedBy: 'rule' }], maps: [{ id: 'a', name: 'Lotus', status: 'banned', by: 0, resolvedBy: 'referee' }], step: 1, note: null } });
    expect(c.find('.q-pick-ban-board__turn--done').text()).toBe('Selection complete');
    expect(c.find('.q-pick-ban-board__auto').text()).toBe('By referee');
    expect(c.find('.q-pick-ban-board__sauto').text()).toBe('(by rule after timeout)');
    expect(c.find('.q-pick-ban-board__note').exists()).toBe(false);
  });
});
