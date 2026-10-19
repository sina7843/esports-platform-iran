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

  /** Gap-free catch-up from the store; `after` is the last seq the client saw. */
  async poll(viewer: Viewer, after: number, channels: string[] | null, limit: number): Promise<{ events: RealtimeEvent[]; cursor: number }> {
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
    // catch-up then live
    void this.poll(viewer, opts.after, opts.channels, 500).then(({ events }) => {
      for (const e of events) {
        if (closed) return;
        last = Math.max(last, e.seq);
        opts.onEvent(e);
      }
      if (!closed) this.emitter.on('event', deliver);
    });
    return () => close('client_closed');
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
