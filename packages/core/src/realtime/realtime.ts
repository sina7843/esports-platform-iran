import type { ClientSession } from 'mongodb';
import { EventEmitter } from 'node:events';
import { type Audience, type RealtimeEvent, type Permission, type Scope } from '@esp/contracts';
import type { Collections, RealtimeDoc } from '../db/collections.js';
import { newId } from '../ids.js';
import { afterCommit } from '../db/client.js';
import type { Acl } from '../acl/acl.js';
import type { Sessions } from '../identity/sessions.js';

/**
 * Realtime publication (LIVE-004/006 foundations, CAST-005/006 contract).
 * Events are persisted with a monotonic `seq` (atomic counter) and then announced in-process. Consumers
 * (SSE/WS handlers) subscribe with a cursor; on connect they first catch up from the store (gap-free resume),
 * then receive live pushes. Audience and session validity are re-checked server-side on every delivery.
 * Delayed projection: `visibleAt` in the future hides the event from any channel until that instant; the
 * poller and the live hub both apply the filter, so API, stream and overlays can never leak early.
 */
export interface Viewer {
  principalId: string | null;
  sessionId: string | null;
}

export class Realtime {
  private readonly emitter = new EventEmitter();
  private readonly timers = new Set<NodeJS.Timeout>();
  /** seqs this process published itself (the bridge must not announce them a second time) */
  private readonly local = new Set<number>();

  constructor(
    private readonly c: Collections,
    private readonly acl: Acl,
    private readonly sessions: Sessions,
  ) {
    this.emitter.setMaxListeners(10_000);
  }

  async publish(
    input: { channel: string; type: string; audience: Audience; payload: Record<string, unknown>; visibleAt?: string },
    session?: ClientSession,
  ): Promise<RealtimeEvent> {
    const opts = session ? { session } : {};
    const counter = await this.c.counters.findOneAndUpdate({ _id: 'realtime_seq' }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after', ...opts });
    const doc: RealtimeDoc = {
      _id: newId('rt'),
      seq: counter!.value,
      channel: input.channel,
      type: input.type,
      audience: input.audience,
      ...(input.visibleAt ? { visibleAt: input.visibleAt } : {}),
      createdAt: new Date().toISOString(),
      payload: input.payload,
    };
    await this.c.realtime.insertOne(doc, opts);
    const ev = toEvent(doc);
    this.local.add(ev.seq);
    if (this.local.size > 5000) this.local.delete(this.local.values().next().value as number);
    const announce = () => this.emitter.emit('event', ev);
    // announce only after the surrounding transaction commits; the poller covers the gap if the process dies
    if (session) afterCommit(session, announce);
    else announce();
    // delayed events are re-announced when they become visible so live connections receive them on time
    if (ev.visibleAt && Date.parse(ev.visibleAt) > Date.now()) {
      const t = setTimeout(() => {
        this.timers.delete(t);
        this.emitter.emit('event', ev);
      }, Math.min(2 ** 31 - 1, Date.parse(ev.visibleAt) - Date.now()));
      this.timers.add(t);
    }
    return ev;
  }

  /** Server-side audience check used by polling, SSE and WS alike. */
  async canView(viewer: Viewer, audience: Audience): Promise<boolean> {
    if (audience.kind === 'public') return true;
    if (!viewer.principalId || !viewer.sessionId) return false;
    if (!(await this.sessions.isStillValid(viewer.sessionId))) return false;
    if (audience.kind === 'principals') return audience.principalIds.includes(viewer.principalId);
    return this.acl.can(viewer.principalId, audience.permission as Permission, audience.scope as Scope);
  }

  /** Highest seq handed out so far. A snapshot reads this BEFORE reading its data, so nothing between them is lost. */
  async currentCursor(): Promise<number> {
    return (await this.c.counters.findOne({ _id: 'realtime_seq' }))?.value ?? 0;
  }
  /** Highest seq removed by retention; a client whose cursor is below it missed events and must resync. */
  async floor(): Promise<number> {
    return (await this.c.counters.findOne({ _id: 'realtime_floor' }))?.value ?? 0;
  }
  /**
   * LIVE-006 retention: removes events older than `maxAgeMs` and raises the floor to the highest removed seq.
   * Delayed events not yet visible are kept. Returns the number removed.
   */
  async prune(maxAgeMs: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - maxAgeMs).toISOString();
    const nowIso = now.toISOString();
    const filter = { createdAt: { $lt: cutoff }, $or: [{ visibleAt: { $exists: false } }, { visibleAt: { $lte: nowIso } }] };
    const top = await this.c.realtime.find(filter).sort({ seq: -1 }).limit(1).next();
    if (!top) return 0;
    // raise the floor first: a reader racing the delete is told to resync rather than silently skipping
    await this.c.counters.updateOne({ _id: 'realtime_floor' }, { $max: { value: top.seq } }, { upsert: true });
    const r = await this.c.realtime.deleteMany({ ...filter, seq: { $lte: top.seq } });
    return r.deletedCount;
  }

  /** Gap-free catch-up from the store; `after` is the last seq the client saw. */
  async poll(viewer: Viewer, after: number, channels: string[] | null, limit: number): Promise<{ events: RealtimeEvent[]; cursor: number; resync?: boolean }> {
    if (after > 0 && after < (await this.floor())) return { events: [], cursor: after, resync: true };
    const now = new Date().toISOString();
    const filter: Record<string, unknown> = { seq: { $gt: after }, $or: [{ visibleAt: { $exists: false } }, { visibleAt: { $lte: now } }] };
    if (channels && channels.length) filter['channel'] = { $in: channels };
    const docs = await this.c.realtime.find(filter).sort({ seq: 1 }).limit(limit).toArray();
    const events: RealtimeEvent[] = [];
    let cursor = after;
    for (const d of docs) {
      cursor = Math.max(cursor, d.seq);
      if (await this.canView(viewer, d.audience)) events.push(toEvent(d));
    }
    return { events, cursor };
  }

  /**
   * Live subscription. Delivers catch-up first, then live pushes, deduplicated by seq. Every delivery re-checks
   * the viewer's session + audience, and the subscription closes itself if the session is revoked (AC-23).
   */
  subscribe(
    viewer: Viewer,
    opts: { after: number; channels: string[] | null; onEvent: (e: RealtimeEvent) => void; onClose: (reason: string) => void },
  ): () => void {
    let last = opts.after;
    let closed = false;
    let chain: Promise<void> = Promise.resolve();
    const deliver = (e: RealtimeEvent) => {
      chain = chain.then(async () => {
        if (closed || e.seq <= last) return;
        if (opts.channels && !opts.channels.includes(e.channel)) return;
        if (e.visibleAt && Date.parse(e.visibleAt) > Date.now()) return;
        if (viewer.sessionId && !(await this.sessions.isStillValid(viewer.sessionId))) {
          close('session_revoked');
          return;
        }
        if (!(await this.canView(viewer, e.audience))) return;
        last = e.seq;
        opts.onEvent(e);
      });
    };
    const close = (reason: string) => {
      if (closed) return;
      closed = true;
      this.emitter.off('event', deliver);
      opts.onClose(reason);
    };
    // catch-up then live; an expired cursor closes with an explicit resync instruction
    void this.poll(viewer, opts.after, opts.channels, 500).then(({ events, resync }) => {
      if (resync) {
        close('resync_required');
        return;
      }
      for (const e of events) {
        if (closed) return;
        last = Math.max(last, e.seq);
        opts.onEvent(e);
      }
      if (!closed) this.emitter.on('event', deliver);
    });
    return () => close('client_closed');
  }

  /**
   * Cross-process bridge (NFR-011, AC-23): the worker publishes realtime events (consumer output, ACL changes) from
   * another process, so the API process tails the store and announces what it did not publish itself. Subscribers
   * already ignore a seq they have seen, so a double announcement is harmless. A short look-back catches rows whose
   * transaction committed after a higher seq. Delayed events get their re-announcement timer here too.
   * ponytail: polling (default 500 ms) works on any MongoDB; a change stream would cut latency on replica sets.
   */
  startBridge(intervalMs = 500): () => void {
    const seen = new Set<number>();
    let after = -1;
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void (async () => {
        if (after < 0) {
          after = await this.currentCursor();
          return;
        }
        const docs = await this.c.realtime.find({ seq: { $gt: after - 200 } }).sort({ seq: 1 }).limit(1000).toArray();
        for (const d of docs) {
          after = Math.max(after, d.seq);
          if (seen.has(d.seq) || this.local.has(d.seq)) continue;
          seen.add(d.seq);
          if (seen.size > 5000) seen.delete(seen.values().next().value as number);
          const ev = toEvent(d);
          this.emitter.emit('event', ev);
          this.scheduleReveal(ev);
        }
      })()
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    }, intervalMs);
    return () => clearInterval(timer);
  }

  private scheduleReveal(ev: RealtimeEvent): void {
    if (!ev.visibleAt || Date.parse(ev.visibleAt) <= Date.now()) return;
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.emitter.emit('event', ev);
    }, Math.min(2 ** 31 - 1, Date.parse(ev.visibleAt) - Date.now()));
    this.timers.add(t);
  }

  /** Forces re-evaluation for a principal (called by the ACL consumer after a grant change). */
  async notifyAclChanged(principalId: string): Promise<void> {
    await this.publish({ channel: 'system', type: 'acl.changed', audience: { kind: 'principals', principalIds: [principalId] }, payload: { principalId } });
  }

  close(): void {
    for (const t of this.timers) clearTimeout(t);
    this.emitter.removeAllListeners();
  }
}

function toEvent(d: RealtimeDoc): RealtimeEvent {
  return { seq: d.seq, id: d._id, channel: d.channel, type: d.type, audience: d.audience, ...(d.visibleAt ? { visibleAt: d.visibleAt } : {}), createdAt: d.createdAt, payload: d.payload };
}
