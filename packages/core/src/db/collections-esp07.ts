import type { Collection, Db } from 'mongodb';

/**
 * ESP-07 documents: admin tasks and support tickets, bulk jobs, platform settings, legal documents and consents,
 * data-subject requests, retention policies and legal holds, deletion tombstones, backups, provider registry,
 * partner API clients, request nonces, outbound webhooks and their deliveries.
 */
export interface AdminNote {
  by: string;
  at: string;
  text: string;
}
export interface AdminTaskDoc {
  _id: string;
  scope: { type: 'site' | 'event'; id: string };
  title: string;
  description: string;
  ownerId: string | null;
  dueAt: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  state: 'open' | 'in_progress' | 'done' | 'cancelled';
  links: { matchId: string | null; paymentId: string | null; ticketId: string | null };
  notes: AdminNote[];
  handovers: Array<{ from: string; to: string; note: string; at: string }>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface SupportTicketDoc {
  _id: string;
  requesterId: string;
  subject: string;
  category: 'account' | 'payment' | 'registration' | 'match' | 'result' | 'content' | 'technical' | 'other';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  state: 'open' | 'pending' | 'resolved' | 'closed';
  assigneeId: string | null;
  links: { eventId: string | null; matchId: string | null; paymentId: string | null; registrationId: string | null };
  messages: Array<{ by: string; at: string; text: string; internal: boolean }>;
  history: Array<{ at: string; by: string; action: string; note: string | null }>;
  slaDueAt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface BulkJobDoc {
  _id: string;
  kind: 'registration.approve' | 'registration.reject' | 'match.shift' | 'notify';
  scope: { type: 'event'; id: string };
  params: Record<string, unknown>;
  items: Array<{ ref: string; label: string; preview: string; status: 'pending' | 'ok' | 'failed' | 'skipped'; error: string | null }>;
  state: 'previewed' | 'running' | 'done';
  createdBy: string;
  executedBy: string | null;
  createdAt: string;
  finishedAt: string | null;
}
export interface PlatformSettingDoc {
  _id: string;
  value: unknown;
  version: number;
  updatedBy: string;
  updatedAt: string;
  history: Array<{ value: unknown; by: string; at: string; reason: string }>;
}
export interface LegalDocumentDoc {
  _id: string; // `${kind}:${version}`
  kind: 'terms' | 'privacy' | 'consent_marketing' | 'retention';
  version: number;
  title: string;
  body: string;
  requiresAcceptance: boolean;
  effectiveAt: string;
  publishedBy: string;
  publishedAt: string;
}
export interface ConsentDoc {
  _id: string; // `${principalId}:${kind}:${version}`
  principalId: string;
  kind: LegalDocumentDoc['kind'];
  version: number;
  acceptedAt: string;
  withdrawnAt: string | null;
}
export interface DataRequestDoc {
  _id: string;
  principalId: string;
  kind: 'export' | 'correction' | 'deletion';
  state: 'open' | 'in_review' | 'completed' | 'rejected' | 'on_hold';
  detail: string;
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: string;
  completedAt: string | null;
}
export interface RetentionPolicyDoc {
  _id: string; // data class
  days: number | null; // null = keep for the life of the service
  basis: 'created' | 'case_closed' | 'result_final' | 'expired';
  /** OPS-002: identity/financial classes are blocked until an approved policy exists */
  approved: boolean;
  approvedBy: string | null;
  note: string;
  version: number;
  updatedAt: string;
}
export interface LegalHoldDoc {
  _id: string;
  scope: { kind: 'event' | 'principal' | 'case' | 'file'; id: string };
  reason: string;
  createdBy: string;
  createdAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
}
export interface DeletionTombstoneDoc {
  _id: string; // `${kind}:${ref}`
  kind: 'principal' | 'file';
  ref: string;
  at: string;
  reason: string;
}
export interface BackupRecordDoc {
  _id: string;
  startedAt: string;
  finishedAt: string | null;
  target: string; // label of the independent target (never a secret)
  file: string | null;
  sizeBytes: number;
  sha256: string | null;
  collections: number;
  documents: number;
  encrypted: boolean;
  ok: boolean;
  error: string | null;
}
export interface ProviderDoc {
  _id: string;
  category: 'sms' | 'payment' | 'storage' | 'cdn' | 'video' | 'email' | 'map' | 'search' | 'analytics' | 'errors' | 'metrics' | 'push' | 'publisher';
  name: string;
  origins: string[]; // network domains this provider needs (allowlist, INTG-006)
  iranian: boolean;
  selfHosted: boolean;
  publisherException: { gameId: string; reason: string } | null;
  evaluation: { capabilities: string[]; limits: string; costNote: string; contractRef: string | null; exitPlan: string; testedAt: string | null; testedBy: string | null; result: 'not_tested' | 'passed' | 'failed' };
  keyEnvNames: string[];
  quota: { perMinute: number | null; perDay: number | null };
  state: 'candidate' | 'evaluated' | 'selected' | 'rejected' | 'retired';
  decidedBy: string | null;
  decidedAt: string | null;
  createdBy: string;
  createdAt: string;
  version: number;
}
export interface PartnerClientDoc {
  _id: string;
  name: string;
  scopes: Array<'events:read' | 'results:read' | 'news:read' | 'webhooks:manage'>;
  eventIds: string[]; // empty = all public events
  keyId: string;
  secretEnc: string; // AES-GCM under the app key ring; never returned after creation
  quotaPerMinute: number;
  createdBy: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}
export interface PartnerNonceDoc {
  _id: string; // `${keyId}:${nonce}`
  at: Date;
}
export interface WebhookDoc {
  _id: string;
  clientId: string;
  url: string;
  events: string[];
  secretEnc: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
}
export interface WebhookDeliveryDoc {
  _id: string; // `${webhookId}:${eventId}` — one delivery per event per hook (idempotency)
  webhookId: string;
  eventId: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  state: 'pending' | 'delivered' | 'dead';
  nextAttemptAt: string;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface Esp07Collections {
  adminTasks: Collection<AdminTaskDoc>;
  supportTickets: Collection<SupportTicketDoc>;
  bulkJobs: Collection<BulkJobDoc>;
  platformSettings: Collection<PlatformSettingDoc>;
  legalDocuments: Collection<LegalDocumentDoc>;
  consents: Collection<ConsentDoc>;
  dataRequests: Collection<DataRequestDoc>;
  retentionPolicies: Collection<RetentionPolicyDoc>;
  legalHolds: Collection<LegalHoldDoc>;
  tombstones: Collection<DeletionTombstoneDoc>;
  backups: Collection<BackupRecordDoc>;
  providers: Collection<ProviderDoc>;
  partnerClients: Collection<PartnerClientDoc>;
  partnerNonces: Collection<PartnerNonceDoc>;
  webhooks: Collection<WebhookDoc>;
  webhookDeliveries: Collection<WebhookDeliveryDoc>;
}
export const esp07CollectionNames = {
  adminTasks: 'admin_tasks',
  supportTickets: 'support_tickets',
  bulkJobs: 'bulk_jobs',
  platformSettings: 'platform_settings',
  legalDocuments: 'legal_documents',
  consents: 'consents',
  dataRequests: 'data_requests',
  retentionPolicies: 'retention_policies',
  legalHolds: 'legal_holds',
  tombstones: 'deletion_tombstones',
  backups: 'backup_records',
  providers: 'provider_registry',
  partnerClients: 'partner_clients',
  partnerNonces: 'partner_nonces',
  webhooks: 'webhooks',
  webhookDeliveries: 'webhook_deliveries',
} as const;
export function esp07Collections(db: Db): Esp07Collections {
  const n = esp07CollectionNames;
  return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, db.collection(v)])) as unknown as Esp07Collections;
}
