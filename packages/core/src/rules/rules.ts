import { createHash } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { DomainError, type Clause, type Scope } from '@esp/contracts';
import type { z } from 'zod';
import type { AmendmentSchema, RulesPackageCreateSchema, RulesPackageUpdateSchema, RulesReviewSchema, RulesTransitionSchema } from '@esp/contracts';
import type { Container } from '../container.js';
import type { RulesSnapshot } from '../db/collections.js';
import type { RulesAcceptanceDoc, RulesPackageDoc } from '../db/collections-esp02.js';
import { newId } from '../ids.js';

/** RULE-001..012, BASE-005/006/009. There is NO global default for any rule value: everything comes from clauses (RULE-009). */
const SITE: Scope = { type: 'site', id: 'site' };
const now = () => new Date().toISOString();
const DAY = 86_400_000;
export const REVIEW_INTERVAL_DAYS = 30;
export const PRE_EVENT_WINDOW_DAYS = 14;
const plus = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY).toISOString();
const isDup = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;

const NO_TR = { text: null, reviewed: false, reviewer: null, reviewedAt: null };
const NO_RIGHTS = { reviewed: false, restrictions: null, reviewedBy: null };
type Value = Clause['value'];
export interface SettingViolation {
  key: string;
  code: 'unknown_key' | 'mandatory_not_overridable' | 'human_review_not_settable' | 'no_allowed_bounds' | 'out_of_bounds' | 'type_mismatch';
  message: string;
  citation: string | null;
}

/** Hash of the frozen clause set (same shape and algorithm as the ESP-01 snapshot). */
export function hashClauses(clauses: Clause[]): string {
  return createHash('sha256').update(JSON.stringify(snapshotClauses(clauses))).digest('hex');
}
const snapshotClauses = (clauses: Clause[]): RulesSnapshot['clauses'] => clauses.map((c) => ({ key: c.key, kind: c.kind, value: c.value, citation: c.citation }));

function checkValue(value: unknown, a: NonNullable<Clause['allowed']>): string | null {
  const items = Array.isArray(value) ? value : [value];
  for (const v of items) {
    if (a.options && !a.options.includes(v as never)) return `value ${JSON.stringify(v)} is not one of the allowed options`;
    if ((a.min !== null || a.max !== null) && typeof v !== 'number') return 'a numeric value is required';
    if (typeof v === 'number') {
      if (a.min !== null && v < a.min) return `value ${v} is below the allowed minimum ${a.min}`;
      if (a.max !== null && v > a.max) return `value ${v} is above the allowed maximum ${a.max}`;
    }
  }
  return null;
}
const hasBounds = (a: Clause['allowed']): a is NonNullable<Clause['allowed']> => !!a && (a.min !== null || a.max !== null || (a.options !== null && a.options.length > 0));

/** Structural problems of a clause set; any of these blocks publishing (RULE-005/010). */
export function clauseIssues(clauses: Clause[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of clauses) {
    if (seen.has(c.key)) out.push(`${c.key}: duplicate key`);
    seen.add(c.key);
    if (c.kind === 'configurable') {
      if (!hasBounds(c.allowed)) out.push(`${c.key}: configurable clause needs allowed bounds`);
      else if (c.value !== null) {
        const r = checkValue(c.value, c.allowed);
        if (r) out.push(`${c.key}: ${r}`);
      }
    }
  }
  return out;
}

export function checkSettings(clauses: Clause[], settings: Record<string, Value>): SettingViolation[] {
  const by = new Map(clauses.map((c) => [c.key, c]));
  const v: SettingViolation[] = [];
  for (const [key, value] of Object.entries(settings)) {
    const c = by.get(key);
    if (!c) v.push({ key, code: 'unknown_key', message: 'no such clause in the rules package', citation: null });
    else if (c.kind === 'mandatory') {
      if (JSON.stringify(value) !== JSON.stringify(c.value)) v.push({ key, code: 'mandatory_not_overridable', message: 'mandatory clause cannot be overridden', citation: c.citation });
    } else if (c.kind === 'human_review') v.push({ key, code: 'human_review_not_settable', message: 'clause requires human review and cannot be set automatically', citation: c.citation });
    else if (!hasBounds(c.allowed)) v.push({ key, code: 'no_allowed_bounds', message: 'configurable clause has no allowed bounds', citation: c.citation });
    else {
      const r = checkValue(value, c.allowed);
      if (r) v.push({ key, code: r.startsWith('a numeric') ? 'type_mismatch' : 'out_of_bounds', message: r, citation: c.citation });
    }
  }
  return v;
}

export class RulesService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private async au(s: ClientSession, actor: string, action: string, id: string, details: Record<string, unknown>, rid: string) {
    await this.ct.audit.append({ actorPrincipalId: actor, action, target: { type: 'rules_package', id }, scope: SITE, outcome: 'success', details, requestId: rid }, s);
  }
  private async ev(s: ClientSession, type: string, id: string, version: number, actor: string, payload: Record<string, unknown>, rid: string) {
    await this.ct.outbox.append({ type, aggregate: { type: 'rules_package', id }, aggregateVersion: version, actor: { principalId: actor, kind: 'user' }, payload, correlationId: rid }, s);
  }

  // ---------------------------------------------------------------- authorization
  private scopePerm(scope: RulesPackageDoc['scope']): ['rules.manage', Scope] | ['organization.manage', Scope] | ['event.manage', Scope] {
    if (scope.kind === 'catalog') return ['rules.manage', SITE];
    if (scope.kind === 'organizer') return ['organization.manage', { type: 'organization', id: scope.ref }];
    return ['event.manage', { type: 'event', id: scope.ref }];
  }
  /** Organizer/event packages need organizer permission in THAT scope; catalog packages need rules.manage. */
  private async requireWrite(me: string, scope: RulesPackageDoc['scope'], rid: string) {
    const [perm, sc] = this.scopePerm(scope);
    await this.ct.acl.require(me, perm, sc, rid);
  }
  private async canManage(me: string, p: RulesPackageDoc): Promise<boolean> {
    if (await this.ct.acl.can(me, 'rules.review', SITE)) return true;
    const [perm, sc] = this.scopePerm(p.scope);
    return this.ct.acl.can(me, perm, sc);
  }
  private async load(id: string): Promise<RulesPackageDoc> {
    const p = await this.c.rulesPackages.findOne({ _id: id });
    if (!p) throw new DomainError('NOT_FOUND', 'rules package not found');
    return p;
  }

  /** Reviewer flags can only be set by a rules reviewer; the reviewer is always the caller. */
  private async normalizeReviews(me: string, rid: string, translation: RulesPackageDoc['translationFa'], rights: RulesPackageDoc['publisherRights']) {
    const t = now();
    if (translation.reviewed || rights.reviewed) await this.ct.acl.require(me, 'rules.review', SITE, rid);
    return {
      translationFa: { ...translation, reviewer: translation.reviewed ? me : null, reviewedAt: translation.reviewed ? t : null },
      publisherRights: { ...rights, reviewedBy: rights.reviewed ? me : null },
    };
  }

  // ---------------------------------------------------------------- create / edit
  async create(me: string, input: z.infer<typeof RulesPackageCreateSchema>, rid: string): Promise<RulesPackageDoc> {
    await this.requireWrite(me, input.scope, rid);
    if (!input.sourceUrl && !input.sourceText) throw new DomainError('VALIDATION_FAILED', 'a rules package needs a source URL or source text (RULE-001)');
    if (!(await this.c.games.findOne({ _id: input.gameId }, { projection: { _id: 1 } }))) throw new DomainError('NOT_FOUND', 'game not found');
    if (input.adaptedFrom && !(await this.c.rulesPackages.findOne({ _id: input.adaptedFrom.packageId }, { projection: { _id: 1 } }))) throw new DomainError('VALIDATION_FAILED', 'adaptedFrom package not found');
    const rev = await this.normalizeReviews(me, rid, input.translationFa, input.publisherRights);
    const t = now();
    const doc: RulesPackageDoc = {
      _id: newId('rules'),
      gameId: input.gameId,
      scope: input.scope,
      title: input.title,
      versionLabel: input.version,
      state: 'draft',
      sourceUrl: input.sourceUrl,
      sourceText: input.sourceText,
      sourcePublishedAt: input.sourcePublishedAt,
      sourceRetrievedAt: t,
      reviewedAt: null,
      nextReviewDueAt: null,
      applicability: input.applicability,
      originalLanguage: input.originalLanguage,
      translationFa: rev.translationFa,
      clauses: input.clauses,
      clausesHash: hashClauses(input.clauses),
      conflicts: [],
      humanReviewAcks: [],
      publisherRights: rev.publisherRights,
      adaptedFrom: input.adaptedFrom,
      supersedes: null,
      supersededBy: null,
      amendment: null,
      testOnly: input.testOnly,
      history: [{ state: 'draft', by: me, at: t, note: 'created' }],
      createdBy: me,
      createdAt: t,
      updatedAt: t,
      version: 0,
    };
    await this.insert(doc, me, 'rules.package.create', 'rules.package.created', rid);
    return doc;
  }

  private async insert(doc: RulesPackageDoc, me: string, action: string, evType: string, rid: string, extra: Record<string, unknown> = {}) {
    try {
      await this.ct.dbh.withTransaction(async (s) => {
        await this.c.rulesPackages.insertOne(doc, { session: s });
        await this.au(s, me, action, doc._id, { gameId: doc.gameId, versionLabel: doc.versionLabel, ...extra }, rid);
        await this.ev(s, evType, doc._id, 0, me, { gameId: doc.gameId, versionLabel: doc.versionLabel, ...extra }, rid);
      });
    } catch (e) {
      if (isDup(e)) throw new DomainError('CONFLICT', 'this version label already exists for the game and scope');
      throw e;
    }
  }

  async update(me: string, id: string, input: z.infer<typeof RulesPackageUpdateSchema>, rid: string): Promise<RulesPackageDoc> {
    const p = await this.load(id);
    await this.requireWrite(me, p.scope, rid);
    if (p.state !== 'draft') throw new DomainError('ILLEGAL_TRANSITION', `a ${p.state} rules package is immutable; create an amendment instead`);
    if (p.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'package was modified', { currentVersion: p.version });
    const { expectedVersion, version, translationFa, publisherRights, ...rest } = input;
    const set: Record<string, unknown> = { updatedAt: now() };
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) set[k] = v;
    if (version !== undefined) set['versionLabel'] = version;
    if (input.clauses) {
      set['clausesHash'] = hashClauses(input.clauses);
      set['humanReviewAcks'] = []; // changed clauses must be re-acknowledged
    }
    if (translationFa || publisherRights) {
      const rev = await this.normalizeReviews(me, rid, translationFa ?? NO_TR, publisherRights ?? NO_RIGHTS);
      if (translationFa) set['translationFa'] = rev.translationFa;
      if (publisherRights) set['publisherRights'] = rev.publisherRights;
    }
    try {
      return await this.ct.dbh.withTransaction(async (s) => {
        const r = await this.c.rulesPackages.findOneAndUpdate({ _id: id, version: expectedVersion, state: 'draft' }, { $set: set, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
        if (!r) throw new DomainError('VERSION_CONFLICT', 'package was modified');
        await this.au(s, me, 'rules.package.update', id, { fields: Object.keys(rest) }, rid);
        await this.ev(s, 'rules.package.updated', id, r.version, me, { fields: Object.keys(rest) }, rid);
        return r;
      });
    } catch (e) {
      if (isDup(e)) throw new DomainError('CONFLICT', 'this version label already exists for the game and scope');
      throw e;
    }
  }

  // ---------------------------------------------------------------- conflicts and review
  async recordConflict(me: string, id: string, input: { description: string; resolution: string | null; expectedVersion: number }, rid: string) {
    await this.ct.acl.require(me, 'rules.review', SITE, rid);
    const p = await this.load(id);
    this.assertOpen(p);
    const t = now();
    const entry = { id: newId('cfl'), description: input.description, resolution: input.resolution, recordedBy: me, recordedAt: t, resolvedBy: input.resolution ? me : null, resolvedAt: input.resolution ? t : null };
    return this.mutate(p, input.expectedVersion, { $push: { conflicts: entry } }, me, 'rules.package.conflict_recorded', { conflictId: entry.id, resolved: !!input.resolution }, rid);
  }

  async resolveConflict(me: string, id: string, conflictId: string, input: { resolution: string; expectedVersion: number }, rid: string) {
    await this.ct.acl.require(me, 'rules.review', SITE, rid);
    const p = await this.load(id);
    this.assertOpen(p);
    if (!p.conflicts.some((x) => x.id === conflictId)) throw new DomainError('NOT_FOUND', 'conflict not found');
    return this.mutate(p, input.expectedVersion, { $set: { 'conflicts.$[c].resolution': input.resolution, 'conflicts.$[c].resolvedBy': me, 'conflicts.$[c].resolvedAt': now() } }, me, 'rules.package.conflict_resolved', { conflictId }, rid, { arrayFilters: [{ 'c.id': conflictId }] });
  }

  private assertOpen(p: RulesPackageDoc) {
    if (p.state !== 'draft' && p.state !== 'under_review') throw new DomainError('ILLEGAL_TRANSITION', `a ${p.state} rules package cannot be changed`);
  }

  private async mutate(p: RulesPackageDoc, expectedVersion: number, update: Record<string, unknown>, me: string, evType: string, payload: Record<string, unknown>, rid: string, opts: { arrayFilters?: Array<Record<string, unknown>> } = {}) {
    if (p.version !== expectedVersion) throw new DomainError('VERSION_CONFLICT', 'package was modified', { currentVersion: p.version });
    return this.ct.dbh.withTransaction(async (s) => {
      const upd = { ...update, $inc: { version: 1 } } as Record<string, Record<string, unknown>>;
      upd['$set'] = { ...(upd['$set'] ?? {}), updatedAt: now() };
      const r = await this.c.rulesPackages.findOneAndUpdate({ _id: p._id, version: expectedVersion }, upd, { session: s, returnDocument: 'after', ...opts });
      if (!r) throw new DomainError('VERSION_CONFLICT', 'package was modified');
      await this.au(s, me, evType, p._id, payload, rid);
      await this.ev(s, evType, p._id, r.version, me, payload, rid);
      return r;
    });
  }

  /**
   * Reviewer sign-off (translation, publisher rights, human-review acknowledgement). On a published package it only
   * re-confirms the review date (monthly review, RULE-012) and never touches the clauses.
   */
  async review(me: string, id: string, input: z.infer<typeof RulesReviewSchema>, rid: string) {
    await this.ct.acl.require(me, 'rules.review', SITE, rid);
    const p = await this.load(id);
    const t = now();
    const set: Record<string, unknown> = { reviewedAt: t, nextReviewDueAt: plus(t, REVIEW_INTERVAL_DAYS) };
    const upd: Record<string, unknown> = { $set: set };
    if (p.state === 'published') return this.mutate(p, input.expectedVersion, upd, me, 'rules.package.review_confirmed', { note: input.note }, rid);
    this.assertOpen(p);
    const humanKeys = new Set(p.clauses.filter((c) => c.kind === 'human_review').map((c) => c.key));
    const bad = input.acknowledgedClauseKeys.filter((k) => !humanKeys.has(k));
    if (bad.length) throw new DomainError('VALIDATION_FAILED', 'acknowledged keys are not human-review clauses of this package', { keys: bad });
    if (input.translationReviewed !== undefined) set['translationFa'] = { ...p.translationFa, reviewed: input.translationReviewed, reviewer: input.translationReviewed ? me : null, reviewedAt: input.translationReviewed ? t : null };
    if (input.publisherRights) set['publisherRights'] = { reviewed: input.publisherRights.reviewed, restrictions: input.publisherRights.restrictions, reviewedBy: input.publisherRights.reviewed ? me : null };
    const have = new Set((p.humanReviewAcks ?? []).map((a) => a.key));
    const fresh = input.acknowledgedClauseKeys.filter((k) => !have.has(k)).map((key) => ({ key, by: me, at: t }));
    if (fresh.length) upd['$push'] = { humanReviewAcks: { $each: fresh } };
    return this.mutate(p, input.expectedVersion, upd, me, 'rules.package.reviewed', { acknowledged: input.acknowledgedClauseKeys, note: input.note }, rid);
  }

  // ---------------------------------------------------------------- workflow
  /** Synthetic exercises never represent publisher approval and are disabled outside development login mode. */
  private isDevelopmentTrial(p: RulesPackageDoc): boolean {
    return p.testOnly && !this.ct.config.isProduction && this.ct.config.devLoginEnabled;
  }

  /** Everything that currently prevents publishing (RULE-005/010). */
  async publishBlockers(p: RulesPackageDoc): Promise<string[]> {
    const b: string[] = [];
    for (const i of clauseIssues(p.clauses)) b.push(`clause_invalid:${i}`);
    for (const x of p.conflicts) if (!x.resolution) b.push(`unresolved_conflict:${x.id}`);
    if (!p.translationFa.reviewed) b.push('translation_not_reviewed');
    if (!p.publisherRights.reviewed && !this.isDevelopmentTrial(p)) b.push('publisher_rights_not_reviewed');
    const acked = new Set((p.humanReviewAcks ?? []).map((a) => a.key));
    for (const c of p.clauses) if (c.kind === 'human_review' && !acked.has(c.key)) b.push(`human_review_not_acknowledged:${c.key}`);
    if (p.testOnly && this.ct.config.isProduction) b.push('test_only_in_production');
    if (p.supersedes) {
      const prev = await this.c.rulesPackages.findOne({ _id: p.supersedes }, { projection: { state: 1 } });
      if (prev?.state !== 'published') b.push('superseded_package_not_published');
    }
    return b;
  }

  async transition(me: string, id: string, input: z.infer<typeof RulesTransitionSchema>, rid: string): Promise<RulesPackageDoc> {
    const p = await this.load(id);
    if (p.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'package was modified', { currentVersion: p.version });
    const illegal = () => new DomainError('ILLEGAL_TRANSITION', `cannot ${input.transition} a package that is ${p.state}`);
    const t = now();
    let next: RulesPackageDoc['state'];
    switch (input.transition) {
      case 'submit_for_review':
        if (p.state !== 'draft') throw illegal();
        if (!(await this.canManage(me, p))) await this.requireWrite(me, p.scope, rid);
        next = 'under_review';
        break;
      case 'return_to_draft':
        await this.ct.acl.require(me, 'rules.review', SITE, rid);
        if (p.state !== 'under_review') throw illegal();
        next = 'draft';
        break;
      case 'withdraw':
        await this.ct.acl.require(me, 'rules.publish', SITE, rid);
        if (!['draft', 'under_review', 'published'].includes(p.state)) throw illegal();
        next = 'withdrawn';
        break;
      case 'publish': {
        await this.ct.acl.require(me, 'rules.publish', SITE, rid);
        if (p.state !== 'under_review') throw illegal();
        if (p.createdBy === me && !this.isDevelopmentTrial(p)) throw new DomainError('SEPARATION_OF_DUTIES', 'the author of a rules package cannot publish it');
        const blockers = await this.publishBlockers(p);
        if (blockers.length) throw new DomainError('PRECONDITION_FAILED', 'rules package cannot be published', { blockers });
        next = 'published';
        break;
      }
    }
    return this.ct.dbh.withTransaction(async (s) => {
      const set: Record<string, unknown> = { state: next, updatedAt: t };
      if (next === 'published') {
        set['reviewedAt'] = t;
        set['nextReviewDueAt'] = plus(t, REVIEW_INTERVAL_DAYS);
        if (p.amendment) set['amendment.notifiedAt'] = t;
      }
      const r = await this.c.rulesPackages.findOneAndUpdate({ _id: id, version: input.expectedVersion, state: p.state }, { $set: set, $push: { history: { state: next, by: me, at: t, note: input.note } }, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
      if (!r) throw new DomainError('VERSION_CONFLICT', 'package was modified');
      await this.au(s, me, `rules.package.${input.transition}`, id, { from: p.state, to: next, developmentTrial: this.isDevelopmentTrial(p) }, rid);
      await this.ev(s, `rules.package.${next}`, id, r.version, me, { from: p.state, to: next, gameId: p.gameId }, rid);
      if (next === 'published' && p.supersedes) {
        // RULE-007: the previous version is superseded; started events keep their frozen snapshot (never rewritten here)
        const prev = await this.c.rulesPackages.findOneAndUpdate({ _id: p.supersedes, state: 'published' }, { $set: { state: 'superseded', supersededBy: id, updatedAt: t }, $push: { history: { state: 'superseded', by: me, at: t, note: `superseded by ${id}` } }, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
        if (!prev) throw new DomainError('CONFLICT', 'superseded package is no longer published');
        const events = await this.c.events.find({ 'rulesSnapshot.packageId': p.supersedes }, { session: s, projection: { _id: 1, name: 1, startsAt: 1 } }).toArray();
        await this.ev(s, 'rules.package.amended', id, r.version, me, { gameId: p.gameId, supersedes: p.supersedes, reason: p.amendment?.reason ?? null, impactAssessment: p.amendment?.impactAssessment ?? null, reacceptRequired: p.amendment?.reacceptRequired ?? false, affectedEventIds: events.map((e) => e._id) }, rid);
      }
      return r;
    });
  }

  /** RULE-007: a NEW package version; the published one is never mutated and stays in force until the new one is published. */
  async amend(me: string, id: string, input: z.infer<typeof AmendmentSchema>, rid: string): Promise<RulesPackageDoc> {
    const p = await this.load(id);
    await this.requireWrite(me, p.scope, rid);
    if (p.state !== 'published') throw new DomainError('ILLEGAL_TRANSITION', 'only a published package can be amended');
    if (await this.c.rulesPackages.findOne({ supersedes: id, state: { $in: ['draft', 'under_review'] } }, { projection: { _id: 1 } })) throw new DomainError('CONFLICT', 'an amendment of this package is already open');
    const tr = input.translationFa ? await this.normalizeReviews(me, rid, input.translationFa, NO_RIGHTS) : null;
    const t = now();
    const doc: RulesPackageDoc = {
      ...p,
      _id: newId('rules'),
      versionLabel: input.newVersion,
      state: 'draft',
      sourceUrl: input.sourceUrl === undefined ? p.sourceUrl : input.sourceUrl,
      sourceRetrievedAt: t,
      reviewedAt: null,
      nextReviewDueAt: null,
      translationFa: tr ? tr.translationFa : { text: null, reviewed: false, reviewer: null, reviewedAt: null },
      clauses: input.clauses,
      clausesHash: hashClauses(input.clauses),
      conflicts: [],
      humanReviewAcks: [],
      supersedes: id,
      supersededBy: null,
      amendment: { reason: input.reason, impactAssessment: input.impactAssessment, reacceptRequired: input.reacceptRequired, notifiedAt: null },
      history: [{ state: 'draft', by: me, at: t, note: `amendment of ${id}` }],
      createdBy: me,
      createdAt: t,
      updatedAt: t,
      version: 0,
    };
    await this.insert(doc, me, 'rules.package.amend', 'rules.package.amendment_drafted', rid, { supersedes: id, reacceptRequired: input.reacceptRequired });
    return doc;
  }

  // ---------------------------------------------------------------- snapshot, settings
  /** RULE-006/011: frozen copy for ESP-03 (events/disciplines/matches). Published packages only. */
  async freezeSnapshot(packageId: string): Promise<RulesSnapshot> {
    const p = await this.load(packageId);
    if (p.state !== 'published') throw new DomainError('PRECONDITION_FAILED', 'only a published rules package can be frozen into a snapshot', { state: p.state });
    return {
      packageId: p._id,
      version: p.versionLabel,
      sourceRef: p.sourceUrl ?? `text:${p._id}`,
      reviewedAt: p.reviewedAt,
      label: p.testOnly ? `TEST ONLY — ${p.title}` : p.title,
      clauses: snapshotClauses(p.clauses),
      hash: hashClauses(p.clauses),
    };
  }

  /** RULE-009: the value of a clause, or null. There is no fallback constant anywhere. */
  async resolveSetting(packageId: string, key: string): Promise<Value> {
    const p = await this.c.rulesPackages.findOne({ _id: packageId }, { projection: { clauses: 1 } });
    return p?.clauses.find((c) => c.key === key)?.value ?? null;
  }

  async validateSettings(packageId: string, settings: Record<string, Value>) {
    const p = await this.load(packageId);
    const violations = checkSettings(p.clauses, settings);
    return { ok: violations.length === 0, packageId, versionLabel: p.versionLabel, violations };
  }

  // ---------------------------------------------------------------- acceptance
  async accept(me: string, packageId: string, context: { eventId: string | null; participationId: string | null }, rid: string): Promise<{ doc: RulesAcceptanceDoc; created: boolean }> {
    const p = await this.load(packageId);
    if (p.state !== 'published') throw new DomainError('PRECONDITION_FAILED', 'only a published rules package can be accepted', { state: p.state });
    if (context.eventId && !(await this.c.events.findOne({ _id: context.eventId }, { projection: { _id: 1 } }))) throw new DomainError('NOT_FOUND', 'event not found');
    const key = { packageId, principalId: me, 'context.eventId': context.eventId, 'context.participationId': context.participationId };
    const existing = await this.c.rulesAcceptances.findOne(key);
    if (existing) return { doc: existing, created: false };
    const doc: RulesAcceptanceDoc = { _id: newId('racc'), packageId, packageVersionLabel: p.versionLabel, clausesHash: hashClauses(p.clauses), principalId: me, context, acceptedAt: now() };
    try {
      await this.ct.dbh.withTransaction(async (s) => {
        await this.c.rulesAcceptances.insertOne(doc, { session: s });
        await this.au(s, me, 'rules.package.accept', packageId, { eventId: context.eventId, participationId: context.participationId, hash: doc.clausesHash }, rid);
        await this.ev(s, 'rules.package.accepted', packageId, p.version, me, { eventId: context.eventId, participationId: context.participationId, versionLabel: p.versionLabel, hash: doc.clausesHash }, rid);
      });
    } catch (e) {
      if (isDup(e)) return { doc: (await this.c.rulesAcceptances.findOne(key))!, created: false };
      throw e;
    }
    return { doc, created: true };
  }

  async acceptances(me: string, packageId: string, eventId: string | undefined, rid: string) {
    if (eventId) await this.ct.acl.require(me, 'event.manage', { type: 'event', id: eventId }, rid);
    else await this.ct.acl.require(me, 'rules.review', SITE, rid);
    await this.load(packageId);
    return this.c.rulesAcceptances.find(eventId ? { packageId, 'context.eventId': eventId } : { packageId }).sort({ acceptedAt: 1 }).limit(1000).toArray();
  }

  /** True when an amendment with reacceptRequired was published after the principal's acceptance in this event and has not been accepted. */
  async needsReacceptance(principalId: string, eventId: string): Promise<boolean> {
    const mine = await this.c.rulesAcceptances.find({ principalId, 'context.eventId': eventId }).toArray();
    const accepted = new Set(mine.map((a) => a.packageId));
    for (const a of mine) {
      let need = false;
      let cur = await this.c.rulesPackages.findOne({ _id: a.packageId }, { projection: { supersededBy: 1 } });
      for (let guard = 0; cur?.supersededBy && guard < 100; guard++) {
        const next: RulesPackageDoc | null = await this.c.rulesPackages.findOne({ _id: cur.supersededBy });
        if (!next) break;
        if (accepted.has(next._id)) need = false;
        else if (next.amendment?.reacceptRequired) need = true;
        cur = next;
      }
      if (need) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- reminders (RULE-012)
  /**
   * Monthly review due + packages behind events starting within 14 days.
   * ponytail: every event is treated as rated until ESP-03 adds a rated flag; add the filter there.
   */
  async listDueReviews(at: Date = new Date()) {
    const iso = at.toISOString();
    const out: Array<{ packageId: string; gameId: string; title: string; version: string; reason: 'monthly_review_due' | 'pre_rated_event'; dueAt: string; eventId: string | null }> = [];
    const published = await this.c.rulesPackages.find({ state: 'published' }).limit(2000).toArray();
    for (const p of published) {
      if (p.nextReviewDueAt && p.nextReviewDueAt <= iso) out.push({ packageId: p._id, gameId: p.gameId, title: p.title, version: p.versionLabel, reason: 'monthly_review_due', dueAt: p.nextReviewDueAt, eventId: null });
    }
    const byId = new Map(published.map((p) => [p._id, p]));
    const horizon = plus(iso, PRE_EVENT_WINDOW_DAYS);
    const events = await this.c.events.find({ 'rulesSnapshot.packageId': { $in: [...byId.keys()] }, startsAt: { $gte: iso, $lte: horizon } }, { projection: { _id: 1, startsAt: 1, rulesSnapshot: 1 } }).toArray();
    for (const e of events) {
      const p = byId.get(e.rulesSnapshot!.packageId)!;
      out.push({ packageId: p._id, gameId: p.gameId, title: p.title, version: p.versionLabel, reason: 'pre_rated_event', dueAt: e.startsAt!, eventId: e._id });
    }
    return out;
  }

  async reminders(me: string, rid: string) {
    await this.ct.acl.require(me, 'rules.review', SITE, rid);
    return this.listDueReviews();
  }

  // ---------------------------------------------------------------- reads
  /** Public projection of a published/superseded package; managers also get the working data. */
  view(p: RulesPackageDoc, manager: boolean) {
    const acked = new Set((p.humanReviewAcks ?? []).map((a) => a.key));
    const pub = {
      id: p._id,
      gameId: p.gameId,
      scope: p.scope,
      title: p.title,
      versionLabel: p.versionLabel,
      state: p.state,
      testOnly: p.testOnly,
      label: p.testOnly ? 'TEST ONLY — not a publisher-approved rule set' : null,
      sourceUrl: p.sourceUrl,
      sourcePublishedAt: p.sourcePublishedAt,
      sourceRetrievedAt: p.sourceRetrievedAt,
      reviewedAt: p.reviewedAt,
      nextReviewDueAt: p.nextReviewDueAt,
      applicability: p.applicability,
      originalLanguage: p.originalLanguage,
      translationFa: { reviewed: p.translationFa.reviewed, reviewedAt: p.translationFa.reviewedAt, text: p.translationFa.reviewed ? p.translationFa.text : null },
      clauses: p.clauses,
      clausesHash: p.clausesHash,
      publisherRights: { reviewed: p.publisherRights.reviewed, restrictions: p.publisherRights.restrictions },
      adaptedFrom: p.adaptedFrom,
      supersedes: p.supersedes,
      supersededBy: p.supersededBy,
      amendment: p.amendment,
      version: p.version,
    };
    if (!manager) return pub;
    return {
      ...pub,
      sourceText: p.sourceText,
      translationFa: { ...p.translationFa },
      conflicts: p.conflicts,
      humanReviewClauses: p.clauses.filter((c) => c.kind === 'human_review').map((c) => ({ key: c.key, citation: c.citation, textOriginal: c.textOriginal, acknowledged: acked.has(c.key) })),
      clauseIssues: clauseIssues(p.clauses),
      history: p.history,
      createdBy: p.createdBy,
    };
  }

  async get(me: string | null, id: string) {
    const p = await this.load(id);
    const manager = !!me && (await this.canManage(me, p));
    if (!manager && !['published', 'superseded'].includes(p.state)) throw new DomainError(me ? 'FORBIDDEN' : 'UNAUTHENTICATED', 'this rules package is not public');
    return { ...this.view(p, manager), ...(manager ? { blockers: p.state === 'under_review' || p.state === 'draft' ? await this.publishBlockers(p) : [] } : {}) };
  }

  async list(me: string | null, f: { gameId?: string | undefined; scopeKind?: string | undefined; scopeRef?: string | undefined; state?: RulesPackageDoc['state'] | undefined; limit: number }) {
    const q: Record<string, unknown> = { state: f.state ?? 'published' };
    if (f.gameId) q['gameId'] = f.gameId;
    if (f.scopeKind) q['scope.kind'] = f.scopeKind;
    if (f.scopeRef) q['scope.ref'] = f.scopeRef;
    const rows = await this.c.rulesPackages.find(q).sort({ createdAt: -1 }).limit(f.limit).toArray();
    if (q['state'] === 'published' || q['state'] === 'superseded') return rows.map((p) => this.view(p, false));
    if (!me) throw new DomainError('UNAUTHENTICATED', 'authentication required');
    const out = [];
    for (const p of rows) if (await this.canManage(me, p)) out.push(this.view(p, true));
    return out;
  }
}
