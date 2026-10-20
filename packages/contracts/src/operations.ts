import { z } from 'zod';
import { UtcInstantSchema } from './time.js';

/** ESP-04 request contracts: draw/structure, results hook, schedule, room/selection/run, servers, LAN. */
const Id = z.string().min(1).max(64);
const Reason = z.string().min(5).max(2000);
const Instant = UtcInstantSchema;
const RuleValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()])), z.null()]);

export const StageSettingsSchema = z.object({
  settings: z.record(z.string(), RuleValue).optional(),
  overrides: z.array(z.object({ label: z.string().min(1).max(80), match: z.object({ bracket: z.string().max(10).optional(), round: z.number().int().min(1).optional(), slotKey: z.string().max(40).optional() }), values: z.record(z.string(), RuleValue) })).max(20).optional(),
  phases: z.array(z.object({ key: z.string().min(1).max(40), format: z.enum(['single_elim', 'double_elim', 'round_robin', 'groups', 'swiss', 'multi_lobby', 'record', 'time_trial']), advance: z.object({ perGroup: z.number().int().min(1).optional(), bestRemaining: z.number().int().min(0).optional(), top: z.number().int().min(1).optional() }).nullable() })).max(5).optional(),
  expectedVersion: z.number().int(),
});

const DrawAttr = z.object({ seed: z.number().int().min(1).nullable().optional(), rank: z.number().int().min(1).nullable().optional(), qualifierRank: z.number().int().min(1).nullable().optional(), pot: z.number().int().min(1).nullable().optional(), region: z.string().max(60).nullable().optional(), club: z.string().max(80).nullable().optional() });
export const DrawPreviewSchema = z.object({ method: z.enum(['manual', 'random', 'ranking', 'qualifier']), attributes: z.record(z.string(), DrawAttr).optional() });
export const RedrawSchema = DrawPreviewSchema.extend({ reason: Reason });
export const OffsetPageSchema = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(50) });
export const BracketQuerySchema = OffsetPageSchema.extend({ bracket: z.string().max(10).optional(), round: z.coerce.number().int().min(1).optional() });
export const StandingsQuerySchema = OffsetPageSchema.extend({ group: z.string().max(10).optional() });
export const ChallengeSchema = z.object({ challenger: Id, defender: Id });
export const WithdrawalSchema = z.object({ participationId: Id, reason: Reason });
export const TransferSchema = z.object({ fromStageId: Id });

const Pair = z.tuple([z.number().int().min(0), z.number().int().min(0)]);
export const MatchOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('win'), winnerSide: z.union([z.literal(0), z.literal(1)]), scores: Pair.nullable().default(null), maps: Pair.nullable().default(null), forfeit: z.literal(false).default(false), reason: z.null().default(null) }),
  z.object({ kind: z.literal('draw'), scores: Pair.nullable().default(null), maps: Pair.nullable().default(null) }),
  z.object({ kind: z.literal('placements'), placements: z.array(z.object({ id: Id, placement: z.number().int().min(1), kills: z.number().int().min(0) })).min(2).max(200) }),
  z.object({ kind: z.literal('attempts'), attempts: z.array(z.object({ attempt: z.number().int().min(1), value: z.string().max(40).nullable(), timeMs: z.number().int().min(0).nullable(), penaltyMs: z.number().int().min(0), dnf: z.boolean(), at: Instant })).min(1).max(50) }),
]);
export const ResultSubmitSchema = z.object({ outcome: MatchOutcomeSchema, evidenceFileIds: z.array(Id).max(10).default([]), units: z.array(z.object({ order: z.number().int().min(1).max(50), kind: z.enum(['map', 'set', 'round', 'attempt', 'lobby_round']), label: z.string().min(1).max(60), values: z.record(z.string(), z.unknown()) })).max(20).default([]) });
export const ResultFinalizeSchema = z.object({ outcome: MatchOutcomeSchema.nullable().default(null) });

const Window = z.object({ from: Instant, to: Instant });
export const ScheduleConfigSchema = z.object({
  windows: z.array(Window).max(100),
  defaultDurationMinutes: z.number().int().min(1).max(1440),
  bufferMinutes: z.number().int().min(0).max(600),
  minRestMinutes: z.number().int().min(0).max(1440),
  broadcastWindows: z.array(Window.extend({ label: z.string().max(80) })).max(100),
  unavailable: z.array(Window.extend({ participationId: Id, reason: z.string().min(2).max(300) })).max(500),
});
export const SetTimeSchema = z.object({ at: Instant, durationMinutes: z.number().int().min(1).max(1440).optional(), stationId: Id.nullable().optional(), serverId: Id.nullable().optional(), refereeIds: z.array(Id).max(10).optional(), confirmed: z.boolean(), broadcast: z.boolean().optional(), reason: z.string().min(2).max(500), override: z.boolean().optional() });
export const AutoScheduleSchema = z.object({ stageId: Id.optional(), from: Instant, reason: z.string().min(2).max(500) });
export const BulkShiftSchema = z.object({ matchIds: z.array(Id).min(1).max(500), minutes: z.number().int().min(-10080).max(10080), reason: z.string().min(2).max(500) });
export const DelaySchema = z.object({ minutes: z.number().int().min(1).max(1440), reason: z.string().min(2).max(500) });
export const ApplyProposalSchema = z.object({ confirm: z.boolean(), override: z.boolean().optional(), reason: z.string().max(500).optional() });
export const RescheduleRequestSchema = z.object({ proposedAt: Instant, reason: Reason });
export const RescheduleDecisionSchema = z.object({ approve: z.boolean(), note: z.string().max(500).default('') });

export const ChatSchema = z.object({ text: z.string().min(1).max(1000), channel: z.enum(['private', 'officials']).default('private') });
export const RefereeCallSchema = z.object({ reason: z.string().min(3).max(500) });
export const RefereeCallUpdateSchema = z.object({ state: z.enum(['acknowledged', 'closed']) });
export const ManualLobbySchema = z.object({ host: z.string().min(1).max(200), password: z.string().min(4).max(100) });
export const SelectionActSchema = z.object({ step: z.number().int().min(0), value: z.string().min(1).max(80) });
export const PauseSchema = z.object({ kind: z.enum(['tactical', 'technical']), side: z.number().int().min(0).max(1).nullable().default(null), reason: z.string().min(2).max(300) });
export const DisconnectSchema = z.object({ side: z.number().int().min(0).max(1) });
export const RunDecisionSchema = z.object({ decision: z.enum(['continue', 'replay', 'restore', 'forfeit_map', 'forfeit_match']), reason: Reason });
export const DeviceSwapSchema = z.object({ side: z.number().int().min(0).max(1), note: z.string().min(2).max(300) });
export const SurrenderSchema = z.object({ reason: z.string().min(2).max(300) });
export const SanctionSchema = z.object({ type: z.enum(['delay', 'expel', 'forfeit', 'double_forfeit']), side: z.number().int().min(0).max(1).nullable().default(null), principalId: Id.nullable().default(null), reason: Reason });
export const IncidentSchema = z.object({ kind: z.enum(['game_update', 'internet_outage', 'infrastructure', 'venue']), disciplineIds: z.array(Id).max(20).nullable().default(null), publicNotice: z.string().min(5).max(500), internalNote: z.string().max(2000).nullable().default(null), delayMinutes: z.number().int().min(0).max(1440), newGameVersion: z.string().max(40).nullable().default(null) });
export const IncidentResolveSchema = z.object({ resume: z.boolean(), note: z.string().max(2000).default('') });
export const ReviewResolveSchema = z.object({ resolution: Reason });

export const ServerCreateSchema = z.object({ gameId: Id, name: z.string().min(1).max(80), region: z.string().min(1).max(40), kind: z.enum(['dedicated', 'lobby', 'lan_host']), connection: z.object({ host: z.string().min(1).max(200), port: z.number().int().min(1).max(65535).nullable() }), capacity: z.number().int().min(1).max(1000), enabled: z.boolean().default(true), configTemplate: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}) });
export const ServerHealthSchema = z.object({ health: z.enum(['healthy', 'degraded', 'down', 'unknown']), enabled: z.boolean() });
export const AllocateSchema = z.object({ serverId: Id.nullable().default(null), reason: z.string().min(2).max(300) });
export const SwitchServerSchema = z.object({ toServerId: Id.nullable().default(null), reason: Reason });
export const IngestSchema = z.object({ kind: z.enum(['result', 'log', 'demo']), raw: z.record(z.string(), z.unknown()), fileId: Id.nullable().default(null) });

export const VenueSchema = z.object({ name: z.string().min(2).max(120), addressText: z.string().min(5).max(500), directions: z.string().max(1000).nullable().default(null), parking: z.string().max(500).nullable().default(null), attendanceGuide: z.string().max(2000).nullable().default(null), mapUrl: z.string().url().max(500).nullable().default(null), areas: z.array(z.object({ key: z.string().regex(/^[a-z0-9_-]{1,30}$/), name: z.string().min(1).max(80), kind: z.enum(['hall', 'stage', 'warmup', 'media', 'audience']), capacity: z.number().int().min(1).max(100000) })).min(1).max(30) });
export const StationSchema = z.object({ areaKey: z.string().max(30), label: z.string().min(1).max(40) });
export const ChecklistSchema = z.object({ items: z.array(z.object({ item: z.string().min(1).max(120), ok: z.boolean() })).min(1).max(40) });
export const FaultSchema = z.object({ note: z.string().min(2).max(500) });
export const AssignStationSchema = z.object({ stationId: Id, reason: z.string().min(2).max(300) });
export const EquipmentSchema = z.object({ label: z.string().min(1).max(80), kind: z.string().min(1).max(40), serial: z.string().max(80).nullable().default(null) });
export const LoanSchema = z.object({ to: Id, condition: z.string().min(2).max(200) });
export const ReturnSchema = z.object({ condition: z.string().min(2).max(200), faulty: z.boolean().default(false) });
export const PersonalEquipmentSchema = z.object({ item: z.string().min(2).max(120) });
export const DecisionNoteSchema = z.object({ approve: z.boolean(), note: z.string().max(500).default('') });
export const CredentialSchema = z.object({ principalId: Id, role: z.enum(['player', 'coach', 'media', 'staff', 'spectator']), areas: z.array(z.string().max(30)).max(30).nullable().default(null) });
export const AdmitSchema = z.object({ qr: z.string().min(8).max(200), gate: z.string().min(1).max(40), area: z.string().min(1).max(30) });
export const TicketAdmitSchema = z.object({ code: z.string().min(6).max(64), gate: z.string().min(1).max(40), area: z.string().min(1).max(30) });
export const CallupStateSchema = z.object({ state: z.enum(['at_station', 'ready']) });
export const OfflineDecisionSchema = z.object({ decisions: z.array(z.object({ row: z.number().int().min(2), apply: z.boolean() })).min(1).max(1000) });
