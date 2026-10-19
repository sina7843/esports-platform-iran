import { z } from 'zod';
import { UtcInstantSchema } from './time.js';
import { RialSchema } from './money.js';

/** Chapter 7.1–7.5: event setup, stages and links, registration, roster, check-in (EVT, STG, REG, ROS, CHK). */

const Instant = UtcInstantSchema;
const NullableInstant = UtcInstantSchema.nullable();
export const Presence = z.enum(['online', 'offline', 'hybrid']);
export const Visibility = z.enum(['public', 'private', 'invite', 'link_only']);

export const PrizeInputSchema = z.object({
  key: z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/),
  title: z.string().min(1).max(120),
  kind: z.enum(['cash', 'non_cash']),
  amountRial: RialSchema.default(0),
  description: z.string().max(500).nullable().default(null),
  responsible: z.enum(['platform', 'organizer', 'sponsor']),
  responsibleName: z.string().max(120).nullable().default(null),
});

export const RefundPolicySchema = z.object({
  beforeDeadlinePercent: z.number().int().min(0).max(100),
  afterDeadlinePercent: z.number().int().min(0).max(100),
  onEventCancelPercent: z.number().int().min(0).max(100),
  onDisqualificationPercent: z.number().int().min(0).max(100),
  text: z.string().min(5).max(4000),
});

export const EventCreateSchema = z.object({
  organizerOrgId: z.string().min(1).max(64),
  name: z.string().min(2).max(160),
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/),
  visibility: Visibility.default('public'),
  timeZone: z.string().max(64).default('Asia/Tehran'),
  startsAt: NullableInstant.default(null),
  endsAt: NullableInstant.default(null),
  description: z.string().max(10000).nullable().default(null),
  posterFileId: z.string().nullable().default(null),
  presence: Presence.default('online'),
  regions: z.array(z.string().max(60)).max(30).default([]),
  language: z.string().max(10).default('fa'),
  contact: z.string().max(300).nullable().default(null),
  rated: z.boolean().default(false),
  prizes: z.array(PrizeInputSchema).max(50).default([]),
  refundPolicy: RefundPolicySchema.nullable().default(null),
  cancellationTerms: z.string().max(4000).nullable().default(null),
  disputeTerms: z.string().max(4000).nullable().default(null),
  isTemplate: z.boolean().default(false),
  seasonId: z.string().nullable().default(null),
});
export const EventUpdateSchema = EventCreateSchema.omit({ organizerOrgId: true }).partial().extend({ expectedVersion: z.number().int() });
export const EventScheduleSchema = z.object({ publishAt: Instant, expectedVersion: z.number().int() });
export const EventDuplicateSchema = z.object({ slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/), name: z.string().min(2).max(160), asTemplate: z.boolean().default(false) });

const FormFieldSchema = z.object({
  key: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/),
  label: z.string().min(1).max(120),
  type: z.enum(['text', 'number', 'select', 'checkbox']),
  required: z.boolean().default(false),
  options: z.array(z.string().max(80)).max(50).nullable().default(null),
  private: z.boolean().default(true),
});
const QuotaSchema = z.object({ kind: z.enum(['public', 'invite', 'qualifier', 'organization']), size: z.number().int().min(0).max(100000), ref: z.string().nullable().default(null) });
const CheckinConfigSchema = z.object({
  opensMinutesBefore: z.number().int().min(0).max(10080),
  closesMinutesBefore: z.number().int().min(0).max(10080),
  graceMinutes: z.number().int().min(0).max(1440),
  policy: z.enum(['captain', 'all_members', 'min_members']),
  minMembers: z.number().int().min(1).max(100).nullable().default(null),
});

export const DisciplineCreateSchema = z.object({
  name: z.string().min(1).max(120),
  gameId: z.string().min(1).max(64),
  gameVersion: z.string().min(1).max(40),
  platform: z.string().min(1).max(40),
  mode: z.string().min(1).max(40),
  rulesPackageId: z.string().nullable().default(null),
  participantKind: z.enum(['team', 'player']),
  capacity: z.number().int().min(1).max(100000),
  minParticipants: z.number().int().min(0).max(100000).default(0),
  feeRial: RialSchema.default(0),
  registrationOpensAt: NullableInstant.default(null),
  registrationClosesAt: NullableInstant.default(null),
  lateRegistrationUntil: NullableInstant.default(null),
  editDeadline: NullableInstant.default(null),
  withdrawalDeadline: NullableInstant.default(null),
  paymentWindowMinutes: z.number().int().min(5).max(1440).default(30),
  autoApprove: z.boolean().default(false),
  quotas: z.array(QuotaSchema).max(10).default([]),
  formFields: z.array(FormFieldSchema).max(30).default([]),
  requiredDocuments: z.array(z.object({ key: z.string().min(1).max(40), label: z.string().min(1).max(120), retentionClass: z.string().min(1).max(40) })).max(10).default([]),
  checkin: CheckinConfigSchema.nullable().default(null),
  seasonChangeCap: z.number().int().min(0).max(100).nullable().default(null),
  presence: Presence.default('online'),
  regions: z.array(z.string().max(60)).max(30).default([]),
});
export const DisciplineUpdateSchema = DisciplineCreateSchema.omit({ gameId: true }).partial().extend({ expectedVersion: z.number().int() });

export const StageLinkSchema = z.object({
  fromStageId: z.string().nullable(),
  kind: z.enum(['qualifier', 'invite', 'seed', 'quota']),
  slots: z.number().int().min(1).max(10000),
  points: z.enum(['carry', 'reset', 'factor']),
  factor: z.number().min(0).max(10).nullable().default(null),
});
export const StageCreateSchema = z.object({
  name: z.string().min(1).max(120),
  order: z.number().int().min(1).max(100),
  format: z.enum(['single_elim', 'double_elim', 'round_robin', 'groups', 'swiss', 'ladder', 'multi_lobby', 'record', 'mixed']),
  presence: Presence.default('online'),
  dependsOnStageIds: z.array(z.string()).max(10).default([]),
  links: z.array(StageLinkSchema).max(20).default([]),
});
export const StageStartExceptionSchema = z.object({ approvalId: z.string(), reason: z.string().min(5).max(1000) });

export const SeasonCreateSchema = z.object({
  gameId: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  from: Instant,
  to: Instant,
  pointsPolicy: z.string().min(1).max(2000),
  nextEventQuotas: z.array(z.object({ targetEventId: z.string(), slots: z.number().int().min(1).max(10000) })).max(20).default([]),
});
export const QualificationSlotCreateSchema = z.object({
  targetStageId: z.string().nullable().default(null),
  source: z.object({ kind: z.enum(['stage', 'event', 'invite', 'season']), ref: z.string().min(1), rank: z.number().int().min(1).nullable().default(null) }),
  holderKey: z.string().regex(/^(team|player):[A-Za-z0-9_]+$/),
  reason: z.string().min(3).max(500),
});
export const EntryCodeCreateSchema = z.object({
  quotaKind: z.enum(['invite', 'organization']),
  holderKey: z.string().regex(/^(team|player):[A-Za-z0-9_]+$/).nullable().default(null),
  maxUses: z.number().int().min(1).max(10000).default(1),
  expiresAt: NullableInstant.default(null),
});

/** EVT-008: official affiliation is a claim with evidence; an independent reviewer decides. */
export const EventAffiliationClaimSchema = z.object({
  kind: z.enum(['publisher_licensed', 'federation_sanctioned', 'official_partner']),
  body: z.string().min(2).max(160),
  evidenceFileId: z.string().min(1).max(64),
});
export const EventAffiliationDecisionSchema = z.object({ decision: z.enum(['verify', 'reject']), note: z.string().min(5).max(1000) });

// ---- registration
export const RegistrationCreateSchema = z.object({
  teamId: z.string().nullable().default(null),
  roster: z.array(z.object({ principalId: z.string().min(1), role: z.enum(['starter', 'substitute', 'coach', 'manager']) })).max(30).default([]),
  formAnswers: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean()])).default({}),
  documentFileIds: z.record(z.string(), z.string()).default({}),
  entryCode: z.string().max(40).nullable().default(null),
  acceptRulesHash: z.string().min(16).max(128),
});
export const RegistrationUpdateSchema = z.object({
  formAnswers: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean()])).optional(),
  documentFileIds: z.record(z.string(), z.string()).optional(),
  expectedVersion: z.number().int(),
});
export const RegistrationDecisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'mark_incomplete', 'remove']),
  reason: z.string().max(2000).nullable().default(null),
  expectedVersion: z.number().int(),
});
export const RegistrationListQuerySchema = z.object({ state: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });

// ---- roster and check-in
export const RosterConfirmSchema = z.object({ decision: z.enum(['confirm', 'decline']) });
export const RosterLockSchema = z.object({ level: z.enum(['event', 'stage', 'match']), ref: z.string().min(1) });
export const SubstitutionSchema = z.object({
  kind: z.enum(['regular', 'between_maps', 'emergency']),
  outPrincipalId: z.string().min(1),
  inPrincipalId: z.string().min(1),
  matchId: z.string().nullable().default(null),
  reason: z.string().max(1000).nullable().default(null),
  approvalId: z.string().nullable().default(null),
});
export const CheckinSchema = z.object({ level: z.enum(['event', 'stage', 'match']), ref: z.string().min(1) });
export const CheckinManualSchema = CheckinSchema.extend({ registrationId: z.string(), outcome: z.enum(['checked_in', 'late', 'no_show', 'excused']), reason: z.string().min(3).max(1000) });
