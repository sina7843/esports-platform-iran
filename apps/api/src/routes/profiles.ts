import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BadgeIssueSchema,
  BadgeRevokeSchema,
  CompetitiveRecordSchema,
  ErrorResponse,
  GameIdentityCreateSchema,
  GameIdentityUpdateSchema,
  GameIdentityVerificationStates,
  GameIdentityVerifySchema,
  HonorsSchema,
  PlayerSearchQuerySchema,
  PrivacyLevelSchema,
  ProfileUpdateSchema,
  RatingChartSchema,
  SITE_SCOPE,
  VerifiedLevelSchema,
  BadgeKinds,
  decodeCursor,
  encodeCursor,
} from '@esp/contracts';
import { BadgeService, GameIdentityService, ProfileService, effectiveVerification, ownIdentityView, type publicBadge, type Container } from '@esp/core';

const errs = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 503: ErrorResponse };
const Games = z.array(z.object({ gameId: z.string(), roles: z.array(z.string()), declaredLevel: z.string().nullable(), verifiedLevel: z.object({ value: z.string(), issuer: z.string(), at: z.string() }).nullable(), equipment: z.string().nullable(), activityHours: z.string().nullable() }));
const Links = z.array(z.object({ label: z.string(), url: z.string() }));
const Lft = z.object({ active: z.boolean(), resume: z.string().nullable(), gameIds: z.array(z.string()), since: z.string().nullable() });

const OwnProfile = z.object({
  id: z.string(),
  nickname: z.string(),
  realName: z.string().nullable(),
  bio: z.string().nullable(),
  province: z.string().nullable(),
  city: z.string().nullable(),
  links: Links,
  avatarFileId: z.string().nullable(),
  coverFileId: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  coverUrl: z.string().nullable(),
  games: Games,
  privacy: z.record(z.string(), PrivacyLevelSchema),
  messagePolicy: z.string(),
  notificationPrefs: z.record(z.string(), z.unknown()),
  essentialNotificationsAlwaysDelivered: z.literal(true),
  lookingForTeam: Lft,
  locale: z.string(),
  timeZone: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
});

const PublicProfile = z.object({
  id: z.string(),
  nickname: z.string(),
  avatarUrl: z.string().nullable(),
  coverUrl: z.string().nullable(),
  bio: z.string().nullable(),
  realName: z.string().nullable(),
  province: z.string().nullable(),
  city: z.string().nullable(),
  links: Links,
  games: z.array(z.object({ gameId: z.string(), roles: z.array(z.string()), declaredLevel: z.string().nullable(), verifiedLevel: z.object({ value: z.string(), at: z.string() }).nullable(), equipment: z.string().nullable(), activityHours: z.string().nullable() })),
  gameIdentities: z.array(z.object({ gameId: z.string(), platform: z.string(), value: z.string(), verified: z.boolean() })),
  badges: z.array(z.object({ kind: z.enum(BadgeKinds), issuedAt: z.string(), expiresAt: z.string().nullable(), ref: z.record(z.string(), z.string()) })),
  lookingForTeam: Lft,
  teams: z.object({ current: z.array(z.object({ teamId: z.string(), name: z.string(), tag: z.string(), role: z.string(), from: z.string(), to: z.string().nullable() })), past: z.array(z.object({ teamId: z.string(), name: z.string(), tag: z.string(), role: z.string(), from: z.string(), to: z.string().nullable() })) }),
  followerCount: z.number().int(),
  viewer: z.object({ isSelf: z.boolean(), isFollowing: z.boolean(), canMessage: z.boolean() }),
  competitiveRecord: CompetitiveRecordSchema,
  honors: HonorsSchema,
  ratingChart: RatingChartSchema,
});

const PlayerCard = z.object({ id: z.string(), nickname: z.string(), avatarUrl: z.string().nullable(), city: z.string().nullable(), games: z.array(z.object({ gameId: z.string(), declaredLevel: z.string().nullable(), verifiedLevel: z.string().nullable() })), lookingForTeam: z.boolean() });

const OwnIdentity = z.object({
  id: z.string(),
  gameId: z.string(),
  platform: z.string(),
  value: z.string(),
  active: z.boolean(),
  visibility: PrivacyLevelSchema,
  verification: z.object({ state: z.enum(GameIdentityVerificationStates), expired: z.boolean(), method: z.string(), verifiedAt: z.string().nullable(), expiresAt: z.string().nullable() }),
  valueHistory: z.array(z.object({ value: z.string(), from: z.string(), to: z.string().nullable() })),
  ownershipHistory: z.array(z.object({ from: z.string(), to: z.string().nullable() })),
  createdAt: z.string(),
  version: z.number().int(),
});
const AdminIdentity = OwnIdentity.extend({ principalId: z.string(), issuer: z.string().nullable() });
const AdminBadge = z.object({ id: z.string(), principalId: z.string(), kind: z.enum(BadgeKinds), issuer: z.string(), issuedAt: z.string(), expiresAt: z.string().nullable(), revokedAt: z.string().nullable(), revokedReason: z.string().nullable(), ref: z.record(z.string(), z.unknown()) });
type BadgeRow = Parameters<typeof publicBadge>[0];
const adminBadge = (b: BadgeRow) => ({ id: b._id, principalId: b.principalId, kind: b.kind, issuer: b.issuer, issuedAt: b.issuedAt, expiresAt: b.expiresAt, revokedAt: b.revokedAt, revokedReason: b.revokedReason ?? null, ref: b.ref });

/** USR-003..007, USR-010 (duplicate game identity), USR-011. Staff endpoints need `badge.issue` in site scope. */
export function profileRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const profiles = new ProfileService(container);
  const identities = new GameIdentityService(container);
  const badges = new BadgeService(container);
  const idParams = z.object({ id: z.string().min(1).max(64) });

  r.get('/me/profile', { schema: { tags: ['profiles'], summary: 'Own full profile', response: { 200: OwnProfile, ...errs } } }, async (req) => profiles.getOwn(req.requireAuth().principal._id));

  r.patch('/me/profile', { schema: { tags: ['profiles'], summary: 'Update own profile (optimistic concurrency via expectedVersion)', body: ProfileUpdateSchema, response: { 200: OwnProfile, ...errs } } }, async (req) =>
    profiles.update(req.requireAuth().principal._id, req.body, req.id),
  );

  r.get('/players/:nickname', { schema: { tags: ['profiles'], summary: 'Public player profile (privacy + block aware)', params: z.object({ nickname: z.string().min(1).max(64) }), response: { 200: PublicProfile, 404: ErrorResponse } } }, async (req) =>
    profiles.publicProfile(req.params.nickname, req.auth?.principal._id ?? null),
  );

  r.get('/players', { schema: { tags: ['profiles'], summary: 'Search players (public projections only)', querystring: PlayerSearchQuerySchema, response: { 200: z.object({ items: z.array(PlayerCard), page: z.object({ nextCursor: z.string().nullable(), limit: z.number().int() }) }), 400: ErrorResponse } } }, async (req) => {
    const cursor = decodeCursor(req.query.cursor, z.object({ n: z.string() }));
    const res = await profiles.search({ ...req.query, ...(cursor ? { cursor: cursor.n } : { cursor: undefined }) }, req.auth?.principal._id ?? null);
    return { items: res.items, page: { nextCursor: res.nextCursor ? encodeCursor({ n: res.nextCursor }) : null, limit: req.query.limit } };
  });

  // ---- game identities (own)
  r.get('/me/game-identities', { schema: { tags: ['profiles'], response: { 200: z.object({ items: z.array(OwnIdentity) }), ...errs } } }, async (req) => ({ items: (await identities.list(req.requireAuth().principal._id)).map(ownIdentityView) }));

  r.post('/me/game-identities', { schema: { tags: ['profiles'], summary: 'Add a game identity; a value active on another account is created as disputed and sent to review', body: GameIdentityCreateSchema, response: { 201: OwnIdentity, ...errs } } }, async (req, reply) =>
    reply.status(201).send(ownIdentityView(await identities.add(req.requireAuth().principal._id, req.body, req.id))),
  );

  r.patch('/me/game-identities/:id', { schema: { tags: ['profiles'], body: GameIdentityUpdateSchema, params: idParams, response: { 200: OwnIdentity, ...errs } } }, async (req) =>
    ownIdentityView(await identities.update(req.requireAuth().principal._id, req.params.id, req.body, req.id)),
  );

  r.post('/me/game-identities/:id/deactivate', { schema: { tags: ['profiles'], params: idParams, response: { 200: OwnIdentity, ...errs } } }, async (req) => ownIdentityView(await identities.deactivate(req.requireAuth().principal._id, req.params.id, req.id)));

  // ---- staff: verified level, game identity verification, badges (badge.issue, site scope)
  r.post('/admin/players/:id/verified-level', { schema: { tags: ['profiles-admin'], summary: 'Set (or clear) the verified level; records issuer and date', params: idParams, body: VerifiedLevelSchema, response: { 200: Games.element, ...errs } } }, async (req) => {
    await req.requirePermission('badge.issue', SITE_SCOPE);
    return profiles.setVerifiedLevel(req.params.id, req.body.gameId, req.body.value, req.requireAuth().principal._id, req.id);
  });

  r.get('/admin/game-identities', { schema: { tags: ['profiles-admin'], querystring: z.object({ state: z.enum(GameIdentityVerificationStates).optional(), principalId: z.string().max(64).optional() }), response: { 200: z.object({ items: z.array(AdminIdentity) }), ...errs } } }, async (req) => {
    await req.requirePermission('badge.issue', SITE_SCOPE);
    return { items: (await identities.adminList(req.query)).map((g) => ({ ...ownIdentityView(g), principalId: g.principalId, issuer: g.verification.issuer, verification: { ...ownIdentityView(g).verification, state: g.verification.state === 'verified' ? effectiveVerification(g).state : g.verification.state } })) };
  });

  r.post('/admin/game-identities/:id/verify', { schema: { tags: ['profiles-admin'], summary: 'Verify a game identity and issue a game_identity badge', params: idParams, body: GameIdentityVerifySchema, response: { 200: AdminBadge, ...errs } } }, async (req) => {
    await req.requirePermission('badge.issue', SITE_SCOPE);
    return adminBadge((await identities.verify(req.params.id, req.body, req.requireAuth().principal._id, req.id)).badge);
  });

  r.post('/admin/badges', { schema: { tags: ['profiles-admin'], summary: 'Issue an identity or org_position badge (identity: issuer + reference text only, no documents)', body: BadgeIssueSchema, response: { 201: AdminBadge, ...errs } } }, async (req, reply) => {
    await req.requirePermission('badge.issue', SITE_SCOPE);
    const me = req.requireAuth().principal._id;
    const b = req.body;
    if (b.kind === 'game_identity') return reply.status(201).send(adminBadge((await identities.verify(b.gameIdentityId, b, me, req.id)).badge));
    return reply.status(201).send(adminBadge(await badges.issue(b, me, req.id)));
  });

  r.post('/admin/badges/:id/revoke', { schema: { tags: ['profiles-admin'], params: idParams, body: BadgeRevokeSchema, response: { 200: AdminBadge, ...errs } } }, async (req) => {
    await req.requirePermission('badge.issue', SITE_SCOPE);
    return adminBadge(await badges.revoke(req.params.id, req.body.reason, req.requireAuth().principal._id, req.id));
  });

  r.get('/admin/players/:id/badges', { schema: { tags: ['profiles-admin'], params: idParams, response: { 200: z.object({ items: z.array(AdminBadge) }), ...errs } } }, async (req) => {
    await req.requirePermission('badge.issue', SITE_SCOPE);
    return { items: (await badges.listAll(req.params.id)).map(adminBadge) };
  });
}
