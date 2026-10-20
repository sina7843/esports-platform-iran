import type { Db, Collection } from 'mongodb';
import { esp02CollectionNames, esp02Collections, type Esp02Collections } from './collections-esp02.js';
import { esp03CollectionNames, esp03Collections, type Esp03Collections, type EventConfig, type DisciplineConfig, type StageLink } from './collections-esp03.js';
import { esp04CollectionNames, esp04Collections, type Esp04Collections, type MatchEsp04Fields } from './collections-esp04.js';
import type { Grant, OutboxRecord, RealtimeEvent, Scope, Approval, FileRecord, AuditEntry, EventState, MatchState, RegistrationState } from '@esp/contracts';

/**
 * Collection catalog (DATA-001..007). Every document carries `_id` (ULID string), `version` for optimistic
 * concurrency where mutable, and UTC ISO strings for instants. Historical snapshots are embedded, never joined
 * to current profiles (DATA-002, ROS-006, RULE-006).
 */

export interface PrincipalDoc {
  _id: string;
  kind: 'user' | 'service';
  displayName: string;
  locale: 'fa' | 'en';
  timeZone: string;
  /** ESP-02 fills phone/email/identity; ESP-01 keeps the identity surface minimal. */
  status: 'active' | 'suspended' | 'deleted';
  aclVersion: number; // bumped on any grant change → live connections re-evaluate
  deletedAt: string | null;
  anonymizedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  seedLabel?: string;
}

export interface SessionDoc {
  _id: string;
  principalId: string;
  tokenHash: string; // sha256 of the opaque bearer/cookie token; raw token never stored
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  userAgent: string | null;
  ip: string | null;
  /** Second factor proven on this session (USR-009); required by MFA-gated roles when MFA_ENFORCED. */
  mfaVerifiedAt?: string | null;
  /** Last fresh OTP/TOTP re-verification; gates phone/email change and account deletion (10 min). */
  reauthAt?: string | null;
}

export type GrantDoc = Omit<Grant, 'id'> & { _id: string };

export type ApprovalDoc = Omit<Approval, 'id'> & { _id: string };

export type OutboxDoc = Omit<OutboxRecord, 'id'> & { _id: string };

export interface ProcessedEventDoc {
  _id: string; // `${consumer}:${eventId}`
  consumer: string;
  eventId: string;
  processedAt: string;
}

export type RealtimeDoc = Omit<RealtimeEvent, 'seq' | 'id'> & { _id: string; seq: number };

export interface CounterDoc {
  _id: string;
  value: number;
}

export type AuditDoc = Omit<AuditEntry, 'id'> & { _id: string };

export type FileDoc = Omit<FileRecord, 'id'> & { _id: string; storageKey: string; version: number };

export interface MigrationDoc {
  _id: string; // version id, e.g. '0001_initial_indexes'
  appliedAt: string;
  checksum: string;
}

// ---- Competitive hierarchy (DATA-001): event → discipline → stage → match → game unit
export interface RulesSnapshot {
  packageId: string;
  version: string;
  sourceRef: string;
  reviewedAt: string | null;
  label: string;
  /** Frozen copy of the clause set the participants accepted. Immutable after publish (RULE-007). */
  clauses: Array<{ key: string; kind: 'mandatory' | 'configurable' | 'human_review'; value: unknown; citation?: string }>;
  hash: string;
}

export interface EventDoc {
  _id: string;
  slug: string;
  name: string;
  organizerOrgId: string;
  visibility: 'public' | 'private' | 'invite' | 'link_only';
  state: EventState;
  timeZone: string;
  startsAt: string | null;
  endsAt: string | null;
  rulesSnapshot: RulesSnapshot | null;
  config: EventConfig;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  seedLabel?: string;
}

export interface DisciplineDoc {
  _id: string;
  eventId: string;
  gameId: string;
  gameVersion: string;
  platform: string;
  mode: string;
  name: string;
  rulesSnapshot: RulesSnapshot | null;
  config: DisciplineConfig;
  createdAt: string;
  version: number;
}

export interface StageDoc {
  _id: string;
  eventId: string;
  disciplineId: string;
  order: number;
  name: string;
  format: string; // single_elim | double_elim | round_robin | groups | swiss | ladder | multi_lobby | record | mixed
  state: 'planned' | 'drawn' | 'active' | 'finished' | 'cancelled';
  dependsOnStageIds: string[];
  presence: 'online' | 'offline' | 'hybrid';
  links: StageLink[];
  /** Starting before dependencies are final requires an approved, reasoned exception (STG-006). */
  startException: { approvalId: string; reason: string; by: string; at: string } | null;
  /** FMT-002/CFG-005: organizer values for configurable clauses (inside clause bounds) and per-match overrides, e.g. BO5 final */
  settings?: Record<string, unknown>;
  overrides?: Array<{ label: string; match: { bracket?: string; round?: number; slotKey?: string }; values: Record<string, unknown> }>;
  /** mixed format: ordered phases, each with its own adapter */
  phases?: Array<{ key: string; format: string; advance: { perGroup?: number; bestRemaining?: number; top?: number } | null }>;
  createdAt: string;
  version: number;
}

export interface MatchSide {
  participationId: string;
  /** Snapshot of the display name at the time of the match (DATA-002, TEAM-006). */
  displayName: string;
  origin: { kind: 'seed' | 'advance' | 'quota' | 'invite' | 'waitlist'; ref: string };
  /** Roster snapshot for honors attribution (ROS-006). */
  roster: Array<{ principalId: string; displayName: string; role: string; present: boolean }>;
}

export interface MatchDoc extends MatchEsp04Fields {
  _id: string;
  eventId: string;
  disciplineId: string;
  stageId: string;
  kind: 'head_to_head' | 'lobby' | 'attempts';
  sides: MatchSide[];
  state: MatchState;
  scheduledAt: string | null;
  estimated: boolean;
  /** Private lobby data is NEVER embedded in public projections (ROOM-004). */
  lobby: { host: string; password: string; releasedAt: string | null } | null;
  rulesSnapshot: RulesSnapshot | null;
  resultVersion: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface GameUnitDoc {
  _id: string;
  matchId: string;
  order: number;
  kind: 'map' | 'set' | 'round' | 'attempt' | 'lobby_round';
  label: string;
  state: 'pending' | 'live' | 'provisional' | 'final' | 'void';
  /** Game-specific values; validated against the game module schema in ESP-02/05. */
  values: Record<string, unknown>;
  provenance: { source: 'manual' | 'referee' | 'integration'; actorPrincipalId: string | null; evidenceFileIds: string[]; recordedAt: string } | null;
  resultVersion: number;
  createdAt: string;
  version: number;
}

export interface ParticipationDoc {
  _id: string;
  eventId: string;
  disciplineId: string;
  kind: 'team' | 'player';
  /** Immutable snapshot taken on confirmation (DATA-002). */
  snapshot: { displayName: string; teamId: string | null; roster: Array<{ principalId: string; displayName: string; role: string }> };
  acceptedRules: { packageId: string; version: string; hash: string; acceptedAt: string; acceptedBy: string } | null;
  registrationState: RegistrationState;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface OrganizationDoc {
  _id: string;
  name: string;
  slug: string;
  ownerPrincipalId: string;
  description: string | null;
  city: string | null;
  links: Array<{ label: string; url: string }>;
  sponsors: Array<{ name: string; url: string | null; logoFileId: string | null }>;
  logoFileId: string | null;
  nameHistory: Array<{ name: string; from: string; to: string | null }>;
  ownerHistory: Array<{ principalId: string; from: string; to: string | null }>;
  createdAt: string;
  updatedAt: string;
  version: number;
  seedLabel?: string;
}

/** A team is one competitive lineup for one game; an organization may own several (TEAM-002). */
export interface TeamDoc {
  _id: string;
  organizationId: string | null;
  ownerPrincipalId: string;
  gameId: string;
  name: string;
  tag: string;
  description: string | null;
  city: string | null;
  links: Array<{ label: string; url: string }>;
  sponsors: Array<{ name: string; url: string | null; logoFileId: string | null }>;
  logoFileId: string | null;
  coverFileId: string | null;
  nameHistory: Array<{ name: string; tag: string; from: string; to: string | null }>;
  ownerHistory: Array<{ principalId: string; from: string; to: string | null }>;
  createdAt: string;
  updatedAt: string;
  version: number;
  seedLabel?: string;
}

export interface TeamMembershipDoc {
  _id: string;
  teamId: string;
  principalId: string;
  role: string;
  from: string;
  to: string | null;
  endedReason: string | null;
  endedBy: string | null;
  /** Display name at join time, kept for historical lineups (TEAM-006). */
  displayNameAtJoin: string;
}

export interface ResultVersionDoc {
  _id: string;
  targetType: 'match' | 'game_unit' | 'standing' | 'rating';
  targetId: string;
  version: number;
  calcVersion: string; // formula / engine version (DATA-007)
  data: Record<string, unknown>;
  provenance: { source: string; actorPrincipalId: string | null; reason: string | null; evidenceFileIds: string[] };
  createdAt: string;
}

export interface Collections extends Esp02Collections, Esp03Collections, Esp04Collections {
  principals: Collection<PrincipalDoc>;
  sessions: Collection<SessionDoc>;
  grants: Collection<GrantDoc>;
  approvals: Collection<ApprovalDoc>;
  outbox: Collection<OutboxDoc>;
  processedEvents: Collection<ProcessedEventDoc>;
  realtime: Collection<RealtimeDoc>;
  counters: Collection<CounterDoc>;
  audit: Collection<AuditDoc>;
  files: Collection<FileDoc>;
  migrations: Collection<MigrationDoc>;
  events: Collection<EventDoc>;
  disciplines: Collection<DisciplineDoc>;
  stages: Collection<StageDoc>;
  matches: Collection<MatchDoc>;
  gameUnits: Collection<GameUnitDoc>;
  participations: Collection<ParticipationDoc>;
  organizations: Collection<OrganizationDoc>;
  teams: Collection<TeamDoc>;
  teamMemberships: Collection<TeamMembershipDoc>;
  resultVersions: Collection<ResultVersionDoc>;
}

export const collectionNames = {
  principals: 'principals',
  sessions: 'sessions',
  grants: 'grants',
  approvals: 'approvals',
  outbox: 'outbox',
  processedEvents: 'processed_events',
  realtime: 'realtime_events',
  counters: 'counters',
  audit: 'audit_log',
  files: 'files',
  migrations: 'migrations',
  events: 'events',
  disciplines: 'disciplines',
  stages: 'stages',
  matches: 'matches',
  gameUnits: 'game_units',
  participations: 'participations',
  organizations: 'organizations',
  teams: 'teams',
  teamMemberships: 'team_memberships',
  resultVersions: 'result_versions',
  ...esp02CollectionNames,
  ...esp03CollectionNames,
  ...esp04CollectionNames,
} as const satisfies Record<keyof Collections, string>;

export function collections(db: Db): Collections {
  return {
    principals: db.collection(collectionNames.principals),
    sessions: db.collection(collectionNames.sessions),
    grants: db.collection(collectionNames.grants),
    approvals: db.collection(collectionNames.approvals),
    outbox: db.collection(collectionNames.outbox),
    processedEvents: db.collection(collectionNames.processedEvents),
    realtime: db.collection(collectionNames.realtime),
    counters: db.collection(collectionNames.counters),
    audit: db.collection(collectionNames.audit),
    files: db.collection(collectionNames.files),
    migrations: db.collection(collectionNames.migrations),
    events: db.collection(collectionNames.events),
    disciplines: db.collection(collectionNames.disciplines),
    stages: db.collection(collectionNames.stages),
    matches: db.collection(collectionNames.matches),
    gameUnits: db.collection(collectionNames.gameUnits),
    participations: db.collection(collectionNames.participations),
    organizations: db.collection(collectionNames.organizations),
    teams: db.collection(collectionNames.teams),
    teamMemberships: db.collection(collectionNames.teamMemberships),
    resultVersions: db.collection(collectionNames.resultVersions),
    ...esp02Collections(db),
    ...esp03Collections(db),
    ...esp04Collections(db),
  };
}

export type { Scope };
