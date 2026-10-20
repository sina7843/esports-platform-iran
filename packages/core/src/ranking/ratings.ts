import type { ClientSession } from 'mongodb';
import { DomainError } from '@esp/contracts';
import type { Container } from '../container.js';
import type { MatchDoc, ParticipationDoc } from '../db/collections.js';
import type { RatingDoc, RatingEventDoc, RatingJobDoc, RatingSystemDoc } from '../db/collections-esp05.js';
import { newId } from '../ids.js';
import { decay, glicko2, type GlickoResult } from './glicko2.js';

const iso = () => new Date().toISOString();
const SITE = { type: 'site' as const, id: 'site' };
type GlickoParams = { initialRating: number; initialRd: number; initialVolatility: number; tau: number; periodDays: number };
type PointsParams = { placementPoints: number[]; killPoints: number; source: string };
const isGlicko = (p: RatingSystemDoc['params']): p is GlickoParams => 'tau' in p;
const playedAt = (m: MatchDoc) => m.run?.endedAt ?? m.updatedAt;

/**
 * RANK-001..008: rating systems per game/mode/platform/season. A system is a versioned, published formula; until the
 * competition owner approves it, every leaderboard says "internal / unapproved" (RANK-006). Ratings are never edited:
 * a build replays final, rated, non-forfeit results in time order into a fresh build id, one match per transaction
 * with a cursor, so a crash resumes without double counting (unique contribution index). The leaderboard reads the
 * system's active build; a finished build replaces it atomically.
 */
export class RatingService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }

  validateParams(model: RatingSystemDoc['model'], p: RatingSystemDoc['params']): void {
    const bad = (m: string) => {
      throw new DomainError('VALIDATION_FAILED', m);
    };
    if (model === 'glicko2') {
      if (!isGlicko(p)) bad('glicko2 needs initialRating, initialRd, initialVolatility, tau, periodDays');
      const g = p as GlickoParams;
      if (!(g.initialRd > 0 && g.initialRd <= 500) || !(g.initialVolatility > 0 && g.initialVolatility < 1) || !(g.tau >= 0.2 && g.tau <= 1.2) || !(Number.isInteger(g.periodDays) && g.periodDays >= 1)) bad('glicko2 parameters out of range (rd 0..500, volatility 0..1, tau 0.2..1.2, periodDays >= 1)');
    } else {
      const q = p as PointsParams;
      if (!Array.isArray(q.placementPoints) || !q.placementPoints.length || q.placementPoints.some((x, i) => !Number.isInteger(x) || x < 0 || (i > 0 && x > q.placementPoints[i - 1]!))) bad('placement points must be non-increasing whole numbers >= 0');
      if (!Number.isInteger(q.killPoints) || q.killPoints < 0) bad('kill points must be a whole number >= 0');
      if (!q.source || q.source.trim().length < 3) bad('lobby points must cite their source (game rules package clause)');
    }
  }

  async create(input: Omit<RatingSystemDoc, '_id' | 'version' | 'state' | 'approval' | 'publishedAt' | 'activeBuild' | 'createdBy' | 'createdAt' | 'updatedAt'>, actor: string, requestId: string): Promise<RatingSystemDoc> {
    await this.ct.acl.require(actor, 'ranking.manage', SITE, requestId);
    const game = await this.c.games.findOne({ _id: input.gameId });
    if (!game) throw new DomainError('NOT_FOUND', 'game not found');
    if (!game.modes.includes(input.mode)) throw new DomainError('VALIDATION_FAILED', `mode ${input.mode} is not a mode of ${game.title}`);
    if (input.platform && !game.platforms.includes(input.platform)) throw new DomainError('VALIDATION_FAILED', `platform ${input.platform} is not a platform of ${game.title}`);
    this.validateParams(input.model, input.params);
    if (Object.values(input.eventWeights).some((w) => !(w > 0 && w <= 3))) throw new DomainError('VALIDATION_FAILED', 'event weights must be in (0, 3]');
    const doc: RatingSystemDoc = { ...input, _id: newId('rsy'), version: 1, state: 'draft', approval: null, publishedAt: null, activeBuild: null, createdBy: actor, createdAt: iso(), updatedAt: iso() };
    await this.c.ratingSystems.insertOne(doc);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'ranking.system.create', target: { type: 'rating_system', id: doc._id }, scope: SITE, outcome: 'success', requestId });
    return doc;
  }
  /** A new formula version; published systems are rebuilt from scratch so history is recomputed, never patched. */
  async revise(systemId: string, params: RatingSystemDoc['params'], eventWeights: Record<string, number> | null, actor: string, requestId: string): Promise<RatingSystemDoc> {
    await this.ct.acl.require(actor, 'ranking.manage', SITE, requestId);
    const s = await this.get(systemId);
    this.validateParams(s.model, params);
    const r = await this.c.ratingSystems.findOneAndUpdate({ _id: s._id, version: s.version }, { $set: { params, ...(eventWeights ? { eventWeights } : {}), approval: null, updatedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('VERSION_CONFLICT', 'the system changed; reload');
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'ranking.system.revise', target: { type: 'rating_system', id: s._id }, scope: SITE, outcome: 'success', details: { version: r.version }, requestId });
    if (r.state === 'published') await this.startBuild(r._id);
    return r;
  }
  async publish(systemId: string, actor: string, requestId: string): Promise<RatingSystemDoc> {
    await this.ct.acl.require(actor, 'ranking.manage', SITE, requestId);
    const r = await this.c.ratingSystems.findOneAndUpdate({ _id: systemId, state: 'draft' }, { $set: { state: 'published', publishedAt: iso(), updatedAt: iso() } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('PRECONDITION_FAILED', 'only a draft system is published');
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'ranking.system.publish', target: { type: 'rating_system', id: r._id }, scope: SITE, outcome: 'success', requestId });
    await this.startBuild(r._id);
    return r;
  }
  /** RANK-006: the official label needs a documented approval by someone other than the author. */
  async approve(systemId: string, reference: string, actor: string, requestId: string): Promise<RatingSystemDoc> {
    await this.ct.acl.require(actor, 'ranking.approve', SITE, requestId);
    const s = await this.get(systemId);
    if (s.createdBy === actor) throw new DomainError('SEPARATION_OF_DUTIES', 'the author cannot approve their own rating system');
    if (s.state !== 'published') throw new DomainError('PRECONDITION_FAILED', 'publish the system first');
    if (reference.trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'cite the owner approval (letter, contract or decision reference)');
    const r = (await this.c.ratingSystems.findOneAndUpdate({ _id: s._id }, { $set: { approval: { by: actor, at: iso(), reference }, updatedAt: iso() } }, { returnDocument: 'after' }))!;
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'ranking.system.approve', target: { type: 'rating_system', id: s._id }, scope: SITE, outcome: 'success', details: { reference }, requestId });
    return r;
  }
  async retire(systemId: string, actor: string, requestId: string): Promise<RatingSystemDoc> {
    await this.ct.acl.require(actor, 'ranking.manage', SITE, requestId);
    const r = await this.c.ratingSystems.findOneAndUpdate({ _id: systemId, state: 'published' }, { $set: { state: 'retired', updatedAt: iso() } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('PRECONDITION_FAILED', 'only a published system is retired');
    return r;
  }
  async get(systemId: string): Promise<RatingSystemDoc> {
    const s = await this.c.ratingSystems.findOne({ _id: systemId });
    if (!s) throw new DomainError('NOT_FOUND', 'rating system not found');
    return s;
  }
  async list(opts: { gameId?: string | undefined; includeDrafts?: boolean }): Promise<RatingSystemDoc[]> {
    return this.c.ratingSystems.find({ ...(opts.gameId ? { gameId: opts.gameId } : {}), state: opts.includeDrafts ? { $in: ['draft', 'published', 'retired'] } : 'published' }).sort({ gameId: 1, mode: 1 }).limit(200).toArray();
  }
  label(s: RatingSystemDoc) {
    return s.approval ? { official: true, text: 'official', reference: s.approval.reference } : { official: false, text: 'internal_unapproved', reference: null };
  }

  // ------------------------------------------------------------------ builds (RANK-005 resumable job)
  async startBuild(systemId: string): Promise<RatingJobDoc> {
    const s = await this.get(systemId);
    await this.c.ratingJobs.updateMany({ systemId, state: 'running' }, { $set: { state: 'failed', error: 'superseded by a newer build', finishedAt: iso() } });
    const job: RatingJobDoc = { _id: newId('rbd'), systemId, formulaVersion: s.version, cursor: null, processed: 0, state: 'running', startedAt: iso(), finishedAt: null, error: null };
    await this.c.ratingJobs.insertOne(job);
    return job;
  }
  async rebuildForEvent(eventId: string, reason: string): Promise<number> {
    const games = (await this.c.disciplines.find({ eventId }, { projection: { gameId: 1 } }).toArray()).map((d) => d.gameId);
    const systems = await this.c.ratingSystems.find({ gameId: { $in: games }, state: 'published' }).toArray();
    for (const s of systems) await this.startBuild(s._id);
    if (systems.length) await this.ct.outbox.append({ type: 'ranking.rebuild.requested', aggregate: { type: 'event', id: eventId }, aggregateVersion: 0, actor: { principalId: 'system', kind: 'system' }, payload: { eventId, systems: systems.map((s) => s._id), reason }, correlationId: `rebuild:${eventId}` });
    return systems.length;
  }

  /** RANK-004 eligible matches for a system: final, rated event, same game/mode/platform (and season), not forfeits. */
  private async scope(s: RatingSystemDoc): Promise<{ disciplineIds: string[]; weightOf: Map<string, number> }> {
    const discs = await this.c.disciplines.find({ gameId: s.gameId, mode: s.mode, ...(s.platform ? { platform: s.platform } : {}) }).toArray();
    const events = await this.c.events.find({ _id: { $in: [...new Set(discs.map((d) => d.eventId))] }, 'config.rated': true, state: { $nin: ['draft', 'cancelled'] }, ...(s.seasonId ? { 'config.seasonId': s.seasonId } : {}) }).toArray();
    const weightOf = new Map(events.map((e) => [e._id, s.eventWeights[e.config.affiliation?.state === 'verified' ? e.config.affiliation.kind : 'standard'] ?? s.eventWeights['standard'] ?? 1]));
    return { disciplineIds: discs.filter((d) => weightOf.has(d.eventId)).map((d) => d._id), weightOf };
  }

  /** Processes up to `max` matches of a build. Each match commits atomically with the cursor. */
  async runJob(buildId: string, opts: { max?: number; failAfter?: number } = {}): Promise<RatingJobDoc> {
    let job = await this.c.ratingJobs.findOne({ _id: buildId });
    if (!job) throw new DomainError('NOT_FOUND', 'build not found');
    if (job.state !== 'running') return job;
    const s = await this.get(job.systemId);
    const { disciplineIds, weightOf } = await this.scope(s);
    const max = opts.max ?? 500;
    let done = 0;
    while (done < max) {
      const cur = job.cursor;
      const next = await this.c.matches
        .find({ disciplineId: { $in: disciplineIds }, state: 'final', 'run.endedAt': { $ne: null }, ...(cur ? { $or: [{ 'run.endedAt': { $gt: cur.playedAt } }, { 'run.endedAt': cur.playedAt, _id: { $gt: cur.matchId } }] } : {}) })
        .sort({ 'run.endedAt': 1, _id: 1 })
        .limit(1)
        .next();
      if (!next) {
        await this.c.ratingJobs.updateOne({ _id: job._id, state: 'running' }, { $set: { state: 'complete', finishedAt: iso() } });
        const fresh = await this.c.ratingSystems.findOne({ _id: s._id });
        // only the newest finished build becomes active
        const newer = await this.c.ratingJobs.findOne({ systemId: s._id, startedAt: { $gt: job.startedAt }, state: { $in: ['running', 'complete'] } });
        if (fresh && !newer) await this.c.ratingSystems.updateOne({ _id: s._id }, { $set: { activeBuild: job._id } });
        break;
      }
      if (opts.failAfter !== undefined && done >= opts.failAfter) throw new Error('injected failure during rebuild');
      await this.ct.dbh.withTransaction(async (session) => {
        const events = await this.contributions(s, job!._id, next, weightOf.get(next.eventId) ?? 1, session);
        for (const e of events) {
          await this.c.ratingEvents.insertOne(e, { session });
        }
        await this.c.ratingJobs.updateOne({ _id: job!._id, state: 'running' }, { $set: { cursor: { playedAt: playedAt(next), matchId: next._id } }, $inc: { processed: 1 } }, { session });
      });
      job = (await this.c.ratingJobs.findOne({ _id: buildId }))!;
      if (job.state !== 'running') break; // superseded meanwhile
      done++;
    }
    return (await this.c.ratingJobs.findOne({ _id: buildId }))!;
  }
  /** Worker tick: advance every running build a little. */
  async tick(): Promise<number> {
    const running = await this.c.ratingJobs.find({ state: 'running' }).limit(20).toArray();
    for (const j of running) await this.runJob(j._id, { max: 200 }).catch(async (e) => this.c.ratingJobs.updateOne({ _id: j._id }, { $set: { error: (e as Error).message } }));
    return running.length;
  }

  private subjectsOf(s: RatingSystemDoc, p: ParticipationDoc | undefined, fallback: string): Array<{ id: string; kind: 'player' | 'team'; name: string }> {
    if (s.subject === 'team') return [{ id: p?.snapshot.teamId ?? p?._id ?? fallback, kind: 'team', name: p?.snapshot.displayName ?? fallback }];
    return (p?.snapshot.roster ?? []).map((r) => ({ id: r.principalId, kind: 'player' as const, name: r.displayName }));
  }

  private async contributions(s: RatingSystemDoc, build: string, m: MatchDoc, weight: number, session: ClientSession): Promise<RatingEventDoc[]> {
    const o = m.outcome;
    if (!o || o.kind === 'double_forfeit' || o.kind === 'attempts' || (o.kind === 'win' && o.forfeit)) return []; // nothing was played: excluded (RANK-004)
    const parts = new Map((await this.c.participations.find({ _id: { $in: m.participantIds ?? [] } }, { session }).toArray()).map((p) => [p._id, p]));
    // groups of subjects with an ordinal result (lower = better)
    let groups: Array<{ subjects: ReturnType<RatingService['subjectsOf']>; place: number; kills: number }>;
    if (o.kind === 'placements') groups = o.placements.map((pl) => ({ subjects: this.subjectsOf(s, parts.get(pl.id), pl.id), place: pl.placement, kills: pl.kills }));
    else {
      const ids = m.participantIds ?? m.sides.map((x) => x.participationId);
      groups = ids.map((pid, side) => ({ subjects: this.subjectsOf(s, parts.get(pid), pid), place: o.kind === 'draw' ? 1 : o.winnerSide === side ? 1 : 2, kills: 0 }));
    }
    const all = groups.flatMap((g) => g.subjects);
    const current = new Map((await this.c.ratings.find({ _id: { $in: all.map((x) => `${build}:${x.id}`) } }, { session }).toArray()).map((r) => [r.subjectId, r]));
    const at = playedAt(m);
    const profiles = new Map((await this.c.profiles.find({ _id: { $in: all.filter((x) => x.kind === 'player').map((x) => x.id) } }, { session }).toArray()).map((p) => [p._id, p]));
    const teams = new Map((await this.c.teams.find({ _id: { $in: all.filter((x) => x.kind === 'team').map((x) => x.id) } }, { session }).toArray()).map((t) => [t._id, t]));
    const region = (x: { id: string; kind: string }) => (x.kind === 'player' ? { province: profiles.get(x.id)?.province ?? null, city: profiles.get(x.id)?.city ?? null } : { province: null, city: teams.get(x.id)?.city ?? null });
    const out: RatingEventDoc[] = [];
    const G = isGlicko(s.params) ? s.params : null;
    const state = (id: string) => {
      const r = current.get(id);
      if (!G) return { rating: r?.rating ?? 0, rd: null as number | null, vol: null as number | null };
      if (!r) return { rating: G.initialRating, rd: G.initialRd, vol: G.initialVolatility };
      const periods = Math.floor((Date.parse(at) - Date.parse(r.lastActiveAt)) / (G.periodDays * 86_400_000));
      const d = decay({ rating: r.rating, rd: r.rd ?? G.initialRd, vol: r.vol ?? G.initialVolatility }, Math.max(0, periods - 1), G.initialRd);
      return { rating: d.rating, rd: d.rd, vol: d.vol };
    };
    const before = new Map(all.map((x) => [x.id, state(x.id)]));
    for (const g of groups) {
      for (const subj of g.subjects) {
        const b = before.get(subj.id)!;
        let after: { rating: number; rd: number | null; vol: number | null };
        if (G) {
          // each opponent group is one composite opponent (mean rating/rd of its members); lobby = pairwise by placement
          const results: GlickoResult[] = groups.filter((x) => x !== g && x.subjects.length).map((x) => {
            const ms = x.subjects.map((y) => before.get(y.id)!);
            return { rating: ms.reduce((t, y) => t + y.rating, 0) / ms.length, rd: ms.reduce((t, y) => t + (y.rd ?? G.initialRd), 0) / ms.length, score: g.place < x.place ? 1 : g.place === x.place ? 0.5 : 0 };
          });
          const n = glicko2({ rating: b.rating, rd: b.rd ?? G.initialRd, vol: b.vol ?? G.initialVolatility }, results, G.tau);
          after = { rating: b.rating + (n.rating - b.rating) * weight, rd: n.rd, vol: n.vol };
        } else {
          const P = s.params as PointsParams;
          after = { rating: b.rating + Math.round(((P.placementPoints[g.place - 1] ?? 0) + g.kills * P.killPoints) * weight), rd: null, vol: null };
        }
        out.push({ _id: newId('rev'), systemId: s._id, build, subjectId: subj.id, matchId: m._id, resultVersion: m.resultVersion, formulaVersion: s.version, eventWeight: weight, opponents: groups.filter((x) => x !== g).flatMap((x) => x.subjects.map((y) => y.id)), before: b, after, delta: after.rating - b.rating, playedAt: at, region: region(subj), voided: false });
        const prev = current.get(subj.id);
        const doc: RatingDoc = { _id: `${build}:${subj.id}`, systemId: s._id, build, subjectId: subj.id, subjectKind: subj.kind, displayName: subj.name, rating: after.rating, rd: after.rd, vol: after.vol, games: (prev?.games ?? 0) + 1, wins: (prev?.wins ?? 0) + (g.place === 1 ? 1 : 0), lastActiveAt: at, region: region(subj) };
        await this.c.ratings.replaceOne({ _id: doc._id }, doc, { upsert: true, session });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ read models (RANK-003/007/008)
  async leaderboard(systemId: string, f: { province?: string | undefined; city?: string | undefined; from?: string | undefined; to?: string | undefined; offset: number; limit: number }) {
    const s = await this.get(systemId);
    if (s.state === 'draft') throw new DomainError('NOT_FOUND', 'rating system not published');
    const label = this.label(s);
    if (!s.activeBuild) return { system: this.publicSystem(s), label, build: null, total: 0, rows: [] };
    const region = { ...(f.province ? { 'region.province': f.province } : {}), ...(f.city ? { 'region.city': f.city } : {}) };
    let rows: Array<{ subjectId: string; subjectKind: string; displayName: string; rating: number; rd: number | null; games: number; wins: number; lastActiveAt: string; region: RatingDoc['region'] }>;
    if (f.from || f.to) {
      // time window: the last rating reached inside the window, games counted inside it
      const evs = await this.c.ratingEvents.find({ systemId: s._id, build: s.activeBuild, voided: false, playedAt: { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) }, ...region }).sort({ playedAt: 1 }).toArray();
      const by = new Map<string, (typeof rows)[number]>();
      const names = new Map((await this.c.ratings.find({ build: s.activeBuild, subjectId: { $in: [...new Set(evs.map((e) => e.subjectId))] } }).toArray()).map((r) => [r.subjectId, r]));
      for (const e of evs) {
        const r = names.get(e.subjectId);
        const cur = by.get(e.subjectId) ?? { subjectId: e.subjectId, subjectKind: r?.subjectKind ?? 'player', displayName: r?.displayName ?? e.subjectId, rating: 0, rd: null, games: 0, wins: 0, lastActiveAt: e.playedAt, region: e.region };
        by.set(e.subjectId, { ...cur, rating: e.after.rating, rd: e.after.rd, games: cur.games + 1, wins: cur.wins + (e.delta > 0 ? 1 : 0), lastActiveAt: e.playedAt });
      }
      rows = [...by.values()];
    } else rows = await this.c.ratings.find({ systemId: s._id, build: s.activeBuild, ...region }).toArray();
    const cutoff = Date.now() - s.inactivityDays * 86_400_000;
    const ranked = rows
      .map((r) => ({ ...r, inactive: Date.parse(r.lastActiveAt) < cutoff }))
      .sort((a, b) => Number(a.inactive) - Number(b.inactive) || b.rating - a.rating || b.games - a.games || a.subjectId.localeCompare(b.subjectId));
    let rank = 0;
    const out = ranked.map((r, i) => {
      if (i === 0 || r.rating !== ranked[i - 1]!.rating || r.inactive !== ranked[i - 1]!.inactive) rank = i + 1;
      return { rank: r.inactive ? null : rank, subjectId: r.subjectId, subjectKind: r.subjectKind, displayName: r.displayName, rating: Math.round(r.rating), rd: r.rd === null ? null : Math.round(r.rd), games: r.games, wins: r.wins, lastActiveAt: r.lastActiveAt, inactive: r.inactive, region: r.region };
    });
    return { system: this.publicSystem(s), label, build: s.activeBuild, total: out.length, rows: out.slice(f.offset, f.offset + f.limit) };
  }
  publicSystem(s: RatingSystemDoc) {
    return { id: s._id, gameId: s.gameId, mode: s.mode, platform: s.platform, subject: s.subject, model: s.model, version: s.version, params: s.params, seasonId: s.seasonId, carry: s.carry, inactivityDays: s.inactivityDays, tiebreak: s.tiebreak, regionBasis: s.regionBasis, eventWeights: s.eventWeights, eligibility: s.eligibility, state: s.state, approval: s.approval, publishedAt: s.publishedAt, label: this.label(s) };
  }
  /** RANK-007 trend of one subject in every published system's active build. */
  async trend(subjectId: string) {
    const systems = await this.c.ratingSystems.find({ state: 'published', activeBuild: { $ne: null } }).toArray();
    const out = [];
    for (const s of systems) {
      const evs = await this.c.ratingEvents.find({ systemId: s._id, build: s.activeBuild!, subjectId, voided: false }).sort({ playedAt: 1 }).limit(500).toArray();
      if (!evs.length) continue;
      const r = await this.c.ratings.findOne({ _id: `${s.activeBuild}:${subjectId}` });
      out.push({ system: this.publicSystem(s), current: r ? { rating: Math.round(r.rating), rd: r.rd === null ? null : Math.round(r.rd), games: r.games, wins: r.wins } : null, points: evs.map((e) => ({ at: e.playedAt, rating: Math.round(e.after.rating), delta: Math.round(e.delta), matchId: e.matchId })) });
    }
    return out;
  }
  /** RANK-008 records of a system: peak rating, biggest gain, most games. */
  async records(systemId: string) {
    const s = await this.get(systemId);
    if (!s.activeBuild) return { peak: null, biggestGain: null, mostGames: null };
    const peak = await this.c.ratingEvents.find({ systemId, build: s.activeBuild, voided: false }).sort({ 'after.rating': -1 }).limit(1).next();
    const gain = await this.c.ratingEvents.find({ systemId, build: s.activeBuild, voided: false }).sort({ delta: -1 }).limit(1).next();
    const most = await this.c.ratings.find({ build: s.activeBuild }).sort({ games: -1 }).limit(1).next();
    const name = async (id: string) => (await this.c.ratings.findOne({ _id: `${s.activeBuild}:${id}` }))?.displayName ?? id;
    return {
      peak: peak ? { subjectId: peak.subjectId, name: await name(peak.subjectId), rating: Math.round(peak.after.rating), at: peak.playedAt } : null,
      biggestGain: gain ? { subjectId: gain.subjectId, name: await name(gain.subjectId), delta: Math.round(gain.delta), matchId: gain.matchId } : null,
      mostGames: most ? { subjectId: most.subjectId, name: most.displayName, games: most.games } : null,
    };
  }
}
