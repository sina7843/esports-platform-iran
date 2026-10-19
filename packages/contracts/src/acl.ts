import { z } from 'zod';

/**
 * Chapter 3 — contextual access control.
 * A grant binds a role to a principal inside ONE scope (site, organization, team, event, match).
 * Permission checks are deny-by-default and always resolved against the scope of the resource
 * being accessed; a "site" role never silently implies access to an organization's or event's data
 * unless the permission matrix explicitly says so (see `scopeInheritance`).
 */
export const ScopeTypes = ['site', 'organization', 'team', 'event', 'match'] as const;
export type ScopeType = (typeof ScopeTypes)[number];

export const ScopeSchema = z.object({
  type: z.enum(ScopeTypes),
  id: z.string().min(1).max(64), // 'site' uses id 'site'
});
export type Scope = z.infer<typeof ScopeSchema>;
export const SITE_SCOPE: Scope = { type: 'site', id: 'site' };

export const Roles = [
  'guest',
  'player',
  'team_owner',
  'team_manager',
  'team_captain',
  'coach',
  'analyst',
  'organizer',
  'event_operator',
  'referee',
  'head_referee',
  'appeal_authority',
  'reporter',
  'photographer',
  'editor',
  'broadcast_crew',
  'finance_officer',
  'support_moderator',
  'platform_admin',
  'rules_officer',
  'disciplinary_admin',
] as const;
export type Role = (typeof Roles)[number];

/** Which scope types a role may be granted in. Granting elsewhere is rejected at the API boundary. */
export const roleScopeTypes: Record<Role, readonly ScopeType[]> = {
  guest: ['site'],
  player: ['site'],
  team_owner: ['team', 'organization'],
  team_manager: ['team'],
  team_captain: ['team'],
  coach: ['team'],
  analyst: ['team'],
  organizer: ['organization', 'event'],
  event_operator: ['event'],
  referee: ['event', 'match'],
  head_referee: ['event'],
  appeal_authority: ['event'],
  reporter: ['event', 'site'],
  photographer: ['event', 'site'],
  editor: ['site', 'event'],
  broadcast_crew: ['event'],
  finance_officer: ['site', 'organization'],
  support_moderator: ['site'],
  platform_admin: ['site'],
  rules_officer: ['site'],
  disciplinary_admin: ['site'],
};

/** Permission identifiers are `domain.action`. New domains in later stages extend this list; checks stay deny-by-default. */
export const Permissions = [
  'session.read_self',
  'session.revoke_self',
  'acl.grant',
  'acl.revoke',
  'acl.read',
  'approval.request',
  'approval.decide',
  'approval.read',
  'audit.read',
  'outbox.replay',
  'outbox.read',
  'file.upload_private',
  'file.upload_public',
  'file.read_private',
  'file.read_public',
  'organization.read',
  'organization.manage',
  'team.read_private',
  'team.manage',
  'team.roster.manage',
  'event.read_private',
  'event.manage',
  'event.staff.manage',
  'event.publish',
  'event.evidence.read',
  'match.read_private',
  'match.manage',
  'match.result.submit',
  'match.result.verify',
  'match.result.correct',
  'match.lobby.read',
  'dispute.decide_first',
  'dispute.decide_appeal',
  'news.draft',
  'news.publish',
  'broadcast.read',
  'finance.read',
  'finance.refund',
  'finance.payout',
  'catalog.manage',
  'rules.manage',
  'platform.settings',
  'moderation.act',
  'discipline.platform_wide',
  'account.review',
  'badge.issue',
  'team.ownership.transfer',
  'recruitment.manage',
  'scrim.manage',
  'organizer.review',
  'organizer.profile.manage',
  'rating.moderate',
  'rules.review',
  'rules.publish',
] as const;
export type Permission = (typeof Permissions)[number];

/** Role → permissions inside the scope where the role is granted. */
export const rolePermissions: Record<Role, readonly Permission[]> = {
  guest: ['file.read_public'],
  player: ['session.read_self', 'session.revoke_self', 'file.read_public', 'file.upload_private', 'approval.read'],
  team_owner: ['team.read_private', 'team.manage', 'team.roster.manage', 'team.ownership.transfer', 'recruitment.manage', 'scrim.manage', 'organization.read', 'file.upload_private', 'file.upload_public'],
  team_manager: ['team.read_private', 'team.manage', 'team.roster.manage', 'recruitment.manage', 'scrim.manage', 'file.upload_private', 'file.upload_public'],
  team_captain: ['team.read_private', 'team.roster.manage', 'scrim.manage', 'match.result.submit', 'match.lobby.read', 'match.read_private'],
  coach: ['team.read_private'],
  analyst: ['team.read_private'],
  organizer: [
    'organization.read',
    'organization.manage',
    'organizer.profile.manage',
    'event.read_private',
    'event.manage',
    'event.staff.manage',
    'event.publish',
    'acl.grant',
    'acl.revoke',
    'acl.read',
    'approval.request',
    'approval.read',
    'match.read_private',
    'match.manage',
    'file.upload_private',
    'file.upload_public',
    'file.read_private',
  ],
  event_operator: ['event.read_private', 'match.read_private', 'match.manage', 'match.lobby.read', 'file.upload_private'],
  referee: ['event.read_private', 'event.evidence.read', 'match.read_private', 'match.lobby.read', 'match.result.verify', 'dispute.decide_first', 'file.read_private', 'file.upload_private'],
  head_referee: [
    'event.read_private',
    'event.evidence.read',
    'match.read_private',
    'match.lobby.read',
    'match.result.verify',
    'match.result.correct',
    'dispute.decide_first',
    'acl.grant',
    'acl.revoke',
    'acl.read',
    'approval.request',
    'approval.decide',
    'approval.read',
    'file.read_private',
    'file.upload_private',
  ],
  appeal_authority: ['event.read_private', 'event.evidence.read', 'match.read_private', 'dispute.decide_appeal', 'file.read_private'],
  reporter: ['news.draft', 'event.read_private', 'file.upload_public'],
  photographer: ['news.draft', 'file.upload_public'],
  editor: ['news.draft', 'news.publish', 'event.read_private', 'file.upload_public'],
  broadcast_crew: ['broadcast.read', 'event.read_private'],
  finance_officer: ['finance.read', 'finance.refund', 'finance.payout', 'approval.request', 'approval.decide', 'approval.read', 'audit.read'],
  support_moderator: ['moderation.act', 'rating.moderate', 'account.review'],
  platform_admin: [
    'acl.grant',
    'acl.revoke',
    'acl.read',
    'approval.request',
    'approval.decide',
    'approval.read',
    'audit.read',
    'outbox.read',
    'outbox.replay',
    'catalog.manage',
    'platform.settings',
    'moderation.act',
    'account.review',
    'badge.issue',
    'organizer.review',
    'rating.moderate',
    'file.read_private',
    'file.upload_private',
    'file.upload_public',
  ],
  rules_officer: ['catalog.manage', 'rules.manage', 'rules.review', 'rules.publish'],
  disciplinary_admin: ['discipline.platform_wide', 'event.evidence.read'],
};

/**
 * Scope inheritance: a grant in a parent scope applies to the listed child scope types ONLY for the
 * listed roles. Everything else stays strictly local. Site-level admin roles do not inherit into
 * event evidence or match lobbies (ACL acceptance criterion: referee of event A must not reach event B).
 */
export const scopeInheritance: Partial<Record<Role, readonly ScopeType[]>> = {
  organizer: ['event', 'match'], // organization organizer → its events and their matches; event organizer → its matches
  event_operator: ['match'],
  head_referee: ['match'],
  referee: ['match'], // event-level referee grant covers that event's matches; a match-level grant covers only that match
  appeal_authority: ['match'],
  team_owner: ['team'], // organization owner → its teams
  editor: ['event'], // site editor may publish news for any event (newsroom), never evidence
  reporter: ['event'],
  photographer: ['event'],
  finance_officer: ['organization', 'event'],
  platform_admin: ['organization', 'team', 'event', 'match'], // explicit: admin reaches structures; evidence/lobby still excluded by permission list
};

/**
 * Separation-of-duties rules (ACL-003): the actor performing the second step must differ from the first.
 * Used by the approvals module; sensitive actions listed here can never be self-approved.
 */
export const SensitiveActions = [
  'finance.payout',
  'finance.refund.large',
  'match.result.correct',
  'stage.delete_active',
  'acl.grant.platform_admin',
] as const;
export type SensitiveAction = (typeof SensitiveActions)[number];

export const sensitiveActionApproverPermission: Record<SensitiveAction, Permission> = {
  'finance.payout': 'approval.decide',
  'finance.refund.large': 'approval.decide',
  'match.result.correct': 'approval.decide',
  'stage.delete_active': 'approval.decide',
  'acl.grant.platform_admin': 'approval.decide',
};

export const GrantSchema = z.object({
  id: z.string(),
  principalId: z.string(),
  role: z.enum(Roles),
  scope: ScopeSchema,
  grantedBy: z.string(),
  grantedAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  revokedBy: z.string().nullable(),
  reason: z.string().max(500).nullable(),
});
export type Grant = z.infer<typeof GrantSchema>;
