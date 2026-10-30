import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory } from 'vue-router';
import LoginView from './views/LoginView.vue';
import TeamView from './views/TeamView.vue';
import { createAppRouter } from './router';
import { resetSession, setMe } from './session';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const me = (id: string) => ({
  principal: { id, displayName: id, locale: 'fa', timeZone: 'Asia/Tehran', kind: 'user' },
  session: { id: 's1', principalId: id, createdAt: '', expiresAt: '', lastSeenAt: '', revokedAt: null, userAgent: null, current: true },
  grants: [],
});

beforeEach(() => {
  resetSession();
  vi.unstubAllGlobals();
});

describe('OTP login (USR-001, UX-004)', () => {
  const mountLogin = async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push('/login?redirect=/account');
    return { router, w: mount(LoginView, { global: { plugins: [router] } }) };
  };
  it('normalizes a Persian-digit mobile to +98, sends the code, then verifies and returns to the deep link', async () => {
    const fetchMock = vi.fn().mockImplementation((u: string) => {
      const url = String(u);
      if (url.includes('/otp/request')) return Promise.resolve(json(200, { challengeId: 'c1', expiresAt: '', message: 'ok', resendAfterSeconds: 60 }));
      if (url.includes('/otp/verify')) return Promise.resolve(json(200, { isNewAccount: true, principalId: 'usr_1', mfaVerified: false }));
      return Promise.resolve(json(200, me('usr_1')));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { router, w } = await mountLogin();
    await w.get('#otp-phone').setValue('۰۹۱۲۳۴۵۶۷۸۹');
    await w.get('form').trigger('submit');
    await flushPromises();
    const sent = fetchMock.mock.calls.find(([u]) => String(u).includes('/otp/request'))!;
    expect(JSON.parse(String((sent[1] as RequestInit).body))).toEqual({ phone: '+989123456789' });
    await w.get('.p-login-form input').setValue('۱۲۳۴۵۶');
    await flushPromises();
    const verified = fetchMock.mock.calls.find(([u]) => String(u).includes('/otp/verify'))!;
    expect(JSON.parse(String((verified[1] as RequestInit).body))).toEqual({ phone: '+989123456789', code: '123456' });
    // the lazy /account route resolves asynchronously
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/account'), { timeout: 3000 });
  });

  it('rejects a non-Iranian number before calling the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { w } = await mountLogin();
    fetchMock.mockClear();
    await w.get('#otp-phone').setValue('12345');
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/otp/'))).toBe(false);
    expect(w.find('[aria-invalid="true"]').exists()).toBe(true);
  });
});

describe('team page (TEAM-003/004)', () => {
  const page = {
    id: 'team_1', name: 'تیم الف', tag: 'TMA', gameId: 'g', organizationId: null, description: null, city: null, links: [], sponsors: [],
    nameHistory: [{ name: 'تیم الف', tag: 'TMA', from: '2026-01-01T00:00:00Z', to: null }],
    currentMembers: [{ principalId: 'usr_owner', nickname: 'owner', avatarUrl: null, role: 'owner', from: '2026-01-01T00:00:00Z', to: null }],
    pastMembers: [], record: { source: 'none_yet' }, standings: { source: 'none_yet', items: [] }, honors: { source: 'none_yet', items: [] },
  };

  async function mountAs(principal: string | null) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, page)));
    if (principal) setMe(me(principal) as never);
    else setMe(null);
    const router = createAppRouter(createMemoryHistory());
    await router.push('/teams/team_1');
    const w = mount(TeamView, { global: { plugins: [router] } });
    await flushPromises();
    return w;
  }

  it('shows the invite form to the owner only (server still enforces)', async () => {
    expect((await mountAs('usr_owner')).find('#inv-p').exists()).toBe(true);
    expect((await mountAs('usr_other')).find('#inv-p').exists()).toBe(false);
    expect((await mountAs(null)).find('#inv-p').exists()).toBe(false);
  });

  it('never invents results: shows the empty-results notice', async () => {
    expect((await mountAs(null)).text()).toContain('هنوز ثبت نشده');
  });
});

describe('routes', () => {
  it('my-teams requires login and keeps the deep link (UX-007)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED', message: 'x', requestId: 'r' } })));
    const router = createAppRouter(createMemoryHistory());
    await router.push('/teams');
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query['redirect']).toBe('/teams');
  });
});
