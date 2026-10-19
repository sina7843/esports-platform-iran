import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { createAppRouter } from './router';
import { resetSession } from './session';
import { safeRedirect } from './validators';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const me = (role: string) => ({
  principal: { id: 'usr_x', displayName: 'X', locale: 'fa', timeZone: 'Asia/Tehran', kind: 'user' },
  session: { id: 's1', principalId: 'usr_x', createdAt: '', expiresAt: '', lastSeenAt: '', revokedAt: null, userAgent: null, current: true },
  grants: [{ id: 'g1', principalId: 'usr_x', role, scope: { type: 'site', id: 'site' }, grantedBy: 'a', grantedAt: '', expiresAt: null, revokedAt: null, revokedBy: null, reason: null }],
});

beforeEach(() => {
  resetSession();
  vi.unstubAllGlobals();
});

describe('router guard', () => {
  it('redirects an unauthenticated user from /account to /login with the deep link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'no session', requestId: 'r1' } }));
    vi.stubGlobal('fetch', fetchMock);
    const router = createAppRouter(createMemoryHistory());
    await router.push('/account');
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/account');
    expect(router.resolve(router.currentRoute.value.fullPath).query.redirect).toBe('/account');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/auth/me');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).credentials).toBe('include');
  });

  it('shows /403 when the session lacks the route permission, and fetches /me only once', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, me('player')));
    vi.stubGlobal('fetch', fetchMock);
    const router = createAppRouter(createMemoryHistory());
    await router.push('/admin/ops');
    expect(router.currentRoute.value.name).toBe('forbidden');
    await router.push('/account');
    expect(router.currentRoute.value.name).toBe('account');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows a route when a grant carries the permission', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, me('platform_admin'))));
    const router = createAppRouter(createMemoryHistory());
    await router.push('/admin/ops');
    expect(router.currentRoute.value.name).toBe('admin-ops');
  });

  it('sends protected routes to /offline when /me is unreachable but keeps public pages open', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    const router = createAppRouter(createMemoryHistory());
    await router.push('/account');
    expect(router.currentRoute.value.name).toBe('offline');
    await router.push('/events');
    expect(router.currentRoute.value.name).toBe('events');
  });
});

describe('safeRedirect', () => {
  it('only honors same-origin paths', () => {
    expect(safeRedirect('/account?x=1')).toBe('/account?x=1');
    expect(safeRedirect('//evil.example')).toBe('/');
    expect(safeRedirect('https://evil.example')).toBe('/');
    expect(safeRedirect(undefined)).toBe('/');
  });
});
