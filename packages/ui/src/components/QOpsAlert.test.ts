import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QOpsAlert from './QOpsAlert.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QOpsAlert', () => {
  it('fa: labelled article, severity, uncontrolled acknowledge', async () => {
    const w = mount(QOpsAlert, { props: { severity: 'critical', title: 'ایستگاه ۴ قطع است', target: 'سیمرغ — پارس', time: '۱۸:۴۰' } });
    expect(w.element.tagName).toBe('ARTICLE');
    expect(w.classes()).toEqual(['q-ops-alert', 'q-ops-alert--critical']);
    expect(w.attributes('aria-labelledby')).toBe(w.find('h3').attributes('id'));
    expect(w.find('.q-badge--danger').text()).toBe('بحرانی');
    expect(w.findAll('button')).toHaveLength(1);
    await w.find('button').trigger('click');
    expect(w.emitted('acknowledge')).toHaveLength(1);
    expect(w.emitted('update:acknowledged')).toEqual([[true]]);
    expect(w.classes()).toContain('q-ops-alert--acked');
    expect(w.find('.q-badge--neutral').exists()).toBe(true);
    expect(w.find('.q-ops-alert__fact--ok').text()).toBe('دریافت شد');
    expect(w.find('button').exists()).toBe(false);
  });
  it('controlled false stays unacknowledged; en strings; action emits; title slot', async () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QOpsAlert, { props: { acknowledged: false, onAction: () => {} }, slots: { title: '<bdi>WEBHOOK_FAIL</bdi>' } });
    expect(w.classes()).toContain('q-ops-alert--warning');
    expect(w.find('h3 bdi').text()).toBe('WEBHOOK_FAIL');
    expect(w.find('.q-badge--warning').text()).toBe('Warning');
    const [ack, act] = w.findAll('button');
    expect(ack!.text()).toBe('Acknowledge');
    expect(act!.text()).toBe('Take action');
    await ack!.trigger('click');
    expect(w.classes()).not.toContain('q-ops-alert--acked');
    await act!.trigger('click');
    expect(w.emitted('action')).toHaveLength(1);
    const link = mount(QOpsAlert, { props: { title: 'x', severity: 'info', actionHref: '/ops/1' } });
    expect(link.find('a.q-btn--green').attributes('href')).toBe('/ops/1');
    expect(link.find('.q-badge--info').text()).toBe('Info');
  });
});
