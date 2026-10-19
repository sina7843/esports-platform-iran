import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory } from 'vue-router';
import EventDetailView from './views/EventDetailView.vue';
import PaymentReturnView from './views/PaymentReturnView.vue';
import FinanceView from './views/FinanceView.vue';
import { createAppRouter } from './router';
import { resetSession, setMe } from './session';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const me = (id: string, grants: unknown[] = []) => ({
  principal: { id, displayName: id, locale: 'fa', timeZone: 'Asia/Tehran', kind: 'user' },
  session: { id: 's1', principalId: id, createdAt: '', expiresAt: '', lastSeenAt: '', revokedAt: null, userAgent: null, current: true },
  grants,
});
const grant = (role: string) => ({ id: `g_${role}`, principalId: 'usr_1', role, scope: { type: 'site', id: 'site' }, grantedBy: 'x', grantedAt: '', expiresAt: null, revokedAt: null, reason: null });
const body = (fetchMock: ReturnType<typeof vi.fn>, i: number) => JSON.parse(String((fetchMock.mock.calls[i]?.[1] as RequestInit).body));
const url = (fetchMock: ReturnType<typeof vi.fn>, i: number) => String(fetchMock.mock.calls[i]?.[0]);

beforeEach(() => {
  resetSession();
  vi.unstubAllGlobals();
});

const eventFull = {
  event: { id: 'evt_1', slug: 's', name: 'جام', state: 'registration_open', visibility: 'public', timeZone: 'Asia/Tehran', startsAt: '2026-11-01T10:00:00Z', endsAt: null, organizerOrgId: 'org_1', version: 3, description: null, presence: 'online', regions: [], language: 'fa', contact: null, rated: false, refundPolicy: { beforeDeadlinePercent: 100, afterDeadlinePercent: 50, onEventCancelPercent: 100, onDisqualificationPercent: 0, text: 'TEST ONLY policy' }, cancellationTerms: 'TEST ONLY', disputeTerms: 'TEST ONLY', robots: 'index', posterUrl: null },
  badges: { rated: false, organizerVerified: true, affiliation: null },
  disciplines: [{ id: 'dsc_1', name: 'انفرادی', gameId: 'g', gameVersion: '1', platform: 'pc', mode: '1v1', participantKind: 'player', capacity: 8, remaining: 3, waitlisted: 0, feeRial: 2_000_000, registrationOpensAt: null, registrationClosesAt: '2026-10-30T10:00:00Z', lateRegistrationUntil: null, withdrawalDeadline: null, presence: 'online', formFields: [], requiredDocuments: [], rules: { packageId: 'rp_1', version: '1.0', label: 'TEST', hash: 'h'.repeat(64), clauses: [] }, stages: [] }],
  prizes: [{ id: 'prz_1', title: 'قهرمان', kind: 'cash', amountRial: 5_000_000, responsible: 'organizer', state: 'defined', guaranteed: false }],
  sponsors: [],
};

async function mountEvent(fetchMock: ReturnType<typeof vi.fn>, principal: string | null) {
  vi.stubGlobal('fetch', fetchMock);
  setMe(principal ? (me(principal) as never) : null);
  const router = createAppRouter(createMemoryHistory());
  await router.push('/events/evt_1');
  const w = mount(EventDetailView, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

describe('public event page (EVT-005/007, REG-001/002, FIN-001)', () => {
  it('shows capacity, fee in Toman and prizes as not guaranteed', async () => {
    const w = await mountEvent(vi.fn().mockResolvedValue(json(200, eventFull)), null);
    expect(w.text()).toContain('تضمین نمی‌کند');
    expect(w.text()).toContain('تومان');
    expect(w.text()).toContain('۳ جای خالی از ۸');
    expect(w.text()).toContain('برای ثبت‌نام وارد شوید');
  });

  it('cannot submit without accepting the frozen rules version, then registers with its hash and goes to pay on our origin', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, eventFull))
      .mockResolvedValueOnce(json(201, { id: 'reg_1', trackingCode: 'RG-1', state: 'awaiting_payment', orderId: 'ord_1' }))
      .mockResolvedValueOnce(json(200, { paymentId: 'pay_1', redirectUrl: null }));
    const w = await mountEvent(fetchMock, 'usr_1');
    await w.get('button.btn-primary').trigger('click');
    const submit = w.get('form button[type=submit]');
    expect(submit.attributes('disabled')).toBeDefined();
    await w.get('form input[type=checkbox]').setValue(true);
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(url(fetchMock, 1)).toContain('/disciplines/dsc_1/registrations');
    expect(body(fetchMock, 1).acceptRulesHash).toBe('h'.repeat(64));
    expect(url(fetchMock, 2)).toContain('/orders/ord_1/pay');
    expect(body(fetchMock, 2).returnUrl).toBe(`${window.location.origin}/payments/return`);
    expect(w.text()).toContain('RG-1');
  });
});

describe('registration documents (REG-001/008)', () => {
  it('requires each document, uploads it private to the event scope, then sends its file id', async () => {
    const withDoc = { ...eventFull, disciplines: [{ ...eventFull.disciplines[0]!, feeRial: 0, requiredDocuments: [{ key: 'consent', label: 'رضایت‌نامه', retentionClass: 'dispute_evidence' }] }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, withDoc))
      .mockResolvedValueOnce(json(201, { id: 'file_1', scanState: 'clean' }))
      .mockResolvedValueOnce(json(201, { id: 'reg_1', trackingCode: 'RG-2', state: 'awaiting_review', orderId: null }));
    const w = await mountEvent(fetchMock, 'usr_1');
    await w.get('button.btn-primary').trigger('click');
    await w.get('form input[type=checkbox]').setValue(true);
    expect(w.get('form button[type=submit]').attributes('disabled')).toBeDefined();
    const input = w.get<HTMLInputElement>('input[type=file]');
    Object.defineProperty(input.element, 'files', { value: [new File(['%PDF-1.4'], 'c.pdf', { type: 'application/pdf' })] });
    await input.trigger('change');
    await flushPromises();
    const fd = (fetchMock.mock.calls[1]?.[1] as RequestInit).body as FormData;
    expect(url(fetchMock, 1)).toContain('/files');
    expect([fd.get('visibility'), fd.get('scopeType'), fd.get('scopeId'), fd.get('retentionClass')]).toEqual(['private', 'event', 'evt_1', 'dispute_evidence']);
    expect(w.get('form button[type=submit]').attributes('disabled')).toBeUndefined();
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(body(fetchMock, 2).documentFileIds).toEqual({ consent: 'file_1' });
  });
});

describe('payment return (FIN-002/003, AC-04)', () => {
  it('asks the server to verify an open payment and only then shows the receipt', async () => {
    const order = (state: string, payState: string, receiptNo: string | null) => ({ id: 'ord_1', kind: 'entry', items: [{ description: 'ورودی', amountRial: 2_000_000, quantity: 1 }], subtotalRial: 2_000_000, discountRial: 0, feeRial: 0, totalRial: 2_000_000, priceVersion: 1, refs: {}, state, receiptNo, createdAt: '2026-10-20T00:00:00Z', payments: [{ id: 'pay_1', state: payState, amountRial: 2_000_000, manual: false, refundedRial: 0, verifiedAt: null }] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, order('open', 'awaiting_gateway', null)))
      .mockResolvedValueOnce(json(200, { id: 'pay_1', state: 'verified', orderId: 'ord_1' }))
      .mockResolvedValueOnce(json(200, order('paid', 'verified', 'RC-000001')));
    vi.stubGlobal('fetch', fetchMock);
    setMe(me('usr_1') as never);
    const router = createAppRouter(createMemoryHistory());
    await router.push('/payments/return?order=ord_1');
    const w = mount(PaymentReturnView, { global: { plugins: [router] } });
    await flushPromises();
    expect(url(fetchMock, 1)).toContain('/payments/pay_1/verify');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('POST');
    expect(w.text()).toContain('RC-000001');
    expect(w.text()).toContain('سرور');
  });

  it('a failed payment is never shown as paid', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { id: 'ord_2', kind: 'entry', items: [], subtotalRial: 0, discountRial: 0, feeRial: 0, totalRial: 2_000_000, priceVersion: 1, refs: {}, state: 'open', receiptNo: null, createdAt: '2026-10-20T00:00:00Z', payments: [{ id: 'p', state: 'failed', amountRial: 2_000_000, manual: false, refundedRial: 0, verifiedAt: null }] }));
    vi.stubGlobal('fetch', fetchMock);
    setMe(me('usr_1') as never);
    const router = createAppRouter(createMemoryHistory());
    await router.push('/payments/return?order=ord_2');
    const w = mount(PaymentReturnView, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.text()).toContain('ناموفق');
    expect(w.text()).not.toContain('تأیید شد');
    expect(w.text()).toContain('پرداخت دوباره');
  });
});

describe('finance dashboard (FIN-004/006)', () => {
  it('keeps unresolved money visible and sends refunds with an idempotency key that rotates after success', async () => {
    const queue = { unknownPayments: [{ _id: 'pay_x', orderId: 'ord_x', amountRial: 1000, state: 'unknown', createdAt: '2026-10-20T00:00:00Z' }], providerVerifiedAfterFailure: [], openRefunds: [], paidWithoutCapacity: [{ registrationId: 'reg_y', orderId: 'ord_y', totalRial: 2000 }] };
    const fetchMock = vi.fn().mockImplementation((u: string) => Promise.resolve(String(u).includes('/refunds') ? json(201, { state: 'sent' }) : json(200, queue)));
    vi.stubGlobal('fetch', fetchMock);
    setMe(me('usr_1', [grant('finance_officer')]) as never);
    const router = createAppRouter(createMemoryHistory());
    await router.push('/finance');
    const w = mount(FinanceView, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.text()).toContain('pay_x');
    expect(w.text()).toContain('reg_y');
    await w.get('#rf-p').setValue('pay_1');
    await w.get('#rf-a').setValue(500);
    await w.get<HTMLInputElement>('#rf-p').element.form!.dispatchEvent(new Event('submit'));
    await flushPromises();
    const i = fetchMock.mock.calls.findIndex((c) => String(c[0]).includes('/payments/pay_1/refunds'));
    expect(i).toBeGreaterThan(-1);
    const sent = body(fetchMock, i);
    expect(sent.amountRial).toBe(500);
    expect(sent.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    expect(w.text()).not.toContain(sent.idempotencyKey);
  });
});

describe('ESP-03 routes', () => {
  it('finance and organizer pages need their permissions; a player is sent to 403 (server still enforces)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, {})));
    setMe(me('usr_1', [grant('player')]) as never);
    const router = createAppRouter(createMemoryHistory());
    await router.push('/finance');
    expect(router.currentRoute.value.name).toBe('forbidden');
    await router.push('/organizer');
    expect(router.currentRoute.value.name).toBe('forbidden');
    await router.push('/account/registrations');
    expect(router.currentRoute.value.name).toBe('my-registrations');
  });
});
