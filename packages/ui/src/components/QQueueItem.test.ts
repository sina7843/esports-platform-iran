import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QQueueItem from './QQueueItem.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QQueueItem', () => {
  it('fa: link row, SLA warning, priority, assignee, note', () => {
    const w = mount(QQueueItem, { props: { subject: 'بازپرداخت', requester: 'علی', category: 'پرداخت', reference: 'tkt_3c91', slaMinutes: 330, priority: 'urgent', assignee: { name: 'مریم' }, internalNote: true, href: '/t/1', selected: true } });
    expect(w.element.tagName).toBe('A');
    expect(w.classes()).toEqual(expect.arrayContaining(['q-queue-item', 'q-queue-item--interactive', 'q-queue-item--selected']));
    expect(w.attributes('aria-current')).toBe('true');
    expect(w.find('.q-queue-item__sla--ok').text()).toBe('۵ ساعت و ۳۰ دقیقه مانده');
    expect(w.find('.q-queue-item__prio .q-badge--danger').text()).toBe('فوری');
    expect(w.find('.q-queue-item__avatar').attributes('title')).toBe('مریم');
    expect(w.find('.q-queue-item__avatar .q-sr').text()).toBe('مسئول: مریم');
    expect(w.find('.q-queue-item__note').text()).toBe('یادداشت داخلی');
    expect(w.find('.q-queue-item__ref').classes()).toContain('q-ltr');
  });
  it('en: overdue button row via @click, unassigned, hidden cells', async () => {
    setLocale('en', { keepDocument: true });
    let n = 0;
    const w = mount(QQueueItem, { props: { subject: 'Refund', slaMinutes: -120 }, attrs: { onClick: () => { n++; } } });
    expect(w.element.tagName).toBe('BUTTON');
    expect(w.attributes('type')).toBe('button');
    expect(w.classes()).toContain('q-queue-item--overdue');
    expect(w.find('.q-queue-item__sla--danger').text()).toBe('2 h overdue');
    expect(w.find('.q-queue-item__prio').text()).toBe('Normal');
    expect(w.find('.q-queue-item__avatar--empty .q-sr').text()).toBe('Assignee: Unassigned');
    await w.trigger('click');
    expect(n).toBe(1);
    const plain = mount(QQueueItem, { props: { subject: 'x', priority: false, assignee: false, slaMinutes: 45 } });
    expect(plain.element.tagName).toBe('DIV');
    expect(plain.find('.q-queue-item__prio').exists()).toBe(false);
    expect(plain.find('.q-queue-item__avatar').exists()).toBe(false);
    expect(plain.find('.q-queue-item__sla--warning').text()).toBe('45 min left');
  });
});
