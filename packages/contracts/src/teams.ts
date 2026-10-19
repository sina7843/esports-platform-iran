import { z } from 'zod';
import { LinkSchema, RecordSources } from './identity.js';

/** Chapter 5 — organizations, teams (one competitive lineup per game), membership, recruitment, scrims. */

export const SponsorSchema = z.object({ name: z.string().min(1).max(80), url: z.string().url().max(300).nullable().default(null), logoFileId: z.string().nullable().default(null) });

export const TeamRoles = ['owner', 'manager', 'captain', 'player', 'substitute', 'coach', 'analyst'] as const;
export type TeamRole = (typeof TeamRoles)[number];

export const OrganizationCreateSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
  description: z.string().max(2000).nullable().default(null),
  city: z.string().max(60).nullable().default(null),
  links: z.array(LinkSchema).max(10).default([]),
  sponsors: z.array(SponsorSchema).max(20).default([]),
  logoFileId: z.string().nullable().default(null),
});
export const OrganizationUpdateSchema = OrganizationCreateSchema.partial().extend({ expectedVersion: z.number().int() });

export const TeamCreateSchema = z.object({
  name: z.string().min(2).max(60),
  tag: z.string().min(2).max(6).regex(/^[A-Za-z0-9]+$/),
  gameId: z.string().min(1).max(64),
  organizationId: z.string().nullable().default(null),
  description: z.string().max(2000).nullable().default(null),
  city: z.string().max(60).nullable().default(null),
  links: z.array(LinkSchema).max(10).default([]),
  sponsors: z.array(SponsorSchema).max(20).default([]),
  logoFileId: z.string().nullable().default(null),
  coverFileId: z.string().nullable().default(null),
});
export const TeamUpdateSchema = TeamCreateSchema.omit({ gameId: true, organizationId: true }).partial().extend({ expectedVersion: z.number().int() });

export const InvitationStates = ['pending', 'accepted', 'declined', 'cancelled', 'expired'] as const;
export const TeamInviteSchema = z.object({ principalId: z.string().min(1).max(64), role: z.enum(TeamRoles).exclude(['owner']), message: z.string().max(500).nullable().default(null) });
export const JoinRequestSchema = z.object({ role: z.enum(TeamRoles).exclude(['owner', 'manager']), message: z.string().max(500).nullable().default(null) });
export const MembershipRoleChangeSchema = z.object({ role: z.enum(TeamRoles).exclude(['owner']) });
export const MembershipEndSchema = z.object({ reason: z.string().max(500).nullable().default(null) });

export const OwnershipTransferStates = ['pending', 'accepted', 'declined', 'cancelled', 'expired'] as const;
export const OwnershipTransferRequestSchema = z.object({
  toPrincipalId: z.string().min(1).max(64),
  /** The new owner must explicitly accept the listed responsibilities (TEAM-005). */
  responsibilitiesNote: z.string().max(1000).nullable().default(null),
});
export const OwnershipTransferAcceptSchema = z.object({ acceptResponsibilities: z.literal(true) });

export const CalendarKinds = ['practice', 'match', 'scrim', 'meeting', 'other'] as const;
export const CalendarEventSchema = z.object({
  kind: z.enum(CalendarKinds),
  title: z.string().min(1).max(120),
  startsAt: z.string(),
  endsAt: z.string(),
  note: z.string().max(1000).nullable().default(null),
  refId: z.string().nullable().default(null),
});

export const MembershipSnapshotQuerySchema = z.object({ at: z.string() });

// ---- recruitment (REC-001..005)
export const RecruitmentKinds = ['player', 'coach', 'analyst', 'manager'] as const;
export const RecruitmentAdSchema = z.object({
  kind: z.enum(RecruitmentKinds),
  gameId: z.string().min(1).max(64),
  role: z.string().max(40).nullable().default(null),
  level: z.string().max(40).nullable().default(null),
  city: z.string().max(60).nullable().default(null),
  activityHours: z.string().max(120).nullable().default(null),
  description: z.string().min(1).max(3000),
});
export const RecruitmentAdStates = ['open', 'closed'] as const;
export const ApplicationStates = ['applied', 'tryout_invited', 'under_review', 'accepted', 'rejected', 'withdrawn'] as const;
export const ApplicationCreateSchema = z.object({ message: z.string().max(2000).nullable().default(null) });
export const ApplicationDecisionSchema = z.object({ action: z.enum(['invite_tryout', 'start_review', 'accept', 'reject']), note: z.string().max(1000).nullable().default(null), expectedVersion: z.number().int() });
export const RecruitmentFilterSchema = z.object({ gameId: z.string().optional(), kind: z.enum(RecruitmentKinds).optional(), role: z.string().optional(), level: z.string().optional(), city: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().optional() });

// ---- scrims (REC-004/005)
export const ScrimRequestSchema = z.object({
  gameId: z.string().min(1).max(64),
  level: z.string().max(40).nullable().default(null),
  windowStart: z.string(),
  windowEnd: z.string(),
  server: z.string().max(60).nullable().default(null),
  conditions: z.string().max(1000).nullable().default(null),
});
export const ScrimStates = ['open', 'proposed', 'accepted', 'declined', 'played', 'cancelled'] as const;
export const ScrimProposeSchema = z.object({ proposedAt: z.string(), server: z.string().max(60).nullable().default(null), note: z.string().max(500).nullable().default(null) });
export const ScrimResultSchema = z.object({ scores: z.array(z.object({ teamId: z.string(), score: z.number().int().min(0) })).length(2), note: z.string().max(500).nullable().default(null), expectedVersion: z.number().int() });

// ---- public team page sections (TEAM-007); real shapes, empty with source 'none_yet' until ESP-03/05 produce data
export const TeamRecordSchema = z.object({ source: z.enum(RecordSources), played: z.number().int(), wins: z.number().int(), losses: z.number().int(), draws: z.number().int() });
export const TeamStandingsSchema = z.object({ source: z.enum(RecordSources), items: z.array(z.object({ eventId: z.string(), title: z.string(), rank: z.number().int(), points: z.number() })) });
export const TeamHonorsSchema = z.object({ source: z.enum(RecordSources), items: z.array(z.object({ eventId: z.string(), title: z.string(), placement: z.number().int(), awardedAt: z.string() })) });
