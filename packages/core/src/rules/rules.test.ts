import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DomainError, type Clause } from '@esp/contracts';
import { testContainer, rid } from '../test/harness.js';
import { seedIds } from '../db/seed-ids.js';
import { seedCatalogDomain, SEED_GAME_ID } from '../catalog/seed.js';
import { RulesService, checkSettings, hashClauses } from './rules.js';

let t: Awaited<ReturnType<typeof testContainer>>;
let svc: RulesService;
const O1 = 'usr_rules_officer_1';
const O2 = 'usr_rules_officer_2';
const now = () => new Date().toISOString();
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as DomainError | null)?.code ?? null;
const blockers = async (p: Promise<unknown>) => (((await p.then(() => null, (e: unknown) => e)) as DomainError).details as { blockers: string[] }).blockers;

const cl = (key: string, kind: Clause['kind'], value: Clause['value'], allowed: Clause['allowed'] = null): Clause => ({ key, kind, value, allowed, citation: `§${key}`, textOriginal: null, textFa: null });
const goodClauses = (): Clause[] => [cl('roster.min', 'mandatory', 4), cl('roster.substitutes', 'configurable', 1, { min: 0, max: 2, options: null }), cl('age.minimum', 'human_review', null)];
let n = 0;
const input = (over: Record<string, unknown> = {}) => ({
  gameId: SEED_GAME_ID,
  scope: { kind: 'catalog' as const, ref: 'catalog' },
  title: 'TEST ONLY pkg',
  version: `t${++n}`,
  sourceUrl: 'https://example.org/rules',
  sourceText: null,
  sourcePublishedAt: null,
  applicability: 'test',
  originalLanguage: 'en',
  translationFa: { text: 'ترجمه', reviewed: false, reviewer: null, reviewedAt: null },
  clauses: goodClauses(),
  publisherRights: { reviewed: false, restrictions: null, reviewedBy: null },
  adaptedFrom: null,
  testOnly: true,
  ...over,
});
type PkgIn = ReturnType<typeof input>;

/** author O1 -> review by O2 -> submit -> returns package id (ready for publish by O2). */
async function inReview(over: Record<string, unknown> = {}, review = true): Promise<string> {
  const p = await svc.create(O1, input(over) as PkgIn, rid());
  let cur = p;
  if (review) cur = await svc.review(O2, p._id, { translationReviewed: true, publisherRights: { reviewed: true, restrictions: null }, acknowledgedClauseKeys: cur.clauses.filter((c) => c.kind === 'human_review').map((c) => c.key), note: null, expectedVersion: 0 }, rid());
  await svc.transition(O1, p._id, { transition: 'submit_for_review', note: null, expectedVersion: cur.version }, rid());
  return p._id;
}
const publish = async (id: string, by = O2) => svc.transition(by, id, { transition: 'publish', note: null, expectedVersion: (await t.c.rulesPackages.findOne({ _id: id }))!.version }, rid());

async function person(id: string, role?: 'rules_officer') {
  const at = now();
  await t.c.principals.insertOne({ _id: id, kind: 'user', displayName: id, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: at, updatedAt: at, version: 0 });
  if (role) await t.acl.grant({ principalId: id, role, scope: { type: 'site', id: 'site' }, expiresAt: null, reason: 'test' }, { principalId: seedIds.admin, requestId: rid() });
}

beforeAll(async () => {
  t = await testContainer({ seed: true });
  svc = new RulesService(t);
  await seedCatalogDomain(t.c);
  await person(O1, 'rules_officer');
  await person(O2, 'rules_officer');
});
afterAll(async () => {
  await t.drop();
});

describe('rules packages', () => {
  it('requires a source and permission by scope', async () => {
    expect(await code(svc.create(O1, input({ sourceUrl: null }) as PkgIn, rid()))).toBe('VALIDATION_FAILED');
    expect(await code(svc.create(seedIds.player, input() as PkgIn, rid()))).toBe('FORBIDDEN');
    // organizer of org B cannot create a package scoped to org A; organizer of A can
    const scopeA = { kind: 'organizer' as const, ref: seedIds.orgA };
    expect(await code(svc.create(seedIds.organizerB, input({ scope: scopeA }) as PkgIn, rid()))).toBe('FORBIDDEN');
    expect(await code(svc.create(seedIds.organizer, input({ scope: scopeA }) as PkgIn, rid()))).toBeNull();
    // organizers cannot mark reviews themselves
    expect(await code(svc.create(seedIds.organizer, input({ scope: { kind: 'organizer', ref: seedIds.orgA }, publisherRights: { reviewed: true, restrictions: null, reviewedBy: null } }) as PkgIn, rid()))).toBe('FORBIDDEN');
    // catalog packages need rules.manage
    expect(await code(svc.create(seedIds.organizer, input() as PkgIn, rid()))).toBe('FORBIDDEN');
  });

  it('publish is blocked for each blocker, and the author cannot publish', async () => {
    const unreviewed = await inReview({ testOnly: false }, false);
    expect(await blockers(publish(unreviewed))).toEqual(expect.arrayContaining(['translation_not_reviewed', 'publisher_rights_not_reviewed', 'human_review_not_acknowledged:age.minimum']));

    const bad = await inReview({ clauses: [cl('a.b', 'configurable', 5, null), cl('c.d', 'configurable', 9, { min: 0, max: 3, options: null })] });
    expect((await blockers(publish(bad))).filter((b) => b.startsWith('clause_invalid')).length).toBe(2);

    const conflict = await inReview({ testOnly: false });
    await svc.transition(O2, conflict, { transition: 'return_to_draft', note: null, expectedVersion: (await t.c.rulesPackages.findOne({ _id: conflict }))!.version }, rid());
    let p = await svc.recordConflict(O2, conflict, { description: 'sources disagree', resolution: null, expectedVersion: (await t.c.rulesPackages.findOne({ _id: conflict }))!.version }, rid());
    await svc.transition(O1, conflict, { transition: 'submit_for_review', note: null, expectedVersion: p.version }, rid());
    expect(await blockers(publish(conflict))).toEqual([`unresolved_conflict:${p.conflicts[0]!.id}`]);
    p = (await t.c.rulesPackages.findOne({ _id: conflict }))!;
    await svc.resolveConflict(O2, conflict, p.conflicts[0]!.id, { resolution: 'use newer source', expectedVersion: p.version }, rid());
    expect(await code(publish(conflict, O1))).toBe('SEPARATION_OF_DUTIES');
    expect((await publish(conflict)).state).toBe('published');

    const ok = await inReview({ testOnly: false });
    expect(await code(publish(ok, O1))).toBe('SEPARATION_OF_DUTIES');
    expect(await code(publish(ok, seedIds.admin))).toBe('FORBIDDEN');
  });

  it('development trials retain review checks and never claim publisher approval', async () => {
    const id = await inReview({ clauses: [cl('roster.min', 'mandatory', 5)] }, false);
    expect(await blockers(publish(id, O1))).toEqual(['translation_not_reviewed']);
    let p = (await t.c.rulesPackages.findOne({ _id: id }))!;
    p = await svc.review(O1, id, { translationReviewed: true, acknowledgedClauseKeys: [], note: 'synthetic exercise', expectedVersion: p.version }, rid());
    const disabled = new RulesService({ ...t, config: { ...t.config, devLoginEnabled: false } } as typeof t);
    expect(await disabled.publishBlockers(p)).toContain('publisher_rights_not_reviewed');
    expect(await code(disabled.transition(O1, id, { transition: 'publish', note: null, expectedVersion: p.version }, rid()))).toBe('SEPARATION_OF_DUTIES');
    expect(await code(publish(id, seedIds.admin))).toBe('FORBIDDEN');
    const published = await publish(id, O1);
    expect(published.state).toBe('published');
    expect(published.publisherRights).toEqual({ reviewed: false, restrictions: null, reviewedBy: null });
    expect((await svc.freezeSnapshot(id)).label).toContain('TEST ONLY');
  });

  it('testOnly packages cannot be published in production config', async () => {
    const id = await inReview();
    const prodSvc = new RulesService({ ...t, config: { ...t.config, isProduction: true } } as typeof t);
    expect(await blockers(prodSvc.transition(O2, id, { transition: 'publish', note: null, expectedVersion: (await t.c.rulesPackages.findOne({ _id: id }))!.version }, rid()))).toContain('test_only_in_production');
    expect((await publish(id)).state).toBe('published');
  });

  it('published packages are immutable; amendment supersedes without touching event snapshots', async () => {
    const id = await inReview();
    const pub = await publish(id);
    expect(pub.reviewedAt).not.toBeNull();
    expect(pub.nextReviewDueAt).toBe(new Date(Date.parse(pub.reviewedAt!) + 30 * 86_400_000).toISOString());
    expect(await code(svc.update(O1, id, { title: 'x', expectedVersion: pub.version }, rid()))).toBe('ILLEGAL_TRANSITION');

    const snap = await svc.freezeSnapshot(id);
    expect(snap.hash).toBe(hashClauses(pub.clauses));
    expect(snap.label.startsWith('TEST ONLY')).toBe(true);
    await t.c.events.updateOne({ _id: seedIds.eventA }, { $set: { rulesSnapshot: snap, startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString() } });
    const before = JSON.stringify((await t.c.events.findOne({ _id: seedIds.eventA }))!.rulesSnapshot);

    // acceptance is idempotent and records the hash
    const ctx = { eventId: seedIds.eventA, participationId: seedIds.participationA1 };
    const a1 = await svc.accept(seedIds.captain, id, ctx, rid());
    const a2 = await svc.accept(seedIds.captain, id, ctx, rid());
    expect([a1.created, a2.created]).toEqual([true, false]);
    expect(a1.doc._id).toBe(a2.doc._id);
    expect(a1.doc.clausesHash).toBe(snap.hash);
    expect(await t.c.rulesAcceptances.countDocuments({ packageId: id })).toBe(1);
    expect(await svc.needsReacceptance(seedIds.captain, seedIds.eventA)).toBe(false);

    const newClauses = [cl('roster.min', 'mandatory', 5), cl('roster.substitutes', 'configurable', 1, { min: 0, max: 2, options: null }), cl('age.minimum', 'human_review', null)];
    expect(await code(svc.amend(seedIds.player, id, { newVersion: 'a1', reason: 'change roster', impactAssessment: 'small impact', reacceptRequired: true, clauses: newClauses }, rid()))).toBe('FORBIDDEN');
    const am = await svc.amend(O1, id, { newVersion: 'a1', reason: 'change roster', impactAssessment: 'small impact', reacceptRequired: true, clauses: newClauses }, rid());
    expect(am.state).toBe('draft');
    expect(am.supersedes).toBe(id);
    expect(am._id).not.toBe(id);
    expect(await code(svc.amend(O1, id, { newVersion: 'a2', reason: 'again again', impactAssessment: 'small impact', reacceptRequired: true, clauses: newClauses }, rid()))).toBe('CONFLICT');
    expect(await code(svc.amend(O1, id, { newVersion: 'a1', reason: 'again again', impactAssessment: 'small impact', reacceptRequired: true, clauses: newClauses }, rid()))).toBe('CONFLICT');

    // new version needs its own review; publish supersedes the old one
    await svc.review(O2, am._id, { translationReviewed: true, acknowledgedClauseKeys: ['age.minimum'], note: null, expectedVersion: 0 }, rid());
    let cur = (await t.c.rulesPackages.findOne({ _id: am._id }))!;
    await svc.transition(O1, am._id, { transition: 'submit_for_review', note: null, expectedVersion: cur.version }, rid());
    const published = await publish(am._id);
    expect(published.state).toBe('published');
    cur = (await t.c.rulesPackages.findOne({ _id: id }))!;
    expect(cur.state).toBe('superseded');
    expect(cur.supersededBy).toBe(am._id);
    expect(cur.clauses).toEqual(pub.clauses);

    // frozen snapshot unchanged byte-for-byte; the outbox lists the affected event
    expect(JSON.stringify((await t.c.events.findOne({ _id: seedIds.eventA }))!.rulesSnapshot)).toBe(before);
    const ev = await t.c.outbox.findOne({ type: 'rules.package.amended', 'aggregate.id': am._id });
    expect((ev!.payload as { affectedEventIds: string[] }).affectedEventIds).toContain(seedIds.eventA);

    // re-acceptance
    expect(await svc.needsReacceptance(seedIds.captain, seedIds.eventA)).toBe(true);
    await svc.accept(seedIds.captain, am._id, ctx, rid());
    expect(await svc.needsReacceptance(seedIds.captain, seedIds.eventA)).toBe(false);
    expect(await code(svc.accept(seedIds.captain, id, { eventId: null, participationId: null }, rid()))).toBe('PRECONDITION_FAILED');

    // review reminders: monthly due and pre-event
    const reminders = await svc.listDueReviews(new Date(Date.now() + 31 * 86_400_000));
    expect(reminders.some((r) => r.packageId === am._id && r.reason === 'monthly_review_due')).toBe(true);
    expect(reminders.some((r) => r.reason === 'pre_rated_event')).toBe(false); // event is >14d away then
    await t.c.events.updateOne({ _id: seedIds.eventA }, { $set: { 'rulesSnapshot.packageId': am._id } });
    const soon = await svc.listDueReviews();
    expect(soon.some((r) => r.reason === 'pre_rated_event' && r.eventId === seedIds.eventA)).toBe(true);
    expect(await svc.listDueReviews()).not.toContainEqual(expect.objectContaining({ reason: 'monthly_review_due' }));
    expect(await code(svc.reminders(seedIds.player, rid()))).toBe('FORBIDDEN');
  });

  it('draft packages are not public; freeze needs a published package', async () => {
    const p = await svc.create(O1, input() as PkgIn, rid());
    expect(await code(svc.get(null, p._id))).toBe('UNAUTHENTICATED');
    expect(await code(svc.get(seedIds.player, p._id))).toBe('FORBIDDEN');
    expect(((await svc.get(O2, p._id)) as Record<string, unknown>)['humanReviewClauses']).toEqual([expect.objectContaining({ key: 'age.minimum', acknowledged: false })]);
    expect(await code(svc.freezeSnapshot(p._id))).toBe('PRECONDITION_FAILED');
  });
});

describe('organizer settings and no global values', () => {
  const clauses = goodClauses();
  it('rejects out-of-bounds, mandatory overrides, human-review and unknown keys with citations', () => {
    expect(checkSettings(clauses, { 'roster.substitutes': 2, 'roster.min': 4 })).toEqual([]);
    const v = checkSettings(clauses, { 'roster.substitutes': 9, 'roster.min': 2, 'age.minimum': 16, 'x.y': 1 });
    expect(v.map((x) => [x.key, x.code])).toEqual([['roster.substitutes', 'out_of_bounds'], ['roster.min', 'mandatory_not_overridable'], ['age.minimum', 'human_review_not_settable'], ['x.y', 'unknown_key']]);
    expect(v[0]!.citation).toBe('§roster.substitutes');
    expect(checkSettings([cl('m.o', 'configurable', 'a', { min: null, max: null, options: ['a', 'b'] })], { 'm.o': 'c' })[0]!.code).toBe('out_of_bounds');
  });

  it('resolveSetting returns the clause value or null, never a built-in number', async () => {
    const id = await inReview({ clauses: [cl('age.minimum', 'human_review', null), cl('match.bo', 'mandatory', 3)] });
    expect(await svc.resolveSetting(id, 'age.minimum')).toBeNull();
    expect(await svc.resolveSetting(id, 'match.bo')).toBe(3);
    expect(await svc.resolveSetting(id, 'pause.max')).toBeNull();
    expect(await svc.resolveSetting('missing', 'age.minimum')).toBeNull();
    const out = await svc.validateSettings(id, { 'match.bo': 5 });
    expect(out.ok).toBe(false);
    expect(out.violations[0]).toMatchObject({ key: 'match.bo', citation: '§match.bo' });
  });
});
