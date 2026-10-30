import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QCertificateCard from './QCertificateCard.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

describe('QCertificateCard', () => {
  it('fa gold placement: card label, medal, code groups and sr text, verify link', () => {
    const w = mount(QCertificateCard, { props: { title: 'قهرمانی', rank: 1, recipient: 'سیمرغ', event: 'جام', date: '2026-12-03T15:00:00Z', code: 'ab12-cd34-ef56' } });
    expect(w.element.tagName).toBe('ARTICLE');
    expect(w.classes()).toEqual(expect.arrayContaining(['q-card', 'q-card--flush', 'q-chamfer-xl', 'q-certificate-card', 'q-certificate-card--gold']));
    expect(w.attributes('aria-label')).toBe('گواهی رتبه: قهرمانی');
    const medal = w.find('.q-certificate-card__medal');
    expect(medal.attributes('role')).toBe('img');
    expect(medal.attributes('aria-label')).toBe('مقام ۱');
    expect(w.findAll('.q-certificate-card__code > span[aria-hidden="true"]').map((s) => s.text())).toEqual(['AB12', 'CD34', 'EF56']);
    expect(w.find('.q-certificate-card__code .q-sr').text()).toBe('A B 1 2 C D 3 4 E F 5 6');
    expect(w.find('a.q-btn').attributes('href')).toBe('/verify?code=AB12CD34EF56');
    expect(w.find('a.q-btn').text()).toBe('استعلام');
    expect(w.find('time').text()).toBe('۱۲ آذر ۱۴۰۵');
    expect(w.find('.q-tricolor').exists()).toBe(true);
  });
  it('en revoked attendance without rank; actions and footer slots', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QCertificateCard, { props: { title: 'T', kind: 'attendance', code: 'X', state: 'revoked', revokedReason: 'fraud', verifyHref: '/v' }, slots: { actions: '<button class="share">s</button>', footer: '<i class="f">f</i>' } });
    expect(w.classes()).toEqual(expect.arrayContaining(['q-certificate-card--none', 'q-certificate-card--revoked']));
    expect(w.attributes('aria-label')).toBe('Attendance certificate: T');
    expect(w.find('.q-badge--danger').text()).toBe('Revoked');
    expect(w.find('.q-certificate-card__revoked').attributes('role')).toBe('note');
    expect(w.find('.q-certificate-card__medal').attributes('aria-hidden')).toBe('true');
    expect(w.find('.q-certificate-card__actions .share').exists()).toBe(true);
    expect(w.find('.q-certificate-card__actions a').attributes('href')).toBe('/v');
    expect(w.find('.q-certificate-card__footer .f').exists()).toBe(true);
  });
});
