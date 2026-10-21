import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RealtimeEvent } from '@esp/contracts';
import { createContainer, type Container } from '../container.js';
import { testContainer } from '../test/harness.js';

/** The worker and the API are different processes: an event published by one must reach live connections of the other. */
let worker: Awaited<ReturnType<typeof testContainer>>;
let api: Container;
let stop: () => void;
beforeAll(async () => {
  worker = await testContainer();
  const url = new URL(process.env['MONGO_URL'] ?? 'mongodb://127.0.0.1:27018/esports?directConnection=true');
  url.pathname = `/${worker.dbh.db.databaseName}`;
  api = await createContainer({ serviceName: 'api-peer', env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', MONGO_URL: url.toString(), DATA_DIR: mkdtempSync(join(tmpdir(), 'esp-peer-')), LOG_LEVEL: 'silent' } });
  stop = api.realtime.startBridge(50);
  await new Promise((r) => setTimeout(r, 200)); // let the bridge take its starting cursor
});
afterAll(async () => {
  stop();
  await api.close();
  await worker.drop();
});

const waitFor = async (cond: () => boolean, ms: number) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
  return Date.now() - t0;
};

describe('realtime bridge across processes (NFR-011, AC-23)', () => {
  it('an event published by the worker process reaches a live subscriber of the API process, once', async () => {
    const got: RealtimeEvent[] = [];
    const close = api.realtime.subscribe({ principalId: null, sessionId: null }, { after: await api.realtime.currentCursor(), channels: ['live:bridge'], onEvent: (e) => got.push(e), onClose: () => undefined });
    await worker.realtime.publish({ channel: 'live:bridge', type: 'x', audience: { kind: 'public' }, payload: { n: 1 } });
    const ms = await waitFor(() => got.length >= 1, 3000);
    await new Promise((r) => setTimeout(r, 300));
    close();
    expect(got).toHaveLength(1);
    expect(ms).toBeLessThan(1000);
  });

  it('a delayed event stays hidden until its visibleAt, then is announced by the receiving process too', async () => {
    const got: Array<{ at: number; e: RealtimeEvent }> = [];
    const close = api.realtime.subscribe({ principalId: null, sessionId: null }, { after: await api.realtime.currentCursor(), channels: ['live:bridge2'], onEvent: (e) => got.push({ at: Date.now(), e }), onClose: () => undefined });
    const visibleAt = new Date(Date.now() + 800).toISOString();
    await worker.realtime.publish({ channel: 'live:bridge2', type: 'result', audience: { kind: 'public' }, payload: {}, visibleAt });
    await new Promise((r) => setTimeout(r, 400));
    expect(got).toHaveLength(0); // not early
    await waitFor(() => got.length >= 1, 3000);
    close();
    expect(got).toHaveLength(1);
    expect(got[0]!.at).toBeGreaterThanOrEqual(Date.parse(visibleAt) - 5);
  });

  it('events the API process publishes itself are announced once, not again by the bridge', async () => {
    const got: RealtimeEvent[] = [];
    const close = api.realtime.subscribe({ principalId: null, sessionId: null }, { after: await api.realtime.currentCursor(), channels: ['live:bridge3'], onEvent: (e) => got.push(e), onClose: () => undefined });
    await api.realtime.publish({ channel: 'live:bridge3', type: 'x', audience: { kind: 'public' }, payload: {} });
    await new Promise((r) => setTimeout(r, 400));
    close();
    expect(got).toHaveLength(1);
  });
});
