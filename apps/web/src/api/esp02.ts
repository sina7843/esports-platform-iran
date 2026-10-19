import { request } from './client';

/** ESP-02 endpoints: identity, profiles, social, teams, recruitment, organizers, catalog, rules. */

export type Privacy = 'public' | 'followers' | 'private';
export interface GameProfile { gameId: string; roles: string[]; declaredLevel: string | null; verifiedLevel: { value: string; issuer?: string; at: string } | null; equipment: string | null; activityHours: string | null }
export interface MyProfile {
  id: string; nickname: string; realName: string | null; bio: string | null; province: string | null; city: string | null;
  links: { label: string; url: string }[]; avatarUrl: string | null; games: GameProfile[]; privacy: Record<string, Privacy>;
  messagePolicy: 'everyone' | 'followers' | 'teammates' | 'nobody';
  lookingForTeam: { active: boolean; resume: string | null; gameIds: string[]; since: string | null };
  version: number;
}
export interface PublicPlayer {
  id: string; nickname: string; avatarUrl: string | null; bio: string | null; realName: string | null; province: string | null; city: string | null;
  links: { label: string; url: string }[]; games: GameProfile[];
  gameIdentities: { gameId: string; platform: string; value: string; verified: boolean }[];
  badges: { kind: 'identity' | 'game_identity' | 'org_position'; issuedAt: string; expiresAt: string | null; ref: Record<string, unknown> }[];
  lookingForTeam: { active: boolean; resume: string | null; gameIds: string[] };
  teams?: { current?: { teamId: string; name: string; role: string }[]; past?: { teamId: string; name: string; role: string }[] } | unknown;
  record?: unknown; honors?: unknown; ratingChart?: unknown;
}
export interface GameIdentity { id: string; gameId: string; platform: string; value: string; active: boolean; visibility: Privacy; verification: { state: string; expired: boolean }; valueHistory: { value: string; from: string; to: string | null }[]; version: number }
export interface MfaStatus { enabled: boolean; sessionVerified: boolean; requiredByRole: boolean; enforced: boolean }
export interface MyTeam { teamId: string; name: string; tag: string; gameId?: string; role: string; from: string }
export interface TeamMemberRow { principalId: string; nickname: string; avatarUrl: string | null; role: string; from: string; to: string | null }
export interface TeamPage {
  id: string; name: string; tag: string; gameId: string; organizationId: string | null; description: string | null; city: string | null;
  links: { label: string; url: string }[]; sponsors: { name: string; url: string | null }[];
  nameHistory: { name: string; tag: string; from: string; to: string | null }[];
  currentMembers: TeamMemberRow[]; pastMembers: TeamMemberRow[];
  record: { source: string }; standings: { source: string; items: unknown[] }; honors: { source: string; items: unknown[] };
}
export interface Invitation { id: string; teamId: string; team?: { name: string; tag: string }; role: string; state: string; message: string | null; expiresAt: string; version?: number }
export interface TeamRef { id: string; name: string; tag: string; logoUrl: string | null }
export interface RecruitmentAd { id: string; team: TeamRef; kind: string; gameId: string; role: string | null; level: string | null; city: string | null; activityHours: string | null; description: string; state: 'open' | 'closed'; createdAt: string }
export interface Scrim { id: string; requester: TeamRef; gameId: string; level: string | null; windowStart: string; windowEnd: string; server: string | null; conditions: string | null; state: string; proposal: { teamId: string; proposedAt: string } | null; result: { label: 'friendly'; countsForRating: false } | null; version: number }
export interface LftPlayer { id: string; nickname: string; city: string | null; games: { gameId: string; declaredLevel: string | null }[]; resume: string | null }
export interface OrganizerSummary { id: string; slug: string; name: string; level: string; ratingSummary: { count: number; average: number | null } }
export interface OrganizerPage {
  id: string; slug: string; name: string; intro: string | null; staff: { name: string; role: string }[]; venue: string | null; venueAddressText: string | null;
  facilities: string[]; links: { label: string; url: string }[]; sponsors: { name: string; url: string | null }[];
  verification: { verified: boolean; level: string | null; issuedAt: string | null; prizeGuarantee: false; disclaimerFa: string; disclaimerEn: string };
  ratingSummary: { count: number; average: number | null };
  upcomingEvents: { id: string; name: string; state: string }[];
  pastEvents: { id: string; name: string; state: string }[];
}
export interface OrganizerApplication { id: string; organizationId: string; state: string; description: string; history: { state: string; at: string; note: string }[]; createdAt: string; version: number }
export interface Capability { status: 'supported' | 'limited' | 'unsupported' | 'unknown'; detail: string | null }
export interface Game {
  id: string; slug: string; title: string; publisher: string; platforms: string[]; modes: string[]; regions: string[]; family: string; moduleId: string; moduleTestOnly?: boolean;
  references: { title: string; url: string; kind: string; retrievedAt: string }[]; capabilities: Record<string, Capability>; state: string;
  readiness?: { version: string; platform: string; mode: string; state: string }[];
  version: number;
}
export interface GameModule { id: string; family: string; label: string; testOnly: boolean; resultFields: { key: string; type: string; required: boolean; description: string }[]; scoringModel: string; tieBreakOrder: string[] }
export interface RulesClause { key: string; kind: 'mandatory' | 'configurable' | 'human_review'; value: unknown; allowed: { min: number | null; max: number | null; options: unknown[] | null } | null; citation: string; textFa: string | null }
export interface RulesPackage {
  id: string; gameId: string; scope: { kind: string; ref: string }; title: string; versionLabel: string; state: string; testOnly: boolean; label: string | null;
  sourceUrl: string | null; reviewedAt: string | null; nextReviewDueAt: string | null; applicability: string; translationFa: { reviewed: boolean; text: string | null };
  clauses: RulesClause[]; clausesHash: string; publisherRights: { reviewed: boolean; restrictions: string | null }; adaptedFrom: { packageId: string; differences: string } | null;
  supersededBy: string | null; version: number; blockers?: string[];
}
export interface AccountReview { id: string; principals: { id: string; nickname: string | null; status: string | null }[]; reason: string; state: string; note: string | null; createdAt: string; version: number }

export interface CalendarEntry { id: string; kind: string; title: string; startsAt: string; endsAt: string; note: string | null }
export interface JoinRequest { id: string; teamId: string; principalId: string; role: string; state: string; message: string | null; createdAt: string }
export interface OwnershipTransfer { id: string; targetType: string; targetId: string; fromPrincipalId: string; toPrincipalId: string; state: string; responsibilities: { activeRegistrations: number; openObligations: number; note: string | null }; expiresAt: string }
export interface Application { id: string; adId: string; principalId: string; nickname?: string; message: string | null; state: string; version: number }
export interface Rating { id: string; organizationId: string; eventId: string; score: number; comment: string | null; state: string }
export interface Reminder { packageId: string; gameId: string; title: string; version: string; reason: string; dueAt: string; eventId: string | null }

type Page<T> = { items: T[]; page?: { nextCursor: string | null; limit: number } };
const enc = encodeURIComponent;

export const esp02 = {
  // identity (USR-001/009/010)
  otpRequest: (phone: string) => request<{ challengeId: string; expiresAt: string; message: string; resendAfterSeconds: number }>('POST', '/auth/otp/request', { body: { phone } }),
  otpVerify: (phone: string, code: string) => request<{ isNewAccount: boolean; principalId: string; mfaVerified: boolean }>('POST', '/auth/otp/verify', { body: { phone, code } }),
  emailLogin: (email: string, password: string) => request<{ isNewAccount: boolean; principalId: string; mfaVerified: boolean }>('POST', '/auth/email/login', { body: { email, password } }),
  logoutOthers: () => request<void>('POST', '/auth/logout-others'),
  mfa: () => request<MfaStatus>('GET', '/me/mfa'),
  totpSetup: () => request<{ secret: string; otpauthUri: string; recoveryCodes: string[] }>('POST', '/me/mfa/totp/setup'),
  totpConfirm: (code: string) => request<void>('POST', '/me/mfa/totp/confirm', { body: { code } }),
  stepUp: (code: string) => request<void>('POST', '/auth/mfa/stepup', { body: { code } }),
  reauthRequest: () => request<{ expiresAt: string }>('POST', '/auth/reauth/otp/request'),
  reauthVerify: (code: string) => request<void>('POST', '/auth/reauth/otp/verify', { body: { code } }),
  exportUrl: () => '/api/v1/me/export',
  deleteAccount: () => request<void>('POST', '/me/delete', { body: { confirm: true } }),
  // profile + social (USR-003..008, 011)
  myProfile: () => request<MyProfile>('GET', '/me/profile'),
  updateProfile: (patch: Record<string, unknown>) => request<MyProfile>('PATCH', '/me/profile', { body: patch }),
  player: (nickname: string) => request<PublicPlayer>('GET', `/players/${enc(nickname)}`),
  players: (q: Record<string, string | undefined>) => request<Page<{ id: string; nickname: string; city: string | null; lookingForTeam: boolean; games: { gameId: string; declaredLevel: string | null }[] }>>('GET', '/players', { query: q }),
  gameIdentities: () => request<{ items: GameIdentity[] }>('GET', '/me/game-identities'),
  addGameIdentity: (b: { gameId: string; platform: string; value: string; visibility: Privacy }) => request<GameIdentity>('POST', '/me/game-identities', { body: { ...b, method: 'manual' } }),
  follow: (targetType: string, targetId: string) => request<void>('POST', '/follows', { body: { targetType, targetId } }),
  unfollow: (targetType: string, targetId: string) => request<void>('DELETE', `/follows/${enc(targetType)}/${enc(targetId)}`),
  block: (principalId: string) => request<void>('PUT', `/me/blocks/${enc(principalId)}`),
  // teams (TEAM-001..007)
  myTeams: () => request<{ items: MyTeam[] }>('GET', '/me/teams'),
  createTeam: (b: { name: string; tag: string; gameId: string; organizationId: string | null; city: string | null }) => request<{ id: string }>('POST', '/teams', { body: b }),
  team: (id: string) => request<TeamPage>('GET', `/teams/${enc(id)}/profile`),
  myInvitations: () => request<{ items: Invitation[] }>('GET', '/me/team-invitations'),
  invite: (teamId: string, principalId: string, role: string) => request<Invitation>('POST', `/teams/${enc(teamId)}/invitations`, { body: { principalId, role, message: null } }),
  invitationAction: (id: string, action: 'accept' | 'decline' | 'cancel') => request<unknown>('POST', `/team-invitations/${enc(id)}/${action}`),
  leaveTeam: (teamId: string) => request<void>('POST', `/teams/${enc(teamId)}/leave`, { body: { reason: null } }),
  kick: (teamId: string, principalId: string, reason: string) => request<void>('POST', `/teams/${enc(teamId)}/members/${enc(principalId)}/kick`, { body: { reason } }),
  // recruitment + scrims (REC-001..005)
  ads: (q: Record<string, string | undefined>) => request<Page<RecruitmentAd>>('GET', '/recruitment/ads', { query: q }),
  apply: (adId: string, message: string | null) => request<unknown>('POST', `/recruitment/ads/${enc(adId)}/applications`, { body: { message } }),
  lftPlayers: (q: Record<string, string | undefined>) => request<Page<LftPlayer>>('GET', '/recruitment/players', { query: q }),
  scrims: (q: Record<string, string | undefined>) => request<Page<Scrim>>('GET', '/scrims', { query: q }),
  // organizers (ADM-002/003/004/010)
  organizers: (q: Record<string, string | undefined>) => request<{ items: OrganizerSummary[] }>('GET', '/organizers', { query: q }),
  organizer: (slug: string) => request<OrganizerPage>('GET', `/organizers/${enc(slug)}`),
  applyOrganizer: (b: { organizationId: string; description: string; experience: string | null; contactPhone: string | null }) => request<OrganizerApplication>('POST', '/organizers/applications', { body: { ...b, documentFileIds: [] } }),
  myOrganizerApplications: () => request<{ items: OrganizerApplication[] }>('GET', '/me/organizer-applications'),
  organizerApplications: () => request<{ items: OrganizerApplication[] }>('GET', '/organizers/applications'),
  reviewOrganizer: (id: string, b: Record<string, unknown>) => request<OrganizerApplication>('POST', `/organizers/applications/${enc(id)}/review`, { body: b }),
  // catalog + rules (GAME-*, RULE-*)
  games: (q: Record<string, string | undefined>) => request<{ items: Game[] }>('GET', '/catalog/games', { query: q }),
  game: (id: string) => request<Game>('GET', `/catalog/games/${enc(id)}`),
  modules: () => request<{ items: GameModule[] }>('GET', '/catalog/modules'),
  rulesList: (q: Record<string, string | undefined>) => request<{ items: RulesPackage[] }>('GET', '/rules', { query: q }),
  rules: (id: string) => request<RulesPackage>('GET', `/rules/${enc(id)}`),
  acceptRules: (id: string) => request<unknown>('POST', `/rules/${enc(id)}/accept`, { body: { eventId: null, participationId: null } }),
  // admin
  accountReviews: () => request<{ items: AccountReview[] }>('GET', '/admin/account-reviews'),
  decideReview: (id: string, decision: string, note: string, expectedVersion: number) =>
    request<AccountReview>('POST', `/admin/account-reviews/${enc(id)}/decision`, { body: { decision, note, expectedVersion, suspendPrincipalIds: [] } }),
  // team management (TEAM-003/004/005/007)
  changeRole: (teamId: string, principalId: string, role: string) => request<unknown>('PATCH', `/teams/${enc(teamId)}/members/${enc(principalId)}`, { body: { role } }),
  joinRequest: (teamId: string, role: string, message: string | null) => request<JoinRequest>('POST', `/teams/${enc(teamId)}/join-requests`, { body: { role, message } }),
  joinRequests: (teamId: string) => request<{ items: JoinRequest[] }>('GET', `/teams/${enc(teamId)}/join-requests`),
  joinRequestAction: (id: string, action: 'accept' | 'decline') => request<unknown>('POST', `/team-join-requests/${enc(id)}/${action}`),
  requestTransfer: (teamId: string, toPrincipalId: string, note: string | null) => request<OwnershipTransfer>('POST', `/teams/${enc(teamId)}/ownership-transfers`, { body: { toPrincipalId, responsibilitiesNote: note } }),
  myTransfers: () => request<{ items: OwnershipTransfer[] }>('GET', '/me/ownership-transfers'),
  acceptTransfer: (id: string) => request<unknown>('POST', `/ownership-transfers/${enc(id)}/accept`, { body: { acceptResponsibilities: true } }),
  transferAction: (id: string, action: 'decline' | 'cancel') => request<unknown>('POST', `/ownership-transfers/${enc(id)}/${action}`),
  calendar: (teamId: string) => request<{ items: CalendarEntry[] }>('GET', `/teams/${enc(teamId)}/calendar`),
  addCalendar: (teamId: string, b: { kind: string; title: string; startsAt: string; endsAt: string; note: string | null }) => request<CalendarEntry>('POST', `/teams/${enc(teamId)}/calendar`, { body: b }),
  deleteCalendar: (teamId: string, id: string) => request<void>('DELETE', `/teams/${enc(teamId)}/calendar/${enc(id)}`),
  // recruitment + scrim management (REC-001/003/004/005)
  teamAds: (teamId: string) => request<{ items: RecruitmentAd[] }>('GET', `/teams/${enc(teamId)}/recruitment/ads`),
  createAd: (teamId: string, b: Record<string, unknown>) => request<RecruitmentAd>('POST', `/teams/${enc(teamId)}/recruitment/ads`, { body: b }),
  closeAd: (id: string) => request<unknown>('POST', `/recruitment/ads/${enc(id)}/close`),
  adApplications: (adId: string) => request<{ adState: string; items: Application[] }>('GET', `/recruitment/ads/${enc(adId)}/applications`),
  decideApplication: (id: string, action: string, version: number) => request<Application>('POST', `/recruitment/applications/${enc(id)}/decision`, { body: { action, note: null, expectedVersion: version } }),
  myApplications: () => request<{ items: Application[] }>('GET', '/me/recruitment/applications'),
  withdrawApplication: (id: string) => request<unknown>('POST', `/recruitment/applications/${enc(id)}/withdraw`),
  teamScrims: (teamId: string) => request<{ items: Scrim[] }>('GET', `/teams/${enc(teamId)}/scrims`),
  createScrim: (teamId: string, b: Record<string, unknown>) => request<Scrim>('POST', `/teams/${enc(teamId)}/scrims`, { body: b }),
  proposeScrim: (id: string, teamId: string, proposedAt: string) => request<Scrim>('POST', `/scrims/${enc(id)}/propose`, { body: { teamId, proposedAt, server: null, note: null } }),
  scrimAction: (id: string, action: 'accept' | 'decline' | 'cancel') => request<Scrim>('POST', `/scrims/${enc(id)}/${action}`),
  scrimResult: (id: string, teamId: string, scores: { teamId: string; score: number }[], version: number) => request<Scrim>('POST', `/scrims/${enc(id)}/result`, { body: { teamId, scores, note: null, expectedVersion: version } }),
  // organizer management (ADM-003/010)
  organizerProfile: (orgId: string) => request<{ version: number; intro: string | null; venue: string | null; venueAddressText: string | null; facilities: string[] }>('GET', `/organizers/${enc(orgId)}/profile`),
  updateOrganizerProfile: (orgId: string, b: Record<string, unknown>) => request<unknown>('PATCH', `/organizers/${enc(orgId)}/profile`, { body: b }),
  rateOrganizer: (orgId: string, eventId: string, score: number, comment: string | null) => request<Rating>('POST', `/organizers/${enc(orgId)}/ratings`, { body: { eventId, score, comment } }),
  ratingsForModeration: () => request<{ items: Rating[] }>('GET', '/organizer-ratings/moderation'),
  moderateRating: (id: string, action: 'hide' | 'unhide', reason: string) => request<Rating>('PATCH', `/organizer-ratings/${enc(id)}/moderation`, { body: { action, reason } }),
  // staff identity actions (USR-004/005/011)
  setVerifiedLevel: (principalId: string, gameId: string, value: string | null) => request<unknown>('POST', `/admin/players/${enc(principalId)}/verified-level`, { body: { gameId, value } }),
  pendingGameIdentities: () => request<{ items: (GameIdentity & { principalId: string })[] }>('GET', '/admin/game-identities'),
  verifyGameIdentity: (id: string) => request<unknown>('POST', `/admin/game-identities/${enc(id)}/verify`, { body: { expiresAt: null, note: null } }),
  issueBadge: (b: Record<string, unknown>) => request<unknown>('POST', '/admin/badges', { body: b }),
  // catalog admin (GAME-001..004)
  createGame: (b: Record<string, unknown>) => request<Game>('POST', '/catalog/games', { body: b }),
  transitionGame: (id: string, b: Record<string, unknown>) => request<Game>('POST', `/catalog/games/${enc(id)}/transition`, { body: b }),
  upsertReadiness: (id: string, b: Record<string, unknown>) => request<unknown>('PUT', `/catalog/games/${enc(id)}/readiness`, { body: b }),
  // rules workflow (RULE-003..012)
  createRules: (b: Record<string, unknown>) => request<RulesPackage>('POST', '/rules', { body: b }),
  rulesTransition: (id: string, transition: string, version: number, note: string | null) => request<RulesPackage>('POST', `/rules/${enc(id)}/transition`, { body: { transition, note, expectedVersion: version } }),
  rulesReview: (id: string, b: Record<string, unknown>) => request<RulesPackage>('POST', `/rules/${enc(id)}/review`, { body: b }),
  rulesConflict: (id: string, description: string, resolution: string | null, version: number) => request<RulesPackage>('POST', `/rules/${enc(id)}/conflicts`, { body: { description, resolution, expectedVersion: version } }),
  rulesAmend: (id: string, b: Record<string, unknown>) => request<RulesPackage>('POST', `/rules/${enc(id)}/amendments`, { body: b }),
  validateSettings: (id: string, settings: Record<string, unknown>) => request<{ ok: boolean; violations: { key: string; reason: string; citation: string | null }[] }>('POST', `/rules/${enc(id)}/validate-settings`, { body: { settings } }),
  reminders: () => request<{ items: Reminder[] }>('GET', '/rules/review-reminders'),
  // social lists (USR-007/008)
  following: () => request<{ items: { targetType: string; targetId: string; label: string | null; since: string }[] }>('GET', '/me/following'),
  blocks: () => request<{ items: { principalId: string; nickname?: string | null }[] }>('GET', '/me/blocks'),
  unblock: (principalId: string) => request<void>('DELETE', `/me/blocks/${enc(principalId)}`),
};
