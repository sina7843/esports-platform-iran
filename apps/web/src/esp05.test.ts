import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory } from 'vue-router';
import CaseView from './views/CaseView.vue';
import RankingsView from './views/RankingsView.vue';
import VerifyView from './views/VerifyView.vue';
import { createAppRouter } from './router';
import { resetSession, setMe } from './session';
import { faEsp05, enEsp05 } from './locales/esp05';
import { honorLabel } from './i18n';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const me = (id: string) => ({ principal: { id, displayName: id, locale: 'fa', timeZone: 'Asia/Tehran', kind: 'user' }, session: { id: 's1', principalId: id, createdAt: '', expiresAt: '', lastSeenAt: '', revokedAt: null, userAgent: null, current: true }, grants: [] });
function server(routes: Array<[string | RegExp, unknown]>) {
  return vi.fn((url: string) => {
    const hit = routes.find(([k]) => (typeof k === 'string' ? url.includes(k) : k.test(url)));
    if (!hit) return Promise.resolve(json(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } }));
    return Promise.resolve(json(200, hit[1]));
  });
}
async function at(path: string, component: unknown) {
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
});

describe('ESP-05 web', () => {
  it('locales are complete in both languages and honor labels fall back to the award title', () => {
    expect(Object.keys(enEsp05).sort()).toEqual(Object.keys(faEsp05).sort());
    expect(honorLabel('champion')).toBe('قهرمان');
    expect(honorLabel('MVP')).toBe('MVP');
  });

  it('a party sees the public decision but no reasoning field and can appeal after the first decision', async () => {
    setMe(me('usr_p') as never);
    vi.stubGlobal('fetch', server([['/cases/c1', { _id: 'c1', eventId: 'e1', matchId: 'm1', category: 'result', claim: 'wrong score here', state: 'first_decision', role: 'party', deadlines: { defenseBy: null, appealBy: '2027-01-01T00:00:00.000Z', fileBy: null }, decisions: [{ level: 'first', at: '2026-10-20T10:00:00.000Z', rulesRef: { clauseKey: 'result.decision', citation: 'TEST' }, publicSummary: 'Side one result stands', effect: { kind: 'result_change', outcome: null } }], defense: [], requests: [] }]]));
    const w = await at('/cases/c1', CaseView);
    expect(w.text()).toContain('Side one result stands');
    expect(w.text()).not.toContain('استدلال (خصوصی)');
    expect(w.find('#cs-ap').exists()).toBe(true);
    expect(w.find('#cs-cl').exists()).toBe(false); // no decision form for a party
  });

  it('an unapproved rating system is labelled internal, never official', async () => {
    const sys = { id: 's1', gameId: 'g', mode: '5v5', platform: 'pc', subject: 'player', model: 'glicko2', version: 1, regionBasis: 'TEST', eligibility: 'TEST', label: { official: false, text: 'internal_unapproved', reference: null } };
    vi.stubGlobal('fetch', server([['/leaderboard', { system: sys, label: sys.label, build: 'b1', total: 1, rows: [{ rank: 1, subjectId: 'u1', subjectKind: 'player', displayName: 'P1', rating: 1600, rd: 80, games: 3, wins: 2, lastActiveAt: '2026-10-20T00:00:00.000Z', inactive: false, region: { province: 'تهران', city: null } }] }], ['/records', { peak: null, biggestGain: null, mostGames: null }], ['/ratings/systems', { items: [sys] }]]));
    const w = await at('/rankings', RankingsView);
    await flushPromises();
    expect(w.text()).toContain('داخلی / تأییدنشده');
    expect(w.text()).not.toContain('رسمی (تأییدشده)');
    expect(w.text()).toContain('P1');
  });

  it('verify shows a revoked honor as invalid with its reason', async () => {
    vi.stubGlobal('fetch', server([['/verify/ABCDEF123456', { kind: 'honor', valid: false, honor: { id: 'h1', kind: 'trophy', label: 'champion', place: 1, eventId: 'e', eventName: 'جام', team: null, recipients: [{ principalId: 'u', displayName: 'P1' }], state: 'revoked', verifyCode: 'ABCDEF123456', correctionOf: null, revokedReason: 'TEST fraud', issuedAt: '2026-10-20T00:00:00.000Z' } }]]));
    const w = await at('/verify/ABCDEF123456', VerifyView);
    expect(w.text()).toContain('باطل یا اصلاح');
    expect(w.text()).toContain('TEST fraud');
  });
});
