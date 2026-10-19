import type { Collection, Db } from 'mongodb';
import type { PrivacyLevel, TeamRole, GameState, CompetitionFamily, RulesPackageState, Clause } from '@esp/contracts';

/** ESP-02 collections: identity, profiles, social, organizations/teams, recruitment, organizer, catalog, rules. */

export interface OtpChallengeDoc {
  _id: string;
  purpose: 'login' | 'phone_change' | 'email_verify' | 'recovery' | 'reauth';
  /** E.164 phone or lower-cased email. */
  target: string;
  codeHash: string;
  salt: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  consumedAt: string | null;
  principalId: string | null;
  ip: string | null;
  createdAt: string;
  /** Set when the provider failed to deliver; the challenge is dead (no silent success). */
  deliveryFailedAt?: string | null;
}

export interface CredentialDoc {
  _id: string; // principalId
  phone: string | null;
  phoneVerifiedAt: string | null;
  email: string | null;
  emailVerifiedAt: string | null;
  /** Email awaiting code verification; only becomes `email` (unique, login-capable) once verified. */
  pendingEmail?: string | null;
  passwordHash: string | null; // scrypt: salt$hash
  totp: { enabled: boolean; secretEnc: string | null; pendingSecretEnc: string | null; recoveryCodeHashes: string[]; enabledAt: string | null; lastUsedStep?: number };
  phoneHistory: Array<{ phone: string; from: string; to: string | null; reason: string }>;
  emailHistory: Array<{ email: string; from: string; to: string | null }>;
  failedLogins: number;
  lockedUntil: string | null;
  updatedAt: string;
  version: number;
}

export interface ProfileDoc {
  _id: string; // principalId
  nickname: string;
  nicknameLower: string;
  realName: string | null;
  bio: string | null;
  province: string | null;
  city: string | null;
  links: Array<{ label: string; url: string }>;
  avatarFileId: string | null;
  coverFileId: string | null;
  games: Array<{ gameId: string; roles: string[]; declaredLevel: string | null; verifiedLevel: { value: string; issuer: string; at: string } | null; equipment: string | null; activityHours: string | null }>;
  privacy: Record<string, PrivacyLevel>;
  messagePolicy: 'everyone' | 'followers' | 'teammates' | 'nobody';
  notificationPrefs: Record<string, unknown>;
  lookingForTeam: { active: boolean; resume: string | null; gameIds: string[]; since: string | null };
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface GameIdentityDoc {
  _id: string;
  principalId: string;
  gameId: string;
  platform: string;
  value: string;
  valueNormalized: string;
  active: boolean;
  /** Who may see the value on the public profile; missing (legacy) is treated as private. */
  visibility?: PrivacyLevel;
  verification: { state: 'unverified' | 'pending' | 'verified' | 'rejected' | 'disputed'; method: 'manual' | 'publisher'; issuer: string | null; verifiedAt: string | null; expiresAt: string | null; note: string | null };
  ownershipHistory: Array<{ principalId: string; from: string; to: string | null; by: string }>;
  valueHistory: Array<{ value: string; from: string; to: string | null }>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface BadgeDoc {
  _id: string;
  principalId: string;
  kind: 'identity' | 'game_identity' | 'org_position';
  issuer: string;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy?: string | null;
  revokedReason?: string | null;
  /** identity: { referenceText } only (no documents, OPS-002); game_identity: { gameIdentityId, gameId, platform }; org_position: { organizationId, position }. */
  ref: Record<string, unknown>;
}

export interface FollowDoc {
  _id: string;
  followerId: string;
  targetType: 'player' | 'team' | 'game' | 'organizer' | 'event';
  targetId: string;
  createdAt: string;
}

export interface BlockDoc {
  _id: string;
  blockerId: string;
  blockedId: string;
  createdAt: string;
}

export interface AccountReviewDoc {
  _id: string;
  principalIds: string[];
  reason: string;
  signals: Record<string, unknown>;
  state: 'open' | 'resolved_distinct' | 'resolved_merged_manually' | 'resolved_suspended';
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  createdAt: string;
  version: number;
}

export interface TeamInvitationDoc {
  _id: string;
  teamId: string;
  principalId: string;
  role: TeamRole;
  invitedBy: string;
  message: string | null;
  state: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  version: number;
}

export interface TeamJoinRequestDoc {
  _id: string;
  teamId: string;
  principalId: string;
  role: TeamRole;
  message: string | null;
  state: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
  version: number;
}

export interface OwnershipTransferDoc {
  _id: string;
  targetType: 'team' | 'organization';
  targetId: string;
  fromPrincipalId: string;
  toPrincipalId: string;
  responsibilities: { activeRegistrations: number; openObligations: number; note: string | null };
  state: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  version: number;
}

export interface TeamCalendarEventDoc {
  _id: string;
  teamId: string;
  kind: 'practice' | 'match' | 'scrim' | 'meeting' | 'other';
  title: string;
  startsAt: string;
  endsAt: string;
  note: string | null;
  refId: string | null;
  createdBy: string;
  createdAt: string;
  version: number;
}

export interface RecruitmentAdDoc {
  _id: string;
  teamId: string;
  kind: 'player' | 'coach' | 'analyst' | 'manager';
  gameId: string;
  role: string | null;
  level: string | null;
  city: string | null;
  activityHours: string | null;
  description: string;
  state: 'open' | 'closed';
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
  version: number;
}

export interface RecruitmentApplicationDoc {
  _id: string;
  adId: string;
  teamId: string;
  principalId: string;
  message: string | null;
  state: 'applied' | 'tryout_invited' | 'under_review' | 'accepted' | 'rejected' | 'withdrawn';
  history: Array<{ state: string; by: string; at: string; note: string | null }>;
  createdAt: string;
  version: number;
}

export interface ScrimDoc {
  _id: string;
  requesterTeamId: string;
  gameId: string;
  level: string | null;
  windowStart: string;
  windowEnd: string;
  server: string | null;
  conditions: string | null;
  state: 'open' | 'proposed' | 'accepted' | 'declined' | 'played' | 'cancelled';
  proposal: { teamId: string; proposedAt: string; server: string | null; note: string | null; by: string } | null;
  /** Friendly result: independent label, never feeds official ranking by default (REC-005). */
  result: { label: 'friendly'; countsForRating: false; scores: Array<{ teamId: string; score: number }>; reportedBy: string; reportedAt: string; note: string | null } | null;
  createdBy: string;
  createdAt: string;
  version: number;
}

export interface OrganizerApplicationDoc {
  _id: string;
  principalId: string;
  organizationId: string;
  description: string;
  experience: string | null;
  contactPhone: string | null;
  documentFileIds: string[];
  state: 'submitted' | 'needs_info' | 'under_review' | 'approved' | 'rejected';
  history: Array<{ state: string; by: string; at: string; note: string }>;
  createdAt: string;
  version: number;
}

export interface OrganizerProfileDoc {
  _id: string; // organizationId
  verified: { state: 'unverified' | 'verified' | 'revoked'; issuer: string | null; at: string | null; expiresAt: string | null; note: string | null };
  level: 'basic' | 'trusted' | 'partner';
  limits: { maxActiveEvents: number; maxCapacityPerEvent: number; paidEventsAllowed: boolean };
  /** A verification badge is never a prize guarantee (ADM-004). */
  prizeGuarantee: false;
  intro: string | null;
  staff: Array<{ principalId: string | null; name: string; role: string }>;
  venue: string | null;
  venueAddressText: string | null;
  facilities: string[];
  links: Array<{ label: string; url: string }>;
  sponsors: Array<{ name: string; url: string | null; logoFileId: string | null }>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface OrganizerRatingDoc {
  _id: string;
  organizationId: string;
  eventId: string;
  principalId: string;
  score: number;
  comment: string | null;
  state: 'visible' | 'hidden';
  moderation: { by: string; at: string; reason: string } | null;
  createdAt: string;
  version: number;
}

export interface GameDoc {
  _id: string;
  slug: string;
  title: string;
  publisher: string;
  releasePeriod: string | null;
  platforms: string[];
  modes: string[];
  regions: string[];
  family: CompetitionFamily;
  moduleId: string;
  references: Array<{ title: string; url: string; kind: string; retrievedAt: string }>;
  capabilities: Record<string, { status: string; detail: string | null }>;
  state: GameState;
  stateHistory: Array<{ from: GameState | null; to: GameState; by: string; at: string; reason: string; evidence: Record<string, unknown> | null }>;
  logoFileId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  seedLabel?: string;
}

export interface GameReadinessDoc {
  _id: string;
  gameId: string;
  version: string;
  platform: string;
  mode: string;
  state: 'not_ready' | 'ready' | 'suspended';
  evidence: string | null;
  reviewedBy: string;
  reviewedAt: string;
}

export interface RulesPackageDoc {
  _id: string;
  gameId: string;
  scope: { kind: 'catalog' | 'organizer' | 'event'; ref: string };
  title: string;
  /** Human version label of the source package (e.g. "2026.2"); `version` is the concurrency counter. */
  versionLabel: string;
  state: RulesPackageState;
  sourceUrl: string | null;
  sourceText: string | null;
  sourcePublishedAt: string | null;
  sourceRetrievedAt: string | null;
  reviewedAt: string | null;
  nextReviewDueAt: string | null;
  applicability: string;
  originalLanguage: string;
  translationFa: { text: string | null; reviewed: boolean; reviewer: string | null; reviewedAt: string | null };
  clauses: Clause[];
  clausesHash: string;
  /** Recorded conflicts; `resolution` null means unresolved, which blocks publishing (RULE-005). */
  conflicts: Array<{ id: string; description: string; resolution: string | null; recordedBy: string; recordedAt: string; resolvedBy: string | null; resolvedAt: string | null }>;
  /** Human-review clause keys acknowledged by a reviewer (RULE-010). */
  humanReviewAcks?: Array<{ key: string; by: string; at: string }>;
  publisherRights: { reviewed: boolean; restrictions: string | null; reviewedBy: string | null };
  adaptedFrom: { packageId: string; differences: string } | null;
  supersedes: string | null;
  supersededBy: string | null;
  amendment: { reason: string; impactAssessment: string; reacceptRequired: boolean; notifiedAt: string | null } | null;
  testOnly: boolean;
  history: Array<{ state: string; by: string; at: string; note: string | null }>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface RulesAcceptanceDoc {
  _id: string;
  packageId: string;
  packageVersionLabel: string;
  clausesHash: string;
  principalId: string;
  context: { eventId: string | null; participationId: string | null };
  acceptedAt: string;
}

export interface Esp02Collections {
  otpChallenges: Collection<OtpChallengeDoc>;
  credentials: Collection<CredentialDoc>;
  profiles: Collection<ProfileDoc>;
  gameIdentities: Collection<GameIdentityDoc>;
  badges: Collection<BadgeDoc>;
  follows: Collection<FollowDoc>;
  blocks: Collection<BlockDoc>;
  accountReviews: Collection<AccountReviewDoc>;
  teamInvitations: Collection<TeamInvitationDoc>;
  teamJoinRequests: Collection<TeamJoinRequestDoc>;
  ownershipTransfers: Collection<OwnershipTransferDoc>;
  teamCalendar: Collection<TeamCalendarEventDoc>;
  recruitmentAds: Collection<RecruitmentAdDoc>;
  recruitmentApplications: Collection<RecruitmentApplicationDoc>;
  scrims: Collection<ScrimDoc>;
  organizerApplications: Collection<OrganizerApplicationDoc>;
  organizerProfiles: Collection<OrganizerProfileDoc>;
  organizerRatings: Collection<OrganizerRatingDoc>;
  games: Collection<GameDoc>;
  gameReadiness: Collection<GameReadinessDoc>;
  rulesPackages: Collection<RulesPackageDoc>;
  rulesAcceptances: Collection<RulesAcceptanceDoc>;
}

export const esp02CollectionNames = {
  otpChallenges: 'otp_challenges',
  credentials: 'credentials',
  profiles: 'profiles',
  gameIdentities: 'game_identities',
  badges: 'badges',
  follows: 'follows',
  blocks: 'blocks',
  accountReviews: 'account_reviews',
  teamInvitations: 'team_invitations',
  teamJoinRequests: 'team_join_requests',
  ownershipTransfers: 'ownership_transfers',
  teamCalendar: 'team_calendar',
  recruitmentAds: 'recruitment_ads',
  recruitmentApplications: 'recruitment_applications',
  scrims: 'scrims',
  organizerApplications: 'organizer_applications',
  organizerProfiles: 'organizer_profiles',
  organizerRatings: 'organizer_ratings',
  games: 'games',
  gameReadiness: 'game_readiness',
  rulesPackages: 'rules_packages',
  rulesAcceptances: 'rules_acceptances',
} as const satisfies Record<keyof Esp02Collections, string>;

export function esp02Collections(db: Db): Esp02Collections {
  const n = esp02CollectionNames;
  return {
    otpChallenges: db.collection(n.otpChallenges),
    credentials: db.collection(n.credentials),
    profiles: db.collection(n.profiles),
    gameIdentities: db.collection(n.gameIdentities),
    badges: db.collection(n.badges),
    follows: db.collection(n.follows),
    blocks: db.collection(n.blocks),
    accountReviews: db.collection(n.accountReviews),
    teamInvitations: db.collection(n.teamInvitations),
    teamJoinRequests: db.collection(n.teamJoinRequests),
    ownershipTransfers: db.collection(n.ownershipTransfers),
    teamCalendar: db.collection(n.teamCalendar),
    recruitmentAds: db.collection(n.recruitmentAds),
    recruitmentApplications: db.collection(n.recruitmentApplications),
    scrims: db.collection(n.scrims),
    organizerApplications: db.collection(n.organizerApplications),
    organizerProfiles: db.collection(n.organizerProfiles),
    organizerRatings: db.collection(n.organizerRatings),
    games: db.collection(n.games),
    gameReadiness: db.collection(n.gameReadiness),
    rulesPackages: db.collection(n.rulesPackages),
    rulesAcceptances: db.collection(n.rulesAcceptances),
  };
}
