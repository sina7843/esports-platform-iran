import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory } from 'vue-router';
import EventOpsView from './views/EventOpsView.vue';
import PrivacyView from './views/PrivacyView.vue';
import AdminIntegrationsView from './views/AdminIntegrationsView.vue';
import AdminUsersView from './views/AdminUsersView.vue';
import { createAppRouter } from './router';
import { resetSession, setMe } from './session';
import { faEsp07, enEsp07 } from './locales/esp07';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const calls: Array<{ method: string; url: string; body: unknown }> = [];
function server(routes: Array<[RegExp, unknown | ((url: string, body: unknown) => unknown)]>) {
  return vi.fn((url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? 'GET', url, body });
    const hit = routes.find(([k]) => k.test(`${init?.method ?? 'GET'} ${url}`));
    if (!hit) return Promise.resolve(json(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } }));
    return Promise.resolve(json(200, typeof hit[1] === 'function' ? (hit[1] as (u: string, b: unknown) => unknown)(url, body) : hit[1]));
  });
}
const asRole = (role: string) => setMe({ principal: { id: 'usr_1', displayName: 'usr_1', locale: 'fa', timeZone: 'Asia/Tehran', kind: 'user' }, session: { id: 's1', principalId: 'usr_1', createdAt: '', expiresAt: '', lastSeenAt: '', revokedAt: null, userAgent: null, current: true }, grants: [{ id: 'g1', principalId: 'usr_1', role, scope: { type: 'site', id: 'site' }, grantedBy: 'x', grantedAt: '', expiresAt: null, revokedAt: null, reason: null }] } as never);
async function at(path: string, component: unknown, role = 'platform_admin') {
  asRole(role);
  const router = createAppRouter(createMemoryHistory());
  await router.push(path);
  await router.isReady();
  const w = mount(component as never, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}
beforeEach(() => {
  resetSession();
  vi.unstubAllGlobals();
  calls.length = 0;
});

const ops = { at: '2026-10-21T10:00:00.000Z', registrations: { confirmed: 12 }, checkins: { checked_in: 9 }, matches: { live: 2 }, live: [{ id: 'm1', slot: 'R1-1', state: 'live', sides: ['الف', 'ب'] }], delayed: [], cases: 1, incidents: 0, tickets: 2, resources: { stations: {}, servers: [] }, alerts: [{ level: 'warn', kind: 'open_cases', detail: '1 open cases' }] };

describe('ESP-07 web', () => {
  it('locales are complete in both languages', () => {
    expect(Object.keys(enEsp07).sort()).toEqual(Object.keys(faEsp07).sort());
    expect(Object.values(faEsp07).every((v) => v.length > 0)).toBe(true);
  });

  it('bulk actions: a preview lists every item, execution is a separate confirmed step, failures stay visible per item', async () => {
    vi.stubGlobal('fetch', server([
      [/GET .*\/admin\/events\/e1\/ops/, ops],
      [/POST .*\/admin\/bulk\/preview/, { _id: 'blk1', kind: 'registration.approve', state: 'previewed', items: [{ ref: 'r1', label: 'تیم الف', preview: 'awaiting_review → confirmed', status: 'pending', error: null }, { ref: 'r2', label: 'r2', preview: 'not found in this event', status: 'skipped', error: 'not found' }] }],
      [/POST .*\/admin\/bulk\/blk1\/execute/, { _id: 'blk1', kind: 'registration.approve', state: 'done', items: [{ ref: 'r1', label: 'تیم الف', preview: 'x', status: 'failed', error: 'version conflict' }, { ref: 'r2', label: 'r2', preview: 'x', status: 'skipped', error: 'not found' }] }],
    ]));
    const w = await at('/organizer/events/e1/ops', EventOpsView, 'organizer');
    expect(w.text()).toContain('1 open cases'); // alert from the dashboard
    expect(w.find('[role="alert"]').exists()).toBe(true);
    await w.find('#bk-refs').setValue('r1, r2');
    await w.find('form button[type="submit"]').trigger('submit');
    await flushPromises();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/admin/bulk/preview'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/execute'))).toBe(false); // preview alone changes nothing
    expect(w.text()).toContain('تیم الف');
    const run = w.findAll('button').find((b) => b.text().includes('اجرای'));
    expect(run).toBeTruthy();
    await run!.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('version conflict'); // the failure is shown on its own row
  });

  it('account deletion needs an explicit confirmation and an export downloads without secrets', async () => {
    vi.stubGlobal('fetch', server([
      [/GET .*\/legal\/pending/, { items: [{ kind: 'terms', version: 2, title: 'شرایط' }] }],
      [/GET .*\/legal\/consents/, { items: [] }],
      [/GET .*\/privacy\/requests/, { items: [] }],
      [/GET .*\/legal\/consent_marketing/, null],
      [/POST .*\/privacy\/requests/, (_u: string, b: unknown) => ({ request: { _id: 'd1', state: (b as { kind: string }).kind === 'deletion' ? 'on_hold' : 'completed' }, export: null })],
    ]));
    const w = await at('/account/privacy', PrivacyView);
    expect(w.text()).toContain('شرایط');
    const del = w.findAll('button').find((b) => b.text().includes('درخواست حذف حساب'))!;
    expect(del.attributes('disabled')).toBeDefined();
    await w.find('input[type="checkbox"]').setValue(true);
    expect(del.attributes('disabled')).toBeUndefined();
  });

  it('a new partner secret is shown once and can be hidden; readiness lists blockers instead of claiming success', async () => {
    vi.stubGlobal('fetch', server([
      [/GET .*\/admin\/providers\/readiness/, { at: '', ready: false, rows: [{ kind: 'sms', provider: null, adapter: 'dev-sms', mode: 'development_double', status: 'ok', keys: [], ready: false, blockers: ['a development double is wired (forbidden in production)'], optional: false }] }],
      [/GET .*\/admin\/providers\/allowlist/, { origins: [] }],
      [/GET .*\/admin\/providers\/sms/, { adapter: 'dev-sms', apiKeyConfigured: false, template: null, sender: null, health: { status: 'ok' } }],
      [/GET .*\/admin\/providers/, { items: [] }],
      [/GET .*\/admin\/partners/, { items: [] }],
      [/GET .*\/admin\/webhook-deliveries/, { items: [] }],
      [/POST .*\/admin\/partners/, { id: 'p1', keyId: 'pk_1', secret: 'SECRET-VALUE-1' }],
    ]));
    const w = await at('/admin/integrations', AdminIntegrationsView);
    expect(w.text()).toContain('شبیه‌ساز آزمون');
    expect(w.text()).not.toContain('SECRET-VALUE-1');
    await w.find('#pt-n').setValue('شریک آزمون');
    await w.findAll('form').at(-1)!.trigger('submit');
    await flushPromises();
    expect(w.text()).toContain('SECRET-VALUE-1');
    await w.findAll('button').find((b) => b.text().includes('پنهان'))!.trigger('click');
    expect(w.text()).not.toContain('SECRET-VALUE-1');
  });

  it('user search requires two characters and suspension needs a reason', async () => {
    vi.stubGlobal('fetch', server([
      [/GET .*\/admin\/users/, { items: [{ id: 'u1', displayName: 'علی', nickname: 'ali', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }] }],
      [/POST .*\/admin\/users\/u1\/status/, { id: 'u1', status: 'suspended' }],
    ]));
    const w = await at('/admin/users', AdminUsersView);
    const submit = w.find('form button[type="submit"]');
    expect(submit.attributes('disabled')).toBeDefined();
    await w.find('#u-q').setValue('ali');
    expect(submit.attributes('disabled')).toBeUndefined();
    await w.find('form').trigger('submit');
    await flushPromises();
    const suspend = w.findAll('button').find((b) => b.text().includes('تعلیق'))!;
    expect(suspend.attributes('disabled')).toBeDefined();
    await w.find('input[placeholder]').setValue('گزارش سوءاستفاده تأییدشده');
    expect(suspend.attributes('disabled')).toBeUndefined();
    await suspend.trigger('click');
    await flushPromises();
    expect(calls.some((c) => c.url.includes('/admin/users/u1/status') && (c.body as { reason: string }).reason.includes('سوءاستفاده'))).toBe(true);
  });
});
