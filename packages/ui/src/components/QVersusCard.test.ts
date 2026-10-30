import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QVersusCard from './QVersusCard.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QVersusCard', () => {
  const props = {
    home: { name: 'سیمرغ', seed: 1, note: '۲ برد پیاپی' }, away: { name: 'پارس', initial: 'پ' }, event: 'جام پاییزه', stage: 'یک‌چهارم نهایی',
    info: [{ label: 'نقشه اول', value: 'Lotus', ltr: true }, { label: 'شروع', value: '۱۸:۳۰', tone: 'green' as const }],
    sponsor: { name: 'Acme' },
  };
  it('fa: region label, sides around the vs, seed, facts, sponsor placeholder', () => {
    const w = mount(QVersusCard, { props });
    expect(w.classes()).toEqual(['q-versus-card']);
    expect(w.find('.q-versus-card__frame').attributes('aria-label')).toBe('سیمرغ در برابر پارس');
    const main = [...w.find('.q-versus-card__main').element.children].map((e) => e.className);
    expect(main).toEqual(['q-versus-card__side', 'q-versus-card__vs', 'q-versus-card__side q-versus-card__side--away']);
    expect(w.find('.q-versus-card__seed').text()).toBe('سید ۱');
    expect(w.find('.q-versus-card__fact .q-ltr').text()).toBe('Lotus');
    expect(w.findAll('.q-versus-card__fact')[1]!.classes()).toContain('q-versus-card__fact--green');
    expect(w.find('.q-versus-card__sponsor-label').text()).toBe('اسپانسر');
    expect(w.find('.q-versus-card__sponsor-slot bdi').classes()).toContain('q-ltr');
    expect(w.find('.q-versus-card__logo').exists()).toBe(true);
  });
  it('en strings, labels override, logo=false, sponsor image', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QVersusCard, { props: { ...props, logo: false, labels: { seed: '#' }, sponsor: { name: 'Acme', logoUrl: '/a.png' } } });
    expect(w.find('.q-versus-card__vs strong').text()).toBe('vs');
    expect(w.find('.q-versus-card__seed').text()).toBe('# 1');
    expect(w.find('.q-versus-card__sponsor-label').text()).toBe('Sponsor');
    expect(w.find('.q-versus-card__sponsor-slot img').attributes('alt')).toBe('Acme');
    expect(w.find('.q-versus-card__logo').exists()).toBe(false);
  });
});
