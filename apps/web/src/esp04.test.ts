import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory } from 'vue-router';
import BracketView from './components/BracketView.vue';
import StandingsTable from './components/StandingsTable.vue';
import MatchRoomView from './views/MatchRoomView.vue';
import MyQrView from './views/MyQrView.vue';
import { createAppRouter } from './router';
import { resetSession, setMe } from './session';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const me = (id: string, grants: unknown[] = []) => ({ principal: { id, displayName: id, locale: 'fa', timeZone: 'Asia/Tehran', kind: 'user' }, session: { id: 's1', principalId: id, createdAt: '', expiresAt: '', lastSeenAt: '', revokedAt: null, userAgent: null, current: true }, grants });
/** routes fetch by URL substring; unmatched calls fail loudly */
function server(routes: Array<[string | RegExp, unknown]>) {
  return vi.fn((url: string, _init?: RequestInit) => {
    const hit = routes.find(([k]) => (typeof k === 'string' ? url.includes(k) : k.test(url)));
    if (!hit) return Promise.resolve(json(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } }));
    return Promise.resolve(json(200, typeof hit[1] === 'function' ? (hit[1] as (u: string) => unknown)(url) : hit[1]));
  });
}
beforeEach(() => {
  resetSession();
  vi.unstubAllGlobals();
});

const slot = (key: string, round: number, a: string | null, b: string | null, extra: Record<string, unknown> = {}) => ({ key, bracket: 'W', round, order: 1, group: null, conditional: null, participants: [{ id: a, name: a }, { id: b, name: b }], status: 'ready', winner: null, match: { id: `m-${key}`, state: 'scheduled', scheduledAt: null, estimated: true, outcome: null }, ...extra });

describe('bracket view (DRAW-004, AC-24)', () => {
  it('loads rounds page by page, shows byes, moves focus with arrows and opens a match with Enter', async () => {
    const fetchMock = server([
      [/round=1/, { format: 'single_elim', phaseFormat: 'single_elim', total: 2, offset: 0, limit: 32, brackets: ['W'], rounds: [1, 2], slots: [slot('W1-1', 1, 'تیم الف', 'BYE', { status: 'auto_advance' }), slot('W1-2', 1, 'تیم ب', 'تیم ج')] }],
      [/round=2/, { format: 'single_elim', phaseFormat: 'single_elim', total: 1, offset: 0, limit: 32, brackets: ['W'], rounds: [1, 2], slots: [slot('W2-1', 2, 'تیم الف', null)] }],
      ['/bracket', { format: 'single_elim', phaseFormat: 'single_elim', total: 3, offset: 0, limit: 1, brackets: ['W'], rounds: [1, 2], slots: [] }],
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const router = createAppRouter(createMemoryHistory());
    await router.push('/stages/stg_1');
    const push = vi.spyOn(router, 'push');
    const w = mount(BracketView, { props: { stageId: 'stg_1' }, global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    expect(w.text()).toContain('استراحت (Bye)');
    expect(w.text()).toContain('نامشخص'); // the final's second side is not known yet
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes('limit=1000'))).toBe(true);
    const cards = w.findAll('[role=gridcell]');
    expect(cards[0]!.attributes('tabindex')).toBe('0');
    await cards[0]!.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    expect(document.activeElement?.id).toBe(cards[1]!.attributes('id'));
    await cards[1]!.trigger('keydown', { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/matches/m-W1-2');
    w.unmount();
  });
});

describe('standings (FMT-003)', () => {
  it('shows ranks with tie markers, the provisional label, and pages on the server', async () => {
    const page = (offset: number) => ({ format: 'swiss', algorithm: 'swiss/dutch/1', engine: 'esp-engine/1.0.0', rulesHash: 'abcdef1234567890', needsReview: null, total: 30, offset, limit: 25, provisional: true, rows: [{ id: 'p1', displayName: 'تیم الف', rank: 1, unresolvedTie: true, metrics: { points: 9, wins: 3 } }, { id: 'p2', displayName: 'تیم ب', rank: 1, unresolvedTie: true, metrics: { points: 9, wins: 3 } }] });
    const fetchMock = server([[/offset=25/, page(25)], ['/standings', page(0)]]);
    vi.stubGlobal('fetch', fetchMock);
    const w = mount(StandingsTable, { props: { stageId: 'stg_1' } });
    await flushPromises();
    expect(w.text()).toContain('موقت');
    expect(w.findAll('.tie')).toHaveLength(2);
    await w.findAll('button').find((b) => b.text() === 'بعدی')!.trigger('click');
    await flushPromises();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('offset=25'))).toBe(true);
  });
});

describe('match room (ROOM-002/003, CFG-003)', () => {
  const pub = { id: 'm1', eventId: 'e1', stageId: 's1', kind: 'head_to_head', state: 'pre_game_selection', scheduledAt: null, estimated: true, slot: { key: 'W1-1', bracket: 'W', round: 1, group: null }, sides: [{ displayName: 'تیم الف', roster: [] }, { displayName: 'تیم ب', roster: [] }], config: { bestOf: 3, mode: '5v5', gameVersion: 'test', mapPool: ['m1', 'm2'], override: null }, outcome: null, provisional: false, publicNotice: null, stationLabel: null, version: 3, stage: { name: 'S', format: 'single_elim', presence: 'online' }, timeline: [], serverTime: new Date().toISOString() };
  const selection = { sequence: ['ban:0', 'ban:1', 'decider'], pool: ['m1', 'm2', 'm3'], step: 0, state: 'active', turnDeadline: new Date(Date.now() + 25_000).toISOString(), serverTime: new Date().toISOString(), options: ['m1', 'm2', 'm3'], actions: [] };
  async function mountRoom(privatePart: unknown) {
    const fetchMock = server([['/room', { public: pub, private: privatePart }], ['/selection', selection], ['/messages', { items: [] }], ['/realtime/events', { events: [], cursor: 1, serverTime: new Date().toISOString() }], ['/selection/act', selection]]);
    vi.stubGlobal('fetch', fetchMock);
    setMe(me('usr_a') as never);
    const router = createAppRouter(createMemoryHistory());
    await router.push('/matches/m1');
    const w = mount(MatchRoomView, { global: { plugins: [router] } });
    await flushPromises();
    return { w, fetchMock };
  }
  it('a spectator sees progress and the server timer but no private controls', async () => {
    const { w } = await mountRoom(null);
    expect(w.text()).toContain('حذف مپ');
    expect(w.text()).toMatch(/ثانیه تا پایان نوبت/);
    expect(w.text()).not.toContain('بخش خصوصی');
    expect(w.findAll('button').some((b) => b.text() === 'm1')).toBe(false);
  });
  it('the side whose turn it is gets the options and sends the step it answers', async () => {
    const priv = { side: 0, official: false, config: { vetoSequence: ['ban:0'], undecided: [], pauses: {}, disconnect: {}, bestOf: 3 }, ready: [], countdownTo: null, referees: [], run: null, lobbyAvailable: false, calls: [] };
    const { w, fetchMock } = await mountRoom(priv);
    expect(w.text()).toContain('بخش خصوصی');
    await w.findAll('button').find((b) => b.text() === 'm2')!.trigger('click');
    await flushPromises();
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/selection/act'))!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ step: 0, value: 'm2' });
  });
});

describe('entry card (LAN-002)', () => {
  it('renders the QR locally as SVG from the server token', async () => {
    vi.stubGlobal('fetch', server([['/my-qr', { items: [{ credentialId: 'c1', role: 'player', areas: ['hall'], qr: 'ESPQR:abcDEF123_-xyz' }] }], ['/venues', { items: [{ _id: 'v1', name: 'سالن', addressText: 'تهران، خیابان آزمون', directions: null, parking: 'طبقه منفی یک', attendanceGuide: null }] }]]));
    setMe(me('usr_a') as never);
    const router = createAppRouter(createMemoryHistory());
    await router.push('/events/e1/my-qr');
    const w = mount(MyQrView, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.find('.qr svg').exists()).toBe(true);
    expect(w.text()).toContain('طبقه منفی یک');
    expect(w.html()).not.toContain('<script');
    w.unmount();
  });
});

describe('ESP-04 routes', () => {
  it('operations need event staff; the hall display is public', async () => {
    vi.stubGlobal('fetch', server([['/auth/me', {}]]));
    setMe(me('usr_1', [{ id: 'g', principalId: 'usr_1', role: 'player', scope: { type: 'site', id: 'site' }, grantedBy: 'x', grantedAt: '', expiresAt: null, revokedAt: null, reason: null }]) as never);
    const router = createAppRouter(createMemoryHistory());
    await router.push('/organizer/events/e1/operations');
    expect(router.currentRoute.value.name).toBe('forbidden');
    await router.push('/events/e1/hall');
    expect(router.currentRoute.value.name).toBe('hall');
    await router.push('/stages/s1');
    expect(router.currentRoute.value.name).toBe('stage');
  });
});
