import { DomainError, zonedWallTimeToUtc } from '@esp/contracts';
import type { Container } from '../container.js';
import type { EventDoc, MatchDoc } from '../db/collections.js';
import type { NewsPostDoc } from '../db/collections-esp06.js';
import { EventsService } from '../events/events.js';
import { publicPost } from '../news/news.js';
import { cutoffOf, liveAudience, projectMatches, resolveView, visibleAtFor, type ProjectedMatch, type View } from './policy.js';

const iso = () => new Date().toISOString();
export interface LiveFilters {
  disciplineId?: string | undefined;
  stageId?: string | undefined;
  day?: string | undefined; // YYYY-MM-DD in Asia/Tehran
  teamId?: string | undefined;
  matchId?: string | undefined;
}
export const channelOf = (eventId: string, v: View) => (v.kind === 'latest' ? `live:${eventId}:latest` : `live:${eventId}:d${v.delaySeconds}`);

/**
 * LIVE-001..006, AUD-003/004: the live centre. Every read takes a view (latest or stream-synced) and returns data
 * as visible in that view now; the snapshot carries the realtime cursor read BEFORE its data, so subscribing from
 * that cursor can only repeat (deduplicated by post id/version), never skip. Ended events become an archive.
 */
export class LiveService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }

  async event(eventId: string, viewer: string | null, token: string | null): Promise<EventDoc> {
    const e = await this.c.events.findOne({ _id: eventId });
    if (!e || !(await new EventsService(this.ct).canView(e, viewer, token))) throw new DomainError('NOT_FOUND', 'not found');
    return e;
  }
  async view(eventId: string, requested: string | undefined): Promise<View & { channel: string; label: string }> {
    const v = await resolveView(this.c, eventId, requested);
    const s = v.streamId ? await this.c.broadcastStreams.findOne({ _id: v.streamId }) : null;
    return { ...v, channel: channelOf(eventId, v), label: v.kind === 'latest' ? 'latest' : s ? `${s.label} (${v.delaySeconds}s)` : 'synced' };
  }

  private async matches(eventId: string, f: LiveFilters): Promise<MatchDoc[]> {
    const q: Record<string, unknown> = { eventId };
    if (f.disciplineId) q['disciplineId'] = f.disciplineId;
    if (f.stageId) q['stageId'] = f.stageId;
    if (f.matchId) q['_id'] = f.matchId;
    if (f.day && /^\d{4}-\d{2}-\d{2}$/.test(f.day)) {
      const from = zonedWallTimeToUtc(`${f.day}T00:00`);
      q['scheduledAt'] = { $gte: from, $lt: new Date(Date.parse(from) + 86_400_000).toISOString() };
    }
    if (f.teamId) {
      const parts = (await this.c.participations.find({ eventId, 'snapshot.teamId': f.teamId }, { projection: { _id: 1 } }).toArray()).map((p) => p._id);
      q['participantIds'] = { $in: parts };
    }
    return this.c.matches.find(q).sort({ scheduledAt: 1, 'slot.round': 1, 'slot.order': 1 }).limit(1000).toArray();
  }

  /** Timeline page in a view: newest first, `before` pages into the past; spoilers obey the view cutoff server-side. */
  async timeline(eventId: string, v: View, f: LiveFilters & { before?: string | undefined; limit?: number | undefined }) {
    const now = iso();
    const q: Record<string, unknown> = { eventId, state: { $in: ['published', 'corrected', 'retracted'] }, publishedAt: { $lte: now } };
    const and: Record<string, unknown>[] = [];
    if (v.kind === 'synced') and.push({ $or: [{ spoiler: false }, { occurredAt: { $lte: cutoffOf(v) } }] });
    if (f.before) {
      const [at, id] = f.before.split('|');
      and.push({ $or: [{ occurredAt: { $lt: at } }, { occurredAt: at, _id: { $lt: id } }] });
    }
    if (f.matchId) q['relations.matchId'] = f.matchId;
    if (f.teamId) q['relations.teamIds'] = f.teamId;
    if (f.stageId) q['relations.stageId'] = f.stageId;
    if (f.disciplineId) q['relations.disciplineId'] = f.disciplineId;
    if (and.length) q['$and'] = and;
    const limit = Math.min(f.limit ?? 30, 100);
    const rows = await this.c.newsPosts.find(q).sort({ occurredAt: -1, _id: -1 }).limit(limit + 1).toArray();
    const items = rows.slice(0, limit).map(publicPost);
    const last = rows[limit - 1];
    return { items, before: rows.length > limit && last ? `${last.occurredAt}|${last._id}` : null };
  }

  async snapshot(eventId: string, requested: string | undefined, f: LiveFilters, viewer: string | null, token: string | null) {
    const e = await this.event(eventId, viewer, token);
    // cursor first: anything published after this point is redelivered by the subscription (gap-free handoff)
    const cursor = await this.ct.realtime.currentCursor();
    const v = await this.view(eventId, requested);
    const ms = await this.matches(eventId, f);
    const projected = await projectMatches(this.c, ms, v);
    const pinned = await this.c.newsPosts.find({ eventId, pinned: true, state: { $in: ['published', 'corrected'] }, ...(v.kind === 'synced' ? { $or: [{ spoiler: false }, { occurredAt: { $lte: cutoffOf(v) } }] } : {}) }).sort({ publishedAt: -1 }).limit(3).toArray();
    const discs = await this.c.disciplines.find({ eventId }, { projection: { name: 1 } }).toArray();
    const stages = await this.c.stages.find({ eventId }, { projection: { name: 1, disciplineId: 1, order: 1 } }).sort({ order: 1 }).toArray();
    const parts = await this.c.participations.find({ eventId, registrationState: 'confirmed', 'snapshot.teamId': { $ne: null } }, { projection: { snapshot: 1 } }).toArray();
    const days = [...new Set(ms.filter((m) => m.scheduledAt).map((m) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date(m.scheduledAt!))))].sort();
    const archived = ['closed', 'archived'].includes(e.state);
    const archive = archived ? await this.c.eventArchives.findOne({ _id: eventId }) : null;
    const report = archived ? await this.c.newsPosts.findOne({ eventId, format: 'report', state: { $in: ['published', 'corrected'] } }, { sort: { publishedAt: -1 } }) : null;
    return {
      view: { kind: v.kind, streamId: v.streamId, delaySeconds: v.delaySeconds, channel: v.channel, label: v.label },
      cursor,
      serverTime: iso(),
      event: { id: e._id, name: e.name, state: e.state, startsAt: e.startsAt, endsAt: e.endsAt, visibility: e.visibility },
      mode: archived ? ('archive' as const) : ('live' as const),
      filters: { disciplines: discs.map((d) => ({ id: d._id, name: d.name })), stages: stages.map((s) => ({ id: s._id, name: s.name, disciplineId: s.disciplineId })), days, teams: [...new Map(parts.map((p) => [p.snapshot.teamId!, p.snapshot.displayName])).entries()].map(([id, name]) => ({ id, name })) },
      pinned: pinned.map(publicPost),
      now: projected.filter((m) => m.state === 'live' || m.state === 'provisional'),
      next: projected.filter((m) => m.state === 'scheduled' || m.state === 'waiting').slice(0, 5),
      results: projected.filter((m) => m.state === 'final').sort((a, b) => (b.finalAt ?? '').localeCompare(a.finalAt ?? '')).slice(0, 10),
      timeline: await this.timeline(eventId, v, f),
      streams: await this.publicStreams(eventId),
      archive: archive ? { closedAt: archive.closedAt, standings: archive.standings, honors: archive.honors.length, rules: archive.rules } : null,
      finalReport: report ? publicPost(report) : null,
    };
  }

  /** One tab of the live centre in a view (LIVE-002). */
  async section(eventId: string, requested: string | undefined, tab: 'schedule' | 'results' | 'bracket' | 'stats' | 'gallery' | 'video' | 'timeline', f: LiveFilters & { before?: string | undefined }, viewer: string | null, token: string | null) {
    await this.event(eventId, viewer, token);
    const v = await this.view(eventId, requested);
    const base = { view: { kind: v.kind, delaySeconds: v.delaySeconds, channel: v.channel, label: v.label }, serverTime: iso() };
    if (tab === 'timeline') return { ...base, cursor: await this.ct.realtime.currentCursor(), ...(await this.timeline(eventId, v, f)) };
    if (tab === 'gallery') {
      const posts = await this.c.newsPosts.find({ eventId, 'media.0': { $exists: true }, state: { $in: ['published', 'corrected'] }, ...(v.kind === 'synced' ? { $or: [{ spoiler: false }, { occurredAt: { $lte: cutoffOf(v) } }] } : {}) }).sort({ occurredAt: -1 }).limit(100).toArray();
      const files = await this.c.files.find({ _id: { $in: posts.flatMap((p) => p.media.map((m) => m.fileId)) } }, { projection: { publicUrl: 1 } }).toArray();
      const url = new Map(files.map((x) => [x._id, x.publicUrl]));
      return { ...base, items: posts.flatMap((p) => p.media.map((m) => ({ postId: p._id, slug: p.slug, url: url.get(m.fileId) ?? null, caption: m.caption, credit: m.credit, occurredAt: p.occurredAt }))) };
    }
    if (tab === 'video') {
      const items = await this.c.mediaItems.find({ eventId, ...(f.matchId ? { matchId: f.matchId } : {}), ...(v.kind === 'synced' ? { $or: [{ spoiler: false }, { occurredAt: { $lte: cutoffOf(v) } }] } : {}) }).sort({ occurredAt: -1 }).limit(100).toArray();
      return { ...base, streams: await this.publicStreams(eventId), items: items.map((x) => ({ id: x._id, kind: x.kind, title: x.title, url: x.url, matchId: x.matchId, offsetSeconds: x.offsetSeconds, occurredAt: x.occurredAt })) };
    }
    const projected = await projectMatches(this.c, await this.matches(eventId, f), v);
    if (tab === 'schedule') return { ...base, items: projected };
    if (tab === 'results') return { ...base, items: projected.filter((m) => m.state === 'final' || m.state === 'provisional') };
    if (tab === 'bracket') return { ...base, items: projected.filter((m) => m.slot) };
    // stats: only from what is visible in this view
    const finals = projected.filter((m) => m.state === 'final' && m.outcome);
    const wins = new Map<string, { name: string; wins: number; played: number }>();
    for (const m of finals) {
      m.sides.forEach((s, i) => {
        if (!s.participationId) return;
        const row = wins.get(s.participationId) ?? { name: s.displayName, wins: 0, played: 0 };
        row.played++;
        if (m.outcome?.kind === 'win' && m.outcome.winnerSide === i) row.wins++;
        wins.set(s.participationId, row);
      });
    }
    return {
      ...base,
      totals: { matches: projected.length, final: finals.length, live: projected.filter((m) => m.state === 'live').length, posts: await this.c.newsPosts.countDocuments({ eventId, state: { $in: ['published', 'corrected'] } }) },
      leaders: [...wins.entries()].map(([id, r]) => ({ participationId: id, ...r })).sort((a, b) => b.wins - a.wins || a.played - b.played).slice(0, 10),
    };
  }

  async publicStreams(eventId: string) {
    const streams = await this.c.broadcastStreams.find({ eventId }).sort({ role: 1, label: 1 }).toArray();
    const adapter = this.ct.adapters.video;
    const out = [];
    for (const s of streams) {
      const info = await adapter.streamInfo(s.streamKey).catch(() => ({ status: 'unknown' as const, playbackUrl: null }));
      out.push({
        id: s._id, label: s.label, language: s.language, role: s.role, status: s.status, delaySeconds: s.delaySeconds, nextProgramme: s.nextProgramme, disciplineId: s.disciplineId, stageId: s.stageId,
        // CAST-001: no selected provider → a clear state, never a fake player
        provider: { name: adapter.name, mode: adapter.mode, status: info.status, configured: adapter.mode === 'production' },
        playbackUrl: info.playbackUrl,
      });
    }
    return out;
  }

  /** Refresh hint for match changes: latest now, each delayed channel when the change becomes visible there. */
  async pushMatches(eventId: string, matchIds: string[], occurredAt: string, spoiler: boolean): Promise<void> {
    const payload = { matchIds };
    const audience = await liveAudience(this.c, eventId);
    await this.ct.realtime.publish({ channel: `live:${eventId}:latest`, type: 'matches.changed', audience, payload });
    const delays = new Set([0, ...(await this.c.broadcastStreams.find({ eventId }, { projection: { delaySeconds: 1 } }).toArray()).map((s) => s.delaySeconds)]);
    for (const d of delays) {
      const at = spoiler ? visibleAtFor(occurredAt, d) : iso();
      await this.ct.realtime.publish({ channel: `live:${eventId}:d${d}`, type: 'matches.changed', audience, payload, ...(at > iso() ? { visibleAt: at } : {}) });
    }
  }
}

export type { ProjectedMatch, NewsPostDoc };
