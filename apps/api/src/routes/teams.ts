import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CalendarEventSchema,
  ErrorResponse,
  JoinRequestSchema,
  MembershipEndSchema,
  MembershipRoleChangeSchema,
  MembershipSnapshotQuerySchema,
  OrganizationCreateSchema,
  OrganizationUpdateSchema,
  OwnershipTransferAcceptSchema,
  OwnershipTransferRequestSchema,
  TeamCreateSchema,
  TeamHonorsSchema,
  TeamInviteSchema,
  TeamRecordSchema,
  TeamStandingsSchema,
  TeamUpdateSchema,
} from '@esp/contracts';
import { TeamService, type Container } from '@esp/core';

const errs = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse };
const Obj = z.record(z.string(), z.unknown());
const List = z.object({ items: z.array(Obj) });
const id = z.object({ id: z.string().min(1).max(64) });
const TeamPublic = z.object({
  id: z.string(),
  name: z.string(),
  tag: z.string(),
  gameId: z.string(),
  organizationId: z.string().nullable(),
  description: z.string().nullable(),
  city: z.string().nullable(),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  sponsors: z.array(z.object({ name: z.string(), url: z.string().nullable(), logoFileId: z.string().nullable() })),
  logoUrl: z.string().nullable(),
  coverUrl: z.string().nullable(),
  nameHistory: z.array(z.object({ name: z.string(), tag: z.string(), from: z.string(), to: z.string().nullable() })),
  currentMembers: z.array(Obj),
  pastMembers: z.array(Obj),
  record: TeamRecordSchema,
  standings: TeamStandingsSchema,
  honors: TeamHonorsSchema,
});

/** TEAM-001..007. Mutations need a session (+ X-Requested-With for cookies); permissions are resolved server-side per team/organization. */
export function teamsRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const svc = new TeamService(container);
  const who = (req: { requireAuth(): { principal: { _id: string } } }) => req.requireAuth().principal._id;

  // ---- organizations
  r.post('/organizations', { schema: { tags: ['teams'], summary: 'Create an organization (creator becomes owner)', body: OrganizationCreateSchema, response: { 201: Obj, ...errs } } }, async (req, reply) =>
    reply.status(201).send(svc.orgView(await svc.createOrganization(who(req), req.body, req.id))),
  );
  r.patch('/organizations/:id', { schema: { tags: ['teams'], params: id, body: OrganizationUpdateSchema, response: { 200: Obj, ...errs } } }, async (req) => svc.orgView(await svc.updateOrganization(who(req), req.params.id, req.body, req.id)));
  r.get('/organizations/:slug', { schema: { tags: ['teams'], summary: 'Public organization page with its teams', params: z.object({ slug: z.string().min(2).max(40) }), response: { 200: Obj, 404: ErrorResponse } } }, async (req) => svc.publicOrganization(req.params.slug));
  r.post('/organizations/:id/ownership-transfers', { schema: { tags: ['teams'], params: id, body: OwnershipTransferRequestSchema, response: { 201: Obj, ...errs } } }, async (req, reply) =>
    reply.status(201).send(svc.transferView(await svc.requestTransfer(who(req), 'organization', req.params.id, req.body, req.id))),
  );

  // ---- teams
  r.post('/teams', { schema: { tags: ['teams'], summary: 'Create a team (one competitive lineup for one game)', body: TeamCreateSchema, response: { 201: Obj, ...errs } } }, async (req, reply) => reply.status(201).send(svc.teamView(await svc.createTeam(who(req), req.body, req.id))));
  r.patch('/teams/:id', { schema: { tags: ['teams'], summary: 'Update name/tag/logo/links; the team and its history are kept', params: id, body: TeamUpdateSchema, response: { 200: Obj, ...errs } } }, async (req) => svc.teamView(await svc.updateTeam(who(req), req.params.id, req.body, req.id)));
  r.get('/teams/:id/profile', { schema: { tags: ['teams'], summary: 'Public team page (public member projection only)', params: id, response: { 200: TeamPublic, 404: ErrorResponse } } }, async (req) => svc.teamProfile(req.params.id, req.auth?.principal._id ?? null));
  r.get('/me/teams', { schema: { tags: ['teams'], response: { 200: List, ...errs } } }, async (req) => ({ items: await svc.myTeams(who(req)) }));
  r.get('/teams/:id/members', { schema: { tags: ['teams'], summary: 'Current roster (team.read_private)', params: id, response: { 200: List, ...errs } } }, async (req) => ({ items: await svc.listMembers(who(req), req.params.id, req.id) }));
  r.get('/teams/:id/membership-at', { schema: { tags: ['teams'], summary: 'Roster at an instant, from history (ROS-006 foundation)', params: id, querystring: MembershipSnapshotQuerySchema, response: { 200: List, ...errs } } }, async (req) => ({
    items: await svc.membershipAt(who(req), req.params.id, req.query.at, req.id),
  }));

  // ---- invitations / join requests
  r.post('/teams/:id/invitations', { schema: { tags: ['teams'], body: TeamInviteSchema, params: id, response: { 201: Obj, ...errs } } }, async (req, reply) =>
    reply.status(201).send(svc.inviteView(await svc.createInvitation(who(req), req.params.id, req.body, req.id))),
  );
  r.get('/teams/:id/invitations', { schema: { tags: ['teams'], params: id, response: { 200: List, ...errs } } }, async (req) => ({ items: await svc.teamInvitations(who(req), req.params.id, req.id) }));
  r.get('/me/team-invitations', { schema: { tags: ['teams'], response: { 200: List, ...errs } } }, async (req) => ({ items: await svc.myInvitations(who(req)) }));
  r.post('/team-invitations/:id/accept', { schema: { tags: ['teams'], params: id, response: { 200: Obj, ...errs } } }, async (req) => svc.inviteView(await svc.respondInvitation(who(req), req.params.id, true, req.id)));
  r.post('/team-invitations/:id/decline', { schema: { tags: ['teams'], params: id, response: { 200: Obj, ...errs } } }, async (req) => svc.inviteView(await svc.respondInvitation(who(req), req.params.id, false, req.id)));
  r.post('/team-invitations/:id/cancel', { schema: { tags: ['teams'], params: id, response: { 200: Obj, ...errs } } }, async (req) => svc.inviteView(await svc.cancelInvitation(who(req), req.params.id, req.id)));

  r.post('/teams/:id/join-requests', { schema: { tags: ['teams'], body: JoinRequestSchema, params: id, response: { 201: Obj, ...errs } } }, async (req, reply) =>
    reply.status(201).send(svc.requestView(await svc.requestToJoin(who(req), req.params.id, req.body, req.id))),
  );
  r.get('/teams/:id/join-requests', { schema: { tags: ['teams'], params: id, response: { 200: List, ...errs } } }, async (req) => ({ items: await svc.listJoinRequests(who(req), req.params.id, req.id) }));
  r.post('/team-join-requests/:id/accept', { schema: { tags: ['teams'], params: id, response: { 200: Obj, ...errs } } }, async (req) => svc.requestView(await svc.decideJoinRequest(who(req), req.params.id, true, req.id)));
  r.post('/team-join-requests/:id/decline', { schema: { tags: ['teams'], params: id, response: { 200: Obj, ...errs } } }, async (req) => svc.requestView(await svc.decideJoinRequest(who(req), req.params.id, false, req.id)));

  // ---- leave / kick / role change
  const member = z.object({ id: z.string().min(1).max(64), principalId: z.string().min(1).max(64) });
  r.post('/teams/:id/leave', { schema: { tags: ['teams'], params: id, body: MembershipEndSchema, response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    await svc.leave(who(req), req.params.id, req.body.reason, req.id);
    return reply.status(204).send(null);
  });
  r.post('/teams/:id/members/:principalId/kick', { schema: { tags: ['teams'], params: member, body: MembershipEndSchema, response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    await svc.kick(who(req), req.params.id, req.params.principalId, req.body.reason, req.id);
    return reply.status(204).send(null);
  });
  r.patch('/teams/:id/members/:principalId', { schema: { tags: ['teams'], params: member, body: MembershipRoleChangeSchema, response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    await svc.changeRole(who(req), req.params.id, req.params.principalId, req.body.role, req.id);
    return reply.status(204).send(null);
  });

  // ---- ownership transfer
  r.post('/teams/:id/ownership-transfers', { schema: { tags: ['teams'], summary: 'Owner requests a transfer; nothing changes until the target accepts', params: id, body: OwnershipTransferRequestSchema, response: { 201: Obj, ...errs } } }, async (req, reply) =>
    reply.status(201).send(svc.transferView(await svc.requestTransfer(who(req), 'team', req.params.id, req.body, req.id))),
  );
  r.get('/me/ownership-transfers', { schema: { tags: ['teams'], response: { 200: List, ...errs } } }, async (req) => ({ items: await svc.myTransfers(who(req)) }));
  r.post('/ownership-transfers/:id/accept', { schema: { tags: ['teams'], summary: 'Target accepts the listed responsibilities', params: id, body: OwnershipTransferAcceptSchema, response: { 200: Obj, ...errs } } }, async (req) =>
    svc.transferView(await svc.respondTransfer(who(req), req.params.id, 'accept', req.id)),
  );
  r.post('/ownership-transfers/:id/decline', { schema: { tags: ['teams'], params: id, response: { 200: Obj, ...errs } } }, async (req) => svc.transferView(await svc.respondTransfer(who(req), req.params.id, 'decline', req.id)));
  r.post('/ownership-transfers/:id/cancel', { schema: { tags: ['teams'], params: id, response: { 200: Obj, ...errs } } }, async (req) => svc.transferView(await svc.respondTransfer(who(req), req.params.id, 'cancel', req.id)));

  // ---- calendar
  r.get('/teams/:id/calendar', { schema: { tags: ['teams'], summary: 'Team calendar (members read)', params: id, response: { 200: List, ...errs } } }, async (req) => ({ items: await svc.listCalendar(who(req), req.params.id, req.id) }));
  r.post('/teams/:id/calendar', { schema: { tags: ['teams'], summary: 'Add calendar entry (team.manage)', params: id, body: CalendarEventSchema, response: { 201: Obj, ...errs } } }, async (req, reply) =>
    reply.status(201).send(svc.calendarView(await svc.addCalendarEvent(who(req), req.params.id, req.body, req.id))),
  );
  r.delete('/teams/:id/calendar/:eventId', { schema: { tags: ['teams'], params: z.object({ id: z.string().min(1).max(64), eventId: z.string().min(1).max(64) }), response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    await svc.deleteCalendarEvent(who(req), req.params.id, req.params.eventId, req.id);
    return reply.status(204).send(null);
  });
}
