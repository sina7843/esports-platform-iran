import { z } from 'zod';
import { UtcInstantSchema } from './time.js';
import { MatchOutcomeSchema } from './operations.js';

/** ESP-05 request contracts: results lifecycle, officials, cases, sanctions, integrity, corrections, ranking, honors, close. */
const Id = z.string().min(1).max(64);
const Reason = z.string().min(5).max(2000);
const Text = z.string().min(10).max(5000);
const Files = z.array(Id).max(10).default([]);

export const GameUnitSchema = z.object({ order: z.number().int().min(1).max(50), kind: z.enum(['map', 'set', 'round', 'attempt', 'lobby_round']), label: z.string().min(1).max(60), values: z.record(z.string(), z.unknown()) });
export const ResultUnitsSchema = z.array(GameUnitSchema).max(20).default([]);
export const ContestSchema = z.object({ claim: Text, evidenceFileIds: Files });
export const LineupSchema = z.object({ side: z.number().int().min(0).max(1), principalIds: z.array(Id).max(20) });

export const OfficialAssignSchema = z.object({ matchId: Id.nullable().default(null), principalId: Id, role: z.enum(['referee', 'head_referee', 'appeal_authority']), overrideReason: z.string().max(500).nullable().optional() });

export const CaseFileSchema = z.object({ matchId: Id.nullable().default(null), category: z.enum(['result', 'eligibility', 'conduct', 'cheating', 'schedule', 'other']), claim: Text, evidenceFileIds: Files });
export const CaseAssignSchema = z.object({ assignee: Id });
export const CaseDefenseSchema = z.object({ text: Text, fileIds: Files });
export const EvidenceRequestSchema = z.object({ to: Id, text: Text, dueAt: UtcInstantSchema.nullable().default(null) });
export const EvidenceAnswerSchema = z.object({ answer: Text, fileIds: Files });
export const CaseReportSchema = z.object({ text: Text });
export const CaseAppealSchema = z.object({ text: Text });
const SanctionInput = z.object({
  subject: z.object({ kind: z.enum(['principal', 'team', 'participation']), ref: Id, displayName: z.string().min(1).max(120) }),
  scope: z.object({ kind: z.enum(['match', 'event', 'platform']), id: Id }),
  type: z.enum(['warning', 'point_penalty', 'forfeit', 'disqualification', 'suspension_temporary', 'suspension_permanent']),
  points: z.number().int().min(1).max(1000).nullable().default(null),
  stageId: Id.nullable().default(null),
  until: UtcInstantSchema.nullable().default(null),
  reason: Reason,
  clauseKey: z.string().min(1).max(120),
  caseId: Id.nullable().default(null),
  approvalId: Id.nullable().optional(),
  eventId: Id.nullable().optional(),
});
export const CaseDecisionSchema = z.object({
  clauseKey: z.string().min(1).max(120),
  publicSummary: Text,
  reasoning: Text,
  effect: z.object({ kind: z.enum(['none', 'result_change', 'sanction']), outcome: MatchOutcomeSchema.nullable().optional(), sanctions: z.array(SanctionInput.omit({ caseId: true })).max(5).optional() }),
});
export const DisciplinarySanctionSchema = SanctionInput;
export const SanctionAppealSchema = z.object({ text: Text });
export const SanctionAppealDecisionSchema = z.object({ decision: z.enum(['upheld', 'revoked']) });
export const SanctionRevokeSchema = z.object({ reason: Reason });
export const IntegrityReportSchema = z.object({
  category: z.enum(['cheating', 'alt_account', 'collusion', 'sabotage', 'misconduct']),
  eventId: Id.nullable().default(null),
  matchId: Id.nullable().default(null),
  subjects: z.array(z.object({ kind: z.enum(['principal', 'team']), ref: Id })).min(1).max(10),
  description: Text,
  evidenceFileIds: Files,
});
export const IntegrityStepSchema = z.object({ action: z.enum(['triage', 'investigate', 'refer', 'close']), note: z.string().min(3).max(2000), assignee: Id.nullable().optional(), caseId: Id.nullable().optional(), outcome: z.string().max(500).nullable().optional() });
export const IntegrityRequirementsSchema = z.object({ requireDemo: z.boolean(), antiCheat: z.boolean() });

export const CorrectionPreviewSchema = z.object({ outcome: MatchOutcomeSchema.nullable().default(null) });
export const CorrectionRequestSchema = z.object({ outcome: MatchOutcomeSchema, reason: Reason, approvalId: Id, caseId: Id.nullable().default(null) });
export const ReopenSchema = z.object({ reason: Reason, approvalId: Id });

const GlickoParams = z.object({ initialRating: z.number().min(0).max(5000), initialRd: z.number().gt(0).max(500), initialVolatility: z.number().gt(0).lt(1), tau: z.number().min(0.2).max(1.2), periodDays: z.number().int().min(1).max(365) });
const PointsParams = z.object({ placementPoints: z.array(z.number().int().min(0)).min(1).max(100), killPoints: z.number().int().min(0), source: z.string().min(3).max(300) });
export const RatingSystemSchema = z.object({
  gameId: Id, mode: z.string().min(1).max(40), platform: z.string().max(40).nullable().default(null), subject: z.enum(['player', 'team']), model: z.enum(['glicko2', 'lobby_points']),
  params: z.union([GlickoParams, PointsParams]), seasonId: Id.nullable().default(null), carry: z.object({ kind: z.enum(['reset', 'carry']), factor: z.number().min(0).max(1).nullable() }),
  inactivityDays: z.number().int().min(1).max(3650), tiebreak: z.array(z.string().max(40)).max(5), regionBasis: z.string().min(3).max(300), eventWeights: z.record(z.string(), z.number().gt(0).max(3)), eligibility: z.string().min(3).max(2000),
});
export const RatingReviseSchema = z.object({ params: z.union([GlickoParams, PointsParams]), eventWeights: z.record(z.string(), z.number().gt(0).max(3)).nullable().default(null) });
export const RatingApproveSchema = z.object({ reference: z.string().min(5).max(300) });
export const LeaderboardQuerySchema = z.object({ province: z.string().max(60).optional(), city: z.string().max(60).optional(), from: UtcInstantSchema.optional(), to: UtcInstantSchema.optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(50) });
export const HeadToHeadQuerySchema = z.object({ kind: z.enum(['player', 'team']), a: Id, b: Id });

export const HonorRevokeSchema = z.object({ reason: Text });
export const CertificateCorrectSchema = z.object({ displayName: z.string().min(1).max(120), place: z.number().int().min(1).nullable(), reason: Reason });
export const SpecialAwardSchema = z.object({ title: z.string().min(2).max(80), method: z.enum(['official_selection', 'vote', 'statistics']), approverRole: z.enum(['organizer', 'head_referee']), participationId: Id, principalId: Id.nullable().default(null), justification: Text });
export const SpecialDecisionSchema = z.object({ approve: z.boolean() });
export const DeclareAchievementSchema = z.object({ owner: z.object({ kind: z.enum(['principal', 'team']), ref: Id }), title: z.string().min(3).max(120), eventName: z.string().min(3).max(160), year: z.number().int().min(1990).max(2100).nullable().default(null), evidenceFileIds: Files });
export const DeclaredReviewSchema = z.object({ decision: z.enum(['verified', 'rejected']), note: z.string().max(1000).nullable().default(null) });
export const EventVersionSchema = z.object({ expectedVersion: z.number().int().min(0) });
export const EventCloseSchema = z.object({ expectedVersion: z.number().int().min(0), approvalId: Id.nullable().default(null) });
export const FeedbackSchema = z.object({ score: z.number().int().min(1).max(5), comment: z.string().max(2000).nullable().default(null) });
