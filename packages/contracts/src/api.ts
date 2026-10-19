import { z } from 'zod';
import { GrantSchema, Roles, ScopeSchema, SensitiveActions } from './acl.js';
import { ApiErrorSchema } from './errors.js';

/** API resource schemas shared by server (validation + OpenAPI) and web client (typing). */

export const HealthSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string(),
  uptimeSeconds: z.number(),
  checks: z.record(
    z.string(),
    z.object({ status: z.enum(['ok', 'degraded', 'down', 'unconfigured']), detail: z.string().optional(), latencyMs: z.number().optional() }),
  ),
  serverTime: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;

export const PrincipalSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  locale: z.enum(['fa', 'en']),
  timeZone: z.string(),
  kind: z.enum(['user', 'service']),
});
export type Principal = z.infer<typeof PrincipalSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  principalId: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  lastSeenAt: z.string(),
  revokedAt: z.string().nullable(),
  userAgent: z.string().nullable(),
  current: z.boolean(),
});
export type Session = z.infer<typeof SessionSchema>;

export const MeResponseSchema = z.object({
  principal: PrincipalSchema,
  session: SessionSchema,
  grants: z.array(GrantSchema),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** Development-only session issuance for seeded identities. Production returns PROVIDER_NOT_CONFIGURED/404. */
export const DevSessionRequestSchema = z.object({
  principalId: z.string().min(1).max(64),
  devCode: z.string().min(1).max(128),
});

export const GrantRequestSchema = z.object({
  principalId: z.string().min(1).max(64),
  role: z.enum(Roles),
  scope: ScopeSchema,
  expiresAt: z.string().nullable().default(null),
  reason: z.string().max(500).nullable().default(null),
});

export const RevokeGrantRequestSchema = z.object({
  reason: z.string().max(500).nullable().default(null),
});

export const ApprovalStates = ['pending', 'approved', 'rejected', 'expired', 'executed'] as const;
export const ApprovalSchema = z.object({
  id: z.string(),
  action: z.enum(SensitiveActions),
  scope: ScopeSchema,
  payload: z.record(z.string(), z.unknown()),
  requestedBy: z.string(),
  requestedAt: z.string(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionReason: z.string().nullable(),
  state: z.enum(ApprovalStates),
  expiresAt: z.string(),
  version: z.number().int(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const ApprovalRequestSchema = z.object({
  action: z.enum(SensitiveActions),
  scope: ScopeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  reason: z.string().min(1).max(1000),
});

export const ApprovalDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().min(1).max(1000),
  expectedVersion: z.number().int(),
});

export const FileVisibility = ['private', 'public'] as const;
export const FileScanStates = ['pending', 'clean', 'infected', 'failed', 'skipped_dev'] as const;
export const FileRecordSchema = z.object({
  id: z.string(),
  visibility: z.enum(FileVisibility),
  scope: ScopeSchema,
  ownerPrincipalId: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  scanState: z.enum(FileScanStates),
  quarantined: z.boolean(),
  retentionClass: z.string(),
  retentionNoticeFa: z.string(),
  createdAt: z.string(),
  publicUrl: z.string().nullable(),
});
export type FileRecord = z.infer<typeof FileRecordSchema>;

export const SignedLinkSchema = z.object({ url: z.string(), expiresAt: z.string() });

export const AuditEntrySchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  at: z.string(),
  actorPrincipalId: z.string(),
  action: z.string(),
  target: z.object({ type: z.string(), id: z.string() }),
  scope: ScopeSchema,
  outcome: z.enum(['success', 'denied', 'failed']),
  details: z.record(z.string(), z.unknown()),
  requestId: z.string(),
  prevHash: z.string(),
  hash: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const ProviderHealthSchema = z.object({
  kind: z.enum(['payment', 'sms', 'email', 'storage', 'video', 'map', 'publisher', 'scanner']),
  adapter: z.string(),
  mode: z.enum(['development_double', 'production']),
  status: z.enum(['ok', 'degraded', 'down', 'unconfigured']),
  capabilities: z.array(z.string()),
  detail: z.string().optional(),
  checkedAt: z.string(),
});
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

export const ErrorResponse = ApiErrorSchema;
