import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import DataState from './components/DataState.vue';
import { ApiClientError } from './api/client';
import { fa } from './locales/fa';

const mk = (props: Record<string, unknown>) => mount(DataState, { props, slots: { default: '<p id="content">ok</p>' } });

describe('DataState', () => {
  it('renders content when nothing is pending', () => {
    expect(mk({}).find('#content').exists()).toBe(true);
  });
  it('loading', () => {
    const w = mk({ loading: true });
    expect(w.text()).toContain(fa['state.loading']);
    expect(w.attributes('aria-busy')).toBe('true');
    expect(w.find('#content').exists()).toBe(false);
  });
  it('empty', () => expect(mk({ empty: true }).text()).toContain(fa['state.empty']));
  it('forbidden', () => expect(mk({ forbidden: true }).text()).toContain(fa['state.forbidden']));
  it('offline with retry', async () => {
    const w = mk({ offline: true });
    expect(w.text()).toContain(fa['state.offline']);
    await w.get('button').trigger('click');
    expect(w.emitted('retry')).toHaveLength(1);
  });
  it('error shows localized text and the requestId', () => {
    const error = new ApiClientError({ code: 'INTERNAL', message: 'boom', requestId: 'req_123', status: 500 });
    const w = mk({ error });
    expect(w.text()).toContain(fa['state.error']);
    expect(w.text()).toContain(fa['err.INTERNAL']);
    expect(w.text()).toContain('req_123');
  });
  it('maps a FORBIDDEN API error to forbidden and NETWORK to offline', () => {
    expect(mk({ error: new ApiClientError({ code: 'FORBIDDEN', message: 'x', status: 403 }) }).text()).toContain(fa['state.forbidden']);
    expect(mk({ error: new ApiClientError({ code: 'NETWORK', message: 'x', status: 0 }) }).text()).toContain(fa['state.offline']);
  });
});
