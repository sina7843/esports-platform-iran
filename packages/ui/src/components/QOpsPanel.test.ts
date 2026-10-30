import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { setLocale } from '../locale';
import QOpsPanel from './QOpsPanel.vue';
import QOpsAlert from './QOpsAlert.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QOpsPanel', () => {
  it('fa: labelled section, counters, each child in an <li>, refresh only with a listener', () => {
    const w = mount(QOpsPanel, {
      props: { updatedAt: '۱۸:۴۲', counters: [{ value: 3, label: 'زنده', tone: 'live' }, { value: 1, label: 'بحرانی', tone: 'danger' }] },
      slots: { default: () => [h(QOpsAlert, { title: 'الف' }), h(QOpsAlert, { title: 'ب' })] },
    });
    expect(w.attributes('aria-labelledby')).toBe(w.find('h2').attributes('id'));
    expect(w.find('h2').text()).toBe('داشبورد عملیات · به‌روزرسانی هر ۳۰ ثانیه');
    expect(w.find('.q-ops-panel__updated').attributes('role')).toBe('status');
    expect(w.find('.q-ops-panel__updated').text()).toBe('آخرین به‌روزرسانی: ۱۸:۴۲');
    expect(w.find('.q-ops-panel__counter--live .q-live-dot').exists()).toBe(true);
    expect(w.find('.q-ops-panel__counter--live .q-ops-panel__counter-value').text()).toBe('۳');
    const list = w.find('.q-ops-panel__list');
    expect(list.attributes('aria-live')).toBe('polite');
    expect(list.attributes('aria-label')).toBe('هشدارها');
    expect(w.findAll('.q-ops-panel__items > li > .q-ops-alert')).toHaveLength(2);
    expect(w.find('.q-ops-panel__refresh button').exists()).toBe(false);
    expect(w.find('.q-ops-panel__bulk').exists()).toBe(false);
  });
  it('en: empty state, refresh and bulk preview emits', async () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QOpsPanel, { props: { onRefresh: () => {}, selectedCount: 2, bulkKinds: [{ value: 'ack', label: 'Acknowledge' }, { value: 'close', label: 'Close' }] } });
    expect(w.find('.q-ops-panel__empty').text()).toBe('No active alerts.');
    await w.find('.q-ops-panel__refresh button').trigger('click');
    expect(w.emitted('refresh')).toHaveLength(1);
    expect(w.find('.q-ops-panel__bulk-count').text()).toBe('2 selected');
    const sel = w.find('select');
    expect(w.find(`label[for="${sel.attributes('id')}"]`).text()).toBe('Action');
    await sel.setValue('close');
    const preview = w.find('.q-ops-panel__bulk .q-btn--green');
    expect(preview.text()).toBe('Preview bulk action');
    await preview.trigger('click');
    expect(w.emitted('preview')).toEqual([['close']]);
    const none = mount(QOpsPanel, { props: { bulkKinds: [{ value: 'a', label: 'A' }] } });
    expect(none.find('.q-ops-panel__bulk .q-btn--green').attributes('disabled')).toBeDefined();
  });
});
