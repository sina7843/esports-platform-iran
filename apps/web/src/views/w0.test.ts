import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterLink } from 'vue-router';
import { QLinkKey } from '@esp/ui';
import NotFoundView from './NotFoundView.vue';
import ForbiddenView from './ForbiddenView.vue';
import OfflineView from './OfflineView.vue';
import LoginView from './LoginView.vue';
import SettingsView from './SettingsView.vue';
import { setLocale } from '../settings';
import { resetSession, setMe } from '../session';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const me = { principal: { id: 'usr_x', displayName: 'سارا', locale: 'fa', timeZone: 'Asia/Tehran', kind: 'user' }, session: { id: 's', principalId: 'usr_x', createdAt: '', expiresAt: '', lastSeenAt: '', revokedAt: null, userAgent: null, current: true }, grants: [] };

async function mountAt(component: object, path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<i />' } }] });
  await router.push(path); await router.isReady();
  return { router, w: mount(component, { global: { plugins: [router], provide: { [QLinkKey as symbol]: RouterLink } } }) };
}

beforeEach(() => { setLocale('fa'); resetSession(); });
afterEach(() => vi.unstubAllGlobals());

describe('W0 system pages', () => {
  it('not-found shows the failed path, one h1 and searches to /search', async () => {
    const { router, w } = await mountAt(NotFoundView, '/events/missing');
    expect(w.findAll('h1')).toHaveLength(1);
    expect(w.get('h1').text()).toBe('صفحه‌ای پیدا نشد');
    expect(w.get('.p-not-found-path bdi').text()).toBe('/events/missing');
    await w.get('#nf-search input, input#nf-search').setValue('سیمرغ');
    await w.get('form').trigger('submit'); await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/search?q=%D8%B3%DB%8C%D9%85%D8%B1%D8%BA');
    setLocale('en'); await flushPromises();
    expect(w.get('h1').text()).toBe('Page not found');
  });

  it('forbidden: guest gets sign-in back to the page; signed-in gets request access', async () => {
    const { w } = await mountAt(ForbiddenView, '/403?from=/admin/ops');
    expect(w.get('h1').text()).toBe('برای دیدن این صفحه وارد شوید');
    expect(w.find('a[href="/login?redirect=%2Fadmin%2Fops"]').exists()).toBe(true);
    setMe(me as never); await flushPromises();
    expect(w.get('h1').text()).toBe('به این صفحه دسترسی ندارید');
    expect(w.find('a[href="/support"]').exists()).toBe(true);
  });

  it('offline renders the status and retry', async () => {
    const { w } = await mountAt(OfflineView, '/offline');
    expect(w.get('h1').text()).toBe('آفلاین هستید');
    expect(w.find('[role="status"]').exists()).toBe(true);
  });

  it('login: invalid number blocks the request; a valid Persian-digit number requests a code and shows the code step', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { challengeId: 'c', expiresAt: '', message: 'ok', resendAfterSeconds: 60 }));
    vi.stubGlobal('fetch', fetchMock);
    const { w } = await mountAt(LoginView, '/login');
    expect(w.get('h1').text()).toBe('ورود یا ثبت‌نام');
    await w.get('form').trigger('submit'); await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(w.text()).toContain('شماره موبایل را وارد کنید.');
    await w.get('#otp-phone').setValue('۰۹۱۲۳۴۵۶۷۸۹');
    await w.get('form').trigger('submit'); await flushPromises();
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ phone: '+989123456789' });
    expect(w.get('h1').text()).toBe('کد تأیید را وارد کنید');
  });

  it('settings: guest sees the browser-only note and a sign-in prompt for notifications; theme switch applies live', async () => {
    const { w } = await mountAt(SettingsView, '/account/settings');
    expect(w.text()).toContain('این تنظیمات فقط روی همین مرورگر ذخیره می‌شوند.');
    expect(w.text()).toContain('برای تنظیم اعلان‌ها وارد شوید');
    const light = w.findAll('button').find((b) => b.text().includes('روشن'));
    await light!.trigger('click');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('settings: signed in loads and saves notification preferences', async () => {
    const prefs = { channels: { inApp: true, sms: true, email: false, push: false }, quietHours: { from: '23', to: '07' }, promotional: false, digestFrequent: true, categories: {} };
    const fetchMock = vi.fn(() => Promise.resolve(json(200, prefs)));
    vi.stubGlobal('fetch', fetchMock);
    setMe(me as never);
    const { w } = await mountAt(SettingsView, '/account/settings');
    await flushPromises();
    expect(w.text()).toContain('کانال‌ها');
    const email = w.findAll('.q-switch').find((s) => s.text().includes('ایمیل'));
    await email!.find('button, input').trigger('click'); await flushPromises();
    expect(w.text()).toContain('تغییرات ذخیره نشده');
  });
});
