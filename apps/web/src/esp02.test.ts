import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory } from 'vue-router';
import OtpLoginForm from './components/OtpLoginForm.vue';
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
  it('normalizes a Persian-digit mobile to +98, sends the code, then verifies and emits done', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { challengeId: 'c1', expiresAt: '', message: 'اگر شماره معتبر باشد کد ارسال شد', resendAfterSeconds: 60 }))
      .mockResolvedValueOnce(json(200, { isNewAccount: true, principalId: 'usr_1', mfaVerified: false }));
    vi.stubGlobal('fetch', fetchMock);
    const w = mount(OtpLoginForm);
    await w.get('input').setValue('۰۹۱۲۳۴۵۶۷۸۹');
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ phone: '+989123456789' });
    expect(w.text()).toContain('اگر شماره معتبر باشد');
    await w.get('input').setValue('۱۲۳۴۵۶');
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ phone: '+989123456789', code: '123456' });
    expect(w.emitted('done')).toHaveLength(1);
  });

  it('rejects a non-Iranian number before calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const w = mount(OtpLoginForm);
    await w.get('input').setValue('12345');
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(w.text()).toContain('معتبر نیست');
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
