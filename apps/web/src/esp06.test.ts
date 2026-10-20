import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory } from 'vue-router';
import LiveCenterView from './views/LiveCenterView.vue';
import OverlayView from './views/OverlayView.vue';
import NotificationsView from './views/NotificationsView.vue';
import { createAppRouter } from './router';
import { resetSession, setMe } from './session';
import { faEsp06, enEsp06 } from './locales/esp06';
import { safeRedirect } from './validators';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const me = (id: string) => ({ principal: { id, displayName: id, locale: 'fa', timeZone: 'Asia/Tehran', kind: 'user' }, session: { id: 's1', principalId: id, createdAt: '', expiresAt: '', lastSeenAt: '', revokedAt: null, userAgent: null, current: true }, grants: [] });
const calls: string[] = [];
function server(routes: Array<[string | RegExp, unknown]>) {
  return vi.fn((url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const hit = routes.find(([k]) => (typeof k === 'string' ? url.includes(k) : k.test(url)));
    if (!hit) return Promise.resolve(json(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } }));
    return Promise.resolve(json(200, typeof hit[1] === 'function' ? (hit[1] as (u: string) => unknown)(url) : hit[1]));
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
const post = (id: string, occurredAt: string, extra: Record<string, unknown> = {}) => ({
  id, slug: id, eventId: 'e1', kind: 'text', format: 'live', title: `T ${id}`, body: 'b', quote: null, link: null, media: [], relations: { matchId: null, stageId: null, disciplineId: null, teamIds: [], principalIds: [], participationIds: [] },
  source: 'reporter', authorId: 'a', occurredAt, publishedAt: occurredAt, state: 'published', pinned: false, highlighted: false, category: 'live', tags: [], seo: { title: null, description: null, canonical: null, shareImageFileId: null },
  result: null, spoiler: false, edited: null, withdrawal: null, correction: null, version: 1, ...extra,
});
const snapshot = (latest: boolean) => ({
  view: { kind: latest ? 'latest' : 'synced', streamId: latest ? null : 's1', delaySeconds: latest ? 0 : 60, channel: latest ? 'live:e1:latest' : 'live:e1:d60', label: '' },
  cursor: 5, serverTime: '2026-10-20T10:00:00.000Z', event: { id: 'e1', name: 'جام آزمون', state: 'active', startsAt: null, endsAt: null, visibility: 'public' }, mode: 'live',
  filters: { disciplines: [], stages: [], days: [], teams: [] }, pinned: [], now: [], next: [], results: [],
  timeline: { items: [post('p1', '2026-10-20T09:00:00.000Z', { result: { matchId: 'm', final: false, version: 1 }, title: 'نتیجه موقت' })], before: null },
  streams: [{ id: 's1', label: 'اصلی', language: 'fa', role: 'primary', status: 'live', delaySeconds: 60, nextProgramme: null, provider: { name: 'dev-video', mode: 'development_double', status: 'unknown', configured: false }, playbackUrl: null }],
  archive: null, finalReport: null,
});
beforeEach(() => {
  resetSession();
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('ESP-06 web', () => {
  it('locales are complete and redirects stay on this origin', () => {
    expect(Object.keys(enEsp06).sort()).toEqual(Object.keys(faEsp06).sort());
    expect(safeRedirect('//evil.example')).toBe('/');
    expect(safeRedirect('javascript:alert(1)')).toBe('/');
    expect(safeRedirect(['/events/x?y=1'])).toBe('/events/x?y=1');
  });

  it('the synced live centre never calls the latest-result endpoint, labels provisional results and shows no fake player', async () => {
    let feed = 0;
    vi.stubGlobal('fetch', server([
      [/\/live\/events\/e1\/latest/, snapshot(true)],
      [/\/live\/events\/e1(\?|$)/, snapshot(false)],
      [/\/realtime\/events/, () => (feed++ === 0 ? { events: [{ seq: 6, id: 'x', channel: 'live:e1:d60', type: 'post.upsert', audience: { kind: 'public' }, createdAt: '', payload: { post: post('p2', '2026-10-20T09:30:00.000Z') } }], cursor: 6, serverTime: '2026-10-20T10:00:02.000Z' } : { events: [], cursor: 6, serverTime: '2026-10-20T10:00:04.000Z' })],
    ]));
    const w = await at('/events/e1/live', LiveCenterView);
    expect(calls.some((c) => c.includes('/latest'))).toBe(false);
    expect(calls.some((c) => c.includes('/realtime/events') && c.includes('live%3Ae1%3Ad60'))).toBe(true);
    expect(w.text()).toContain('نتیجه موقت');
    expect(w.text()).toContain('پیکربندی نشده');
    expect(w.find('video').exists()).toBe(false);
  });

  it('a reader scrolled away from the top keeps their place: new posts are counted behind a button', async () => {
    let feed = 0;
    vi.stubGlobal('fetch', server([
      [/\/live\/events\/e1(\?|$)/, snapshot(false)],
      [/\/realtime\/events/, () => (feed++ === 1 ? { events: [{ seq: 6, id: 'x', channel: 'live:e1:d60', type: 'post.upsert', audience: { kind: 'public' }, createdAt: '', payload: { post: post('p2', '2026-10-20T09:30:00.000Z') } }], cursor: 6, serverTime: '' } : { events: [], cursor: 6, serverTime: '' })],
    ]));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const w = await at('/events/e1/live', LiveCenterView);
    // simulate the reader being further down the timeline
    const el = w.find('[role="tabpanel"]').element as HTMLElement;
    el.getBoundingClientRect = () => ({ top: -900 }) as DOMRect;
    window.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(3000);
    await flushPromises();
    vi.useRealTimers();
    const titles = w.findAll('article h3').map((h) => h.text());
    expect(titles).toEqual(['نتیجه موقت']); // the list did not move
    const btn = w.findAll('button').find((b) => b.text().includes('خبر تازه'));
    expect(btn?.text()).toContain('۱');
    await btn!.trigger('click');
    expect(w.findAll('article h3').map((h) => h.text())).toEqual(['T p2', 'نتیجه موقت']);
  });

  it('overlay states whether it is synced or latest; notifications can be acknowledged separately from reading', async () => {
    vi.stubGlobal('fetch', server([[/\/overlay\/tok/, { label: 'synced_to_stream', delaySeconds: 30, serverTime: '', event: { name: 'x' }, scoreboard: { sides: ['الف', 'ب'], state: 'live', outcome: null, provisional: false } }]]));
    const o = await at('/overlay/tok_aaaaaaaaaaaaaaaaaaaaaaaa', OverlayView);
    expect(o.text()).toContain('هماهنگ با پخش');
    expect(o.text()).toContain('در برابر');
    setMe(me('u1') as never);
    vi.stubGlobal('fetch', server([
      [/\/me\/notifications\/n1\/ack/, { ok: true }],
      [/\/me\/notifications/, { items: [{ id: 'n1', category: 'official', title: 'جلسه', body: 'متن', link: null, essential: true, count: 1, deliverAt: '2026-10-20T10:00:00.000Z', readAt: null, ackRequired: true, ackAt: null, channels: [{ channel: 'in_app', status: 'sent', attempts: 1, deliveredAt: null, reason: null }, { channel: 'sms', status: 'failed', attempts: 1, deliveredAt: null, reason: null }] }], unread: 1 }],
      [/\/me\/notification-prefs/, { channels: { inApp: true, sms: true, email: false, push: false }, quietHours: null, promotional: false, digestFrequent: true, categories: {} }],
    ]));
    const n = await at('/account/notifications', NotificationsView);
    expect(n.text()).toContain('پیامک: ناموفق');
    const ack = n.findAll('button').find((b) => b.text() === 'تأیید مطالعه');
    await ack!.trigger('click');
    await flushPromises();
    expect(calls.some((c) => c.startsWith('POST') && c.includes('/n1/ack'))).toBe(true);
  });
});
