import type { Collection, Db } from 'mongodb';
import type { Plan, SlotSource } from '../competition/engine/types.js';

/**
 * ESP-04 collections: draws and stage structures (FMT/DRAW), schedule changes and proposals (SCH), pre-game
 * selections (CFG), match room (ROOM), game servers and integration provenance (SRV), live run log (RUN),
 * venues/stations/equipment/credentials/admissions and offline imports (LAN). Times are UTC ISO strings.
 */

// ---------------------------------------------------------------- draw and structure (DRAW-001..003, FMT)
export interface DrawEntrantSnapshot {
  participationId: string;
  displayName: string;
  seed: number | null;
  rank: number | null;
  qualifierRank: number | null;
  pot: number | null;
  region: string | null;
  club: string | null;
  /** where each attribute came from (organizer input, team organization, stage transfer …) */
  provenance: Record<string, string>;
}
export interface DrawDoc {
  _id: string;
  stageId: string;
  eventId: string;
  number: number; // 1, 2, … per stage; a redraw creates the next number
  method: 'manual' | 'random' | 'ranking' | 'qualifier';
  separateBy: 'none' | 'region' | 'club';
  groupCount: number | null;
  /** random seed string: replaying the same input with it reproduces the outcome exactly */
  seedString: string;
  engine: string;
  input: DrawEntrantSnapshot[];
  outcome: { order: string[]; groups: Record<string, string[]> | null; explanations: string[] };
  state: 'preview' | 'confirmed' | 'locked' | 'published' | 'superseded';
  reason: string | null; // required for a redraw
  supersedes: string | null;
  history: Array<{ at: string; by: string; action: string; note: string | null }>;
  createdBy: string;
  createdAt: string;
  version: number;
}

export interface StageStructureDoc {
  _id: string; // = stageId
  eventId: string;
  disciplineId: string;
  format: string;
  drawId: string | null;
  rulesHash: string;
  ruleValues: Record<string, unknown>;
  plan: Plan;
  seeds: string[]; // participationIds in seed order (index 0 = seed 1)
  groups: Record<string, string[]> | null;
  /** swiss/lobby rounds generated so far, ladder order, mixed phase pointer */
  progress: { round: number; phase: number; ladder: string[] | null; byes: Record<string, string>; explanations: Record<string, string[]> };
  withdrawn: Array<{ participationId: string; at: string; by: string; reason: string }>;
  state: 'active' | 'complete';
  standings: { computedAt: string; rows: Array<{ id: string; rank: number; group?: string; unresolvedTie: boolean; metrics: Record<string, number> }>; needsReview: string | null } | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** STG-002: entrants of a linked stage, one per participation, with the origin that qualified them. */
export interface StageEntryDoc {
  _id: string;
  stageId: string;
  participationId: string;
  origin: { kind: 'stage_rank' | 'qualification_slot' | 'direct'; ref: string; rank: number | null };
  createdBy: string;
  createdAt: string;
}

// ---------------------------------------------------------------- match additions
export type MatchOutcome =
  | { kind: 'win'; winnerSide: 0 | 1; scores: [number, number] | null; maps: [number, number] | null; forfeit: boolean; reason: string | null }
  | { kind: 'draw'; scores: [number, number] | null; maps: [number, number] | null }
  | { kind: 'double_forfeit'; reason: string | null }
  | { kind: 'placements'; placements: Array<{ id: string; placement: number; kills: number }> }
  | { kind: 'attempts'; attempts: Array<{ attempt: number; value: string | null; timeMs: number | null; penaltyMs: number; dnf: boolean; at: string }> };

export interface MatchConfig {
  gameVersion: string;
  mode: string;
  serverRegion: string | null;
  inputDevices: string[];
  crossplay: boolean | null;
  bestOf: number;
  roundsPerMap: number | null;
  overtime: string | null;
  drawAllowed: boolean;
  replayRule: string | null;
  winCondition: string | null;
  mapPool: string[];
  vetoSequence: string[]; // e.g. ['ban:0','ban:1','pick:0','pick:1','side:0','decider']
  turnSeconds: number | null;
  timeoutAction: 'pool_order_first' | 'pool_order_last' | 'referee' | null;
  sideRule: string | null;
  characterBans: number;
  restrictions: string[];
  pauses: { tacticalPerSide: number | null; tacticalSeconds: number | null; technicalPerSide: number | null; technicalSeconds: number | null };
  disconnect: { returnSeconds: number | null; onExpiry: 'forfeit_map' | 'forfeit_match' | 'referee' | 'continue_short' | null };
  /** clause keys that were missing: the room shows them and an official decides */
  undecided: string[];
  source: { rulesHash: string; stageId: string; override: string | null };
}

// ---------------------------------------------------------------- schedule (SCH)
/** SCH-001/003: organizer scheduling parameters per event (allowed windows, durations, rest, broadcast slots, availability). */
export interface ScheduleConfigDoc {
  _id: string; // = eventId
  windows: Array<{ from: string; to: string }>;
  defaultDurationMinutes: number;
  bufferMinutes: number;
  minRestMinutes: number;
  broadcastWindows: Array<{ from: string; to: string; label: string }>;
  unavailable: Array<{ participationId: string; from: string; to: string; reason: string }>;
  updatedBy: string;
  updatedAt: string;
  version: number;
}
export interface ScheduleProposalDoc {
  _id: string;
  eventId: string;
  kind: 'auto' | 'bulk_shift' | 'delay' | 'reschedule' | 'disruption';
  reason: string;
  changes: Array<{ matchId: string; from: string | null; to: string; stationId?: string | null; serverId?: string | null; refereeIds?: string[] }>;
  conflicts: Array<{ matchId: string; kind: string; hard: boolean; detail: string }>;
  state: 'draft' | 'applied' | 'rejected' | 'superseded';
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  version: number;
}
export interface RescheduleRequestDoc {
  _id: string;
  matchId: string;
  eventId: string;
  requestedBy: string;
  requestedSide: number;
  proposedAt: string;
  reason: string;
  opponentAgreed: { by: string; at: string } | null;
  state: 'open' | 'agreed' | 'approved' | 'rejected' | 'withdrawn';
  decidedBy: string | null;
  note: string | null;
  createdAt: string;
  version: number;
}

// ---------------------------------------------------------------- pre-game selections (CFG-003/004)
export interface SelectionDoc {
  _id: string; // = matchId
  matchId: string;
  sequence: string[];
  pool: string[];
  step: number;
  actions: Array<{ step: number; kind: string; side: number | null; value: string; by: string; at: string; via: 'player' | 'timeout' | 'referee' }>;
  turnDeadline: string | null;
  timeoutAction: MatchConfig['timeoutAction'];
  state: 'active' | 'complete' | 'waiting_referee';
  createdAt: string;
  version: number;
}

// ---------------------------------------------------------------- room and run (ROOM, RUN)
export interface MatchMessageDoc {
  _id: string;
  matchId: string;
  channel: 'private' | 'officials';
  by: string;
  text: string;
  at: string;
  hidden: boolean;
}
export interface RefereeCallDoc {
  _id: string;
  matchId: string;
  eventId: string;
  by: string;
  reason: string;
  state: 'open' | 'acknowledged' | 'closed';
  ackBy: string | null;
  createdAt: string;
  closedAt: string | null;
}
export interface MatchEventDoc {
  _id: string;
  matchId: string;
  eventId: string;
  seq: number;
  type: string; // start | pause | resume | disconnect | reconnect | device_swap | surrender | withdraw | expel | forfeit | replay | restore | delay | finish | ready | note
  side: number | null;
  detail: Record<string, unknown>;
  by: string;
  at: string;
  /** only safe summaries are public (RUN-006) */
  publicText: string | null;
}

// ---------------------------------------------------------------- servers and integrations (SRV)
export interface GameServerDoc {
  _id: string;
  eventId: string | null; // null = platform pool
  gameId: string;
  name: string;
  region: string;
  kind: 'dedicated' | 'lobby' | 'lan_host';
  /** private connection data, never in public projections */
  connection: { host: string; port: number | null };
  capacity: number;
  inUse: number;
  health: 'healthy' | 'degraded' | 'down' | 'unknown';
  healthCheckedAt: string | null;
  enabled: boolean;
  configTemplate: Record<string, string | number | boolean>;
  createdAt: string;
  version: number;
}
export interface ServerAllocationDoc {
  _id: string;
  serverId: string;
  matchId: string;
  eventId: string;
  password: string; // lobby password; released per ROOM-004
  state: 'active' | 'released';
  reason: string;
  by: string;
  at: string;
  releasedAt: string | null;
}
export interface IntegrationRecordDoc {
  _id: string;
  matchId: string;
  source: string; // adapter name
  kind: 'result' | 'log' | 'demo';
  raw: Record<string, unknown>;
  rawHash: string;
  fileId: string | null;
  receivedAt: string;
  comparedWithManual: 'match' | 'mismatch' | 'pending';
}
export interface ReviewItemDoc {
  _id: string;
  eventId: string;
  kind: 'integration_mismatch' | 'offline_conflict' | 'schedule_hard_conflict' | 'rule_missing' | 'tie_unresolved';
  ref: { type: string; id: string };
  detail: Record<string, unknown>;
  state: 'open' | 'resolved';
  resolution: string | null;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

// ---------------------------------------------------------------- disruption (RUN-005)
export interface IncidentDoc {
  _id: string;
  eventId: string;
  kind: 'game_update' | 'internet_outage' | 'infrastructure' | 'venue';
  scope: { disciplineIds: string[] | null; matchIds: string[] };
  publicNotice: string;
  internalNote: string | null;
  state: 'active' | 'resolved';
  pausedMatchIds: string[];
  proposalId: string | null;
  openedBy: string;
  openedAt: string;
  resolvedAt: string | null;
}

// ---------------------------------------------------------------- LAN (LAN-001..007)
export interface VenueDoc {
  _id: string;
  eventId: string;
  name: string;
  addressText: string;
  directions: string | null;
  parking: string | null;
  attendanceGuide: string | null;
  mapUrl: string | null;
  areas: Array<{ key: string; name: string; kind: 'hall' | 'stage' | 'warmup' | 'media' | 'audience'; capacity: number }>;
  createdAt: string;
  version: number;
}
export interface StationDoc {
  _id: string;
  eventId: string;
  venueId: string;
  areaKey: string;
  label: string;
  state: 'ready' | 'in_use' | 'faulty' | 'maintenance';
  matchId: string | null;
  checklist: Array<{ item: string; ok: boolean; by: string; at: string }>;
  faults: Array<{ at: string; by: string; note: string; resolvedAt: string | null }>;
  version: number;
}
export interface EquipmentDoc {
  _id: string;
  eventId: string;
  label: string;
  kind: string;
  serial: string | null;
  state: 'available' | 'loaned' | 'faulty' | 'retired';
  loan: { to: string; at: string; by: string; condition: string } | null;
  history: Array<{ at: string; by: string; action: 'loan' | 'return' | 'fault' | 'repair'; to: string | null; note: string | null }>;
  version: number;
}
export interface PersonalEquipmentDoc {
  _id: string;
  eventId: string;
  principalId: string;
  item: string;
  state: 'pending' | 'approved' | 'rejected';
  decidedBy: string | null;
  note: string | null;
  createdAt: string;
}
export interface AccessCredentialDoc {
  _id: string;
  eventId: string;
  principalId: string;
  role: 'player' | 'coach' | 'media' | 'staff' | 'spectator';
  areas: string[];
  state: 'active' | 'revoked';
  /** rotating QR token: a scanned token is consumed atomically and can never be replayed */
  token: string;
  tokenIssuedAt: string;
  issuedBy: string;
  createdAt: string;
  version: number;
}
export interface AdmissionDoc {
  _id: string;
  eventId: string;
  kind: 'credential' | 'ticket';
  ref: string;
  token: string;
  gate: string;
  area: string | null;
  principalId: string | null;
  by: string;
  at: string;
  direction: 'in' | 'out';
}
export interface CallupDoc {
  _id: string; // = matchId
  eventId: string;
  stationIds: string[];
  state: 'called' | 'at_station' | 'ready';
  calledAt: string;
  by: string;
}
export interface OfflineImportDoc {
  _id: string;
  eventId: string;
  procedureNo: string; // numbered emergency procedure / paper form reference
  kind: 'attendance' | 'result';
  rows: Array<{ row: number; data: Record<string, string>; status: 'pending' | 'applied' | 'conflict' | 'rejected'; conflict: string | null; decidedBy: string | null }>;
  createdBy: string;
  createdAt: string;
  state: 'pending' | 'partially_applied' | 'applied';
}

export interface Esp04Collections {
  draws: Collection<DrawDoc>;
  stageStructures: Collection<StageStructureDoc>;
  stageEntries: Collection<StageEntryDoc>;
  scheduleConfigs: Collection<ScheduleConfigDoc>;
  scheduleProposals: Collection<ScheduleProposalDoc>;
  rescheduleRequests: Collection<RescheduleRequestDoc>;
  selections: Collection<SelectionDoc>;
  matchMessages: Collection<MatchMessageDoc>;
  refereeCalls: Collection<RefereeCallDoc>;
  matchEvents: Collection<MatchEventDoc>;
  gameServers: Collection<GameServerDoc>;
  serverAllocations: Collection<ServerAllocationDoc>;
  integrationRecords: Collection<IntegrationRecordDoc>;
  reviewItems: Collection<ReviewItemDoc>;
  incidents: Collection<IncidentDoc>;
  venues: Collection<VenueDoc>;
  stations: Collection<StationDoc>;
  equipment: Collection<EquipmentDoc>;
  personalEquipment: Collection<PersonalEquipmentDoc>;
  accessCredentials: Collection<AccessCredentialDoc>;
  admissions: Collection<AdmissionDoc>;
  callups: Collection<CallupDoc>;
  offlineImports: Collection<OfflineImportDoc>;
}

export const esp04CollectionNames = {
  draws: 'draws',
  stageStructures: 'stage_structures',
  stageEntries: 'stage_entries',
  scheduleConfigs: 'schedule_configs',
  scheduleProposals: 'schedule_proposals',
  rescheduleRequests: 'reschedule_requests',
  selections: 'match_selections',
  matchMessages: 'match_messages',
  refereeCalls: 'referee_calls',
  matchEvents: 'match_events',
  gameServers: 'game_servers',
  serverAllocations: 'server_allocations',
  integrationRecords: 'integration_records',
  reviewItems: 'review_items',
  incidents: 'incidents',
  venues: 'venues',
  stations: 'stations',
  equipment: 'equipment',
  personalEquipment: 'personal_equipment',
  accessCredentials: 'access_credentials',
  admissions: 'admissions',
  callups: 'callups',
  offlineImports: 'offline_imports',
} as const satisfies Record<keyof Esp04Collections, string>;

export function esp04Collections(db: Db): Esp04Collections {
  const out = {} as Record<string, Collection>;
  for (const [k, name] of Object.entries(esp04CollectionNames)) out[k] = db.collection(name);
  return out as unknown as Esp04Collections;
}

/** Match fields added in ESP-04 (optional so earlier documents stay valid; migration 0008 backfills). */
export interface MatchEsp04Fields {
  slot?: { key: string; bracket: string; round: number; order: number; group: string | null; leg: number | null; conditional: 'reset' | null; sources: SlotSource[] } | null;
  participantIds?: string[];
  principalIds?: string[];
  outcome?: MatchOutcome | null;
  config?: MatchConfig | null;
  schedule?: { durationMinutes: number; bufferMinutes: number; confirmed: boolean; broadcast: boolean; history: Array<{ at: string; by: string; from: string | null; to: string | null; reason: string }> };
  resources?: { stationId: string | null; serverId: string | null; refereeIds: string[] };
  room?: { ready: Array<{ side: number; by: string; at: string }>; countdownTo: string | null; publicNotice: string | null };
  run?: { startedAt: string | null; endedAt: string | null; pauses: Array<{ side: number | null; kind: 'tactical' | 'technical'; at: string; until: string | null; by: string }>; disconnect: { side: number; at: string; deadline: string } | null };
  cancelReason?: string | null;
}
