import { API_BASE, ApiClientError, request, type ClientErrorCode } from './client';

/** ESP-04 endpoints: draw/structure, schedule, room/selection/run, servers, LAN. */
const enc = encodeURIComponent;
type Obj = Record<string, unknown>;

export interface SlotView {
  key: string; bracket: string; round: number; order: number; group: string | null; conditional: string | null;
  participants: Array<{ id: string | null; name: string | null }>; status: string; winner: string | null;
  match: { id: string; state: string; scheduledAt: string | null; estimated: boolean; outcome: Obj | null } | null;
}
export interface BracketView { format: string; phaseFormat: string; total: number; offset: number; limit: number; brackets: string[]; rounds: number[]; slots: SlotView[] }
export interface StandingRowView { id: string; displayName: string; rank: number; group?: string; unresolvedTie: boolean; metrics: Record<string, number> }
export interface StandingsView { format: string; algorithm: string; engine: string; rulesHash: string; needsReview: string | null; total: number; offset: number; limit: number; rows: StandingRowView[]; provisional: boolean }
export interface PublicMatch {
  id: string; eventId: string; stageId: string; kind: string; state: string; scheduledAt: string | null; estimated: boolean;
  slot: { key: string; bracket: string; round: number; group: string | null } | null;
  sides: Array<{ displayName: string; roster: Array<{ displayName: string; role: string }> }>;
  config: { bestOf: number; mode: string; gameVersion: string; mapPool: string[]; override: string | null } | null;
  outcome: Obj | null; provisional: boolean; publicNotice: string | null; stationLabel: string | null; version: number;
}
export interface RoomView {
  public: PublicMatch & { stage: { name: string; format: string; presence: string } | null; timeline: Array<{ at: string; type: string; text: string }>; serverTime: string };
  private: null | {
    side: number; official: boolean; config: Obj & { vetoSequence: string[]; undecided: string[]; pauses: Obj; disconnect: Obj; bestOf: number };
    ready: Array<{ side: number; at: string }>; countdownTo: string | null; referees: string[]; run: Obj | null; lobbyAvailable: boolean;
    calls: Array<{ _id: string; reason: string; state: string; createdAt: string }>;
  };
}
export interface SelectionView {
  sequence: string[]; pool: string[]; step: number; state: string; turnDeadline: string | null; serverTime: string; options: string[];
  actions: Array<{ step: number; kind: string; side: number | null; value: string; at: string; via: string }>;
}
export interface DrawDoc {
  _id: string; stageId: string; number: number; method: string; separateBy: string; seedString: string; engine: string; state: string; reason: string | null;
  input: Array<{ participationId: string; displayName: string; seed: number | null; rank: number | null; qualifierRank: number | null; pot: number | null; region: string | null; club: string | null }>;
  outcome: { order: string[]; groups: Record<string, string[]> | null; explanations: string[] };
  history: Array<{ at: string; by: string; action: string; note: string | null }>; version: number;
}
export interface Proposal {
  _id: string; kind: string; reason: string; state: string; createdAt: string;
  changes: Array<{ matchId: string; from: string | null; to: string; stationId?: string | null }>;
  conflicts: Array<{ matchId: string; kind: string; hard: boolean; detail: string }>;
}

async function multipart<T>(path: string, fields: Record<string, string | File>): Promise<T> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (typeof v === 'string') fd.append(k, v);
  for (const [k, v] of Object.entries(fields)) if (typeof v !== 'string') fd.append(k, v);
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'fetch', Accept: 'application/json' }, body: fd });
  const data = (await res.json().catch(() => null)) as Obj | null;
  const err = data?.['error'] as Obj | undefined;
  if (!res.ok) throw new ApiClientError({ code: (err?.['code'] as ClientErrorCode | undefined) ?? 'UNKNOWN', message: String(err?.['message'] ?? res.statusText), requestId: (err?.['requestId'] as string | undefined) ?? null, status: res.status, details: err?.['details'] });
  return data as T;
}

export const esp04 = {
  // public competition views
  stage: (stageId: string, t?: string) => request<{ id: string; name: string; order: number; format: string; state: string; presence: string; eventId: string; eventName: string; disciplineId: string; disciplineName: string | null; rules: { packageId: string; version: string; label: string } | null; structure: { state: string; algorithm: string; engine: string; rulesHash: string; groups: string[] } | null; phases: Obj[]; links: Obj[] }>('GET', `/stages/${enc(stageId)}`, { query: { t } }),
  bracket: (stageId: string, q: { bracket?: string | undefined; round?: number | undefined; offset?: number | undefined; limit?: number | undefined; t?: string | undefined }) => request<BracketView>('GET', `/stages/${enc(stageId)}/bracket`, { query: q }),
  standings: (stageId: string, q: { group?: string | undefined; offset?: number | undefined; limit?: number | undefined; t?: string | undefined }) => request<StandingsView>('GET', `/stages/${enc(stageId)}/standings`, { query: q }),
  draws: (stageId: string, t?: string) => request<{ items: DrawDoc[] }>('GET', `/stages/${enc(stageId)}/draws`, { query: { t } }),
  schedule: (eventId: string, q: { offset?: number | undefined; limit?: number | undefined; stageId?: string | undefined; t?: string | undefined }) => request<{ total: number; items: PublicMatch[] }>('GET', `/events/${enc(eventId)}/schedule`, { query: q }),
  hall: (eventId: string, t?: string) => request<{ serverTime: string; live: Array<PublicMatch & { callup: string | null }>; called: Array<PublicMatch & { callup: string | null }>; upcoming: PublicMatch[]; results: PublicMatch[] }>('GET', `/events/${enc(eventId)}/hall`, { query: { t } }),
  venues: (eventId: string) => request<{ items: Obj[] }>('GET', `/events/${enc(eventId)}/venues`),
  incidents: (eventId: string) => request<{ items: Obj[] }>('GET', `/events/${enc(eventId)}/incidents`),
  // stage operations
  stageRules: (stageId: string) => request<{ values: Obj; hash: string; format: string; settings: Obj; overrides: Obj[]; phases: Obj[] }>('GET', `/stages/${enc(stageId)}/rules`),
  stageSettings: (stageId: string, b: Obj) => request<Obj>('PATCH', `/stages/${enc(stageId)}/settings`, { body: b }),
  drawPreview: (stageId: string, b: Obj) => request<DrawDoc>('POST', `/stages/${enc(stageId)}/draws`, { body: b }),
  drawStep: (drawId: string, step: 'confirm' | 'lock' | 'publish') => request<DrawDoc>('POST', `/draws/${enc(drawId)}/${step}`),
  drawVerify: (drawId: string) => request<{ reproducible: boolean }>('GET', `/draws/${enc(drawId)}/verify`),
  redraw: (stageId: string, b: Obj) => request<{ draw: DrawDoc; discardedMatches: number }>('POST', `/stages/${enc(stageId)}/redraw`, { body: b }),
  generate: (stageId: string) => request<Obj>('POST', `/stages/${enc(stageId)}/structure`),
  nextRound: (stageId: string) => request<{ round: number; explanations: string[] }>('POST', `/stages/${enc(stageId)}/next-round`),
  nextPhase: (stageId: string) => request<{ phase: number; entrants: string[] }>('POST', `/stages/${enc(stageId)}/next-phase`),
  challenge: (stageId: string, challenger: string, defender: string) => request<PublicMatch>('POST', `/stages/${enc(stageId)}/challenges`, { body: { challenger, defender } }),
  withdraw: (stageId: string, participationId: string, reason: string) => request<void>('POST', `/stages/${enc(stageId)}/withdrawals`, { body: { participationId, reason } }),
  transfer: (stageId: string, fromStageId: string) => request<{ created: number; existing: number }>('POST', `/stages/${enc(stageId)}/transfer`, { body: { fromStageId } }),
  // schedule
  scheduleConfig: (eventId: string) => request<Obj & { windows: Array<{ from: string; to: string }>; defaultDurationMinutes: number; bufferMinutes: number; minRestMinutes: number }>('GET', `/events/${enc(eventId)}/schedule-config`),
  setScheduleConfig: (eventId: string, b: Obj) => request<Obj>('PUT', `/events/${enc(eventId)}/schedule-config`, { body: b }),
  setTime: (matchId: string, b: Obj) => request<{ match: PublicMatch; conflicts: Proposal['conflicts'] }>('PUT', `/matches/${enc(matchId)}/schedule`, { body: b }),
  autoSchedule: (eventId: string, b: Obj) => request<Proposal>('POST', `/events/${enc(eventId)}/schedule/auto`, { body: b }),
  bulkShift: (eventId: string, b: Obj) => request<Proposal>('POST', `/events/${enc(eventId)}/schedule/bulk-shift`, { body: b }),
  delay: (matchId: string, minutes: number, reason: string) => request<Proposal>('POST', `/matches/${enc(matchId)}/delay`, { body: { minutes, reason } }),
  proposals: (eventId: string) => request<{ items: Proposal[] }>('GET', `/events/${enc(eventId)}/schedule-proposals`),
  applyProposal: (id: string, b: Obj) => request<Proposal>('POST', `/schedule-proposals/${enc(id)}/apply`, { body: b }),
  rejectProposal: (id: string) => request<void>('POST', `/schedule-proposals/${enc(id)}/reject`),
  reschedule: (matchId: string, proposedAt: string, reason: string) => request<Obj>('POST', `/matches/${enc(matchId)}/reschedule-requests`, { body: { proposedAt, reason } }),
  agreeReschedule: (id: string) => request<Obj>('POST', `/reschedule-requests/${enc(id)}/agree`),
  decideReschedule: (id: string, approve: boolean, note: string) => request<Obj>('POST', `/reschedule-requests/${enc(id)}/decision`, { body: { approve, note } }),
  rescheduleRequests: (eventId: string) => request<{ items: Obj[] }>('GET', `/events/${enc(eventId)}/reschedule-requests`),
  myRescheduleRequests: () => request<{ items: Obj[] }>('GET', '/me/reschedule-requests'),
  calendar: () => request<{ items: Array<{ matchId: string; eventId: string; scheduledAt: string; estimated: boolean; durationMinutes: number; sides: string[]; state: string }> }>('GET', '/me/calendar'),
  calendarIcsUrl: () => `${API_BASE}/me/calendar.ics`,
  // room / selection / run
  room: (matchId: string, t?: string) => request<RoomView>('GET', `/matches/${enc(matchId)}/room`, { query: { t } }),
  openReadiness: (matchId: string) => request<PublicMatch>('POST', `/matches/${enc(matchId)}/readiness/open`),
  ready: (matchId: string) => request<PublicMatch>('POST', `/matches/${enc(matchId)}/ready`),
  messages: (matchId: string) => request<{ items: Array<{ _id: string; by: string; text: string; at: string; channel: string; hidden: boolean }> }>('GET', `/matches/${enc(matchId)}/messages`),
  send: (matchId: string, text: string, channel: 'private' | 'officials') => request<Obj>('POST', `/matches/${enc(matchId)}/messages`, { body: { text, channel } }),
  callReferee: (matchId: string, reason: string) => request<Obj>('POST', `/matches/${enc(matchId)}/referee-calls`, { body: { reason } }),
  updateCall: (id: string, state: 'acknowledged' | 'closed') => request<Obj>('POST', `/referee-calls/${enc(id)}`, { body: { state } }),
  refereeCalls: (eventId: string) => request<{ items: Array<{ _id: string; matchId: string; reason: string; state: string; createdAt: string }> }>('GET', `/events/${enc(eventId)}/referee-calls`),
  lobby: (matchId: string) => request<{ host: string; password: string }>('GET', `/matches/${enc(matchId)}/lobby`),
  setLobby: (matchId: string, host: string, password: string) => request<void>('PUT', `/matches/${enc(matchId)}/lobby`, { body: { host, password } }),
  selection: (matchId: string, t?: string) => request<SelectionView | null>('GET', `/matches/${enc(matchId)}/selection`, { query: { t } }),
  startSelection: (matchId: string) => request<SelectionView>('POST', `/matches/${enc(matchId)}/selection/start`),
  act: (matchId: string, step: number, value: string) => request<SelectionView>('POST', `/matches/${enc(matchId)}/selection/act`, { body: { step, value } }),
  run: (matchId: string, action: 'start' | 'resume' | 'reconnect') => request<PublicMatch>('POST', `/matches/${enc(matchId)}/run/${action}`),
  pause: (matchId: string, b: Obj) => request<PublicMatch>('POST', `/matches/${enc(matchId)}/run/pause`, { body: b }),
  disconnect: (matchId: string, side: number) => request<PublicMatch>('POST', `/matches/${enc(matchId)}/run/disconnect`, { body: { side } }),
  disconnectStatus: (matchId: string) => request<{ open: boolean; side: number | null; deadline: string | null; expired: boolean; onExpiry: string | null; serverTime: string }>('GET', `/matches/${enc(matchId)}/run/disconnect`),
  decide: (matchId: string, decision: string, reason: string) => request<PublicMatch>('POST', `/matches/${enc(matchId)}/run/decision`, { body: { decision, reason } }),
  surrender: (matchId: string, reason: string) => request<PublicMatch>('POST', `/matches/${enc(matchId)}/run/surrender`, { body: { reason } }),
  sanction: (matchId: string, b: Obj) => request<PublicMatch>('POST', `/matches/${enc(matchId)}/run/sanction`, { body: b }),
  timeline: (matchId: string, t?: string) => request<{ items: Array<{ seq: number; at: string; type: string; text?: string | null; publicText?: string | null; detail?: Obj }> }>('GET', `/matches/${enc(matchId)}/timeline`, { query: { t } }),
  submitResult: (matchId: string, outcome: Obj, evidenceFileIds: string[] = []) => request<PublicMatch>('POST', `/matches/${enc(matchId)}/results`, { body: { outcome, evidenceFileIds } }),
  finalize: (matchId: string, outcome: Obj | null = null) => request<PublicMatch>('POST', `/matches/${enc(matchId)}/finalize`, { body: { outcome } }),
  openIncident: (eventId: string, b: Obj) => request<Obj>('POST', `/events/${enc(eventId)}/incidents`, { body: b }),
  resolveIncident: (id: string, resume: boolean, note: string) => request<Obj>('POST', `/incidents/${enc(id)}/resolve`, { body: { resume, note } }),
  reviewItems: (eventId: string) => request<{ items: Array<{ _id: string; kind: string; state: string; detail: Obj; ref: { type: string; id: string }; createdAt: string; resolution: string | null }> }>('GET', `/events/${enc(eventId)}/review-items`),
  resolveReview: (id: string, resolution: string) => request<Obj>('POST', `/review-items/${enc(id)}/resolve`, { body: { resolution } }),
  // servers
  servers: (eventId: string) => request<{ items: Array<Obj & { _id: string; name: string; region: string; capacity: number; inUse: number; health: string; enabled: boolean }> }>('GET', `/events/${enc(eventId)}/servers`),
  createServer: (eventId: string, b: Obj) => request<Obj>('POST', `/events/${enc(eventId)}/servers`, { body: b }),
  serverHealth: (id: string, health: string, enabled: boolean) => request<Obj>('PATCH', `/servers/${enc(id)}/health`, { body: { health, enabled } }),
  allocate: (matchId: string, serverId: string | null, reason: string) => request<Obj>('POST', `/matches/${enc(matchId)}/server`, { body: { serverId, reason } }),
  switchServer: (matchId: string, toServerId: string | null, reason: string) => request<Obj>('POST', `/matches/${enc(matchId)}/server/switch`, { body: { toServerId, reason } }),
  integration: (gameId: string) => request<{ enabled: boolean; adapter: string; detail: string }>('GET', `/games/${enc(gameId)}/integration`),
  // LAN
  createVenue: (eventId: string, b: Obj) => request<Obj>('POST', `/events/${enc(eventId)}/venues`, { body: b }),
  addStation: (venueId: string, areaKey: string, label: string) => request<Obj>('POST', `/venues/${enc(venueId)}/stations`, { body: { areaKey, label } }),
  stations: (eventId: string) => request<{ items: Array<Obj & { _id: string; label: string; state: string; matchId: string | null; areaKey: string }> }>('GET', `/events/${enc(eventId)}/stations`),
  checklist: (stationId: string, items: Array<{ item: string; ok: boolean }>) => request<Obj>('PUT', `/stations/${enc(stationId)}/checklist`, { body: { items } }),
  fault: (stationId: string, note: string) => request<{ affectedMatchId: string | null }>('POST', `/stations/${enc(stationId)}/fault`, { body: { note } }),
  assignStation: (matchId: string, stationId: string, reason: string) => request<Obj>('POST', `/matches/${enc(matchId)}/station`, { body: { stationId, reason } }),
  equipment: (eventId: string) => request<{ items: Array<Obj & { _id: string; label: string; state: string; loan: Obj | null }> }>('GET', `/events/${enc(eventId)}/equipment`),
  addEquipment: (eventId: string, b: Obj) => request<Obj>('POST', `/events/${enc(eventId)}/equipment`, { body: b }),
  loan: (id: string, to: string, condition: string) => request<Obj>('POST', `/equipment/${enc(id)}/loan`, { body: { to, condition } }),
  returnEquipment: (id: string, condition: string, faulty: boolean) => request<Obj>('POST', `/equipment/${enc(id)}/return`, { body: { condition, faulty } }),
  personalEquipment: (eventId: string) => request<{ items: Array<Obj & { _id: string; item: string; state: string; principalId: string }> }>('GET', `/events/${enc(eventId)}/personal-equipment`),
  requestPersonal: (eventId: string, item: string) => request<Obj>('POST', `/events/${enc(eventId)}/personal-equipment`, { body: { item } }),
  decidePersonal: (id: string, approve: boolean, note: string) => request<Obj>('POST', `/personal-equipment/${enc(id)}/decision`, { body: { approve, note } }),
  credentials: (eventId: string) => request<{ items: Array<{ id: string; principalId: string; role: string; areas: string[]; state: string }> }>('GET', `/events/${enc(eventId)}/credentials`),
  issueCredential: (eventId: string, b: Obj) => request<Obj>('POST', `/events/${enc(eventId)}/credentials`, { body: b }),
  revokeCredential: (id: string) => request<void>('DELETE', `/credentials/${enc(id)}`),
  myQr: (eventId: string) => request<{ items: Array<{ credentialId: string; role: string; areas: string[]; qr: string }> }>('GET', `/events/${enc(eventId)}/my-qr`),
  admit: (eventId: string, qr: string, gate: string, area: string) => request<{ admitted: boolean; role: string; displayName: string | null; at: string }>('POST', `/events/${enc(eventId)}/admissions`, { body: { qr, gate, area } }),
  admitTicket: (eventId: string, code: string, gate: string, area: string) => request<{ admitted: boolean; at: string }>('POST', `/events/${enc(eventId)}/ticket-admissions`, { body: { code, gate, area } }),
  callUp: (matchId: string) => request<Obj>('POST', `/matches/${enc(matchId)}/callup`),
  offlineImports: (eventId: string) => request<{ items: Array<{ _id: string; procedureNo: string; kind: string; state: string; createdAt: string; rows: Array<{ row: number; data: Record<string, string>; status: string; conflict: string | null }> }> }>('GET', `/events/${enc(eventId)}/offline-imports`),
  importOffline: (eventId: string, procedureNo: string, kind: string, file: File) => multipart<Obj>(`/events/${enc(eventId)}/offline-imports`, { procedureNo, kind, file }),
  decideOffline: (id: string, decisions: Array<{ row: number; apply: boolean }>) => request<Obj>('POST', `/offline-imports/${enc(id)}/decisions`, { body: { decisions } }),
};
