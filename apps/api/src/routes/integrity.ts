import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CaseAppealSchema, CaseAssignSchema, CaseDecisionSchema, CaseDefenseSchema, CaseFileSchema, CaseReportSchema, CertificateCorrectSchema, ContestSchema, CorrectionPreviewSchema, CorrectionRequestSchema,
  DeclareAchievementSchema, DeclaredReviewSchema, DisciplinarySanctionSchema, DomainError, ErrorResponse, EventCloseSchema, EventVersionSchema, EvidenceAnswerSchema, EvidenceRequestSchema, FeedbackSchema,
  HeadToHeadQuerySchema, HonorRevokeSchema, IntegrityReportSchema, IntegrityRequirementsSchema, IntegrityStepSchema, LeaderboardQuerySchema, LineupSchema, OfficialAssignSchema, RatingApproveSchema,
  RatingReviseSchema, RatingSystemSchema, ReopenSchema, SanctionAppealDecisionSchema, SanctionAppealSchema, SanctionRevokeSchema, SpecialAwardSchema, SpecialDecisionSchema,
} from '@esp/contracts';
import {
  CareerService, CorrectionService, DisputeService, EventCloseService, EventsService, HonorService, IntegrityService, MatchResultService, OfficialsService, publicMatch, RatingService, RoomService,
  SanctionService, type Container, type MatchOutcome,
} from '@esp/core';

/**
 * ESP-05 API: result confirmation/contest, officials, dispute cases, sanctions, integrity reports, corrections, ranking,
 * honors/certificates, finish/close/archive. Authorization lives in the services (deny by default); public reads
 * respect event visibility and only ever return public projections.
 */
const Id = z.object({ id: z.string().min(1).max(64) });
const Out = z.record(z.string(), z.unknown());
const Items = z.object({ items: z.array(Out) });
const plain = <T extends object>(x: T): Record<string, unknown> => x as unknown as Record<string, unknown>;
const plainAll = <T extends object>(xs: T[]): Array<Record<string, unknown>> => xs.map(plain);
type Effect = Parameters<DisputeService['decideFirst']>[1]['effect'];

export function integrityRoutes(app: FastifyInstance, ct: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const results = new MatchResultService(ct);
  const room = new RoomService(ct);
  const officials = new OfficialsService(ct);
  const disputes = new DisputeService(ct);
  const sanctions = new SanctionService(ct);
  const integrity = new IntegrityService(ct);
  const corrections = new CorrectionService(ct);
  const ratings = new RatingService(ct);
  const career = new CareerService(ct);
  const honors = new HonorService(ct);
  const close = new EventCloseService(ct);
  const events = new EventsService(ct);
  const errors = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 412: ErrorResponse, 429: ErrorResponse };
  const me = (req: { requireAuth(): { principal: { _id: string } } }) => req.requireAuth().principal._id;
  const viewer = (req: { auth: { principal: { _id: string } } | null }) => req.auth?.principal._id ?? null;
  async function visibleEvent(req: { auth: { principal: { _id: string } } | null; query?: unknown }, eventId: string) {
    const e = await ct.c.events.findOne({ _id: eventId });
    const t = (req.query as { t?: string } | undefined)?.t ?? null;
    if (!e || !(await events.canView(e, viewer(req), t))) throw new DomainError('NOT_FOUND', 'not found');
    return e;
  }
  const effect = (e: z.infer<typeof CaseDecisionSchema>['effect']): Effect => ({ kind: e.kind, outcome: (e.outcome ?? null) as MatchOutcome | null, ...(e.sanctions ? { sanctions: e.sanctions.map((s) => ({ ...s, caseId: null })) as NonNullable<Effect['sanctions']> } : {}) });

  // ------------------------------------------------------------------ results lifecycle (RES-001..005)
  r.post('/matches/:id/results/confirm', { schema: { tags: ['results'], params: Id, response: { 200: Out, ...errors } } }, async (req) => publicMatch(await results.confirm(req.params.id, me(req), req.id)));
  r.post('/matches/:id/results/contest', { schema: { tags: ['results'], params: Id, body: ContestSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await disputes.view((await results.contest(req.params.id, req.body.claim, req.body.evidenceFileIds, me(req), req.id))._id, me(req), req.id)));
  r.post('/matches/:id/lineup', { schema: { tags: ['results'], params: Id, body: LineupSchema, response: { 200: Out, ...errors } } }, async (req) => publicMatch(await room.setLineup(req.params.id, req.body.side, req.body.principalIds, me(req), req.id)));
  r.get('/matches/:id/result-history', { schema: { tags: ['results'], params: Id, response: { 200: Items, ...errors } } }, async (req) => {
    const m = await ct.c.matches.findOne({ _id: req.params.id });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    await ct.acl.require(me(req), 'match.result.verify', { type: 'match', id: m._id }, req.id);
    return { items: plainAll(await ct.c.resultVersions.find({ targetType: 'match', targetId: m._id }).sort({ version: 1 }).toArray()) };
  });

  // ------------------------------------------------------------------ officials (REF-001)
  r.get('/events/:id/officials', { schema: { tags: ['officials'], params: Id, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await officials.list(req.params.id, me(req), req.id)) }));
  r.post('/events/:id/officials', { schema: { tags: ['officials'], params: Id, body: OfficialAssignSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await officials.assign({ eventId: req.params.id, ...req.body }, me(req), req.id)));
  r.delete('/officials/:id', { schema: { tags: ['officials'], params: Id, response: { 200: z.object({ ok: z.literal(true) }), ...errors } } }, async (req) => {
    await officials.unassign(req.params.id, me(req), req.id);
    return { ok: true as const };
  });

  // ------------------------------------------------------------------ cases (REF-002..006)
  r.post('/events/:id/cases', { schema: { tags: ['cases'], params: Id, body: CaseFileSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const d = await disputes.file({ eventId: req.params.id, ...req.body }, me(req), req.id);
    return plain(await disputes.view(d._id, me(req), req.id));
  });
  r.get('/events/:id/cases', { schema: { tags: ['cases'], params: Id, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await disputes.queue(req.params.id, me(req), req.id)) }));
  r.get('/events/:id/decisions', { schema: { tags: ['cases'], params: Id, response: { 200: Items, ...errors } } }, async (req) => {
    await visibleEvent(req, req.params.id);
    return { items: plainAll(await disputes.publicDecisions(req.params.id)) };
  });
  r.get('/me/cases', { schema: { tags: ['cases'], response: { 200: Items, ...errors } } }, async (req) => {
    const pid = me(req);
    const ds = await disputes.mine(pid);
    return { items: await Promise.all(ds.map(async (d) => plain(await disputes.view(d._id, pid, req.id)))) };
  });
  r.get('/cases/:id', { schema: { tags: ['cases'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await disputes.view(req.params.id, me(req), req.id)));
  r.post('/cases/:id/assign', { schema: { tags: ['cases'], params: Id, body: CaseAssignSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await disputes.assign(req.params.id, req.body.assignee, me(req), req.id)));
  r.post('/cases/:id/defense', { schema: { tags: ['cases'], params: Id, body: CaseDefenseSchema, response: { 200: Out, ...errors } } }, async (req) => {
    await disputes.defend(req.params.id, req.body.text, req.body.fileIds, me(req), req.id);
    return plain(await disputes.view(req.params.id, me(req), req.id));
  });
  r.post('/cases/:id/evidence-requests', { schema: { tags: ['cases'], params: Id, body: EvidenceRequestSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await disputes.requestEvidence(req.params.id, req.body.to, req.body.text, req.body.dueAt, me(req))));
  r.post('/cases/:id/evidence-requests/:rq/answer', { schema: { tags: ['cases'], params: z.object({ id: z.string().max(64), rq: z.string().max(64) }), body: EvidenceAnswerSchema, response: { 200: Out, ...errors } } }, async (req) => {
    await disputes.answerRequest(req.params.id, req.params.rq, req.body.answer, req.body.fileIds, me(req));
    return plain(await disputes.view(req.params.id, me(req), req.id));
  });
  r.post('/cases/:id/reports', { schema: { tags: ['cases'], params: Id, body: CaseReportSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await disputes.report(req.params.id, req.body.text, me(req), req.id)));
  r.post('/cases/:id/review', { schema: { tags: ['cases'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await disputes.startReview(req.params.id, me(req))));
  r.post('/cases/:id/decision', { schema: { tags: ['cases'], params: Id, body: CaseDecisionSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await disputes.decideFirst(req.params.id, { ...req.body, effect: effect(req.body.effect) }, me(req), req.id)));
  r.post('/cases/:id/appeal', { schema: { tags: ['cases'], params: Id, body: CaseAppealSchema, response: { 200: Out, ...errors } } }, async (req) => {
    await disputes.appeal(req.params.id, req.body.text, me(req), req.id);
    return plain(await disputes.view(req.params.id, me(req), req.id));
  });
  r.post('/cases/:id/appeal-decision', { schema: { tags: ['cases'], params: Id, body: CaseDecisionSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await disputes.decideAppeal(req.params.id, { ...req.body, effect: effect(req.body.effect) }, me(req), req.id)));
  r.post('/cases/:id/close', { schema: { tags: ['cases'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await disputes.close(req.params.id, me(req), req.id)));

  // ------------------------------------------------------------------ sanctions and integrity (REF-004, INT-001..005)
  r.post('/sanctions', { schema: { tags: ['sanctions'], body: DisciplinarySanctionSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await sanctions.issue(req.body, me(req), req.id)));
  r.get('/sanctions', { schema: { tags: ['sanctions'], querystring: z.object({ eventId: z.string().max(64).optional(), subjectRef: z.string().max(64).optional() }), response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await sanctions.list(req.query, me(req), req.id)) }));
  r.post('/sanctions/:id/appeal', { schema: { tags: ['sanctions'], params: Id, body: SanctionAppealSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await sanctions.appeal(req.params.id, req.body.text, me(req))));
  r.post('/sanctions/:id/appeal-decision', { schema: { tags: ['sanctions'], params: Id, body: SanctionAppealDecisionSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await sanctions.decideAppeal(req.params.id, req.body.decision, me(req), req.id)));
  r.post('/sanctions/:id/revoke', { schema: { tags: ['sanctions'], params: Id, body: SanctionRevokeSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await sanctions.revoke(req.params.id, req.body.reason, me(req), req.id)));
  r.post('/integrity-reports', { schema: { tags: ['integrity'], body: IntegrityReportSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const d = await integrity.report(req.body, me(req), req.id);
    return { id: d._id, state: d.state, createdAt: d.createdAt }; // the reporter only gets a receipt
  });
  r.get('/integrity-reports', { schema: { tags: ['integrity'], querystring: z.object({ eventId: z.string().max(64).optional() }), response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await integrity.queue(me(req), req.id, req.query.eventId)) }));
  r.post('/integrity-reports/:id/steps', { schema: { tags: ['integrity'], params: Id, body: IntegrityStepSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await integrity.step(req.params.id, req.body.action, req.body.note, { assignee: req.body.assignee, caseId: req.body.caseId, outcome: req.body.outcome }, me(req), req.id)));
  r.put('/events/:id/integrity-requirements', { schema: { tags: ['integrity'], params: Id, body: IntegrityRequirementsSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await integrity.setRequirements(req.params.id, req.body, me(req), req.id)));

  // ------------------------------------------------------------------ corrections (RES-006..008)
  r.post('/matches/:id/corrections/preview', { schema: { tags: ['corrections'], params: Id, body: CorrectionPreviewSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await corrections.preview(req.params.id, req.body.outcome as MatchOutcome | null, me(req), req.id)));
  r.post('/matches/:id/corrections', { schema: { tags: ['corrections'], params: Id, body: CorrectionRequestSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await corrections.request(req.params.id, req.body.outcome as MatchOutcome, req.body.reason, req.body.caseId, req.body.approvalId, me(req), req.id)));
  r.post('/matches/:id/reopen', { schema: { tags: ['corrections'], params: Id, body: ReopenSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await corrections.reopen(req.params.id, req.body.reason, req.body.approvalId, me(req), req.id)));
  r.post('/corrections/:id/resume', { schema: { tags: ['corrections'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await corrections.resume(req.params.id, me(req), req.id)));
  r.get('/corrections/:id', { schema: { tags: ['corrections'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await corrections.get(req.params.id, me(req), req.id)));
  r.get('/events/:id/corrections', { schema: { tags: ['corrections'], params: Id, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await corrections.list(req.params.id, me(req), req.id)) }));

  // ------------------------------------------------------------------ ranking (RANK-001..008)
  r.get('/ratings/systems', { schema: { tags: ['ranking'], querystring: z.object({ gameId: z.string().max(64).optional(), drafts: z.coerce.boolean().optional() }), response: { 200: Items, ...errors } } }, async (req) => {
    const drafts = !!req.query.drafts && !!req.auth && (await ct.acl.can(req.auth.principal._id, 'ranking.manage', { type: 'site', id: 'site' }));
    return { items: (await ratings.list({ gameId: req.query.gameId, includeDrafts: drafts })).map((s) => plain(ratings.publicSystem(s))) };
  });
  r.post('/ratings/systems', { schema: { tags: ['ranking'], body: RatingSystemSchema, response: { 200: Out, ...errors } } }, async (req) => plain(ratings.publicSystem(await ratings.create(req.body, me(req), req.id))));
  r.post('/ratings/systems/:id/revise', { schema: { tags: ['ranking'], params: Id, body: RatingReviseSchema, response: { 200: Out, ...errors } } }, async (req) => plain(ratings.publicSystem(await ratings.revise(req.params.id, req.body.params, req.body.eventWeights, me(req), req.id))));
  r.post('/ratings/systems/:id/publish', { schema: { tags: ['ranking'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(ratings.publicSystem(await ratings.publish(req.params.id, me(req), req.id))));
  r.post('/ratings/systems/:id/approve', { schema: { tags: ['ranking'], params: Id, body: RatingApproveSchema, response: { 200: Out, ...errors } } }, async (req) => plain(ratings.publicSystem(await ratings.approve(req.params.id, req.body.reference, me(req), req.id))));
  r.post('/ratings/systems/:id/retire', { schema: { tags: ['ranking'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(ratings.publicSystem(await ratings.retire(req.params.id, me(req), req.id))));
  r.get('/ratings/systems/:id/builds', { schema: { tags: ['ranking'], params: Id, response: { 200: Items, ...errors } } }, async (req) => {
    await ct.acl.require(me(req), 'ranking.manage', { type: 'site', id: 'site' }, req.id);
    return { items: plainAll(await ct.c.ratingJobs.find({ systemId: req.params.id }).sort({ startedAt: -1 }).limit(20).toArray()) };
  });
  r.get('/ratings/systems/:id/leaderboard', { schema: { tags: ['ranking'], params: Id, querystring: LeaderboardQuerySchema, response: { 200: Out, ...errors } } }, async (req) => plain(await ratings.leaderboard(req.params.id, req.query)));
  r.get('/ratings/systems/:id/records', { schema: { tags: ['ranking'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await ratings.records(req.params.id)));
  r.get('/ratings/subjects/:id/trend', { schema: { tags: ['ranking'], params: Id, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await ratings.trend(req.params.id)) }));
  r.get('/careers/head-to-head', { schema: { tags: ['ranking'], querystring: HeadToHeadQuerySchema, response: { 200: Out, ...errors } } }, async (req) => plain(await career.headToHead(req.query.kind, req.query.a, req.query.b)));
  r.get('/careers/players/:id', { schema: { tags: ['ranking'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await career.player(req.params.id)));
  r.get('/careers/teams/:id', { schema: { tags: ['ranking'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await career.team(req.params.id)));

  // ------------------------------------------------------------------ honors, certificates, awards (AWD, END-003..005)
  r.get('/events/:id/honors', { schema: { tags: ['honors'], params: Id, response: { 200: Items, ...errors } } }, async (req) => {
    await visibleEvent(req, req.params.id);
    return { items: plainAll(await honors.forEvent(req.params.id)) };
  });
  r.get('/players/:id/honors', { schema: { tags: ['honors'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await honors.forPrincipal(req.params.id)));
  r.get('/teams/:id/honors', { schema: { tags: ['honors'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await honors.forTeam(req.params.id)));
  r.get('/verify/:code', { schema: { tags: ['honors'], params: z.object({ code: z.string().min(1).max(32) }), response: { 200: Out, ...errors } } }, async (req) => plain(await honors.verify(req.params.code)));
  r.get('/honors/:id/card.svg', { schema: { tags: ['honors'], params: Id } }, async (req, reply) => {
    const svg = await honors.shareCard(req.params.id);
    return reply.type('image/svg+xml; charset=utf-8').header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'").header('cache-control', 'public, max-age=300').send(svg);
  });
  r.post('/honors/:id/revoke', { schema: { tags: ['honors'], params: Id, body: HonorRevokeSchema, response: { 200: Out, ...errors } } }, async (req) => plain(honors.publicHonor(await honors.revoke(req.params.id, req.body.reason, me(req), req.id))));
  r.get('/me/certificates', { schema: { tags: ['honors'], response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await honors.myCertificates(me(req))) }));
  r.post('/certificates/:id/revoke', { schema: { tags: ['honors'], params: Id, body: SanctionRevokeSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await honors.revokeCertificate(req.params.id, req.body.reason, me(req), req.id)));
  r.post('/certificates/:id/correct', { schema: { tags: ['honors'], params: Id, body: CertificateCorrectSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await honors.correctCertificate(req.params.id, req.body, me(req), req.id)));
  r.get('/events/:id/special-awards', { schema: { tags: ['honors'], params: Id, response: { 200: Items, ...errors } } }, async (req) => {
    await ct.acl.require(me(req), 'event.read_private', { type: 'event', id: req.params.id }, req.id);
    return { items: plainAll(await honors.specials(req.params.id)) };
  });
  r.post('/events/:id/special-awards', { schema: { tags: ['honors'], params: Id, body: SpecialAwardSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await honors.proposeSpecial({ eventId: req.params.id, ...req.body }, me(req), req.id)));
  r.post('/special-awards/:id/decision', { schema: { tags: ['honors'], params: Id, body: SpecialDecisionSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await honors.decideSpecial(req.params.id, req.body.approve, me(req), req.id)));
  r.post('/declared-achievements', { schema: { tags: ['honors'], body: DeclareAchievementSchema, response: { 200: Out, ...errors } } }, async (req) => plain(honors.publicDeclared(await honors.declare(req.body, me(req), req.id))));
  r.get('/declared-achievements/queue', { schema: { tags: ['honors'], response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await honors.declaredQueue(me(req), req.id)) }));
  r.post('/declared-achievements/:id/review', { schema: { tags: ['honors'], params: Id, body: DeclaredReviewSchema, response: { 200: Out, ...errors } } }, async (req) => plain(honors.publicDeclared(await honors.reviewDeclared(req.params.id, req.body.decision, req.body.note, me(req), req.id))));

  // ------------------------------------------------------------------ finish / close / archive (END-001..007)
  r.get('/events/:id/close-blockers', { schema: { tags: ['close'], params: Id, response: { 200: Out, ...errors } } }, async (req) => {
    await ct.acl.require(me(req), 'event.read_private', { type: 'event', id: req.params.id }, req.id);
    return plain(await close.blockers(req.params.id));
  });
  r.post('/events/:id/finish', { schema: { tags: ['close'], params: Id, body: EventVersionSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await close.finish(req.params.id, req.body.expectedVersion, me(req), req.id)));
  r.post('/events/:id/close', { schema: { tags: ['close'], params: Id, body: EventCloseSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const out = await close.close(req.params.id, req.body.expectedVersion, req.body.approvalId, me(req), req.id);
    return { event: { id: out.event._id, state: out.event.state, version: out.event.version }, effects: out.effects };
  });
  r.post('/events/:id/archive', { schema: { tags: ['close'], params: Id, body: EventVersionSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const e = await close.archiveEvent(req.params.id, req.body.expectedVersion, me(req), req.id);
    return { id: e._id, state: e.state, version: e.version };
  });
  r.get('/events/:id/archive', { schema: { tags: ['close'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await close.getArchive(req.params.id)));
  r.post('/events/:id/feedback', { schema: { tags: ['close'], params: Id, body: FeedbackSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const f = await close.feedback(req.params.id, req.body.score, req.body.comment, me(req));
    return { id: f._id, score: f.score, createdAt: f.createdAt };
  });
  r.get('/events/:id/report', { schema: { tags: ['close'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await close.report(req.params.id, me(req), req.id)));
}
