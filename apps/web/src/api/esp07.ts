import { API_BASE, request } from './client';

/** ESP-07 endpoints: administration, support, privacy, providers, partner clients, operations. */
const enc = encodeURIComponent;
export type Obj = Record<string, unknown>;
type Row<T = Obj> = T & { _id: string };
type Items<T = Obj> = { items: Array<Row<T>> };

export interface Alert { level: 'warn' | 'critical'; kind: string; detail: string }
export interface EventOps {
  at: string; registrations: Record<string, number>; checkins: Record<string, number>; matches: Record<string, number>;
  live: Array<{ id: string; slot: string | null; state: string; sides: string[] }>; delayed: Array<{ id: string; slot: string | null; scheduledAt: string; state: string }>;
  cases: number; incidents: number; tickets: number; resources: { stations: Record<string, number>; servers: Array<{ name: string; health: string; free: number }> }; alerts: Alert[];
}
export interface BulkItem { ref: string; label: string; preview: string; status: 'pending' | 'ok' | 'failed' | 'skipped'; error: string | null }
export interface BulkJob { _id: string; kind: string; items: BulkItem[]; state: 'previewed' | 'running' | 'done' }
export interface Health {
  at: string; providers: Array<{ kind: string; adapter: string; mode: string; status: string; detail?: string }>; outbox: Record<string, number>; outboxLagSeconds: number;
  realtime: { lastSeq: number; lastAt: string | null; floor: number }; notifications: { pending: number; failed: number }; webhooks: { pending: number; dead: number };
  lastBackup: { at: string; sizeBytes: number; target: string } | null; disk: { totalBytes: number; freeBytes: number; usedPct: number } | null; alerts: Alert[];
}
export interface Readiness {
  at: string; ready: boolean;
  rows: Array<{ kind: string; provider: { id: string; name: string; iranian: boolean; selfHosted: boolean } | null; adapter: string | null; mode: string | null; status: string | null; keys: Array<{ name: string; set: boolean }>; ready: boolean; blockers: string[]; optional: boolean }>;
}
export interface LegalDoc { _id: string; kind: string; version: number; title: string; body: string; requiresAcceptance: boolean; effectiveAt: string }

export interface SmsProviderConfig {
  adapter: string; apiKeyConfigured: boolean; template: string | null; sender: string | null;
  health: { status: 'ok' | 'degraded' | 'down' | 'unconfigured'; detail?: string };
}
export const esp07 = {
  smsProvider: () => request<SmsProviderConfig>('GET', '/admin/providers/sms'),
  // users, settings, tasks
  users: (q: string) => request<{ items: Array<{ id: string; displayName: string; nickname: string | null; status: string; createdAt: string }> }>('GET', '/admin/users', { query: { q } }),
  setUserStatus: (id: string, status: 'active' | 'suspended', reason: string) => request<Obj>('POST', `/admin/users/${enc(id)}/status`, { body: { status, reason } }),
  settings: () => request<{ keys: string[]; items: Array<Row<{ value: unknown; version: number; updatedAt: string; history: Array<{ value: unknown; by: string; at: string; reason: string }> }>> }>('GET', '/admin/settings'),
  setSetting: (key: string, value: unknown, reason: string) => request<Obj>('PUT', `/admin/settings/${enc(key)}`, { body: { value, reason } }),
  tasks: (scopeType: 'site' | 'event', scopeId: string, f: { state?: string; mine?: boolean } = {}) => request<Items<{ title: string; description: string; ownerId: string | null; dueAt: string | null; priority: string; state: string; notes: Array<{ by: string; at: string; text: string }>; handovers: Array<{ from: string; to: string; note: string; at: string }>; version: number }>>('GET', '/admin/tasks', { query: { scopeType, scopeId, state: f.state, mine: f.mine ? 'true' : undefined } }),
  createTask: (b: Obj) => request<Obj>('POST', '/admin/tasks', { body: b }),
  updateTask: (id: string, b: Obj) => request<Obj>('PATCH', `/admin/tasks/${enc(id)}`, { body: b }),
  handover: (id: string, to: string, note: string) => request<Obj>('POST', `/admin/tasks/${enc(id)}/handover`, { body: { to, note } }),
  // support
  openTicket: (b: Obj) => request<Row<{ state: string; priority: string }>>('POST', '/support/tickets', { body: b }),
  myTickets: () => request<Items<{ subject: string; state: string; priority: string; category: string; slaDueAt: string; updatedAt: string }>>('GET', '/support/tickets/mine'),
  ticket: (id: string) => request<Row<{ subject: string; state: string; priority: string; category: string; assigneeId: string | null; slaDueAt: string; links: Obj; messages: Array<{ by: string; at: string; text: string; internal: boolean }>; history: Array<{ at: string; by: string; action: string }>; version: number }>>('GET', `/support/tickets/${enc(id)}`),
  reply: (id: string, text: string, internal: boolean) => request<Obj>('POST', `/support/tickets/${enc(id)}/reply`, { body: { text, internal } }),
  ticketQueue: (f: { state?: string; category?: string; assignee?: string; eventId?: string } = {}) => request<Items<{ subject: string; state: string; priority: string; category: string; assigneeId: string | null; slaDueAt: string; overdue: boolean; links: { eventId: string | null; matchId: string | null; paymentId: string | null } }>>('GET', '/admin/tickets', { query: f }),
  manageTicket: (id: string, b: Obj) => request<Obj>('PATCH', `/admin/tickets/${enc(id)}`, { body: b }),
  appeals: () => request<Items<{ targetType: string; reason: string; appeal: { by: string; text: string; at: string } }>>('GET', '/admin/appeals'),
  decideAppeal: (id: string, outcome: 'upheld' | 'reversed') => request<Obj>('POST', `/admin/appeals/${enc(id)}/decide`, { body: { outcome } }),
  appeal: (reportId: string, text: string) => request<Obj>('POST', `/community/reports/${enc(reportId)}/appeal`, { body: { text } }),
  // event operations, bulk, reports, health
  eventOps: (eventId: string) => request<EventOps>('GET', `/admin/events/${enc(eventId)}/ops`),
  bulkPreview: (b: Obj) => request<BulkJob>('POST', '/admin/bulk/preview', { body: b }),
  bulkExecute: (id: string) => request<BulkJob>('POST', `/admin/bulk/${enc(id)}/execute`),
  bulkList: (eventId: string) => request<{ items: BulkJob[] }>('GET', `/admin/events/${enc(eventId)}/bulk`),
  report: (from: string, to: string) => request<Obj>('GET', '/admin/reports', { query: { from, to } }),
  sponsorCsvUrl: (eventId: string) => `${API_BASE}/admin/events/${enc(eventId)}/sponsor.csv`,
  health: () => request<Health>('GET', '/admin/health'),
  rotateSecrets: () => request<Obj>('POST', '/admin/security/rotate-secrets'),
  // legal, consents, privacy
  legal: (kind: string) => request<LegalDoc | null>('GET', `/legal/${enc(kind)}`),
  legalPending: () => request<{ items: Array<{ kind: string; version: number; title: string }> }>('GET', '/legal/pending'),
  consents: () => request<{ items: Array<Row<{ kind: string; version: number; acceptedAt: string; withdrawnAt: string | null }>> }>('GET', '/legal/consents'),
  accept: (kind: string, version: number) => request<Obj>('POST', `/legal/${enc(kind)}/accept`, { body: { version } }),
  withdraw: (kind: string) => request<{ withdrawn: number }>('POST', `/legal/${enc(kind)}/withdraw`),
  publishLegal: (b: Obj) => request<Obj>('POST', '/admin/legal', { body: b }),
  legalHistory: (kind: string) => request<{ items: Array<{ id: string; version: number; title: string; effectiveAt: string; requiresAcceptance: boolean }> }>('GET', `/admin/legal/${enc(kind)}/history`),
  holds: () => request<Items<{ scope: { kind: string; id: string }; reason: string; createdAt: string }>>('GET', '/admin/holds'),
  placeHold: (kind: string, id: string, reason: string) => request<Obj>('POST', '/admin/holds', { body: { kind, id, reason } }),
  releaseHold: (id: string) => request<Obj>('POST', `/admin/holds/${enc(id)}/release`),
  retention: () => request<Items<{ days: number | null; approved: boolean; note: string; updatedAt: string }>>('GET', '/admin/retention'),
  setRetention: (id: string, b: { days: number | null; approved: boolean; note: string }) => request<Obj>('PUT', `/admin/retention/${enc(id)}`, { body: b }),
  runRetention: (dryRun: boolean) => request<{ at: string; dryRun: boolean; report: Record<string, { candidates: number; deleted: number; held: number }> }>('POST', '/admin/retention/run', { body: { dryRun } }),
  createRequest: (kind: 'export' | 'correction' | 'deletion', detail: string) => request<{ request: Row<{ state: string }>; export: Obj | null }>('POST', '/privacy/requests', { body: { kind, detail } }),
  myRequests: () => request<Items<{ kind: string; state: string; createdAt: string; decisionNote: string | null }>>('GET', '/privacy/requests'),
  requestQueue: () => request<Items<{ principalId: string; kind: string; state: string; detail: string; createdAt: string }>>('GET', '/admin/privacy/requests'),
  decideRequest: (id: string, decision: 'complete' | 'reject', note: string) => request<Obj>('POST', `/admin/privacy/requests/${enc(id)}/decide`, { body: { decision, note } }),
  // providers and partners
  providers: () => request<Items<{ category: string; name: string; origins: string[]; iranian: boolean; selfHosted: boolean; state: string; evaluation: { result: string; contractRef: string | null; exitPlan: string; limits: string; costNote: string; capabilities: string[] }; keyEnvNames: string[]; quota: { perMinute: number | null; perDay: number | null } }>>('GET', '/admin/providers'),
  saveProvider: (b: Obj) => request<Obj>('PUT', '/admin/providers', { body: b }),
  decideProvider: (id: string, decision: 'selected' | 'rejected' | 'retired') => request<Obj>('POST', `/admin/providers/${enc(id)}/decide`, { body: { decision } }),
  readiness: () => request<Readiness>('GET', '/admin/providers/readiness'),
  allowlist: () => request<{ origins: string[] }>('GET', '/admin/providers/allowlist'),
  partners: () => request<Items<{ name: string; keyId: string; scopes: string[]; eventIds: string[]; quotaPerMinute: number; revokedAt: string | null; lastUsedAt: string | null }>>('GET', '/admin/partners'),
  createPartner: (b: Obj) => request<{ id: string; keyId: string; secret: string }>('POST', '/admin/partners', { body: b }),
  rotatePartner: (id: string) => request<{ id: string; secret: string }>('POST', `/admin/partners/${enc(id)}/rotate`),
  revokePartner: (id: string) => request<{ ok: true }>('POST', `/admin/partners/${enc(id)}/revoke`),
  deliveries: (state: 'pending' | 'delivered' | 'dead') => request<Items<{ webhookId: string; type: string; attempts: number; lastError: string | null; state: string }>>('GET', '/admin/webhook-deliveries', { query: { state } }),
  replayDelivery: (id: string) => request<{ ok: true }>('POST', `/admin/webhook-deliveries/${enc(id)}/replay`),
};
