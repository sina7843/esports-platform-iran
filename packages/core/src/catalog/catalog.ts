import type { ClientSession } from 'mongodb';
import { DomainError, defaultCapabilities, type GameState, type Scope } from '@esp/contracts';
import type { z } from 'zod';
import type { GameCreateSchema, GameUpdateSchema, GameStateTransitionSchema, ReadinessUpsertSchema } from '@esp/contracts';
import type { Container } from '../container.js';
import type { GameDoc, GameReadinessDoc } from '../db/collections-esp02.js';
import { newId } from '../ids.js';
import { getGameModule } from './modules/index.js';

/** GAME-001..004, 006: game catalog with evidence-gated readiness. A title is never "supported" by name alone. */
const SITE: Scope = { type: 'site', id: 'site' };
const now = () => new Date().toISOString();

/** proposed -> under_review -> ready -> suspended -> archived (+ suspended -> ready, under_review -> proposed). */
export const gameTransitions: Record<GameState, GameState[]> = {
  proposed: ['under_review'],
  under_review: ['proposed', 'ready'],
  ready: ['suspended'],
  suspended: ['ready', 'archived'],
  archived: [],
};

const isDup = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;

export class GameService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private async au(s: ClientSession, actor: string, action: string, id: string, details: Record<string, unknown>, rid: string) {
    await this.ct.audit.append({ actorPrincipalId: actor, action, target: { type: 'game', id }, scope: SITE, outcome: 'success', details, requestId: rid }, s);
  }
  private async ev(s: ClientSession, type: string, id: string, version: number, actor: string, payload: Record<string, unknown>, rid: string) {
    await this.ct.outbox.append({ type, aggregate: { type: 'game', id }, aggregateVersion: version, actor: { principalId: actor, kind: 'user' }, payload, correlationId: rid }, s);
  }

  /** The module must exist and belong to the declared competition family (GAME-005). */
  private assertModule(moduleId: string, family: string) {
    const m = getGameModule(moduleId);
    if (!m) throw new DomainError('VALIDATION_FAILED', 'unknown game module; a title cannot be added without an existing module', { moduleId });
    if (m.descriptor.family !== family) throw new DomainError('VALIDATION_FAILED', 'module does not belong to the declared competition family', { moduleId, family });
  }

  async create(me: string, input: z.infer<typeof GameCreateSchema>, rid: string): Promise<GameDoc> {
    await this.ct.acl.require(me, 'catalog.manage', SITE, rid);
    this.assertModule(input.moduleId, input.family);
    const t = now();
    const doc: GameDoc = {
      _id: newId('game'),
      slug: input.slug,
      title: input.title,
      publisher: input.publisher,
      releasePeriod: input.releasePeriod,
      platforms: input.platforms,
      modes: input.modes,
      regions: input.regions,
      family: input.family,
      moduleId: input.moduleId,
      references: input.references,
      capabilities: input.capabilities ?? defaultCapabilities,
      state: 'proposed',
      stateHistory: [{ from: null, to: 'proposed', by: me, at: t, reason: 'created', evidence: null }],
      logoFileId: input.logoFileId,
      createdBy: me,
      createdAt: t,
      updatedAt: t,
      version: 0,
    };
    try {
      await this.ct.dbh.withTransaction(async (s) => {
        await this.c.games.insertOne(doc, { session: s });
        await this.au(s, me, 'catalog.game.create', doc._id, { slug: doc.slug }, rid);
        await this.ev(s, 'catalog.game.created', doc._id, 0, me, { slug: doc.slug }, rid);
      });
    } catch (e) {
      if (isDup(e)) throw new DomainError('CONFLICT', 'a game with this slug already exists');
      throw e;
    }
    return doc;
  }

  async update(me: string, id: string, input: z.infer<typeof GameUpdateSchema>, rid: string): Promise<GameDoc> {
    await this.ct.acl.require(me, 'catalog.manage', SITE, rid);
    const g = await this.c.games.findOne({ _id: id });
    if (!g) throw new DomainError('NOT_FOUND', 'game not found');
    if (g.state === 'archived') throw new DomainError('ILLEGAL_TRANSITION', 'archived games cannot be edited');
    if (g.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'game was modified', { currentVersion: g.version });
    const { expectedVersion, ...rest } = input;
    this.assertModule(rest.moduleId ?? g.moduleId, rest.family ?? g.family);
    const set: Record<string, unknown> = { updatedAt: now() };
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) set[k] = v;
    return this.ct.dbh.withTransaction(async (s) => {
      const r = await this.c.games.findOneAndUpdate({ _id: id, version: expectedVersion }, { $set: set, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
      if (!r) throw new DomainError('VERSION_CONFLICT', 'game was modified');
      await this.au(s, me, 'catalog.game.update', id, { fields: Object.keys(rest) }, rid);
      await this.ev(s, 'catalog.game.updated', id, r.version, me, { fields: Object.keys(rest) }, rid);
      return r;
    });
  }

  /** What is still missing for `ready` (GAME-002, GAME-004). Empty list means eligible. */
  async readinessBlockers(g: GameDoc, evidence: { referenceUrl: string; reviewedAt: string } | undefined): Promise<string[]> {
    const missing: string[] = [];
    if (!evidence?.referenceUrl || Number.isNaN(Date.parse(evidence.reviewedAt))) missing.push('evidence_reference_and_review_date');
    const pkg = await this.c.rulesPackages.findOne({ gameId: g._id, 'scope.kind': 'catalog', state: 'published', testOnly: false, reviewedAt: { $ne: null } }, { projection: { _id: 1 } });
    if (!pkg) missing.push('published_reviewed_rules_package');
    if (!(await this.c.gameReadiness.findOne({ gameId: g._id, state: 'ready' }, { projection: { _id: 1 } }))) missing.push('ready_mode');
    return missing;
  }

  async transition(me: string, id: string, input: z.infer<typeof GameStateTransitionSchema>, rid: string): Promise<GameDoc> {
    await this.ct.acl.require(me, 'catalog.manage', SITE, rid);
    const g = await this.c.games.findOne({ _id: id });
    if (!g) throw new DomainError('NOT_FOUND', 'game not found');
    if (g.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'game was modified', { currentVersion: g.version });
    if (!gameTransitions[g.state].includes(input.to)) throw new DomainError('ILLEGAL_TRANSITION', `cannot move a game from ${g.state} to ${input.to}`, { allowed: gameTransitions[g.state] });
    if (input.to === 'ready') {
      const missing = await this.readinessBlockers(g, input.evidence);
      if (missing.length) throw new DomainError('PRECONDITION_FAILED', 'game cannot become ready', { missing });
    }
    const t = now();
    return this.ct.dbh.withTransaction(async (s) => {
      const r = await this.c.games.findOneAndUpdate(
        { _id: id, version: input.expectedVersion, state: g.state },
        { $set: { state: input.to, updatedAt: t }, $push: { stateHistory: { from: g.state, to: input.to, by: me, at: t, reason: input.reason, evidence: input.evidence ?? null } }, $inc: { version: 1 } },
        { session: s, returnDocument: 'after' },
      );
      if (!r) throw new DomainError('VERSION_CONFLICT', 'game was modified');
      await this.au(s, me, 'catalog.game.transition', id, { from: g.state, to: input.to, reason: input.reason }, rid);
      await this.ev(s, 'catalog.game.state_changed', id, r.version, me, { from: g.state, to: input.to }, rid);
      return r;
    });
  }

  /** Readiness per (version, platform, mode); one mode never implies another (GAME-003). */
  async upsertReadiness(me: string, gameId: string, input: z.infer<typeof ReadinessUpsertSchema>, rid: string): Promise<GameReadinessDoc> {
    await this.ct.acl.require(me, 'catalog.manage', SITE, rid);
    const g = await this.c.games.findOne({ _id: gameId });
    if (!g) throw new DomainError('NOT_FOUND', 'game not found');
    if (!g.platforms.includes(input.platform) || !g.modes.includes(input.mode)) throw new DomainError('VALIDATION_FAILED', 'platform and mode must be listed on the game', { platforms: g.platforms, modes: g.modes });
    if (input.state === 'ready' && !input.evidence) throw new DomainError('VALIDATION_FAILED', 'readiness evidence is required for ready');
    const t = now();
    return this.ct.dbh.withTransaction(async (s) => {
      const key = { gameId, version: input.version, platform: input.platform, mode: input.mode };
      const r = await this.c.gameReadiness.findOneAndUpdate(key, { $set: { state: input.state, evidence: input.evidence, reviewedBy: me, reviewedAt: t }, $setOnInsert: { _id: newId('rdy') } }, { session: s, upsert: true, returnDocument: 'after' });
      if (!r) throw new DomainError('INTERNAL', 'readiness upsert failed');
      await this.au(s, me, 'catalog.readiness.upsert', gameId, { ...key, state: input.state }, rid);
      await this.ev(s, 'catalog.readiness.changed', gameId, g.version, me, { ...key, state: input.state }, rid);
      // a ready title must keep at least one ready mode (GAME-004): otherwise it is suspended automatically
      if (g.state === 'ready' && !(await this.c.gameReadiness.findOne({ gameId, state: 'ready' }, { session: s, projection: { _id: 1 } }))) {
        await this.c.games.updateOne({ _id: gameId }, { $set: { state: 'suspended', updatedAt: t }, $push: { stateHistory: { from: 'ready', to: 'suspended', by: me, at: t, reason: 'no ready mode left', evidence: null } }, $inc: { version: 1 } }, { session: s });
        await this.ev(s, 'catalog.game.state_changed', gameId, g.version + 1, me, { from: 'ready', to: 'suspended' }, rid);
      }
      return r;
    });
  }

  /** Readiness never generalizes: only an exact (version, platform, mode) row in state `ready` of a `ready` game counts. */
  async isReady(gameId: string, version: string, platform: string, mode: string): Promise<boolean> {
    const g = await this.c.games.findOne({ _id: gameId }, { projection: { state: 1 } });
    if (g?.state !== 'ready') return false;
    return !!(await this.c.gameReadiness.findOne({ gameId, version, platform, mode, state: 'ready' }, { projection: { _id: 1 } }));
  }

  // ---------------------------------------------------------------- public projections
  async view(g: GameDoc) {
    const readiness = await this.c.gameReadiness.find({ gameId: g._id }).sort({ version: 1, platform: 1, mode: 1 }).toArray();
    const m = getGameModule(g.moduleId);
    const caps = Object.fromEntries(Object.entries({ ...defaultCapabilities, ...g.capabilities } as Record<string, { status: string; detail: string | null }>).map(([k, v]) => [k, { status: v.status, detail: v.detail, /** the UI may only promise `supported` */ promisable: v.status === 'supported' }]));
    return {
      id: g._id,
      slug: g.slug,
      title: g.title,
      publisher: g.publisher,
      releasePeriod: g.releasePeriod,
      platforms: g.platforms,
      modes: g.modes,
      regions: g.regions,
      family: g.family,
      moduleId: g.moduleId,
      moduleTestOnly: m?.descriptor.testOnly ?? true,
      references: g.references,
      capabilities: caps,
      state: g.state,
      standardReady: g.state === 'ready',
      readiness: readiness.map((r) => ({ version: r.version, platform: r.platform, mode: r.mode, state: r.state, evidence: r.evidence, reviewedAt: r.reviewedAt })),
      testOnly: !!g.seedLabel,
      version: g.version,
    };
  }

  async list(f: { state?: GameState | undefined; family?: string | undefined; platform?: string | undefined; q?: string | undefined; limit: number }) {
    const q: Record<string, unknown> = {};
    if (f.state) q['state'] = f.state;
    if (f.family) q['family'] = f.family;
    if (f.platform) q['platforms'] = f.platform;
    if (f.q) q['$or'] = [{ title: { $regex: f.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { publisher: { $regex: f.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }];
    const rows = await this.c.games.find(q).sort({ title: 1 }).limit(f.limit).toArray();
    return Promise.all(rows.map((g) => this.view(g)));
  }

  async get(idOrSlug: string): Promise<GameDoc> {
    const g = await this.c.games.findOne({ $or: [{ _id: idOrSlug }, { slug: idOrSlug }] });
    if (!g) throw new DomainError('NOT_FOUND', 'game not found');
    return g;
  }

  async history(me: string, id: string, rid: string) {
    await this.ct.acl.require(me, 'catalog.manage', SITE, rid);
    return (await this.get(id)).stateHistory;
  }
}
