import type {
  Approval,
  ErrorCode,
  Grant,
  Health,
  MeResponse,
  OutboxRecord,
  ProviderHealth,
  RealtimeEvent,
  Role,
  Scope,
  ScopeType,
  Session,
} from '@esp/contracts';

/** Base URL comes from configuration (VITE_API_BASE), defaulting to the same-origin proxy. */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api/v1';

export type ClientErrorCode = ErrorCode | 'NETWORK' | 'UNKNOWN';

export class ApiClientError extends Error {
  readonly code: ClientErrorCode;
  readonly requestId: string | null;
  readonly status: number;
  readonly details: unknown;
  constructor(init: { code: ClientErrorCode; message: string; requestId?: string | null; status: number; details?: unknown }) {
    super(init.message);
    this.name = 'ApiClientError';
    this.code = init.code;
    this.requestId = init.requestId ?? null;
    this.status = init.status;
    this.details = init.details;
  }
}

type Query = Record<string, string | number | undefined>;

export async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query } = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== '') qs.set(k, String(v));
  const url = `${API_BASE}${path}${qs.size ? `?${qs.toString()}` : ''}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-Requested-With'] = 'fetch'; // CSRF guard
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    const init: RequestInit = { method, credentials: 'include', headers };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    res = await fetch(url, init);
  } catch {
    throw new ApiClientError({ code: 'NETWORK', message: 'Network failure', status: 0 });
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const env = (data as { error?: { code?: ErrorCode; message?: string; requestId?: string; details?: unknown } } | null)?.error;
    throw new ApiClientError({
      code: env?.code ?? 'UNKNOWN',
      message: env?.message ?? res.statusText,
      requestId: env?.requestId ?? null,
      status: res.status,
      details: env?.details,
    });
  }
  return data as T;
}

// ---- response shapes not covered by @esp/contracts
export interface EventSummary {
  id: string;
  slug: string;
  name: string;
  state: string;
  visibility: string;
  timeZone: string;
  startsAt: string | null;
  endsAt: string | null;
  organizerOrgId: string;
}
export interface EventDetail {
  event: EventSummary;
  disciplines: {
    id: string;
    name: string;
    gameId: string;
    platform: string;
    mode: string;
    stages: { id: string; name: string; order: number; format: string; state: string }[];
  }[];
}
export interface MatchPublic {
  id: string;
  eventId: string;
  stageId: string;
  state: string;
  kind: string;
  scheduledAt: string | null;
  estimated: boolean;
  sides: { displayName: string; roster: { displayName: string; role: string }[] }[];
  resultVersion: number;
  version: number;
}
export interface Lobby {
  host: string;
  password: string;
  releasedAt: string | null;
}
export interface RealtimePoll {
  events: RealtimeEvent[];
  cursor: number;
  serverTime: string;
}
export interface GrantInput {
  principalId: string;
  role: Role;
  scope: Scope;
  expiresAt: string | null;
  reason: string | null;
}

export const api = {
  health: () => request<Health>('GET', '/health'),
  // auth
  devSession: (principalId: string, devCode: string) => request<MeResponse>('POST', '/auth/dev-session', { body: { principalId, devCode } }),
  me: () => request<MeResponse>('GET', '/auth/me'),
  logout: () => request<void>('POST', '/auth/logout'),
  sessions: () => request<{ items: Session[] }>('GET', '/auth/sessions'),
  revokeSession: (id: string) => request<void>('DELETE', `/auth/sessions/${encodeURIComponent(id)}`),
  // acl
  grants: (scopeType: ScopeType, scopeId: string) => request<{ items: Grant[] }>('GET', '/acl/grants', { query: { scopeType, scopeId } }),
  createGrant: (g: GrantInput) => request<Grant>('POST', '/acl/grants', { body: g }),
  revokeGrant: (id: string, reason: string | null) => request<void>('DELETE', `/acl/grants/${encodeURIComponent(id)}`, { body: { reason } }),
  // approvals
  approvals: (scopeType: ScopeType, scopeId: string) => request<{ items: Approval[] }>('GET', '/approvals', { query: { scopeType, scopeId } }),
  decideApproval: (id: string, decision: 'approve' | 'reject', reason: string, expectedVersion: number) =>
    request<Approval>('POST', `/approvals/${encodeURIComponent(id)}/decision`, { body: { decision, reason, expectedVersion } }),
  // realtime
  realtimeEvents: (after: number, channels = 'system') => request<RealtimePoll>('GET', '/realtime/events', { query: { after, channels, limit: 100 } }),
  realtimeStreamUrl: (after: number, channels = 'system') => `${API_BASE}/realtime/stream?after=${after}&channels=${encodeURIComponent(channels)}`,
  // public catalogue
  events: (cursor?: string, limit = 20) =>
    request<{ items: EventSummary[]; page: { nextCursor: string | null; limit: number } }>('GET', '/events', { query: { cursor, limit } }),
  event: (id: string) => request<EventDetail>('GET', `/events/${encodeURIComponent(id)}`),
  match: (id: string) => request<MatchPublic>('GET', `/matches/${encodeURIComponent(id)}`),
  lobby: (id: string) => request<Lobby>('GET', `/matches/${encodeURIComponent(id)}/lobby`),
  // ops
  providers: () => request<{ items: ProviderHealth[] }>('GET', '/ops/providers'),
  outbox: () => request<{ stats: Record<string, number>; deadLetters: OutboxRecord[] }>('GET', '/ops/outbox'),
  replay: (id: string) => request<OutboxRecord>('POST', `/ops/outbox/${encodeURIComponent(id)}/replay`),
  auditVerify: () => request<{ ok: boolean; checked: number; brokenAtSeq?: number }>('GET', '/ops/audit/verify'),
  // files
  file: (id: string) => request<unknown>('GET', `/files/${encodeURIComponent(id)}`),
  fileLink: (id: string) => request<{ url: string; expiresAt: string }>('POST', `/files/${encodeURIComponent(id)}/link`),
};
