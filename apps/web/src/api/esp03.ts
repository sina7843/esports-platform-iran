import { API_BASE, ApiClientError, request, type ClientErrorCode } from './client';

/** ESP-03 endpoints: event setup, registration/roster/check-in, orders/payments, finance. */
const enc = encodeURIComponent;
type Obj = Record<string, unknown>;

export interface PublicDiscipline {
  id: string; name: string; gameId: string; gameVersion: string; platform: string; mode: string; participantKind: 'team' | 'player';
  capacity: number; remaining: number; waitlisted: number; feeRial: number;
  registrationOpensAt: string | null; registrationClosesAt: string | null; lateRegistrationUntil: string | null; withdrawalDeadline: string | null; presence: string;
  formFields: { key: string; label: string; type: string; required: boolean; options: string[] | null }[];
  requiredDocuments: { key: string; label: string; retentionClass: string }[];
  rules: { packageId: string; version: string; label: string; hash: string; clauses: { key: string; kind: string; value: unknown; citation?: string }[] } | null;
  stages: { id: string; name: string; order: number; format: string; state: string }[];
}
export interface EventFull {
  event: {
    id: string; slug: string; name: string; state: string; visibility: string; timeZone: string; startsAt: string | null; endsAt: string | null; organizerOrgId: string; version: number;
    description: string | null; presence: string; regions: string[]; language: string; contact: string | null; rated: boolean;
    refundPolicy: { beforeDeadlinePercent: number; afterDeadlinePercent: number; onEventCancelPercent: number; onDisqualificationPercent: number; text: string } | null;
    cancellationTerms: string | null; disputeTerms: string | null; robots: 'index' | 'noindex'; posterUrl: string | null;
  };
  badges: { rated: boolean; organizerVerified: boolean; affiliation: { kind: string; body: string } | null };
  disciplines: PublicDiscipline[];
  prizes: { id: string; title: string; kind: string; amountRial: number; responsible: string; state: string; guaranteed: false }[];
  sponsors: { id: string; sponsorName: string; placement: string; label: string }[];
}
export interface Registration {
  id: string; trackingCode: string; eventId: string; disciplineId: string; kind: string; teamId: string | null; displayName: string; quotaKind: string; state: string;
  roster: { principalId: string; displayName: string; role: string; status: string }[];
  formAnswers: Record<string, unknown>; eligibility: { ok: boolean; issues: { code: string; message: string; clause: string | null; needsReview: boolean }[] };
  reservationExpiresAt: string | null; waitlisted: boolean; waitlistSeq: number | null; feeRial: number; orderId: string | null; participationId: string | null; late: boolean;
  history: { at: string; by: string; transition: string; note: string | null }[]; createdAt: string; version: number;
}
export interface Order {
  id: string; kind: string; items: { description: string; amountRial: number; quantity: number }[]; subtotalRial: number; discountRial: number; feeRial: number; totalRial: number;
  priceVersion: number | null; refs: Obj; state: string; receiptNo: string | null; createdAt: string;
  payments: { id: string; state: string; amountRial: number; manual: boolean; refundedRial: number; verifiedAt: string | null }[];
}
export interface ManageView {
  event: { id: string; name: string; slug: string; state: string; visibility: string; startsAt: string | null; organizerOrgId: string; config: Obj & { linkToken: string | null; prizes: unknown[]; posterFileId: string | null; affiliation?: { kind: string; body: string; state: string; note: string | null } | null }; version: number };
  disciplines: { id: string; name: string; gameId: string; gameVersion: string; platform: string; mode: string; config: Obj & { capacity: number; feeRial: number; participantKind: string }; rulesFrozen: boolean; version: number }[];
  stages: { id: string; disciplineId: string; name: string; order: number; format: string; state: string; presence: string; dependsOnStageIds: string[]; links: { fromStageId: string | null; kind: string; slots: number; points: string; factor: number | null }[]; startException: Obj | null }[];
  publishCheck: { ok: boolean; problems: { code: string; message: string; ref: string | null }[] };
}

/** Multipart POST; the JSON client cannot send files. Same CSRF header and error envelope as `request`. */
async function postMultipart<T>(path: string, fields: Record<string, string | File>): Promise<T> {
  const fd = new FormData();
  // metadata fields first: the server reads parts in order
  for (const [k, v] of Object.entries(fields)) if (typeof v === 'string') fd.append(k, v);
  for (const [k, v] of Object.entries(fields)) if (typeof v !== 'string') fd.append(k, v);
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'fetch', Accept: 'application/json' }, body: fd });
  const data = (await res.json().catch(() => null)) as Obj | null;
  const err = data?.['error'] as Obj | undefined;
  if (!res.ok) throw new ApiClientError({ code: (err?.['code'] as ClientErrorCode | undefined) ?? 'UNKNOWN', message: String(err?.['message'] ?? res.statusText), requestId: (err?.['requestId'] as string | undefined) ?? null, status: res.status });
  return data as T;
}

export const esp03 = {
  // public + registration
  event: (id: string, token?: string) => request<EventFull>('GET', `/events/${enc(id)}`, { query: { t: token } }),
  register: (disciplineId: string, b: Obj) => request<Registration>('POST', `/disciplines/${enc(disciplineId)}/registrations`, { body: b }),
  myRegistrations: () => request<{ items: Registration[] }>('GET', '/me/registrations'),
  registration: (id: string) => request<Registration>('GET', `/registrations/${enc(id)}`),
  rosterResponse: (id: string, decision: 'confirm' | 'decline') => request<Registration>('POST', `/registrations/${enc(id)}/roster-response`, { body: { decision } }),
  editRegistration: (id: string, b: Obj) => request<Registration>('PATCH', `/registrations/${enc(id)}`, { body: b }),
  substitute: (id: string, b: Obj) => request<Obj>('POST', `/registrations/${enc(id)}/substitutions`, { body: b }),
  withdraw: (id: string) => request<Registration>('POST', `/registrations/${enc(id)}/withdraw`),
  reReview: (id: string) => request<Registration>('POST', `/registrations/${enc(id)}/re-review`),
  checkIn: (level: string, ref: string) => request<Obj>('POST', '/checkins', { body: { level, ref } }),
  // orders and payments
  order: (id: string) => request<Order>('GET', `/orders/${enc(id)}`),
  myOrders: () => request<{ items: Order[] }>('GET', '/me/orders'),
  pay: (orderId: string, returnUrl: string) => request<{ paymentId: string; redirectUrl: string | null }>('POST', `/orders/${enc(orderId)}/pay`, { body: { returnUrl } }),
  verifyPayment: (paymentId: string) => request<{ id: string; state: string; orderId: string }>('POST', `/payments/${enc(paymentId)}/verify`),
  myTickets: () => request<{ items: { id: string; eventId: string; state: string; code: string | null; orderId: string }[] }>('GET', '/me/tickets'),
  buyTickets: (eventId: string, quantity: number) => request<{ orderId: string }>('POST', `/events/${enc(eventId)}/tickets`, { body: { quantity } }),
  mySubscriptions: () => request<{ items: Obj[] }>('GET', '/me/subscriptions'),
  cancelSubscription: (id: string) => request<Obj>('POST', `/subscriptions/${enc(id)}/cancel`),
  subscribe: (plan: string, holderRef: string) => request<{ subscription: Obj; orderId: string }>('POST', '/subscriptions', { body: { plan, holderRef, autoRenew: false } }),
  // organizer
  orgEvents: (orgId: string) => request<{ items: Obj[] }>('GET', `/organizations/${enc(orgId)}/events`),
  createEvent: (b: Obj) => request<{ id: string }>('POST', '/events', { body: b }),
  manage: (id: string) => request<ManageView>('GET', `/events/${enc(id)}/manage`),
  updateEvent: (id: string, b: Obj) => request<Obj>('PATCH', `/events/${enc(id)}`, { body: b }),
  addDiscipline: (eventId: string, b: Obj) => request<Obj>('POST', `/events/${enc(eventId)}/disciplines`, { body: b }),
  addStage: (disciplineId: string, b: Obj) => request<Obj>('POST', `/disciplines/${enc(disciplineId)}/stages`, { body: b }),
  claimAffiliation: (eventId: string, b: Obj) => request<Obj>('POST', `/events/${enc(eventId)}/affiliation`, { body: b }),
  decideAffiliation: (eventId: string, decision: 'verify' | 'reject', note: string) => request<Obj>('POST', `/events/${enc(eventId)}/affiliation/decision`, { body: { decision, note } }),
  pendingAffiliations: () => request<{ items: { eventId: string; name: string; organizerOrgId: string; affiliation: { kind: string; body: string; evidenceFileId: string; claimedBy: string } }[] }>('GET', '/affiliations/pending'),
  canStart: (stageId: string) => request<Obj>('GET', `/stages/${enc(stageId)}/can-start`),
  startException: (stageId: string, approvalId: string, reason: string) => request<Obj>('POST', `/stages/${enc(stageId)}/start-exception`, { body: { approvalId, reason } }),
  seasons: (gameId?: string) => request<{ items: Obj[] }>('GET', '/seasons', { query: { gameId } }),
  createSeason: (b: Obj) => request<Obj>('POST', '/seasons', { body: b }),
  slots: (disciplineId: string) => request<{ items: Obj[] }>('GET', `/disciplines/${enc(disciplineId)}/slots`),
  createSlot: (disciplineId: string, b: Obj) => request<Obj>('POST', `/disciplines/${enc(disciplineId)}/slots`, { body: b }),
  publish: (id: string) => request<Obj>('POST', `/events/${enc(id)}/publish`),
  schedule: (id: string, publishAt: string, expectedVersion: number) => request<Obj>('POST', `/events/${enc(id)}/schedule`, { body: { publishAt, expectedVersion } }),
  duplicate: (id: string, slug: string, name: string, asTemplate: boolean) => request<{ id: string }>('POST', `/events/${enc(id)}/duplicate`, { body: { slug, name, asTemplate } }),
  transition: (id: string, transition: string, expectedVersion: number) => request<Obj>('POST', `/events/${enc(id)}/transitions`, { body: { transition, expectedVersion } }),
  cancelEvent: (id: string, approvalId: string, reason: string) => request<Obj>('POST', `/events/${enc(id)}/cancel`, { body: { approvalId, reason } }),
  requestApproval: (action: string, scope: { type: string; id: string }, reason: string) => request<{ id: string; state: string }>('POST', '/approvals', { body: { action, scope, payload: {}, reason } }),
  registrations: (disciplineId: string) => request<{ items: Registration[] }>('GET', `/disciplines/${enc(disciplineId)}/registrations`),
  decide: (id: string, action: string, reason: string | null, expectedVersion: number) => request<Registration>('POST', `/registrations/${enc(id)}/decision`, { body: { action, reason, expectedVersion } }),
  exportUrl: (disciplineId: string) => `${API_BASE}/disciplines/${enc(disciplineId)}/registrations.csv`,
  entryCodes: (disciplineId: string, quotaKind: string, count: number) => request<{ items: { _id: string }[] }>('POST', `/disciplines/${enc(disciplineId)}/entry-codes`, { body: { quotaKind, count, holderKey: null, maxUses: 1, expiresAt: null } }),
  lockRoster: (level: string, ref: string) => request<{ items: Obj[] }>('POST', '/roster-locks', { body: { level, ref } }),
  checkins: (level: string, ref: string) => request<{ items: Obj[] }>('GET', '/checkins', { query: { level, ref } }),
  manualCheckin: (b: Obj) => request<Obj>('POST', '/checkins/manual', { body: b }),
  finalizeCheckins: (level: string, ref: string) => request<{ items: Obj[] }>('POST', '/checkins/finalize', { body: { level, ref } }),
  prizes: (eventId: string) => request<{ items: Obj[] }>('GET', `/events/${enc(eventId)}/prizes`),
  financials: (eventId: string) => request<Obj>('GET', `/events/${enc(eventId)}/financials`),
  configureTickets: (eventId: string, capacity: number, priceRial: number) => request<void>('POST', `/events/${enc(eventId)}/tickets/config`, { body: { capacity, priceRial } }),
  addSponsor: (eventId: string, b: Obj) => request<Obj>('POST', `/events/${enc(eventId)}/sponsors`, { body: b }),
  approveSponsor: (id: string, note: string) => request<Obj>('POST', `/sponsors/${enc(id)}/approve`, { body: { note } }),
  sponsors: (eventId: string) => request<{ items: Obj[] }>('GET', `/events/${enc(eventId)}/sponsors`),
  prizeRecipient: (id: string, b: Obj) => request<Obj>('POST', `/prizes/${enc(id)}/recipient`, { body: b }),
  prizePayout: (id: string, b: Obj) => request<Obj>('POST', `/prizes/${enc(id)}/payout`, { body: b }),
  prizePaid: (id: string, b: Obj) => request<Obj>('POST', `/prizes/${enc(id)}/paid`, { body: b }),
  useTicket: (code: string) => request<Obj>('POST', '/tickets/use', { body: { code } }),
  /** REG-007: CSV invite import (holderKey, quota). */
  importInvites: (disciplineId: string, file: File) => postMultipart<{ created: { row: number; holderKey: string; code: string }[]; errors: { row: number; error: string }[] }>(`/disciplines/${enc(disciplineId)}/invites/import`, { file }),
  /** REG-001 documents (private, scanned) and EVT-001 posters (public). */
  uploadFile: (file: File, meta: { visibility: 'private' | 'public'; scopeType: string; scopeId: string; retentionClass: string }) => postMultipart<{ id: string; scanState: string }>('/files', { ...meta, file }),
  // finance
  reconciliation: () => request<{ unknownPayments: Obj[]; providerVerifiedAfterFailure: Obj[]; openRefunds: Obj[]; paidWithoutCapacity: Obj[] }>('GET', '/finance/reconciliation'),
  runReconciliation: () => request<Obj>('POST', '/finance/reconciliation/run'),
  refund: (paymentId: string, b: Obj) => request<Obj>('POST', `/payments/${enc(paymentId)}/refunds`, { body: b }),
  manualPayment: (b: Obj) => request<Obj>('POST', '/finance/manual-payments', { body: b }),
  priceVersion: (b: Obj) => request<Obj>('POST', '/finance/prices', { body: b }),
  priceHistory: (key: string) => request<{ items: Obj[] }>('GET', `/finance/prices/${enc(key)}`),
  discount: (b: Obj) => request<Obj>('POST', '/finance/discounts', { body: b }),
  ledgerCsvUrl: () => `${API_BASE}/finance/ledger.csv`,
  balance: (orgId: string) => request<{ organizationId: string; payableRial: number }>('GET', `/organizations/${enc(orgId)}/balance`),
  settle: (orgId: string, b: Obj) => request<{ txId: string }>('POST', `/organizations/${enc(orgId)}/settlements`, { body: b }),
};
