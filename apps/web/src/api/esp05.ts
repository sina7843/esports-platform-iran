import { API_BASE, request } from './client';

/** ESP-05 endpoints: result confirmation, officials, cases, sanctions, integrity, corrections, ranking, honors, close. */
const enc = encodeURIComponent;
type Obj = Record<string, unknown>;
export type Outcome = { kind: 'win'; winnerSide: 0 | 1; scores: [number, number] | null; maps: [number, number] | null } | { kind: 'draw'; scores: [number, number] | null; maps: [number, number] | null };

export interface CaseView {
  _id: string; eventId: string; matchId: string | null; category: string; claim: string; state: string; role: 'party' | 'official';
  deadlines: { defenseBy: string | null; appealBy: string | null; fileBy: string | null };
  decisions: Array<{ level: 'first' | 'appeal'; at: string; by?: string; rulesRef: { clauseKey: string; citation: string; version?: string | null }; publicSummary: string; reasoning?: string; effect: { kind: string; outcome: Obj | null } }>;
  // official projection
  parties?: string[]; assignee?: string | null; appealAuthority?: string | null; filedBy?: string;
  evidence?: Array<{ fileId: string; by: string; at: string; note: string | null }>;
  defense?: Array<{ by?: string; side: number | null; text: string; at: string; mine?: boolean }>;
  evidenceRequests?: Array<{ id: string; to: string; text: string; dueAt: string | null; answer: string | null; answeredAt: string | null }>;
  requests?: Array<{ id: string; to: string; text: string; dueAt: string | null; answer: string | null }>;
  reports?: Array<{ by: string; text: string; at: string }>;
  views?: Array<{ principalId: string; decisionIndex: number; at: string }>;
  myEvidence?: string[];
  linkedCorrectionId?: string | null;
}
export interface Impact {
  slots: Array<{ key: string; before: string[]; after: string[] }>;
  startedDependents: Array<{ matchId: string; slotKey: string; state: string }>;
  resetMatches: string[];
  standings: Array<{ id: string; rankBefore: number | null; rankAfter: number | null }>;
  ratingEvents: number;
  honors: Array<{ id: string; kind: string; place: number | null }>;
  prizes: Array<{ id: string; title: string; state: string; amountRial: number }>;
  quotas: Array<{ stageId: string; participationId: string }>;
  newsEvents: string[];
}
export interface Correction { _id: string; matchId: string; kind: string; state: string; steps: string[]; error: string | null; reason: string; caseId: string | null; impact: Impact; createdAt: string }
export interface RatingSystem {
  id: string; gameId: string; mode: string; platform: string | null; subject: 'player' | 'team'; model: 'glicko2' | 'lobby_points'; version: number; params: Obj; seasonId: string | null;
  inactivityDays: number; regionBasis: string; eventWeights: Record<string, number>; eligibility: string; state: string; approval: { by: string; at: string; reference: string } | null; publishedAt: string | null;
  label: { official: boolean; text: 'official' | 'internal_unapproved'; reference: string | null };
}
export interface Leaderboard {
  system: RatingSystem; label: RatingSystem['label']; build: string | null; total: number;
  rows: Array<{ rank: number | null; subjectId: string; subjectKind: string; displayName: string; rating: number; rd: number | null; games: number; wins: number; lastActiveAt: string; inactive: boolean; region: { province: string | null; city: string | null } }>;
}
export interface Honor { id: string; kind: string; label: string; place: number | null; eventId: string; eventName: string; team: { teamId: string; nameAtTime: string } | null; recipients: Array<{ principalId: string; displayName: string }>; state: string; verifyCode: string; correctionOf: string | null; revokedReason: string | null; issuedAt: string }
export interface Declared { id: string; title: string; eventName: string; year: number | null; state: string; label: string }
export interface Certificate { id: string; kind: string; displayName: string; eventId: string; eventName: string; place: number | null; code: string; state: string; issuedAt: string }
export interface Blockers { unfinishedStages: Array<{ id: string; name: string; state: string }>; openMatches: Array<{ id: string; slot: string | null; state: string }>; openCases: Array<{ id: string; state: string; category: string }>; corrections: Array<{ id: string; state: string }>; openObligationsRial: number; canFinish: boolean; canClose: boolean }

export const esp05 = {
  // results
  confirm: (matchId: string) => request<Obj>('POST', `/matches/${enc(matchId)}/results/confirm`),
  contest: (matchId: string, claim: string, evidenceFileIds: string[] = []) => request<CaseView>('POST', `/matches/${enc(matchId)}/results/contest`, { body: { claim, evidenceFileIds } }),
  lineup: (matchId: string, side: number, principalIds: string[]) => request<Obj>('POST', `/matches/${enc(matchId)}/lineup`, { body: { side, principalIds } }),
  resultHistory: (matchId: string) => request<{ items: Obj[] }>('GET', `/matches/${enc(matchId)}/result-history`),
  // officials
  officials: (eventId: string) => request<{ items: Array<{ _id: string; principalId: string; role: string; matchId: string | null; at: string }> }>('GET', `/events/${enc(eventId)}/officials`),
  assignOfficial: (eventId: string, b: { principalId: string; role: string; matchId: string | null; overrideReason?: string | null }) => request<Obj>('POST', `/events/${enc(eventId)}/officials`, { body: b }),
  unassignOfficial: (id: string) => request<{ ok: true }>('DELETE', `/officials/${enc(id)}`),
  // cases
  fileCase: (eventId: string, b: { matchId: string | null; category: string; claim: string; evidenceFileIds: string[] }) => request<CaseView>('POST', `/events/${enc(eventId)}/cases`, { body: b }),
  eventCases: (eventId: string) => request<{ items: CaseView[] }>('GET', `/events/${enc(eventId)}/cases`),
  myCases: () => request<{ items: CaseView[] }>('GET', '/me/cases'),
  decisions: (eventId: string, t?: string) => request<{ items: Array<{ caseId: string; matchId: string | null; category: string; state: string; decisions: Array<{ level: string; at: string; clause: string; citation: string; rulesVersion: string | null; summary: string; effect: string }> }> }>('GET', `/events/${enc(eventId)}/decisions`, { query: { t } }),
  getCase: (id: string) => request<CaseView>('GET', `/cases/${enc(id)}`),
  assignCase: (id: string, assignee: string) => request<Obj>('POST', `/cases/${enc(id)}/assign`, { body: { assignee } }),
  defend: (id: string, text: string, fileIds: string[] = []) => request<CaseView>('POST', `/cases/${enc(id)}/defense`, { body: { text, fileIds } }),
  requestEvidence: (id: string, to: string, text: string) => request<Obj>('POST', `/cases/${enc(id)}/evidence-requests`, { body: { to, text, dueAt: null } }),
  answer: (id: string, rq: string, answer: string, fileIds: string[] = []) => request<CaseView>('POST', `/cases/${enc(id)}/evidence-requests/${enc(rq)}/answer`, { body: { answer, fileIds } }),
  report: (id: string, text: string) => request<Obj>('POST', `/cases/${enc(id)}/reports`, { body: { text } }),
  startReview: (id: string) => request<Obj>('POST', `/cases/${enc(id)}/review`),
  decide: (id: string, b: { clauseKey: string; publicSummary: string; reasoning: string; effect: { kind: string; outcome?: Outcome | null } }) => request<Obj>('POST', `/cases/${enc(id)}/decision`, { body: b }),
  appeal: (id: string, text: string) => request<CaseView>('POST', `/cases/${enc(id)}/appeal`, { body: { text } }),
  decideAppeal: (id: string, b: { clauseKey: string; publicSummary: string; reasoning: string; effect: { kind: string; outcome?: Outcome | null } }) => request<Obj>('POST', `/cases/${enc(id)}/appeal-decision`, { body: b }),
  closeCase: (id: string) => request<Obj>('POST', `/cases/${enc(id)}/close`),
  // sanctions and integrity
  issueSanction: (b: Obj) => request<Obj>('POST', '/sanctions', { body: b }),
  sanctions: (q: { eventId?: string; subjectRef?: string }) => request<{ items: Obj[] }>('GET', '/sanctions', { query: q }),
  revokeSanction: (id: string, reason: string) => request<Obj>('POST', `/sanctions/${enc(id)}/revoke`, { body: { reason } }),
  reportIntegrity: (b: { category: string; eventId: string | null; matchId: string | null; subjects: Array<{ kind: 'principal' | 'team'; ref: string }>; description: string; evidenceFileIds: string[] }) => request<{ id: string; state: string }>('POST', '/integrity-reports', { body: b }),
  integrityQueue: (eventId?: string) => request<{ items: Obj[] }>('GET', '/integrity-reports', { query: { eventId } }),
  integrityStep: (id: string, b: { action: string; note: string; assignee?: string | null; caseId?: string | null; outcome?: string | null }) => request<Obj>('POST', `/integrity-reports/${enc(id)}/steps`, { body: b }),
  // corrections
  preview: (matchId: string, outcome: Outcome | null) => request<Impact>('POST', `/matches/${enc(matchId)}/corrections/preview`, { body: { outcome } }),
  correct: (matchId: string, b: { outcome: Outcome; reason: string; approvalId: string; caseId: string | null }) => request<Correction>('POST', `/matches/${enc(matchId)}/corrections`, { body: b }),
  reopen: (matchId: string, reason: string, approvalId: string) => request<Correction>('POST', `/matches/${enc(matchId)}/reopen`, { body: { reason, approvalId } }),
  resume: (id: string) => request<Correction>('POST', `/corrections/${enc(id)}/resume`),
  corrections: (eventId: string) => request<{ items: Correction[] }>('GET', `/events/${enc(eventId)}/corrections`),
  // ranking
  systems: (q: { gameId?: string; drafts?: boolean } = {}) => request<{ items: RatingSystem[] }>('GET', '/ratings/systems', { query: { gameId: q.gameId, drafts: q.drafts ? 'true' : undefined } }),
  createSystem: (b: Obj) => request<RatingSystem>('POST', '/ratings/systems', { body: b }),
  publishSystem: (id: string) => request<RatingSystem>('POST', `/ratings/systems/${enc(id)}/publish`),
  approveSystem: (id: string, reference: string) => request<RatingSystem>('POST', `/ratings/systems/${enc(id)}/approve`, { body: { reference } }),
  builds: (id: string) => request<{ items: Obj[] }>('GET', `/ratings/systems/${enc(id)}/builds`),
  leaderboard: (id: string, q: { province?: string; city?: string; from?: string; to?: string; offset?: number; limit?: number }) => request<Leaderboard>('GET', `/ratings/systems/${enc(id)}/leaderboard`, { query: q }),
  records: (id: string) => request<{ peak: Obj | null; biggestGain: Obj | null; mostGames: Obj | null }>('GET', `/ratings/systems/${enc(id)}/records`),
  trend: (subjectId: string) => request<{ items: Array<{ system: RatingSystem; current: Obj | null; points: Array<{ at: string; rating: number; delta: number; matchId: string }> }> }>('GET', `/ratings/subjects/${enc(subjectId)}/trend`),
  headToHead: (kind: 'player' | 'team', a: string, b: string) => request<{ played: number; wins: number; losses: number; draws: number; items: Obj[] }>('GET', '/careers/head-to-head', { query: { kind, a, b } }),
  playerCareer: (id: string) => request<{ played: number; wins: number; losses: number; draws: number; items: Array<{ matchId: string; eventId: string; eventName: string; opponent: string; result: string; forfeit: boolean; at: string }> }>('GET', `/careers/players/${enc(id)}`),
  // honors
  eventHonors: (eventId: string, t?: string) => request<{ items: Honor[] }>('GET', `/events/${enc(eventId)}/honors`, { query: { t } }),
  playerHonors: (id: string) => request<{ verified: Honor[]; declared: Declared[] }>('GET', `/players/${enc(id)}/honors`),
  teamHonors: (id: string) => request<{ verified: Honor[]; declared: Declared[] }>('GET', `/teams/${enc(id)}/honors`),
  verify: (code: string) => request<{ kind: 'honor' | 'certificate'; valid: boolean; honor?: Honor; certificate?: Certificate }>('GET', `/verify/${enc(code)}`),
  cardUrl: (honorId: string) => `${API_BASE}/honors/${enc(honorId)}/card.svg`,
  revokeHonor: (id: string, reason: string) => request<Honor>('POST', `/honors/${enc(id)}/revoke`, { body: { reason } }),
  myCertificates: () => request<{ items: Certificate[] }>('GET', '/me/certificates'),
  specials: (eventId: string) => request<{ items: Obj[] }>('GET', `/events/${enc(eventId)}/special-awards`),
  proposeSpecial: (eventId: string, b: Obj) => request<Obj>('POST', `/events/${enc(eventId)}/special-awards`, { body: b }),
  decideSpecial: (id: string, approve: boolean) => request<Obj>('POST', `/special-awards/${enc(id)}/decision`, { body: { approve } }),
  declare: (b: { owner: { kind: 'principal' | 'team'; ref: string }; title: string; eventName: string; year: number | null; evidenceFileIds: string[] }) => request<Declared>('POST', '/declared-achievements', { body: b }),
  declaredQueue: () => request<{ items: Array<Obj & { _id: string; title: string; eventName: string; owner: { kind: string; ref: string } }> }>('GET', '/declared-achievements/queue'),
  reviewDeclared: (id: string, decision: 'verified' | 'rejected', note: string | null) => request<Declared>('POST', `/declared-achievements/${enc(id)}/review`, { body: { decision, note } }),
  // close
  blockers: (eventId: string) => request<Blockers>('GET', `/events/${enc(eventId)}/close-blockers`),
  finish: (eventId: string, expectedVersion: number) => request<Obj>('POST', `/events/${enc(eventId)}/finish`, { body: { expectedVersion } }),
  close: (eventId: string, expectedVersion: number, approvalId: string | null) => request<{ event: { id: string; state: string; version: number }; effects: Obj }>('POST', `/events/${enc(eventId)}/close`, { body: { expectedVersion, approvalId } }),
  archive: (eventId: string, expectedVersion: number) => request<Obj>('POST', `/events/${enc(eventId)}/archive`, { body: { expectedVersion } }),
  getArchive: (eventId: string) => request<Obj>('GET', `/events/${enc(eventId)}/archive`),
  feedback: (eventId: string, score: number, comment: string | null) => request<Obj>('POST', `/events/${enc(eventId)}/feedback`, { body: { score, comment } }),
  eventReport: (eventId: string) => request<Obj>('GET', `/events/${enc(eventId)}/report`),
  requestApproval: (action: string, scope: { type: string; id: string }, reason: string) => request<{ id: string; state: string }>('POST', '/approvals', { body: { action, scope, payload: {}, reason } }),
};
