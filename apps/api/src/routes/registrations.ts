import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CheckinManualSchema, CheckinSchema, DomainError, ErrorResponse, RegistrationCreateSchema, RegistrationDecisionSchema, RegistrationListQuerySchema, RegistrationUpdateSchema, RosterConfirmSchema, RosterLockSchema, SubstitutionSchema } from '@esp/contracts';
import { RegistrationIo, RegistrationService, RosterService, type Container, type RegistrationDoc } from '@esp/core';

/** Registration, roster and check-in (REG, ROS, CHK). Private data (form answers, documents) only to the applicant/roster and authorized staff. */
const Id = z.object({ id: z.string().min(1).max(64) });
const Out = z.record(z.string(), z.unknown());
/** Domain documents are returned as plain JSON records (fields are explicit projections or non-sensitive finance docs). */
const plain = <T extends object>(x: T): Record<string, unknown> => x as unknown as Record<string, unknown>;
const plainAll = <T extends object>(xs: T[]): Array<Record<string, unknown>> => xs.map(plain);
const regOut = (r: RegistrationDoc) => ({
  id: r._id, trackingCode: r.trackingCode, eventId: r.eventId, disciplineId: r.disciplineId, kind: r.kind, teamId: r.teamId, displayName: r.displayName, quotaKind: r.quotaKind, state: r.state,
  roster: r.roster, formAnswers: r.formAnswers, documentFileIds: r.documentFileIds, acceptedRules: r.acceptedRules, eligibility: r.eligibility,
  reservationExpiresAt: r.reservation && !r.reservation.released ? r.reservation.expiresAt : null, waitlisted: r.state === 'awaiting_capacity', waitlistSeq: r.waitlistSeq,
  feeRial: r.feeRial, orderId: r.orderId, participationId: r.participationId, late: r.late, history: r.history, createdAt: r.createdAt, version: r.version,
});

export function registrationRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const regs = new RegistrationService(container);
  const roster = new RosterService(container);
  const io = new RegistrationIo(container);
  const errors = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 412: ErrorResponse };
  const me = (req: { requireAuth(): { principal: { _id: string } } }) => req.requireAuth().principal._id;

  r.post('/disciplines/:id/registrations', { schema: { tags: ['registration'], params: Id, body: RegistrationCreateSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(regOut(await regs.create(req.params.id, req.body, me(req), req.id))));
  r.get('/disciplines/:id/registrations', { schema: { tags: ['registration'], params: Id, querystring: RegistrationListQuerySchema, response: { 200: z.object({ items: z.array(Out) }), ...errors } } }, async (req) => ({ items: (await regs.listForDiscipline(req.params.id, me(req), req.id, req.query.state)).slice(0, req.query.limit).map(regOut) }));
  r.get('/me/registrations', { schema: { tags: ['registration'], response: { 200: z.object({ items: z.array(Out) }), ...errors } } }, async (req) => ({ items: (await regs.mine(me(req))).map(regOut) }));
  r.get('/registrations/:id', { schema: { tags: ['registration'], params: Id, response: { 200: Out, ...errors } } }, async (req) => regOut(await regs.view(req.params.id, me(req), req.id)));
  r.patch('/registrations/:id', { schema: { tags: ['registration'], params: Id, body: RegistrationUpdateSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const patch: { formAnswers?: Record<string, unknown>; documentFileIds?: Record<string, string> } = {};
    if (req.body.formAnswers) patch.formAnswers = req.body.formAnswers;
    if (req.body.documentFileIds) patch.documentFileIds = req.body.documentFileIds;
    return regOut(await regs.edit(req.params.id, patch, req.body.expectedVersion, me(req), req.id));
  });
  r.post('/registrations/:id/decision', { schema: { tags: ['registration'], params: Id, body: RegistrationDecisionSchema, response: { 200: Out, ...errors } } }, async (req) => regOut(await regs.decide(req.params.id, req.body.action, req.body.reason, req.body.expectedVersion, me(req), req.id)));
  r.post('/registrations/:id/withdraw', { schema: { tags: ['registration'], params: Id, response: { 200: Out, ...errors } } }, async (req) => regOut(await regs.withdraw(req.params.id, me(req), req.id)));
  r.post('/registrations/:id/re-review', { schema: { tags: ['registration'], params: Id, response: { 200: Out, ...errors } } }, async (req) => regOut(await regs.requestReReview(req.params.id, me(req), req.id)));
  r.post('/registrations/:id/roster-response', { schema: { tags: ['registration'], params: Id, body: RosterConfirmSchema, response: { 200: Out, ...errors } } }, async (req) => regOut(await regs.confirmMembership(req.params.id, req.body.decision, me(req), req.id)));
  r.post('/registrations/:id/substitutions', { schema: { tags: ['registration'], params: Id, body: SubstitutionSchema, response: { 201: Out, ...errors } } }, async (req, reply) => {
    const { approvalId: _a, ...input } = req.body;
    void _a;
    return reply.status(201).send(plain(await roster.substitute(req.params.id, input, me(req), req.id)));
  });

  r.get('/disciplines/:id/registrations.csv', { schema: { tags: ['registration'], params: Id } }, async (req, reply) => {
    const csv = await io.exportCsv(req.params.id, me(req), req.id);
    return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="registrations-${req.params.id}.csv"`).header('Cache-Control', 'private, no-store').send(csv);
  });
  app.post('/disciplines/:id/invites/import', { schema: { tags: ['registration'], consumes: ['multipart/form-data'], summary: 'CSV columns: holderKey (team:<id>|player:<id>), quota (invite|organization)' } }, async (req, reply) => {
    const actor = me(req);
    const file = await req.file({ limits: { fileSize: 1024 * 1024, files: 1 } });
    if (!file) throw new DomainError('VALIDATION_FAILED', 'CSV file part missing');
    const buf = await file.toBuffer();
    return reply.send(await io.importInvites((req.params as { id: string }).id, buf, actor, req.id));
  });

  r.post('/roster-locks', { schema: { tags: ['registration'], body: RosterLockSchema, response: { 201: z.object({ items: z.array(Out) }), ...errors } } }, async (req, reply) => reply.status(201).send({ items: plainAll(await roster.lock(req.body.level, req.body.ref, me(req), req.id)) }));
  r.post('/checkins', { schema: { tags: ['registration'], body: CheckinSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await roster.checkIn(req.body.level, req.body.ref, me(req), req.id)));
  r.post('/checkins/manual', { schema: { tags: ['registration'], body: CheckinManualSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await roster.manual(req.body.level, req.body.ref, req.body.registrationId, req.body.outcome, req.body.reason, me(req), req.id)));
  r.post('/checkins/finalize', { schema: { tags: ['registration'], body: CheckinSchema, response: { 200: z.object({ items: z.array(Out) }), ...errors } } }, async (req) => ({ items: plainAll(await roster.finalizeNoShows(req.body.level, req.body.ref, me(req), req.id)) }));
  r.get('/checkins', { schema: { tags: ['registration'], querystring: CheckinSchema, response: { 200: z.object({ items: z.array(Out) }), ...errors } } }, async (req) => {
    const actor = me(req);
    const items = await roster.status(req.query.level, req.query.ref);
    const regIds = items.map((i) => i.registrationId);
    const visible = await container.c.registrations.find({ _id: { $in: regIds } }).toArray();
    const allowed = [];
    for (const it of items) {
      const reg = visible.find((v) => v._id === it.registrationId);
      if (!reg) continue;
      if (reg.applicantPrincipalId === actor || reg.roster.some((m) => m.principalId === actor) || (await container.acl.can(actor, 'event.read_private', { type: 'event', id: reg.eventId }))) allowed.push(it);
    }
    return { items: plainAll(allowed) };
  });
}
