import { CompetitionFamilies } from '@esp/contracts';
import type { Collections } from '../db/collections.js';
import { SEED_LABEL, seedIds } from '../db/seed-ids.js';
import { hashClauses } from '../rules/rules.js';
import type { Clause } from '@esp/contracts';

export const SEED_GAME_ID = 'game_seed_synthetic';

const REFS = [
  ['IESF — Rules & Regulations', 'https://www.iesf.org/rules-regulations', 'federation'],
  ['IESF — Code of Conduct', 'https://www.iesf.org/code-of-conduct', 'federation'],
  ['Riot Games Competitive Operations — The Library', 'https://competitiveops.riotgames.com/en-US/library', 'publisher'],
  ['ESL Pro Tour Counter-Strike — Rulebook 2026 Update #2', 'https://pro.eslgaming.com/tour/2026/07/esl-pro-tour-counter-strike-rulebook-2026-update-2-changelog/', 'league'],
  ['Riot Developer Relations — Tournament Policies', 'https://support-developer.riotgames.com/hc/en-us/sections/22779580187283-Tournament-Policies', 'publisher'],
] as const;

const clauses = (): Clause[] => [
  { key: 'roster.min', kind: 'mandatory', value: 5, allowed: null, citation: 'TEST ONLY synthetic clause 1', textOriginal: null, textFa: null },
  { key: 'roster.substitutes', kind: 'configurable', value: 2, allowed: { min: 0, max: 3, options: null }, citation: 'TEST ONLY synthetic clause 2', textOriginal: null, textFa: null },
  { key: 'pause.max_per_map', kind: 'configurable', value: 2, allowed: { min: 0, max: 4, options: null }, citation: 'TEST ONLY synthetic clause 3', textOriginal: null, textFa: null },
  { key: 'age.minimum', kind: 'human_review', value: null, allowed: null, citation: 'TEST ONLY: value must come from an approved package', textOriginal: null, textFa: null },
];

/**
 * TEST ONLY, idempotent: the synthetic game (under_review, family team, module team) whose chapter-18 references are
 * review INPUT only (not verified), plus one draft TEST ONLY package per competition family. Nothing here is published,
 * nothing claims publisher approval or compliance.
 */
export async function seedCatalogDomain(c: Collections): Promise<void> {
  const t = new Date().toISOString();
  await c.games.updateOne(
    { _id: SEED_GAME_ID },
    {
      $setOnInsert: {
        _id: SEED_GAME_ID,
        slug: 'seed-synthetic-game',
        title: 'بازی ساختگی (TEST ONLY)',
        publisher: 'TEST ONLY — no publisher',
        releasePeriod: null,
        platforms: ['pc'],
        modes: ['5v5'],
        regions: [],
        family: 'team',
        moduleId: 'team',
        references: REFS.map(([title, url, kind]) => ({ title: `${title} (review INPUT, not verified)`, url, kind, retrievedAt: 'not verified' })),
        capabilities: Object.fromEntries(['api', 'antiCheat', 'stats', 'replay', 'dedicatedServer'].map((k) => [k, { status: 'unknown', detail: null }])),
        state: 'under_review',
        stateHistory: [{ from: null, to: 'under_review', by: seedIds.admin, at: t, reason: SEED_LABEL, evidence: null }],
        logoFileId: null,
        createdBy: seedIds.admin,
        createdAt: t,
        updatedAt: t,
        version: 0,
        seedLabel: SEED_LABEL,
      },
    },
    { upsert: true },
  );
  for (const family of CompetitionFamilies) {
    const cl = clauses();
    await c.rulesPackages.updateOne(
      { _id: `rules_seed_${family}` },
      {
        $setOnInsert: {
          _id: `rules_seed_${family}`,
          gameId: SEED_GAME_ID,
          scope: { kind: 'catalog', ref: 'catalog' },
          title: `TEST ONLY — ${family}`,
          versionLabel: `0.0.1-test-${family}`,
          state: 'draft',
          sourceUrl: null,
          sourceText: `${SEED_LABEL}. Not a publisher rule set.`,
          sourcePublishedAt: null,
          sourceRetrievedAt: t,
          reviewedAt: null,
          nextReviewDueAt: null,
          applicability: `${SEED_LABEL} (${family})`,
          originalLanguage: 'en',
          translationFa: { text: null, reviewed: false, reviewer: null, reviewedAt: null },
          clauses: cl,
          clausesHash: hashClauses(cl),
          conflicts: [],
          humanReviewAcks: [],
          publisherRights: { reviewed: false, restrictions: null, reviewedBy: null },
          adaptedFrom: null,
          supersedes: null,
          supersededBy: null,
          amendment: null,
          testOnly: true,
          history: [{ state: 'draft', by: seedIds.admin, at: t, note: SEED_LABEL }],
          createdBy: seedIds.admin,
          createdAt: t,
          updatedAt: t,
          version: 0,
        },
      },
      { upsert: true },
    );
  }
}
