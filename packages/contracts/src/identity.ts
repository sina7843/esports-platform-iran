import { z } from 'zod';
import { normalizeDigits } from './time.js';

/**
 * Chapter 4 — accounts and player profiles (USR-001..011).
 * Phone numbers are stored in E.164 (+98…); any Persian/Arabic digits and local forms (09…, 0098…, +98…) normalize
 * to the same value so duplicate registration is impossible (unique index) and enumeration is not leaked.
 */
export function normalizeIranMobile(input: string): string | null {
  let s = normalizeDigits(input).replace(/[\s\-()]/g, '');
  if (s.startsWith('0098')) s = '+98' + s.slice(4);
  else if (s.startsWith('98') && s.length === 12) s = '+' + s;
  else if (s.startsWith('09')) s = '+98' + s.slice(1);
  else if (s.startsWith('9') && s.length === 10) s = '+98' + s;
  return /^\+989\d{9}$/.test(s) ? s : null;
}

export const IranMobileSchema = z
  .string()
  .min(10)
  .max(20)
  .transform((v, ctx) => {
    const n = normalizeIranMobile(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'invalid Iranian mobile number' });
      return z.NEVER;
    }
    return n;
  });

export const OtpPurposes = ['login', 'phone_change', 'email_verify', 'recovery', 'reauth'] as const;
export type OtpPurpose = (typeof OtpPurposes)[number];

export const OtpRequestSchema = z.object({ phone: IranMobileSchema });
export const OtpVerifySchema = z.object({ phone: IranMobileSchema, code: z.string().min(4).max(8).transform(normalizeDigits) });
export const OtpChallengeResponseSchema = z.object({
  challengeId: z.string(),
  expiresAt: z.string(),
  /** Always the same message whether or not the phone exists (no enumeration). */
  message: z.string(),
  resendAfterSeconds: z.number().int(),
});

export const PasswordSchema = z.string().min(10).max(200);
export const EmailSchema = z.string().email().max(254).transform((v) => v.trim().toLowerCase());

export const EmailRegisterSchema = z.object({ email: EmailSchema, password: PasswordSchema });
export const EmailLoginSchema = z.object({ email: EmailSchema, password: PasswordSchema, totpCode: z.string().optional() });
export const EmailVerifySchema = z.object({ code: z.string().min(4).max(8).transform(normalizeDigits) });

export const TotpSetupResponseSchema = z.object({ secret: z.string(), otpauthUri: z.string(), recoveryCodes: z.array(z.string()) });
export const TotpCodeSchema = z.object({ code: z.string().min(6).max(12).transform(normalizeDigits) });

/** Roles that require a second factor on the session before their permissions apply (USR-009). */
export const MfaRequiredRoles = ['platform_admin', 'finance_officer', 'head_referee', 'appeal_authority', 'disciplinary_admin', 'rules_officer'] as const;

export const PhoneChangeRequestSchema = z.object({ newPhone: IranMobileSchema });
export const RecoveryRequestSchema = z.object({ email: EmailSchema });
export const RecoveryVerifySchema = z.object({ email: EmailSchema, code: z.string().min(4).max(8).transform(normalizeDigits) });

// ---- profile
export const PrivacyLevels = ['public', 'followers', 'private'] as const;
export type PrivacyLevel = (typeof PrivacyLevels)[number];
export const PrivacyLevelSchema = z.enum(PrivacyLevels);

export const NicknameSchema = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[\p{L}\p{N}_.-]+$/u, 'letters, digits, _ . - only');

export const LinkSchema = z.object({ label: z.string().min(1).max(40), url: z.string().url().max(300) });

export const GameProfileSchema = z.object({
  gameId: z.string().min(1).max(64),
  roles: z.array(z.string().min(1).max(40)).max(8).default([]),
  declaredLevel: z.string().max(40).nullable().default(null),
  equipment: z.string().max(300).nullable().default(null),
  activityHours: z.string().max(120).nullable().default(null),
});

export const ProfileFieldPrivacySchema = z.object({
  realName: PrivacyLevelSchema.default('private'),
  city: PrivacyLevelSchema.default('public'),
  province: PrivacyLevelSchema.default('public'),
  links: PrivacyLevelSchema.default('public'),
  games: PrivacyLevelSchema.default('public'),
  activityHours: PrivacyLevelSchema.default('followers'),
  equipment: PrivacyLevelSchema.default('public'),
  bio: PrivacyLevelSchema.default('public'),
});

export const MessagePolicies = ['everyone', 'followers', 'teammates', 'nobody'] as const;

export const NotificationPrefsSchema = z.object({
  channels: z.object({ inApp: z.boolean().default(true), sms: z.boolean().default(true), email: z.boolean().default(false), push: z.boolean().default(false) }).default({ inApp: true, sms: true, email: false, push: false }),
  quietHours: z.object({ from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/) }).nullable().default(null),
  promotional: z.boolean().default(false),
  digestFrequent: z.boolean().default(true),
  /** Essential operational notifications (check-in, result, rulings) are always delivered (COM-003 exception). */
});

/** Patch semantics: only the listed fields change (zod defaults must not reset the others). */
export const ProfilePrivacyPatchSchema = z.object({
  realName: PrivacyLevelSchema.optional(),
  city: PrivacyLevelSchema.optional(),
  province: PrivacyLevelSchema.optional(),
  links: PrivacyLevelSchema.optional(),
  games: PrivacyLevelSchema.optional(),
  activityHours: PrivacyLevelSchema.optional(),
  equipment: PrivacyLevelSchema.optional(),
  bio: PrivacyLevelSchema.optional(),
});
/**
 * Notification preferences patch. There is deliberately NO switch for essential operational notifications
 * (check-in, results, rulings, security): they are always delivered; only promotional/digest/channels are optional.
 */
export const NotificationPrefsPatchSchema = z.object({
  channels: z.object({ inApp: z.boolean().optional(), sms: z.boolean().optional(), email: z.boolean().optional(), push: z.boolean().optional() }).optional(),
  quietHours: z.object({ from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/) }).nullable().optional(),
  promotional: z.boolean().optional(),
  digestFrequent: z.boolean().optional(),
});

export const ProfileUpdateSchema = z.object({
  nickname: NicknameSchema.optional(),
  realName: z.string().max(120).nullable().optional(),
  bio: z.string().max(1000).nullable().optional(),
  province: z.string().max(60).nullable().optional(),
  city: z.string().max(60).nullable().optional(),
  links: z.array(LinkSchema).max(10).optional(),
  avatarFileId: z.string().nullable().optional(),
  coverFileId: z.string().nullable().optional(),
  games: z.array(GameProfileSchema).max(20).optional(),
  privacy: ProfilePrivacyPatchSchema.optional(),
  notificationPrefs: NotificationPrefsPatchSchema.optional(),
  messagePolicy: z.enum(MessagePolicies).optional(),
  lookingForTeam: z.object({ active: z.boolean(), resume: z.string().max(2000).nullable().default(null), gameIds: z.array(z.string()).max(10).default([]) }).optional(),
  locale: z.enum(['fa', 'en']).optional(),
  timeZone: z.string().max(64).optional(),
  expectedVersion: z.number().int(),
});

export const GameIdentityVerificationStates = ['unverified', 'pending', 'verified', 'rejected', 'disputed'] as const;
export const GameIdentityCreateSchema = z.object({
  gameId: z.string().min(1).max(64),
  platform: z.string().min(1).max(40),
  value: z.string().min(1).max(120),
  method: z.enum(['manual', 'publisher']).default('manual'),
  /** Who may see the value on the public profile. */
  visibility: PrivacyLevelSchema.default('public'),
});

export const BadgeKinds = ['identity', 'game_identity', 'org_position'] as const;
export const BadgeSchema = z.object({
  id: z.string(),
  principalId: z.string(),
  kind: z.enum(BadgeKinds),
  issuer: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  ref: z.record(z.string(), z.unknown()),
});

export const FollowTargetTypes = ['player', 'team', 'game', 'organizer', 'event'] as const;
export const FollowSchema = z.object({ targetType: z.enum(FollowTargetTypes), targetId: z.string().min(1).max(64) });

export const AccountReviewStates = ['open', 'resolved_distinct', 'resolved_merged_manually', 'resolved_suspended'] as const;

// ---- auth additions (USR-001/009/010, ADM-012)
export const OtpCodeSchema = z.object({ code: z.string().min(4).max(8).transform(normalizeDigits) });
export const PhoneChangeVerifySchema = z.object({ newPhone: IranMobileSchema, code: z.string().min(4).max(8).transform(normalizeDigits) });
export const AccountDeleteSchema = z.object({ confirm: z.literal(true) });
export const MfaStatusSchema = z.object({ enabled: z.boolean(), enabledAt: z.string().nullable(), sessionVerified: z.boolean(), requiredByRole: z.boolean(), enforced: z.boolean() });
export const AccountExportSchema = z.object({ exportedAt: z.string(), data: z.record(z.string(), z.unknown()) });
export const DevInboxSmsQuerySchema = z.object({ phone: IranMobileSchema });

// ---- profiles + social (USR-003..008, USR-010, USR-011)
export const GameIdentityUpdateSchema = z
  .object({ value: z.string().min(1).max(120).optional(), visibility: PrivacyLevelSchema.optional(), expectedVersion: z.number().int() })
  .refine((v) => v.value !== undefined || v.visibility !== undefined, { message: 'nothing to change' });
export const GameIdentityVerifySchema = z.object({ expiresAt: z.string().datetime().nullable().default(null), note: z.string().max(300).nullable().default(null) });
/** `value: null` clears the verified level. Only a holder of `badge.issue` (site scope) may call this. */
export const VerifiedLevelSchema = z.object({ gameId: z.string().min(1).max(64), value: z.string().min(1).max(40).nullable() });

/** Identity badges keep ONLY issuer + reference text: no identity documents are stored (retention policy not approved, OPS-002). */
export const BadgeIssueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('identity'), principalId: z.string().min(1), referenceText: z.string().min(1).max(200), expiresAt: z.string().datetime().nullable().default(null) }),
  z.object({ kind: z.literal('game_identity'), gameIdentityId: z.string().min(1), expiresAt: z.string().datetime().nullable().default(null), note: z.string().max(300).nullable().default(null) }),
  z.object({ kind: z.literal('org_position'), principalId: z.string().min(1), organizationId: z.string().min(1), position: z.string().min(1).max(60), expiresAt: z.string().datetime().nullable().default(null) }),
]);
export const BadgeRevokeSchema = z.object({ reason: z.string().min(3).max(300) });

export const AccountReviewDecisions = ['resolved_distinct', 'resolved_merged_manually', 'resolved_suspended'] as const;
/** Recording a decision never merges data. `suspendPrincipalIds` is required (and only valid) for resolved_suspended. */
export const AccountReviewDecisionSchema = z
  .object({ decision: z.enum(AccountReviewDecisions), note: z.string().min(3).max(1000), suspendPrincipalIds: z.array(z.string()).max(10).default([]), expectedVersion: z.number().int().optional() })
  .refine((v) => (v.decision === 'resolved_suspended') === (v.suspendPrincipalIds.length > 0), { message: 'suspendPrincipalIds is required exactly for resolved_suspended' });

export const PlayerSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(40).optional(),
  gameId: z.string().max(64).optional(),
  city: z.string().trim().max(60).optional(),
  lookingForTeam: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const AccountReviewQuerySchema = z.object({ state: z.enum(AccountReviewStates).optional(), cursor: z.string().max(512).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });

/** Section shapes for ESP-03/05 data. Until those stages exist the source is 'none_yet' and the arrays are empty: nothing is fabricated (USR-006). */
export const RecordSources = ['none_yet', 'computed'] as const;
export const CompetitiveRecordSchema = z.object({
  source: z.enum(RecordSources),
  items: z.array(z.object({ gameId: z.string(), played: z.number().int(), wins: z.number().int(), losses: z.number().int(), draws: z.number().int() })),
  recent: z.array(z.object({ matchId: z.string(), eventId: z.string(), eventName: z.string(), opponent: z.string(), result: z.enum(['W', 'L', 'D']), forfeit: z.boolean(), at: z.string() })).optional(),
});
const HonorItem = z.object({ eventId: z.string(), title: z.string(), placement: z.number().int(), awardedAt: z.string(), id: z.string().optional(), kind: z.string().optional(), label: z.string().optional(), state: z.string().optional(), verifyCode: z.string().optional() });
const DeclaredItem = z.object({ id: z.string(), title: z.string(), eventName: z.string(), year: z.number().int().nullable(), state: z.string(), label: z.string() });
export const HonorsSchema = z.object({
  source: z.enum(RecordSources),
  items: z.array(HonorItem),
  declared: z.array(DeclaredItem).optional(),
});
export const RatingChartSchema = z.object({
  source: z.enum(RecordSources),
  points: z.array(z.object({ at: z.string(), gameId: z.string(), rating: z.number() })),
  label: z.enum(['official', 'internal_unapproved']).optional(),
});
