import { z } from 'zod';

/**
 * Chapter 6.1 — game catalog (GAME-001..006) and game modules.
 * Readiness is tracked per (version, platform, mode); a title is never "fully supported" by name alone.
 */
export const GameStates = ['proposed', 'under_review', 'ready', 'suspended', 'archived'] as const;
export type GameState = (typeof GameStates)[number];

export const CompetitionFamilies = ['head_to_head', 'team', 'multi_lobby', 'record', 'time_trial', 'score'] as const;
export type CompetitionFamily = (typeof CompetitionFamilies)[number];

export const CapabilityStatuses = ['supported', 'limited', 'unsupported', 'unknown'] as const;
export const CapabilitySchema = z.object({ status: z.enum(CapabilityStatuses), detail: z.string().max(500).nullable().default(null) });
export const CapabilityMatrixSchema = z.object({
  api: CapabilitySchema,
  antiCheat: CapabilitySchema,
  stats: CapabilitySchema,
  replay: CapabilitySchema,
  dedicatedServer: CapabilitySchema,
});
const unknownCap = { status: 'unknown' as const, detail: null };
export const defaultCapabilities = { api: unknownCap, antiCheat: unknownCap, stats: unknownCap, replay: unknownCap, dedicatedServer: unknownCap };

export const GameReferenceSchema = z.object({ title: z.string().min(1).max(200), url: z.string().url().max(500), kind: z.enum(['publisher', 'federation', 'league', 'other']), retrievedAt: z.string() });

export const GameCreateSchema = z.object({
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(120),
  publisher: z.string().min(1).max(120),
  releasePeriod: z.string().max(40).nullable().default(null),
  platforms: z.array(z.string().min(1).max(40)).min(1).max(20),
  modes: z.array(z.string().min(1).max(40)).min(1).max(30),
  regions: z.array(z.string().min(1).max(40)).max(30).default([]),
  family: z.enum(CompetitionFamilies),
  moduleId: z.string().min(1).max(64),
  references: z.array(GameReferenceSchema).max(20).default([]),
  capabilities: CapabilityMatrixSchema.default(defaultCapabilities),
  logoFileId: z.string().nullable().default(null),
});
export const GameUpdateSchema = GameCreateSchema.omit({ slug: true }).partial().extend({ expectedVersion: z.number().int() });

export const GameStateTransitionSchema = z.object({
  to: z.enum(GameStates),
  reason: z.string().min(1).max(1000),
  /** Evidence (reference + review date) is mandatory to reach `ready` (GAME-002). */
  evidence: z.object({ referenceUrl: z.string().url(), reviewedAt: z.string(), note: z.string().max(1000).nullable().default(null) }).optional(),
  expectedVersion: z.number().int(),
});

export const ReadinessStates = ['not_ready', 'ready', 'suspended'] as const;
export const ReadinessUpsertSchema = z.object({
  version: z.string().min(1).max(40),
  platform: z.string().min(1).max(40),
  mode: z.string().min(1).max(40),
  state: z.enum(ReadinessStates),
  evidence: z.string().max(1000).nullable().default(null),
});

/** Public shape of a game module's contract for the UI and the validation tool. */
export const GameModuleDescriptorSchema = z.object({
  id: z.string(),
  family: z.enum(CompetitionFamilies),
  label: z.string(),
  testOnly: z.boolean(),
  resultFields: z.array(z.object({ key: z.string(), type: z.enum(['int', 'number', 'string', 'boolean', 'duration_ms']), required: z.boolean(), description: z.string() })),
  scoringModel: z.string(),
  tieBreakOrder: z.array(z.string()),
});
export type GameModuleDescriptor = z.infer<typeof GameModuleDescriptorSchema>;

export const GameFilterSchema = z.object({ state: z.enum(GameStates).optional(), family: z.enum(CompetitionFamilies).optional(), platform: z.string().optional(), q: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

export const ModuleValidateSchema = z.object({ values: z.unknown() });
