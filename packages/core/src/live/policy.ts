import { DomainError, type Audience } from '@esp/contracts';
import type { Collections, MatchDoc } from '../db/collections.js';
import type { MatchOutcome } from '../db/collections-esp04.js';

/**
 * CAST-005/006, IMPLEMENTATION_DECISIONS §5: one server-side publication policy for every surface (live API,
 * realtime channels, overlays, share images, search snippets, audience notifications). A "view" is either the
 * explicit latest-result view or a stream-synced view whose cutoff is `now - stream delay`. Result-bearing data
 * becomes visible in a synced view only once `occurredAt + delay <= now`. The browser never decides this.
 */
export interface View {
  kind: 'latest' | 'synced';
  streamId: string | null;
  delaySeconds: number;
}

export async function resolveView(c: Collections, eventId: string, requested: string | undefined): Promise<View> {
  if (requested === 'latest') return { kind: 'latest', streamId: null, delaySeconds: 0 };
  if (requested?.startsWith('stream:')) {
    const s = await c.broadcastStreams.findOne({ _id: requested.slice(7), eventId });
    if (!s) throw new DomainError('NOT_FOUND', 'stream not found');
    return { kind: 'synced', streamId: s._id, delaySeconds: s.delaySeconds };
  }
  // default synced view: the primary stream with the longest delay (never leaks ahead of any primary broadcast)
  const primaries = await c.broadcastStreams.find({ eventId, role: 'primary' }).sort({ delaySeconds: -1 }).limit(1).toArray();
  const p = primaries[0];
  return p ? { kind: 'synced', streamId: p._id, delaySeconds: p.delaySeconds } : { kind: 'synced', streamId: null, delaySeconds: 0 };
}

/** Longest delay of any stream of the event: audience notifications and search snippets wait for it. */
export async function maxDelaySeconds(c: Collections, eventId: string | null): Promise<number> {
  if (!eventId) return 0;
  const s = await c.broadcastStreams.find({ eventId }).sort({ delaySeconds: -1 }).limit(1).next();
  return s?.delaySeconds ?? 0;
}

export const cutoffOf = (v: View, now = new Date()) => new Date(now.getTime() - v.delaySeconds * 1000).toISOString();
export const visibleAtFor = (occurredAt: string, delaySeconds: number) => new Date(Date.parse(occurredAt) + delaySeconds * 1000).toISOString();

/** Whether a result-bearing item that happened at `occurredAt` may be shown in this view now. */
export function isVisible(v: View, occurredAt: string, spoiler: boolean, now = new Date()): boolean {
  return !spoiler || v.kind === 'latest' || Date.parse(occurredAt) <= Date.parse(cutoffOf(v, now));
}

export interface ProjectedMatch {
  id: string;
  stageId: string;
  disciplineId: string;
  slot: { key: string; bracket: string; round: number; order: number; group: string | null } | null;
  sides: Array<{ participationId: string | null; displayName: string; teamId: string | null }>;
  state: 'scheduled' | 'live' | 'provisional' | 'final' | 'cancelled' | 'waiting';
  scheduledAt: string | null;
  startedAt: string | null;
  outcome: MatchOutcome | null;
  provisional: boolean;
  finalAt: string | null;
}

/**
 * Projects matches as they were visible at `cutoff`: an outcome appears only if its official result version existed
 * by then, and a side that came from a winner/loser slot is masked until that source result is visible.
 * The latest view (cutoff = now) also shows provisional outcomes, labelled as such.
 */
export async function projectMatches(c: Collections, matches: MatchDoc[], v: View, now = new Date()): Promise<ProjectedMatch[]> {
  const cutoff = cutoffOf(v, now);
  const ids = matches.map((m) => m._id);
  const finals = await c.resultVersions.find({ targetType: 'match', targetId: { $in: ids }, 'data.final': true, createdAt: { $lte: cutoff } }).sort({ version: -1 }).toArray();
  const finalOf = new Map<string, { outcome: MatchOutcome; at: string }>();
  for (const r of finals) if (!finalOf.has(r.targetId)) finalOf.set(r.targetId, { outcome: r.data['outcome'] as MatchOutcome, at: r.createdAt });
  // source-slot visibility for masking advanced sides
  const stageIds = [...new Set(matches.map((m) => m.stageId))];
  const all = stageIds.length ? await c.matches.find({ stageId: { $in: stageIds } }, { projection: { _id: 1, stageId: 1, slot: 1 } }).toArray() : [];
  const bySlot = new Map(all.filter((m) => m.slot).map((m) => [`${m.stageId}:${m.slot!.key}`, m._id]));
  const sourceIds = [...new Set(all.map((m) => m._id))].filter((id) => !finalOf.has(id));
  if (sourceIds.length) {
    const more = await c.resultVersions.find({ targetType: 'match', targetId: { $in: sourceIds }, 'data.final': true, createdAt: { $lte: cutoff } }).sort({ version: -1 }).toArray();
    for (const r of more) if (!finalOf.has(r.targetId)) finalOf.set(r.targetId, { outcome: r.data['outcome'] as MatchOutcome, at: r.createdAt });
  }
  const parts = new Map((await c.participations.find({ _id: { $in: [...new Set(matches.flatMap((m) => m.participantIds ?? []))] } }, { projection: { snapshot: 1 } }).toArray()).map((p) => [p._id, p]));
  return matches.map((m) => {
    const vis = finalOf.get(m._id);
    const n = Math.max(m.sides?.length ?? 0, m.slot?.sources.filter((x) => x.kind !== 'bye').length ?? 0);
    const sides = Array.from({ length: n }, (_, i) => {
      const s = m.sides?.[i];
      const src = m.slot?.sources[i];
      if (!s) return { participationId: null, displayName: src && (src.kind === 'winner' || src.kind === 'loser') ? `${src.kind === 'winner' ? 'برنده' : 'بازنده'} ${src.slot}` : '—', teamId: null };
      const hidden = src && (src.kind === 'winner' || src.kind === 'loser') && !finalOf.has(bySlot.get(`${m.stageId}:${src.slot}`) ?? '');
      return hidden ? { participationId: null, displayName: `${src.kind === 'winner' ? 'برنده' : 'بازنده'} ${src.slot}`, teamId: null } : { participationId: s.participationId, displayName: s.displayName, teamId: parts.get(s.participationId)?.snapshot.teamId ?? null };
    });
    const started = m.run?.startedAt && m.run.startedAt <= cutoff ? m.run.startedAt : null;
    let state: ProjectedMatch['state'];
    let outcome: MatchOutcome | null = null;
    let provisional = false;
    if (m.state === 'cancelled') state = 'cancelled';
    else if (vis) {
      state = 'final';
      outcome = vis.outcome;
    } else if (v.kind === 'latest' && ['provisional', 'disputed'].includes(m.state)) {
      state = 'provisional';
      outcome = m.result?.submissions.find((x) => x.source !== 'integration')?.outcome ?? null;
      provisional = true;
    } else if (started) state = 'live';
    else if (m.state === 'awaiting_sides') state = 'waiting';
    else state = 'scheduled';
    return {
      id: m._id, stageId: m.stageId, disciplineId: m.disciplineId, slot: m.slot ? { key: m.slot.key, bracket: m.slot.bracket, round: m.slot.round, order: m.slot.order, group: m.slot.group ?? null } : null,
      sides, state, scheduledAt: m.scheduledAt ?? null, startedAt: started, outcome, provisional, finalAt: vis?.at ?? null,
    };
  });
}

/**
 * Realtime audience of an event's live channels: public events are public; any other visibility is limited to
 * holders of `event.read_private` in the event (re-checked on every delivery, so a revoked grant stops the stream).
 * Invite/link viewers of non-public events follow the live centre by snapshot polling instead.
 */
export async function liveAudience(c: Collections, eventId: string): Promise<Audience> {
  const e = await c.events.findOne({ _id: eventId }, { projection: { visibility: 1 } });
  return e?.visibility === 'public' ? { kind: 'public' } : { kind: 'scope', scope: { type: 'event', id: eventId }, permission: 'event.read_private' };
}
