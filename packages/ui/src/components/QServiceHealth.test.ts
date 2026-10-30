import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QServiceHealth from './QServiceHealth.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

const checks = [{ ms: 100, status: 'ok' as const }, { ms: 400, status: 'degraded' as const }, { ms: 0, status: 'down' as const }];

describe('QServiceHealth', () => {
  it('fa: article label, LTR name, sparkline, facts', () => {
    const w = mount(QServiceHealth, { props: { name: 'SMS provider', kind: 'ارسال پیامک', status: 'degraded', checks, checkedAt: '۱۸:۴۰', outbox: 1200, deadLetters: 3 } });
    expect(w.classes()).toEqual(['q-service-health', 'q-service-health--degraded']);
    expect(w.attributes('aria-label')).toBe('SMS provider — مختل');
    expect(w.find('.q-service-health__name').attributes('dir')).toBe('ltr');
    expect(w.find('.q-service-health__name bdi').classes()).toContain('q-ltr');
    expect(w.find('.q-badge--warning').text()).toBe('مختل');
    expect(w.find('[role="img"]').attributes('aria-label')).toBe('آخرین ۳ بررسی: ۱ سالم، ۱ مختل، ۱ قطع');
    const bars = w.findAll('.q-service-health__bar');
    expect(bars.map((b) => b.attributes('style'))).toEqual(['height: 25%;', 'height: 100%;', 'height: 100%;']);
    expect(bars[0]!.attributes('title')).toBe('۱۰۰ ms');
    expect(w.find('figcaption').text()).toBe('آخرین ۳ بررسی، قدیمی ← جدید');
    expect(w.findAll('dd').map((d) => d.text())).toEqual(['۱۸:۴۰', '۱٬۲۰۰', '۳']);
    expect(w.find('.q-service-health__fact--bad').exists()).toBe(true);
  });
  it('en: status labels, no checks, Persian name stays RTL', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QServiceHealth, { props: { name: 'درگاه', status: 'ok', statusLabels: { ok: 'Up' } } });
    expect(w.attributes('aria-label')).toBe('درگاه — Up');
    expect(w.find('.q-service-health__name').attributes('dir')).toBeUndefined();
    expect(w.find('figure').exists()).toBe(false);
    expect(w.findAll('dt').map((d) => d.text())).toEqual(['Last checked']);
    expect(w.find('dd').text()).toBe('—');
    expect(mount(QServiceHealth, { props: { name: 'X', status: 'unconfigured' } }).find('.q-badge--neutral').text()).toBe('Not configured');
  });
});
