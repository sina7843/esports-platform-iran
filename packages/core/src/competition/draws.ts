import { randomBytes } from 'node:crypto';
import { DomainError, type Scope } from '@esp/contracts';
import type { Container } from '../container.js';
import type { StageDoc } from '../db/collections.js';
import type { DrawDoc, DrawEntrantSnapshot } from '../db/collections-esp04.js';
import { newId } from '../ids.js';
import { bracketDraw, drawGroups, rngFrom, seedOrderFor, ENGINE_VERSION, EngineError, type DrawEntrant, type DrawMethod } from './engine/index.js';
import { stageRuleValues } from './stageRules.js';

const iso = () => new Date().toISOString();
export const engineToDomain = (e: unknown): never => {
  if (e instanceof EngineError) {
    const code = e.code === 'NEEDS_REVIEW' || e.code === 'CONSTRAINT_UNSATISFIABLE' || e.code === 'RULE_MISSING' ? 'PRECONDITION_FAILED' : 'VALIDATION_FAILED';
    throw new DomainError(code, e.message, { engine: e.code, ...e.details });
  }
  throw e;
};

export interface DrawInput {
  method: DrawMethod;
  /** organizer-supplied attributes per participation (seed, rank, qualifier rank, pot, region, club) */
  attributes?: Record<string, { seed?: number | null; rank?: number | null; qualifierRank?: number | null; pot?: number | null; region?: string | null; club?: string | null }>;
}

/**
 * DRAW-001..003: preview → confirm → lock → publish. A redraw needs a reason, keeps the history and is refused once
 * any match of the stage has started. Every draw is reproducible: `verify` replays it from the stored input and seed.
 */
export class DrawService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private scope(eventId: string): Scope {
    return { type: 'event', id: eventId };
  }
  private async stage(stageId: string): Promise<StageDoc> {
    const s = await this.c.stages.findOne({ _id: stageId });
    if (!s) throw new DomainError('NOT_FOUND', 'stage not found');
    return s;
  }

  /** Entrants: linked stages take their stage entries (STG-002); a first stage takes confirmed participations minus event no-shows. */
  async entrants(stage: StageDoc): Promise<{ ids: string[]; explanations: string[] }> {
    const entries = await this.c.stageEntries.find({ stageId: stage._id }).toArray();
    const incoming = stage.links.some((l) => l.fromStageId) || entries.length > 0;
    if (incoming) return { ids: entries.map((e) => e.participationId), explanations: [`${entries.length} entrants from stage transfers / qualification slots`] };
    const parts = await this.c.participations.find({ disciplineId: stage.disciplineId, registrationState: 'confirmed' }).toArray();
    const regs = await this.c.registrations.find({ participationId: { $in: parts.map((p) => p._id) } }, { projection: { _id: 1, participationId: 1 } }).toArray();
    const noShow = new Set((await this.c.checkins.find({ level: 'event', ref: stage.eventId, state: 'no_show' }).toArray()).map((x) => x.registrationId));
    const excluded = regs.filter((r) => noShow.has(r._id)).map((r) => r.participationId!);
    const ids = parts.map((p) => p._id).filter((id) => !excluded.includes(id));
    return { ids, explanations: excluded.length ? [`${excluded.length} no-show participant(s) excluded by event check-in`] : [] };
  }

  async preview(stageId: string, input: DrawInput, actor: string, requestId: string): Promise<DrawDoc> {
    const stage = await this.stage(stageId);
    await this.ct.acl.require(actor, 'event.manage', this.scope(stage.eventId), requestId);
    if (stage.state !== 'planned') throw new DomainError('PRECONDITION_FAILED', `stage is ${stage.state}; use redraw with a reason`);
    const discipline = await this.c.disciplines.findOne({ _id: stage.disciplineId });
    if (!discipline) throw new DomainError('NOT_FOUND', 'discipline not found');
    const { values } = await stageRuleValues(this.ct, stage, discipline);
    if (values['draw.method'] && values['draw.method'] !== input.method) throw new DomainError('PRECONDITION_FAILED', `the rules require draw method "${String(values['draw.method'])}"`);
    const { ids, explanations } = await this.entrants(stage);
    if (ids.length < 2) throw new DomainError('PRECONDITION_FAILED', 'at least 2 entrants are needed for a draw', { entrants: ids.length });
    const parts = await this.c.participations.find({ _id: { $in: ids } }).toArray();
    const teams = await this.c.teams.find({ _id: { $in: parts.map((p) => p.snapshot.teamId).filter((x): x is string => !!x) } }, { projection: { organizationId: 1 } }).toArray();
    const snapshot: DrawEntrantSnapshot[] = parts
      .sort((a, b) => ids.indexOf(a._id) - ids.indexOf(b._id))
      .map((p) => {
        const a = input.attributes?.[p._id] ?? {};
        const club = a.club ?? teams.find((t) => t._id === p.snapshot.teamId)?.organizationId ?? null;
        const provenance: Record<string, string> = {};
        for (const k of ['seed', 'rank', 'qualifierRank', 'pot', 'region'] as const) if (a[k] !== undefined && a[k] !== null) provenance[k] = 'organizer_input';
        if (club) provenance['club'] = a.club ? 'organizer_input' : 'team_organization';
        return { participationId: p._id, displayName: p.snapshot.displayName, seed: a.seed ?? null, rank: a.rank ?? null, qualifierRank: a.qualifierRank ?? null, pot: a.pot ?? null, region: a.region ?? null, club, provenance };
      });
    const separateBy = (values['draw.separate_by'] as 'none' | 'region' | 'club' | undefined) ?? 'none';
    const groupCount = stage.format === 'groups' ? (values['groups.count'] as number | undefined) ?? null : stage.format === 'mixed' && stage.phases?.[0]?.format === 'groups' ? (values['groups.count'] as number | undefined) ?? null : null;
    if ((stage.format === 'groups' || stage.phases?.[0]?.format === 'groups') && !groupCount) throw new DomainError('PRECONDITION_FAILED', 'the rules lack groups.count');
    const seedString = randomBytes(16).toString('hex');
    const outcome = (() => {
      try {
        return run(snapshot, input.method, separateBy, groupCount, seedString);
      } catch (e) {
        return engineToDomain(e);
      }
    })();
    const last = await this.c.draws.find({ stageId }).sort({ number: -1 }).limit(1).next();
    const doc: DrawDoc = {
      _id: newId('drw'), stageId, eventId: stage.eventId, number: (last?.number ?? 0) + 1, method: input.method, separateBy, groupCount, seedString, engine: ENGINE_VERSION,
      input: snapshot, outcome: { ...outcome, explanations: [...explanations, ...outcome.explanations] }, state: 'preview', reason: null, supersedes: last && last.state !== 'superseded' ? last._id : null,
      history: [{ at: iso(), by: actor, action: 'preview', note: null }], createdBy: actor, createdAt: iso(), version: 0,
    };
    await this.ct.dbh.withTransaction(async (session) => {
      if (last && ['preview', 'confirmed', 'locked'].includes(last.state)) await this.c.draws.updateOne({ _id: last._id }, { $set: { state: 'superseded' }, $push: { history: { at: iso(), by: actor, action: 'superseded', note: `by draw #${doc.number}` } }, $inc: { version: 1 } }, { session });
      await this.c.draws.insertOne(doc, { session });
      await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.draw.preview', target: { type: 'stage', id: stageId }, scope: this.scope(stage.eventId), outcome: 'success', details: { drawId: doc._id, number: doc.number, method: input.method }, requestId }, session);
    });
    return doc;
  }

  private async step(drawId: string, from: DrawDoc['state'], to: DrawDoc['state'], action: string, actor: string, requestId: string): Promise<DrawDoc> {
    const d = await this.c.draws.findOne({ _id: drawId });
    if (!d) throw new DomainError('NOT_FOUND', 'draw not found');
    await this.ct.acl.require(actor, 'event.manage', this.scope(d.eventId), requestId);
    const r = await this.c.draws.findOneAndUpdate({ _id: drawId, state: from }, { $set: { state: to }, $push: { history: { at: iso(), by: actor, action, note: null } }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('ILLEGAL_TRANSITION', `draw is ${d.state}, not ${from}`);
    await this.ct.audit.append({ actorPrincipalId: actor, action: `competition.draw.${action}`, target: { type: 'stage', id: d.stageId }, scope: this.scope(d.eventId), outcome: 'success', details: { drawId }, requestId });
    return r;
  }
  confirm = (id: string, actor: string, rid: string) => this.step(id, 'preview', 'confirmed', 'confirm', actor, rid);
  lock = (id: string, actor: string, rid: string) => this.step(id, 'confirmed', 'locked', 'lock', actor, rid);

  /** Publishing makes the draw public and moves the stage to "drawn"; the structure is generated from it. */
  async publish(drawId: string, actor: string, requestId: string): Promise<DrawDoc> {
    const d = await this.step(drawId, 'locked', 'published', 'publish', actor, requestId);
    await this.c.stages.updateOne({ _id: d.stageId, state: 'planned' }, { $set: { state: 'drawn' }, $inc: { version: 1 } });
    await this.ct.outbox.append({ type: 'competition.draw.published', aggregate: { type: 'stage', id: d.stageId }, aggregateVersion: d.number, actor: { principalId: actor, kind: 'user' }, payload: { stageId: d.stageId, drawId: d._id, eventId: d.eventId }, correlationId: requestId });
    await this.ct.realtime.publish({ channel: `event:${d.eventId}:public`, type: 'draw.published', audience: { kind: 'public' }, payload: { stageId: d.stageId, drawNumber: d.number } });
    return d;
  }

  /**
   * DRAW-003: redraw with a reason. Before publication it simply supersedes; after publication it is allowed only while
   * no match of the stage has started, and it discards the generated structure (impact returned to the caller).
   */
  async redraw(stageId: string, reason: string, input: DrawInput, actor: string, requestId: string): Promise<{ draw: DrawDoc; discardedMatches: number }> {
    if (reason.trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'a redraw needs a reason');
    const stage = await this.stage(stageId);
    await this.ct.acl.require(actor, 'event.manage', this.scope(stage.eventId), requestId);
    const started = await this.c.matches.countDocuments({ stageId, state: { $nin: ['awaiting_sides', 'scheduled', 'cancelled'] } });
    if (started) throw new DomainError('PRECONDITION_FAILED', `${started} match(es) of this stage already started; a redraw is no longer possible`);
    const discarded = await this.ct.dbh.withTransaction(async (session) => {
      const n = (await this.c.matches.deleteMany({ stageId, state: { $in: ['awaiting_sides', 'scheduled', 'cancelled'] } }, { session })).deletedCount;
      await this.c.stageStructures.deleteOne({ _id: stageId }, { session });
      await this.c.draws.updateMany({ stageId, state: { $ne: 'superseded' } }, { $set: { state: 'superseded' }, $push: { history: { at: iso(), by: actor, action: 'redraw', note: reason } }, $inc: { version: 1 } }, { session });
      await this.c.stages.updateOne({ _id: stageId }, { $set: { state: 'planned' }, $inc: { version: 1 } }, { session });
      await this.ct.audit.append({ actorPrincipalId: actor, action: 'competition.draw.redraw', target: { type: 'stage', id: stageId }, scope: this.scope(stage.eventId), outcome: 'success', details: { reason, discardedMatches: n }, requestId }, session);
      return n;
    });
    const draw = await this.preview(stageId, input, actor, requestId);
    await this.c.draws.updateOne({ _id: draw._id }, { $set: { reason } });
    return { draw: { ...draw, reason }, discardedMatches: discarded };
  }

  /** Re-runs the engine on the stored input and seed: the published outcome must be reproduced exactly. */
  async verify(drawId: string): Promise<{ reproducible: boolean }> {
    const d = await this.c.draws.findOne({ _id: drawId });
    if (!d) throw new DomainError('NOT_FOUND', 'draw not found');
    const again = run(d.input, d.method, d.separateBy, d.groupCount, d.seedString);
    return { reproducible: JSON.stringify(again.order) === JSON.stringify(d.outcome.order) && JSON.stringify(again.groups) === JSON.stringify(d.outcome.groups) };
  }

  async list(stageId: string, viewer: string | null, requestId: string): Promise<DrawDoc[]> {
    const stage = await this.stage(stageId);
    const staff = viewer ? await this.ct.acl.can(viewer, 'event.read_private', this.scope(stage.eventId)) : false;
    void requestId;
    return this.c.draws.find(staff ? { stageId } : { stageId, state: 'published' }).sort({ number: -1 }).toArray();
  }
}

function run(snapshot: DrawEntrantSnapshot[], method: DrawMethod, separateBy: 'none' | 'region' | 'club', groupCount: number | null, seedString: string): { order: string[]; groups: Record<string, string[]> | null; explanations: string[] } {
  const entrants: DrawEntrant[] = snapshot.map((s) => ({ id: s.participationId, seed: s.seed, rank: s.rank, qualifierRank: s.qualifierRank, pot: s.pot, region: s.region, club: s.club }));
  if (groupCount) {
    const rng = rngFrom(seedString);
    const { order, explanations } = seedOrderFor(entrants, method, rng);
    const { groups } = drawGroups(entrants, order, groupCount, separateBy, rng);
    return { order, groups, explanations };
  }
  const r = bracketDraw(entrants, method, separateBy, seedString);
  return { order: r.order, groups: null, explanations: r.explanations };
}
