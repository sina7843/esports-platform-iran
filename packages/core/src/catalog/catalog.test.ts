import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DomainError, defaultCapabilities } from '@esp/contracts';
import { testContainer, rid } from '../test/harness.js';
import { seedIds } from '../db/seed-ids.js';
import { GameService } from './catalog.js';
import { seedCatalogDomain, SEED_GAME_ID } from './seed.js';

let t: Awaited<ReturnType<typeof testContainer>>;
let svc: GameService;
const now = () => new Date().toISOString();
const mk = (slug: string) => ({ slug, title: slug, publisher: 'TEST ONLY', releasePeriod: null, platforms: ['pc', 'console'], modes: ['1v1', '5v5'], regions: [], family: 'team' as const, moduleId: 'team', references: [], capabilities: defaultCapabilities, logoFileId: null });
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as DomainError | null)?.code ?? null;

async function publishedPackage(gameId: string, testOnly = false) {
  const id = `rp_${Math.random().toString(36).slice(2)}`;
  await t.c.rulesPackages.insertOne({
    _id: id,
    gameId,
    scope: { kind: 'catalog', ref: 'catalog' },
    title: 'pkg',
    versionLabel: id,
    state: 'published',
    sourceUrl: 'https://example.org/rules',
    sourceText: null,
    sourcePublishedAt: null,
    sourceRetrievedAt: now(),
    reviewedAt: now(),
    nextReviewDueAt: null,
    applicability: 'x',
    originalLanguage: 'en',
    translationFa: { text: null, reviewed: true, reviewer: 'x', reviewedAt: now() },
    clauses: [],
    clausesHash: 'h',
    conflicts: [],
    publisherRights: { reviewed: true, restrictions: null, reviewedBy: 'x' },
    adaptedFrom: null,
    supersedes: null,
    supersededBy: null,
    amendment: null,
    testOnly,
    history: [],
    createdBy: 'x',
    createdAt: now(),
    updatedAt: now(),
    version: 0,
  });
  return id;
}

beforeAll(async () => {
  t = await testContainer({ seed: true });
  svc = new GameService(t);
  await seedCatalogDomain(t.c);
});
afterAll(async () => {
  await t.drop();
});

describe('game catalog', () => {
  it('seed is under_review, honest and idempotent', async () => {
    await seedCatalogDomain(t.c);
    const g = await t.c.games.findOne({ _id: SEED_GAME_ID });
    expect(g?.state).toBe('under_review');
    expect(g?.references.every((r) => r.retrievedAt === 'not verified')).toBe(true);
    expect(await t.c.rulesPackages.countDocuments({ gameId: SEED_GAME_ID, testOnly: true, state: 'draft' })).toBe(6);
    expect((await svc.view(g!)).standardReady).toBe(false);
  });

  it('capabilities default to unknown and are never promisable', async () => {
    const g = await svc.create(seedIds.admin, mk('cap-default'), rid());
    const v = await svc.view(g);
    for (const c of Object.values(v.capabilities)) {
      expect(c.status).toBe('unknown');
      expect(c.promisable).toBe(false);
    }
    expect(v.state).toBe('proposed');
  });

  it('requires an existing module of the same family and catalog.manage', async () => {
    expect(await code(svc.create(seedIds.admin, { ...mk('bad-mod'), moduleId: 'nope' }, rid()))).toBe('VALIDATION_FAILED');
    expect(await code(svc.create(seedIds.admin, { ...mk('bad-fam'), moduleId: 'score' }, rid()))).toBe('VALIDATION_FAILED');
    expect(await code(svc.create(seedIds.player, mk('denied'), rid()))).toBe('FORBIDDEN');
    expect(await code(svc.create(seedIds.admin, mk('cap-default'), rid()))).toBe('CONFLICT');
  });

  it('cannot become ready without evidence, a reviewed package and a ready mode; modes are isolated', async () => {
    const g = await svc.create(seedIds.admin, mk('gate'), rid());
    let cur = await svc.transition(seedIds.admin, g._id, { to: 'under_review', reason: 'start', expectedVersion: g.version }, rid());
    const ev = { referenceUrl: 'https://example.org/ref', reviewedAt: now(), note: null };
    const attempt = async () => ((await svc.transition(seedIds.admin, g._id, { to: 'ready', reason: 'go', evidence: ev, expectedVersion: cur.version }, rid()).catch((e: DomainError) => e)) as DomainError).details as { missing: string[] };
    expect((await attempt()).missing.sort()).toEqual(['published_reviewed_rules_package', 'ready_mode']);
    expect(await code(svc.transition(seedIds.admin, g._id, { to: 'ready', reason: 'go', expectedVersion: cur.version }, rid()))).toBe('PRECONDITION_FAILED');

    await publishedPackage(g._id, true); // test-only package does not count
    expect((await attempt()).missing).toContain('published_reviewed_rules_package');
    await publishedPackage(g._id);
    expect((await attempt()).missing).toEqual(['ready_mode']);

    await svc.upsertReadiness(seedIds.admin, g._id, { version: '1.0', platform: 'pc', mode: '5v5', state: 'ready', evidence: 'checked' }, rid());
    cur = await svc.transition(seedIds.admin, g._id, { to: 'ready', reason: 'go', evidence: ev, expectedVersion: cur.version }, rid());
    expect(cur.state).toBe('ready');
    expect((await svc.view(cur)).standardReady).toBe(true);

    expect(await svc.isReady(g._id, '1.0', 'pc', '5v5')).toBe(true);
    expect(await svc.isReady(g._id, '1.0', 'pc', '1v1')).toBe(false);
    expect(await svc.isReady(g._id, '1.0', 'console', '5v5')).toBe(false);
    expect(await svc.isReady(g._id, '2.0', 'pc', '5v5')).toBe(false);
    expect(await code(svc.upsertReadiness(seedIds.admin, g._id, { version: '1.0', platform: 'xbox', mode: '5v5', state: 'ready', evidence: 'x' }, rid()))).toBe('VALIDATION_FAILED');

    expect(await code(svc.transition(seedIds.admin, g._id, { to: 'proposed', reason: 'x', expectedVersion: cur.version }, rid()))).toBe('ILLEGAL_TRANSITION');
    await svc.upsertReadiness(seedIds.admin, g._id, { version: '1.0', platform: 'pc', mode: '5v5', state: 'not_ready', evidence: null }, rid());
    const after = await t.c.games.findOne({ _id: g._id });
    expect(after?.state).toBe('suspended');
    expect(after?.stateHistory.length).toBe(4);
    expect(await code(svc.transition(seedIds.admin, g._id, { to: 'ready', reason: 'x', evidence: ev, expectedVersion: 0 }, rid()))).toBe('VERSION_CONFLICT');
  });
});
