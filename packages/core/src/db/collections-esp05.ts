import type { Collection, Db } from 'mongodb';
import type { DisputeState } from '@esp/contracts';
import type { MatchOutcome } from './collections-esp04.js';

/**
 * ESP-05 collections: officials, disputes/appeals, sanctions and integrity reports (REF, INT), result corrections as a
 * resumable saga (RES-006..008), rating systems/events/ratings/jobs (RANK), honors, declared achievements,
 * certificates, special awards (AWD, END-003..005), event archives and feedback (END-006/007), and leases that keep
 * conflicting operations apart.
 */

export interface OfficialDoc {
  _id: string;
  eventId: string;
  matchId: string | null; // null = event-level appointment
  principalId: string;
  role: 'referee' | 'head_referee' | 'appeal_authority';
  grantId: string | null;
  assignedBy: string;
  at: string;
  active: boolean;
}

export interface DisputeDoc {
  _id: string;
  eventId: string;
  matchId: string | null;
  category: 'result' | 'eligibility' | 'conduct' | 'cheating' | 'schedule' | 'other';
  claim: string;
  filedBy: string;
  filedSide: number | null;
  /** principals that are party to the case (both sides' rosters for match cases) */
  parties: string[];
  state: DisputeState;
  deadlines: { defenseBy: string | null; appealBy: string | null; fileBy: string | null };
  assignee: string | null;
  appealAuthority: string | null;
  evidence: Array<{ fileId: string; by: string; at: string; note: string | null }>; // private
  defense: Array<{ by: string; side: number | null; text: string; fileIds: string[]; at: string }>;
  evidenceRequests: Array<{ id: string; to: string; text: string; dueAt: string | null; answer: string | null; answeredAt: string | null }>;
  reports: Array<{ by: string; text: string; at: string }>;
  decisions: Array<{
    level: 'first' | 'appeal';
    by: string;
    at: string;
    rulesRef: { packageId: string; version: string; clauseKey: string; citation: string };
    publicSummary: string;
    reasoning: string; // private
    effect: { kind: 'none' | 'result_change' | 'sanction' | 'replay_order'; outcome?: MatchOutcome | null; sanctionIds?: string[] };
  }>;
  /** REF-006: delivery and viewing of the decision by each party */
  views: Array<{ principalId: string; decisionIndex: number; at: string }>;
  linkedCorrectionId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface SanctionDoc {
  _id: string;
  subject: { kind: 'principal' | 'team' | 'participation'; ref: string; displayName: string };
  scope: { kind: 'match' | 'event' | 'platform'; id: string };
  type: 'warning' | 'point_penalty' | 'forfeit' | 'disqualification' | 'suspension_temporary' | 'suspension_permanent';
  points: number | null; // point_penalty, applied to standings of the scoped event/stage
  stageId: string | null;
  from: string;
  until: string | null; // temporary suspension end
  reason: string;
  rulesRef: { packageId: string | null; clauseKey: string; citation: string };
  issuedBy: string;
  caseId: string | null;
  /** platform extension needs an independent disciplinary approval (INT-004) */
  extension: { approvalId: string; by: string; at: string } | null;
  state: 'active' | 'appealed' | 'revoked' | 'expired';
  appeal: { by: string; text: string; at: string; decidedBy: string | null; decision: 'upheld' | 'revoked' | null; decidedAt: string | null } | null;
  createdAt: string;
  version: number;
}

export interface IntegrityReportDoc {
  _id: string;
  reporter: string;
  category: 'cheating' | 'alt_account' | 'collusion' | 'sabotage' | 'misconduct';
  eventId: string | null;
  matchId: string | null;
  subjects: Array<{ kind: 'principal' | 'team'; ref: string }>;
  description: string;
  evidenceFileIds: string[];
  /** INT-002: demos and recordings are evidence for a human, never an automatic verdict */
  evidenceNote: string;
  state: 'received' | 'triaged' | 'investigating' | 'referred' | 'closed';
  assignee: string | null;
  outcome: string | null;
  linkedCaseId: string | null;
  history: Array<{ at: string; by: string; action: string; note: string | null }>;
  createdAt: string;
  version: number;
}

export interface CorrectionImpact {
  slots: Array<{ key: string; before: string[]; after: string[]; winnerBefore: string | null; winnerAfter: string | null }>;
  startedDependents: Array<{ matchId: string; slotKey: string; state: string }>;
  resetMatches: string[];
  standings: Array<{ id: string; rankBefore: number | null; rankAfter: number | null }>;
  ratingEvents: number;
  honors: Array<{ id: string; kind: string; place: number | null }>;
  prizes: Array<{ id: string; title: string; state: string; amountRial: number }>;
  quotas: Array<{ stageId: string; participationId: string }>;
  newsEvents: string[];
}
export interface CorrectionDoc {
  _id: string;
  eventId: string;
  stageId: string;
  matchId: string;
  kind: 'correction' | 'reopen';
  from: MatchOutcome | null;
  to: MatchOutcome | null;
  reason: string;
  caseId: string | null;
  approvalId: string | null;
  requestedBy: string;
  impact: CorrectionImpact;
  state: 'previewed' | 'blocked_dependency' | 'applying' | 'applied' | 'failed';
  /** saga progress: completed step names in order; resume continues from the first missing one */
  steps: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// ---------------------------------------------------------------- ranking (RANK-001..008)
export interface RatingSystemDoc {
  _id: string;
  gameId: string;
  mode: string;
  platform: string | null;
  subject: 'player' | 'team';
  model: 'glicko2' | 'lobby_points';
  version: number;
  params: { initialRating: number; initialRd: number; initialVolatility: number; tau: number; periodDays: number } | { placementPoints: number[]; killPoints: number; source: string };
  seasonId: string | null;
  carry: { kind: 'reset' | 'carry'; factor: number | null };
  inactivityDays: number;
  tiebreak: string[];
  regionBasis: string; // e.g. "profile province/city at the time of the result"
  eventWeights: Record<string, number>; // tier → weight (1 = standard)
  eligibility: string; // published conditions for a rated event (RANK-004)
  state: 'draft' | 'published' | 'retired';
  /** an official label needs the competition owner's documented approval (RANK-006) */
  approval: { by: string; at: string; reference: string } | null;
  publishedAt: string | null;
  activeBuild: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface RatingEventDoc {
  _id: string;
  systemId: string;
  build: string;
  subjectId: string; // principalId or teamId
  matchId: string;
  resultVersion: number;
  formulaVersion: number;
  eventWeight: number;
  opponents: string[];
  before: { rating: number; rd: number | null; vol: number | null };
  after: { rating: number; rd: number | null; vol: number | null };
  delta: number;
  playedAt: string;
  region: { province: string | null; city: string | null };
  voided: boolean;
}
export interface RatingDoc {
  _id: string; // `${build}:${subjectId}`
  systemId: string;
  build: string;
  subjectId: string;
  subjectKind: 'player' | 'team';
  displayName: string;
  rating: number;
  rd: number | null;
  vol: number | null;
  games: number;
  wins: number;
  lastActiveAt: string;
  region: { province: string | null; city: string | null };
}
export interface RatingJobDoc {
  _id: string; // build id
  systemId: string;
  formulaVersion: number;
  cursor: { playedAt: string; matchId: string } | null;
  processed: number;
  state: 'running' | 'complete' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

// ---------------------------------------------------------------- honors (AWD, END-003..005)
export interface HonorDoc {
  _id: string;
  kind: 'trophy' | 'medal' | 'title' | 'placement' | 'mvp' | 'special';
  eventId: string;
  eventName: string;
  disciplineId: string;
  stageId: string | null;
  place: number | null;
  label: string;
  participationId: string | null;
  team: { teamId: string; nameAtTime: string } | null;
  /** AWD-002: individual honors only for roster members of that time who meet the presence condition */
  recipients: Array<{ principalId: string; displayName: string; eligible: boolean; reason: string }>;
  basis: { kind: 'standing' | 'special_award'; ref: string; version: number };
  state: 'active' | 'revoked';
  verifyCode: string;
  correctionOf: string | null;
  revokedReason: string | null;
  issuedAt: string;
  revokedAt: string | null;
}
export interface DeclaredAchievementDoc {
  _id: string;
  owner: { kind: 'principal' | 'team'; ref: string };
  title: string;
  eventName: string;
  year: number | null;
  evidenceFileIds: string[];
  state: 'pending' | 'verified' | 'rejected';
  reviewer: string | null;
  note: string | null;
  createdAt: string;
}
export interface CertificateDoc {
  _id: string;
  kind: 'attendance' | 'placement';
  principalId: string;
  displayName: string;
  eventId: string;
  eventName: string;
  place: number | null;
  code: string;
  state: 'active' | 'revoked' | 'corrected';
  correctedBy: string | null;
  reason: string | null;
  issuedAt: string;
}
export interface SpecialAwardDoc {
  _id: string;
  eventId: string;
  title: string;
  method: 'official_selection' | 'vote' | 'statistics';
  approverRole: 'organizer' | 'head_referee';
  nominee: { participationId: string; principalId: string | null };
  justification: string;
  proposedBy: string;
  state: 'proposed' | 'approved' | 'rejected' | 'revoked';
  decidedBy: string | null;
  honorId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- close, archive, feedback (END-006/007)
export interface EventArchiveDoc {
  _id: string; // eventId
  eventName: string;
  closedAt: string;
  closedBy: string;
  rules: Array<{ disciplineId: string; packageId: string; version: string; hash: string }>;
  rosters: Array<{ participationId: string; displayName: string; teamId: string | null; roster: Array<{ principalId: string; displayName: string; role: string }> }>;
  standings: Array<{ stageId: string; resultVersion: number; rows: unknown[] }>;
  honors: string[];
  prizes: Array<{ id: string; title: string; amountRial: number; state: string; open: boolean }>;
  openObligationsRial: number;
  media: Array<{ kind: string; ref: string }>;
  outboxEvents: number;
}
export interface FeedbackDoc {
  _id: string;
  eventId: string;
  principalId: string;
  score: number;
  comment: string | null;
  createdAt: string;
}
export interface LeaseDoc {
  _id: string; // lock key
  owner: string;
  until: string;
}

export interface Esp05Collections {
  officials: Collection<OfficialDoc>;
  disputes: Collection<DisputeDoc>;
  sanctions: Collection<SanctionDoc>;
  integrityReports: Collection<IntegrityReportDoc>;
  corrections: Collection<CorrectionDoc>;
  ratingSystems: Collection<RatingSystemDoc>;
  ratingEvents: Collection<RatingEventDoc>;
  ratings: Collection<RatingDoc>;
  ratingJobs: Collection<RatingJobDoc>;
  honors: Collection<HonorDoc>;
  declaredAchievements: Collection<DeclaredAchievementDoc>;
  certificates: Collection<CertificateDoc>;
  specialAwards: Collection<SpecialAwardDoc>;
  eventArchives: Collection<EventArchiveDoc>;
  feedback: Collection<FeedbackDoc>;
  leases: Collection<LeaseDoc>;
}

export const esp05CollectionNames = {
  officials: 'officials',
  disputes: 'disputes',
  sanctions: 'sanctions',
  integrityReports: 'integrity_reports',
  corrections: 'result_corrections',
  ratingSystems: 'rating_systems',
  ratingEvents: 'rating_events',
  ratings: 'ratings',
  ratingJobs: 'rating_jobs',
  honors: 'honors',
  declaredAchievements: 'declared_achievements',
  certificates: 'certificates',
  specialAwards: 'special_awards',
  eventArchives: 'event_archives',
  feedback: 'event_feedback',
  leases: 'leases',
} as const satisfies Record<keyof Esp05Collections, string>;

export function esp05Collections(db: Db): Esp05Collections {
  const out = {} as Record<string, Collection>;
  for (const [k, name] of Object.entries(esp05CollectionNames)) out[k] = db.collection(name);
  return out as unknown as Esp05Collections;
}

/** Match fields added in ESP-05 (optional; earlier documents stay valid). */
export interface MatchEsp05Fields {
  result?: {
    deadline: string | null; // opponent confirmation deadline (RES-002)
    policy: 'on_deadline' | 'never' | null; // auto-confirm policy from the rules (RES-003)
    submissions: Array<{ side: number | null; by: string; outcome: MatchOutcome; units: GameUnitInput[]; evidenceFileIds: string[]; source: 'side' | 'referee' | 'integration'; at: string }>;
    confirmations: Array<{ side: number; by: string; at: string }>;
    /** set when an integration result disagrees with the provisional result; blocks auto-confirm until an official finalises */
    review?: { reason: 'integration_mismatch'; at: string } | null;
  };
  headRefereeId?: string | null;
}
export interface GameUnitInput {
  order: number;
  kind: 'map' | 'set' | 'round' | 'attempt' | 'lobby_round';
  label: string;
  values: Record<string, unknown>;
}
