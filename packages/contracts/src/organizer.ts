import { z } from 'zod';
import { LinkSchema } from './identity.js';
import { SponsorSchema } from './teams.js';

/** Chapter 12 (ADM-002/003/004/010) — organizer applications, profiles, limits and participant ratings. */

export const OrganizerApplicationStates = ['submitted', 'needs_info', 'under_review', 'approved', 'rejected'] as const;
export const OrganizerApplicationSchema = z.object({
  organizationId: z.string().min(1).max(64),
  description: z.string().min(20).max(4000),
  experience: z.string().max(4000).nullable().default(null),
  contactPhone: z.string().max(20).nullable().default(null),
  documentFileIds: z.array(z.string()).max(10).default([]),
});
export const OrganizerReviewSchema = z.object({
  action: z.enum(['request_info', 'start_review', 'approve', 'reject']),
  note: z.string().min(1).max(2000),
  /** Required on approve: trust level and operational limits (ADM-004). */
  level: z.enum(['basic', 'trusted', 'partner']).optional(),
  limits: z.object({ maxActiveEvents: z.number().int().min(0).max(1000), maxCapacityPerEvent: z.number().int().min(0).max(100000), paidEventsAllowed: z.boolean() }).optional(),
  expectedVersion: z.number().int(),
});

export const OrganizerProfileUpdateSchema = z.object({
  intro: z.string().max(4000).nullable().optional(),
  staff: z.array(z.object({ principalId: z.string().nullable().default(null), name: z.string().min(1).max(80), role: z.string().min(1).max(60) })).max(50).optional(),
  venue: z.string().max(300).nullable().optional(),
  venueAddressText: z.string().max(500).nullable().optional(),
  facilities: z.array(z.string().max(80)).max(30).optional(),
  links: z.array(LinkSchema).max(10).optional(),
  sponsors: z.array(SponsorSchema).max(20).optional(),
  expectedVersion: z.number().int(),
});

export const OrganizerRatingSchema = z.object({ eventId: z.string().min(1).max(64), score: z.number().int().min(1).max(5), comment: z.string().max(2000).nullable().default(null) });
export const OrganizerRatingModerationSchema = z.object({ action: z.enum(['hide', 'unhide']), reason: z.string().min(5).max(1000) });

export const OrganizerResubmitSchema = z.object({
  description: z.string().min(20).max(4000).optional(),
  experience: z.string().max(4000).nullable().optional(),
  contactPhone: z.string().max(20).nullable().optional(),
  documentFileIds: z.array(z.string()).max(10).optional(),
  note: z.string().min(1).max(2000),
  expectedVersion: z.number().int(),
});
/** Revoke/suspend a verification; the reason is mandatory and kept in the audit trail. */
export const OrganizerVerificationRevokeSchema = z.object({ reason: z.string().min(5).max(1000) });
export const OrganizerListQuerySchema = z.object({ city: z.string().max(60).optional(), level: z.enum(['basic', 'trusted', 'partner']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
export const OrganizerRatingModerationListSchema = z.object({ organizationId: z.string().max(64).optional(), state: z.enum(['visible', 'hidden']).optional() });
