import { z } from 'zod';

/**
 * Chapter 6.2 — rules packages (RULE-001..012, BASE-005/006/009).
 * A package is versioned, sourced and scoped. Clauses are mandatory / configurable (with allowed bounds) /
 * human_review. Events freeze a snapshot (ESP-01 `RulesSnapshot`); amendments create a new version and never
 * mutate a published one.
 */
export const RulesPackageStates = ['draft', 'under_review', 'published', 'superseded', 'withdrawn'] as const;
export type RulesPackageState = (typeof RulesPackageStates)[number];

export const RulesScopeKinds = ['catalog', 'organizer', 'event'] as const;
export const RulesScopeSchema = z.object({ kind: z.enum(RulesScopeKinds), ref: z.string().min(1).max(64) });

export const ClauseKinds = ['mandatory', 'configurable', 'human_review'] as const;
export const ClauseAllowedSchema = z.object({
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
  options: z.array(z.union([z.string(), z.number(), z.boolean()])).nullable().default(null),
});
export const ClauseSchema = z.object({
  /** Dotted key used by later stages, e.g. `age.minimum`, `roster.substitutes`, `match.bo`, `veto.order`, `pause.max`, `overtime.rule`, `dispute.deadline_minutes`. */
  key: z.string().min(1).max(80).regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/),
  kind: z.enum(ClauseKinds),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()])), z.null()]),
  allowed: ClauseAllowedSchema.nullable().default(null),
  /** Citation to the source (section/page) — required for every clause (RULE-011). */
  citation: z.string().min(1).max(200),
  textOriginal: z.string().max(4000).nullable().default(null),
  textFa: z.string().max(4000).nullable().default(null),
});
export type Clause = z.infer<typeof ClauseSchema>;

export const RulesPackageCreateSchema = z.object({
  gameId: z.string().min(1).max(64),
  scope: RulesScopeSchema,
  title: z.string().min(1).max(200),
  version: z.string().min(1).max(40),
  sourceUrl: z.string().url().max(500).nullable().default(null),
  sourceText: z.string().max(200000).nullable().default(null),
  sourcePublishedAt: z.string().nullable().default(null),
  applicability: z.string().max(1000),
  originalLanguage: z.string().max(10).default('en'),
  translationFa: z.object({ text: z.string().max(200000).nullable().default(null), reviewed: z.boolean().default(false), reviewer: z.string().nullable().default(null), reviewedAt: z.string().nullable().default(null) }).default({ text: null, reviewed: false, reviewer: null, reviewedAt: null }),
  clauses: z.array(ClauseSchema).max(500).default([]),
  publisherRights: z.object({ reviewed: z.boolean().default(false), restrictions: z.string().max(4000).nullable().default(null), reviewedBy: z.string().nullable().default(null) }).default({ reviewed: false, restrictions: null, reviewedBy: null }),
  adaptedFrom: z.object({ packageId: z.string(), differences: z.string().min(1).max(4000) }).nullable().default(null),
  testOnly: z.boolean().default(false),
});
export const RulesPackageUpdateSchema = RulesPackageCreateSchema.omit({ gameId: true, scope: true }).partial().extend({ expectedVersion: z.number().int() });

const OrganizerSettingsBase = () => z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]));
export const ConflictSchema = z.object({ description: z.string().min(1).max(2000), resolution: z.string().min(1).max(2000) });
/** A conflict between sources/clauses is recorded first and resolved by a rules officer; unresolved conflicts block publishing (RULE-005). */
export const ConflictCreateSchema = z.object({ description: z.string().min(1).max(2000), resolution: z.string().min(1).max(2000).nullable().default(null), expectedVersion: z.number().int() });
export const ConflictResolveSchema = z.object({ resolution: z.string().min(1).max(2000), expectedVersion: z.number().int() });

/** Rules-officer review: translation / publisher-rights sign-off and acknowledgement of human-review clauses. */
export const RulesReviewSchema = z.object({
  translationReviewed: z.boolean().optional(),
  publisherRights: z.object({ reviewed: z.boolean(), restrictions: z.string().max(4000).nullable().default(null) }).optional(),
  acknowledgedClauseKeys: z.array(z.string().max(80)).max(500).default([]),
  note: z.string().max(2000).nullable().default(null),
  expectedVersion: z.number().int(),
});
export const RulesListQuerySchema = z.object({
  gameId: z.string().max(64).optional(),
  scopeKind: z.enum(RulesScopeKinds).optional(),
  scopeRef: z.string().max(64).optional(),
  state: z.enum(RulesPackageStates).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const ValidateSettingsBodySchema = z.object({ settings: OrganizerSettingsBase() });

export const RulesTransitionSchema = z.object({
  transition: z.enum(['submit_for_review', 'return_to_draft', 'publish', 'withdraw']),
  note: z.string().max(2000).nullable().default(null),
  expectedVersion: z.number().int(),
});

export const AmendmentSchema = z.object({
  newVersion: z.string().min(1).max(40),
  reason: z.string().min(5).max(2000),
  impactAssessment: z.string().min(5).max(4000),
  reacceptRequired: z.boolean(),
  clauses: z.array(ClauseSchema).max(500),
  sourceUrl: z.string().url().max(500).nullable().optional(),
  translationFa: RulesPackageCreateSchema.shape.translationFa.optional(),
});

export const RulesAcceptanceSchema = z.object({ packageId: z.string(), context: z.object({ eventId: z.string().nullable().default(null), participationId: z.string().nullable().default(null) }).default({ eventId: null, participationId: null }) });

/** Organizer settings derived from a package: every configurable value must sit inside its allowed bounds (BASE-009, RULE-010). */
export const OrganizerSettingsSchema = z.object({ packageId: z.string(), settings: OrganizerSettingsBase() });

export const RulesReviewReminderSchema = z.object({
  packageId: z.string(),
  gameId: z.string(),
  title: z.string(),
  version: z.string(),
  reason: z.enum(['monthly_review_due', 'pre_rated_event']),
  dueAt: z.string(),
  eventId: z.string().nullable(),
});
