import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RealtimeEvent } from '@esp/contracts';
import { testContainer, rid } from '../test/harness.js';
import { seedIds } from '../db/seed.js';

let t: Awaited<ReturnType<typeof testContainer>>;
beforeAll(async () => {
  t = await testContainer({ seed: true });
});
afterAll(async () => {
  await t.drop();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('realtime hub', () => {
  it('delivers catch-up from a cursor, then live pushes, without duplicates', async () => {
    const a = await t.realtime.publish({ channel: 'event:x', type: 'ping', audience: { kind: 'public' }, payload: { n: 1 } });
    const got: RealtimeEvent[] = [];
    const unsubscribe = t.realtime.subscribe({ principalId: null, sessionId: null }, { after: a.seq - 1, channels: ['event:x'], onEvent: (e) => got.push(e), onClose: () => undefined });
    await wait(100);
    const b = await t.realtime.publish({ channel: 'event:x', type: 'ping', audience: { kind: 'public' }, payload: { n: 2 } });
    await t.realtime.publish({ channel: 'event:other', type: 'ping', audience: { kind: 'public' }, payload: { n: 3 } });
    await wait(100);
    unsubscribe();
    expect(got.map((e) => e.seq)).toEqual([a.seq, b.seq]);
    const polled = await t.realtime.poll({ principalId: null, sessionId: null }, a.seq, ['event:x'], 100);
    expect(polled.events.map((e) => e.seq)).toEqual([b.seq]);
    expect(polled.cursor).toBe(b.seq);
  });

  it('hides private events from anonymous viewers and from principals without the permission', async () => {
    await t.realtime.publish({ channel: 'match:a', type: 'lobby', audience: { kind: 'scope', scope: { type: 'match', id: seedIds.matchA }, permission: 'match.lobby.read' }, payload: { secret: true } });
    const anon = await t.realtime.poll({ principalId: null, sessionId: null }, 0, ['match:a'], 100);
    expect(anon.events).toEqual([]);
    const refSession = await t.sessions.create(seedIds.referee);
    const ref = await t.realtime.poll({ principalId: seedIds.referee, sessionId: refSession.session._id }, 0, ['match:a'], 100);
    expect(ref.events.length).toBe(1);
    const repSession = await t.sessions.create(seedIds.reporter);
    const rep = await t.realtime.poll({ principalId: seedIds.reporter, sessionId: repSession.session._id }, 0, ['match:a'], 100);
    expect(rep.events).toEqual([]);
  });

  it('closes a live connection when the session is revoked and stops delivery after a grant is revoked (AC-23)', async () => {
    const { session } = await t.sessions.create(seedIds.referee);
    const got: RealtimeEvent[] = [];
    let closeReason = '';
    t.realtime.subscribe({ principalId: seedIds.referee, sessionId: session._id }, { after: 0, channels: ['match:live'], onEvent: (e) => got.push(e), onClose: (r) => (closeReason = r) });
    await wait(50);
    await t.realtime.publish({ channel: 'match:live', type: 'x', audience: { kind: 'scope', scope: { type: 'match', id: seedIds.matchA }, permission: 'match.lobby.read' }, payload: {} });
    await wait(100);
    expect(got.length).toBe(1);
    // revoke the referee's grant: next push is filtered server-side
    const grant = (await t.c.grants.findOne({ principalId: seedIds.referee, role: 'referee', revokedAt: null }))!;
    await t.acl.revoke(grant._id, { principalId: seedIds.admin, requestId: rid() }, 'test');
    await t.realtime.publish({ channel: 'match:live', type: 'x', audience: { kind: 'scope', scope: { type: 'match', id: seedIds.matchA }, permission: 'match.lobby.read' }, payload: {} });
    await wait(100);
    expect(got.length).toBe(1);
    // revoke the session: the connection is closed
    await t.sessions.revoke(session._id, 'test');
    await t.realtime.publish({ channel: 'match:live', type: 'x', audience: { kind: 'public' }, payload: {} });
    await wait(100);
    expect(closeReason).toBe('session_revoked');
  });

  it('applies the server-side delayed projection: nothing before visibleAt, everything after', async () => {
    const visibleAt = new Date(Date.now() + 400).toISOString();
    const ev = await t.realtime.publish({ channel: 'event:delayed', type: 'result', audience: { kind: 'public' }, payload: { score: '2-0' }, visibleAt });
    const got: RealtimeEvent[] = [];
    t.realtime.subscribe({ principalId: null, sessionId: null }, { after: ev.seq - 1, channels: ['event:delayed'], onEvent: (e) => got.push(e), onClose: () => undefined });
    const early = await t.realtime.poll({ principalId: null, sessionId: null }, ev.seq - 1, ['event:delayed'], 10);
    expect(early.events).toEqual([]);
    expect(got).toEqual([]);
    await wait(600);
    const late = await t.realtime.poll({ principalId: null, sessionId: null }, ev.seq - 1, ['event:delayed'], 10);
    expect(late.events.map((e) => e.seq)).toEqual([ev.seq]);
    expect(got.map((e) => e.seq)).toEqual([ev.seq]);
  });

  it('publishes realtime events only after the surrounding transaction commits', async () => {
    const got: RealtimeEvent[] = [];
    t.realtime.subscribe({ principalId: null, sessionId: null }, { after: 10_000_000, channels: ['tx'], onEvent: (e) => got.push(e), onClose: () => undefined });
    await wait(50);
    await expect(
      t.dbh.withTransaction(async (session) => {
        await t.realtime.publish({ channel: 'tx', type: 'x', audience: { kind: 'public' }, payload: {} }, session);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    await wait(50);
    expect(got).toEqual([]);
    expect(await t.c.realtime.countDocuments({ channel: 'tx' })).toBe(0);
  });
});
