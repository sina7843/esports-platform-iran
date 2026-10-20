import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdmitSchema, AllocateSchema, ApplyProposalSchema, AssignStationSchema, AutoScheduleSchema, BracketQuerySchema, BulkShiftSchema, CallupStateSchema, ChallengeSchema, ChatSchema, ChecklistSchema,
  CredentialSchema, DecisionNoteSchema, DelaySchema, DeviceSwapSchema, DisconnectSchema, DomainError, DrawPreviewSchema, EquipmentSchema, ErrorResponse, FaultSchema, IncidentResolveSchema,
  IncidentSchema, IngestSchema, LoanSchema, ManualLobbySchema, OffsetPageSchema, OfflineDecisionSchema, PauseSchema, PersonalEquipmentSchema, RedrawSchema, RefereeCallSchema, RefereeCallUpdateSchema,
  RescheduleDecisionSchema, RescheduleRequestSchema, ResultFinalizeSchema, ResultSubmitSchema, ReturnSchema, ReviewResolveSchema, RunDecisionSchema, SanctionSchema, ScheduleConfigSchema,
  SelectionActSchema, ServerCreateSchema, ServerHealthSchema, SetTimeSchema, StageSettingsSchema, StandingsQuerySchema, StationSchema, SurrenderSchema, SwitchServerSchema, TicketAdmitSchema,
  TransferSchema, VenueSchema, WithdrawalSchema,
} from '@esp/contracts';
import {
  assertSettings, DrawService, EventsService, LanService, MatchResultService, publicMatch, RoomService, RunService, ScheduleService, SelectionService, ServerService, stageRuleValues, StructureService,
  type Container, type MatchOutcome,
} from '@esp/core';

/**
 * ESP-04 API: draw and structure, result hook, scheduling, room/selection/run, servers/integrations, LAN operations.
 * Public reads respect event visibility (link token, private, invite); everything else is authorized in the services.
 */
const Id = z.object({ id: z.string().min(1).max(64) });
const Out = z.record(z.string(), z.unknown());
const Items = z.object({ items: z.array(Out) });
const Token = z.object({ t: z.string().max(64).optional() });
const plain = <T extends object>(x: T): Record<string, unknown> => x as unknown as Record<string, unknown>;
const plainAll = <T extends object>(xs: T[]): Array<Record<string, unknown>> => xs.map(plain);

export function operationsRoutes(app: FastifyInstance, ct: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const draws = new DrawService(ct);
  const structure = new StructureService(ct);
  const results = new MatchResultService(ct);
  const schedule = new ScheduleService(ct);
  const selection = new SelectionService(ct);
  const room = new RoomService(ct);
  const run = new RunService(ct);
  const servers = new ServerService(ct);
  const lan = new LanService(ct);
  const events = new EventsService(ct);
  const errors = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 412: ErrorResponse, 429: ErrorResponse, 503: ErrorResponse };
  const me = (req: { requireAuth(): { principal: { _id: string } } }) => req.requireAuth().principal._id;
  const viewer = (req: { auth: { principal: { _id: string } } | null }) => req.auth?.principal._id ?? null;

  /** No existence leak: a stage/match of an event the viewer may not see is "not found". */
  async function visibleEvent(req: { auth: { principal: { _id: string } } | null; query?: unknown }, eventId: string) {
    const e = await ct.c.events.findOne({ _id: eventId });
    const t = (req.query as { t?: string } | undefined)?.t ?? null;
    if (!e || !(await events.canView(e, viewer(req), t))) throw new DomainError('NOT_FOUND', 'not found');
    return e;
  }
  async function stageOf(id: string) {
    const s = await ct.c.stages.findOne({ _id: id });
    if (!s) throw new DomainError('NOT_FOUND', 'stage not found');
    return s;
  }
  async function matchOf(id: string) {
    const m = await ct.c.matches.findOne({ _id: id });
    if (!m) throw new DomainError('NOT_FOUND', 'match not found');
    return m;
  }

  // ------------------------------------------------------------------ stage settings, draw, structure
  r.get('/stages/:id', { schema: { tags: ['competition-ops'], params: Id, querystring: Token, response: { 200: Out, ...errors } } }, async (req) => {
    const s = await stageOf(req.params.id);
    const e = await visibleEvent(req, s.eventId);
    const d = await ct.c.disciplines.findOne({ _id: s.disciplineId }, { projection: { name: 1, rulesSnapshot: 1 } });
    const st = await ct.c.stageStructures.findOne({ _id: s._id }, { projection: { state: 1, 'plan.algorithm': 1, 'plan.engine': 1, rulesHash: 1, groups: 1 } });
    return {
      id: s._id, name: s.name, order: s.order, format: s.format, state: s.state, presence: s.presence, eventId: e._id, eventName: e.name, disciplineId: s.disciplineId, disciplineName: d?.name ?? null,
      rules: d?.rulesSnapshot ? { packageId: d.rulesSnapshot.packageId, version: d.rulesSnapshot.version, label: d.rulesSnapshot.label } : null,
      structure: st ? { state: st.state, algorithm: st.plan.algorithm, engine: st.plan.engine, rulesHash: st.rulesHash, groups: st.groups ? Object.keys(st.groups) : [] } : null,
      phases: s.phases ?? [], links: s.links,
    };
  });
  r.patch('/stages/:id/settings', { schema: { tags: ['competition-ops'], params: Id, body: StageSettingsSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const s = await stageOf(req.params.id);
    await req.requirePermission('event.manage', { type: 'event', id: s.eventId });
    if (s.state !== 'planned') throw new DomainError('PRECONDITION_FAILED', 'stage settings are frozen once the draw is published');
    const d = await ct.c.disciplines.findOne({ _id: s.disciplineId });
    if (!d) throw new DomainError('NOT_FOUND', 'discipline not found');
    if (req.body.settings) await assertSettings(ct, d, req.body.settings);
    for (const o of req.body.overrides ?? []) await assertSettings(ct, d, o.values);
    if (req.body.phases && s.format !== 'mixed') throw new DomainError('VALIDATION_FAILED', 'phases belong to mixed stages');
    const set: Record<string, unknown> = {};
    if (req.body.settings) set['settings'] = req.body.settings;
    if (req.body.overrides) set['overrides'] = req.body.overrides;
    if (req.body.phases) set['phases'] = req.body.phases;
    const u = await ct.c.stages.findOneAndUpdate({ _id: s._id, version: req.body.expectedVersion }, { $set: set, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!u) throw new DomainError('VERSION_CONFLICT', 'stage changed since it was read');
    await ct.audit.append({ actorPrincipalId: me(req), action: 'stage.settings', target: { type: 'stage', id: s._id }, scope: { type: 'event', id: s.eventId }, outcome: 'success', details: { keys: Object.keys(set) }, requestId: req.id });
    return plain(u);
  });
  r.get('/stages/:id/rules', { schema: { tags: ['competition-ops'], params: Id, response: { 200: Out, ...errors } } }, async (req) => {
    const s = await stageOf(req.params.id);
    await req.requirePermission('event.read_private', { type: 'event', id: s.eventId });
    const d = await ct.c.disciplines.findOne({ _id: s.disciplineId });
    const v = await stageRuleValues(ct, s, d!);
    return { values: v.values, hash: v.hash, format: s.format, settings: s.settings ?? {}, overrides: s.overrides ?? [], phases: s.phases ?? [] };
  });
  r.post('/stages/:id/draws', { schema: { tags: ['competition-ops'], params: Id, body: DrawPreviewSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await draws.preview(req.params.id, req.body as never, me(req), req.id))));
  r.get('/stages/:id/draws', { schema: { tags: ['competition-ops'], params: Id, querystring: Token, response: { 200: Items, ...errors } } }, async (req) => {
    const s = await stageOf(req.params.id);
    await visibleEvent(req, s.eventId);
    return { items: plainAll(await draws.list(req.params.id, viewer(req), req.id)) };
  });
  for (const step of ['confirm', 'lock', 'publish'] as const) {
    r.post(`/draws/:id/${step}`, { schema: { tags: ['competition-ops'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await draws[step](req.params.id, me(req), req.id)));
  }
  r.get('/draws/:id/verify', { schema: { tags: ['competition-ops'], params: Id, response: { 200: z.object({ reproducible: z.boolean() }), ...errors } } }, async (req) => draws.verify(req.params.id));
  r.post('/stages/:id/redraw', { schema: { tags: ['competition-ops'], params: Id, body: RedrawSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const { reason, ...input } = req.body;
    const res = await draws.redraw(req.params.id, reason, input as never, me(req), req.id);
    return { draw: plain(res.draw), discardedMatches: res.discardedMatches };
  });
  r.post('/stages/:id/structure', { schema: { tags: ['competition-ops'], params: Id, response: { 201: Out, ...errors } } }, async (req, reply) => {
    const st = await structure.generate(req.params.id, me(req), req.id);
    return reply.status(201).send({ stageId: st._id, format: st.format, algorithm: st.plan.algorithm, engine: st.plan.engine, slots: st.plan.slots.length });
  });
  r.get('/stages/:id/bracket', { schema: { tags: ['competition-ops'], params: Id, querystring: BracketQuerySchema.merge(Token), response: { 200: Out, ...errors } } }, async (req) => {
    const s = await stageOf(req.params.id);
    await visibleEvent(req, s.eventId);
    return plain(await structure.view(req.params.id, { bracket: req.query.bracket, round: req.query.round, offset: req.query.offset, limit: req.query.limit }));
  });
  r.get('/stages/:id/standings', { schema: { tags: ['competition-ops'], params: Id, querystring: StandingsQuerySchema.merge(Token), response: { 200: Out, ...errors } } }, async (req) => {
    const s = await stageOf(req.params.id);
    await visibleEvent(req, s.eventId);
    return plain(await structure.standings(req.params.id, { group: req.query.group, offset: req.query.offset, limit: req.query.limit }));
  });
  r.post('/stages/:id/next-round', { schema: { tags: ['competition-ops'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await structure.nextRound(req.params.id, me(req), req.id)));
  r.post('/stages/:id/next-phase', { schema: { tags: ['competition-ops'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await structure.nextPhase(req.params.id, me(req), req.id)));
  r.post('/stages/:id/challenges', { schema: { tags: ['competition-ops'], params: Id, body: ChallengeSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(publicMatch(await structure.challenge(req.params.id, req.body.challenger, req.body.defender, me(req), req.id))));
  r.post('/stages/:id/withdrawals', { schema: { tags: ['competition-ops'], params: Id, body: WithdrawalSchema, response: { 204: z.null(), ...errors } } }, async (req, reply) => {
    await structure.withdraw(req.params.id, req.body.participationId, req.body.reason, me(req), req.id);
    return reply.status(204).send(null);
  });
  r.post('/stages/:id/transfer', { schema: { tags: ['competition-ops'], params: Id, body: TransferSchema, response: { 200: Out, ...errors } } }, async (req) => structure.transfer(req.body.fromStageId, req.params.id, me(req), req.id));

  // ------------------------------------------------------------------ result hook (full cycle in ESP-05)
  r.post('/matches/:id/results', { schema: { tags: ['competition-ops'], params: Id, body: ResultSubmitSchema, response: { 200: Out, ...errors } } }, async (req) => publicMatch(await results.submit(req.params.id, req.body.outcome as MatchOutcome, req.body.evidenceFileIds, me(req), req.id, req.body.units)));
  r.post('/matches/:id/finalize', { schema: { tags: ['competition-ops'], params: Id, body: ResultFinalizeSchema, response: { 200: Out, ...errors } } }, async (req) => publicMatch(await results.finalize(req.params.id, req.body.outcome as MatchOutcome | null, me(req), req.id)));

  // ------------------------------------------------------------------ schedule
  r.get('/events/:id/schedule-config', { schema: { tags: ['schedule'], params: Id, response: { 200: Out, ...errors } } }, async (req) => {
    await req.requirePermission('event.read_private', { type: 'event', id: req.params.id });
    return plain(await schedule.config(req.params.id));
  });
  r.put('/events/:id/schedule-config', { schema: { tags: ['schedule'], params: Id, body: ScheduleConfigSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await schedule.setConfig(req.params.id, req.body, me(req), req.id)));
  r.get('/events/:id/schedule', { schema: { tags: ['schedule'], params: Id, querystring: OffsetPageSchema.merge(Token).extend({ from: z.string().optional(), to: z.string().optional(), stageId: z.string().optional() }), response: { 200: Out, ...errors } } }, async (req) => {
    await visibleEvent(req, req.params.id);
    const filter: Record<string, unknown> = { eventId: req.params.id, state: { $ne: 'cancelled' } };
    if (req.query.stageId) filter['stageId'] = req.query.stageId;
    if (req.query.from || req.query.to) filter['scheduledAt'] = { ...(req.query.from ? { $gte: req.query.from } : {}), ...(req.query.to ? { $lte: req.query.to } : {}) };
    const total = await ct.c.matches.countDocuments(filter);
    const items = await ct.c.matches.find(filter, { projection: { lobby: 0 } }).sort({ scheduledAt: 1, 'slot.round': 1, 'slot.order': 1 }).skip(req.query.offset).limit(req.query.limit).toArray();
    return { total, offset: req.query.offset, limit: req.query.limit, items: items.map(publicMatch) };
  });
  r.put('/matches/:id/schedule', { schema: { tags: ['schedule'], params: Id, body: SetTimeSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const res = await schedule.setTime(req.params.id, req.body, me(req), req.id);
    return { match: publicMatch(res.match), conflicts: res.conflicts };
  });
  r.post('/events/:id/schedule/auto', { schema: { tags: ['schedule'], params: Id, body: AutoScheduleSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await schedule.autoPropose(req.params.id, req.body, me(req), req.id))));
  r.post('/events/:id/schedule/bulk-shift', { schema: { tags: ['schedule'], params: Id, body: BulkShiftSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await schedule.bulkShift(req.params.id, req.body, me(req), req.id))));
  r.post('/matches/:id/delay', { schema: { tags: ['schedule'], params: Id, body: DelaySchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await schedule.proposeDelay(req.params.id, req.body.minutes, req.body.reason, me(req), req.id))));
  r.get('/events/:id/schedule-proposals', { schema: { tags: ['schedule'], params: Id, response: { 200: Items, ...errors } } }, async (req) => {
    await req.requirePermission('match.manage', { type: 'event', id: req.params.id });
    return { items: plainAll(await ct.c.scheduleProposals.find({ eventId: req.params.id }).sort({ createdAt: -1 }).limit(50).toArray()) };
  });
  r.post('/schedule-proposals/:id/apply', { schema: { tags: ['schedule'], params: Id, body: ApplyProposalSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await schedule.applyProposal(req.params.id, req.body, me(req), req.id)));
  r.post('/schedule-proposals/:id/reject', { schema: { tags: ['schedule'], params: Id, response: { 204: z.null(), ...errors } } }, async (req, reply) => {
    await schedule.rejectProposal(req.params.id, me(req), req.id);
    return reply.status(204).send(null);
  });
  r.post('/matches/:id/reschedule-requests', { schema: { tags: ['schedule'], params: Id, body: RescheduleRequestSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await schedule.request(req.params.id, req.body.proposedAt, req.body.reason, me(req)))));
  r.post('/reschedule-requests/:id/agree', { schema: { tags: ['schedule'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await schedule.agree(req.params.id, me(req))));
  r.post('/reschedule-requests/:id/decision', { schema: { tags: ['schedule'], params: Id, body: RescheduleDecisionSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await schedule.decide(req.params.id, req.body.approve, req.body.note, me(req), req.id)));
  r.get('/events/:id/reschedule-requests', { schema: { tags: ['schedule'], params: Id, response: { 200: Items, ...errors } } }, async (req) => {
    await req.requirePermission('match.manage', { type: 'event', id: req.params.id });
    return { items: plainAll(await ct.c.rescheduleRequests.find({ eventId: req.params.id }).sort({ createdAt: -1 }).limit(100).toArray()) };
  });
  r.get('/me/reschedule-requests', { schema: { tags: ['schedule'], response: { 200: Items, ...errors } } }, async (req) => {
    const mine = await ct.c.matches.find({ principalIds: me(req), state: { $nin: ['final', 'cancelled'] } }, { projection: { _id: 1 } }).toArray();
    return { items: plainAll(await ct.c.rescheduleRequests.find({ matchId: { $in: mine.map((m) => m._id) } }).sort({ createdAt: -1 }).limit(100).toArray()) };
  });
  r.get('/me/calendar', { schema: { tags: ['schedule'], response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await schedule.calendar(me(req))) }));
  r.get('/me/calendar.ics', { schema: { tags: ['schedule'] } }, async (req, reply) => reply.header('Content-Type', 'text/calendar; charset=utf-8').header('Content-Disposition', 'attachment; filename="esp-calendar.ics"').header('Cache-Control', 'private, no-store').send(await schedule.ics(me(req))));

  // ------------------------------------------------------------------ room, selection, run
  r.get('/matches/:id/room', { schema: { tags: ['room'], params: Id, querystring: Token, response: { 200: Out, ...errors } } }, async (req) => {
    const m = await matchOf(req.params.id);
    await visibleEvent(req, m.eventId);
    return plain(await room.view(req.params.id, viewer(req)));
  });
  r.post('/matches/:id/readiness/open', { schema: { tags: ['room'], params: Id, response: { 200: Out, ...errors } } }, async (req) => publicMatch(await room.openReadiness(req.params.id, me(req), req.id)));
  r.post('/matches/:id/ready', { schema: { tags: ['room'], params: Id, response: { 200: Out, ...errors } } }, async (req) => publicMatch(await room.ready(req.params.id, me(req), req.id)));
  r.get('/matches/:id/messages', { schema: { tags: ['room'], params: Id, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await room.messages(req.params.id, me(req))) }));
  r.post('/matches/:id/messages', { schema: { tags: ['room'], params: Id, body: ChatSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await room.chat(req.params.id, req.body.text, req.body.channel, me(req)))));
  r.post('/messages/:id/hide', { schema: { tags: ['room'], params: Id, response: { 204: z.null(), ...errors } } }, async (req, reply) => {
    await room.hideMessage(req.params.id, me(req), req.id);
    return reply.status(204).send(null);
  });
  r.post('/matches/:id/referee-calls', { schema: { tags: ['room'], params: Id, body: RefereeCallSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await room.callReferee(req.params.id, req.body.reason, me(req)))));
  r.post('/referee-calls/:id', { schema: { tags: ['room'], params: Id, body: RefereeCallUpdateSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await room.updateCall(req.params.id, req.body.state, me(req), req.id)));
  r.get('/events/:id/referee-calls', { schema: { tags: ['room'], params: Id, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await room.openCalls(req.params.id, me(req), req.id)) }));
  r.put('/matches/:id/lobby', { schema: { tags: ['room'], params: Id, body: ManualLobbySchema, response: { 204: z.null(), ...errors } } }, async (req, reply) => {
    await room.setManualLobby(req.params.id, req.body.host, req.body.password, me(req), req.id);
    return reply.status(204).send(null);
  });
  r.post('/matches/:id/selection/start', { schema: { tags: ['room'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await selection.start(req.params.id, me(req), req.id)));
  r.get('/matches/:id/selection', { schema: { tags: ['room'], params: Id, querystring: Token, response: { 200: Out.nullable(), ...errors } } }, async (req) => {
    const m = await matchOf(req.params.id);
    await visibleEvent(req, m.eventId);
    const v = await selection.view(req.params.id);
    return v ? plain({ ...v, actions: v.actions.map(({ by: _by, ...a }) => a) }) : null;
  });
  r.post('/matches/:id/selection/act', { schema: { tags: ['room'], params: Id, body: SelectionActSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await selection.act(req.params.id, req.body.step, req.body.value, me(req), req.id)));
  r.post('/matches/:id/run/start', { schema: { tags: ['run'], params: Id, response: { 200: Out, ...errors } } }, async (req) => publicMatch(await run.start(req.params.id, me(req), req.id)));
  r.post('/matches/:id/run/pause', { schema: { tags: ['run'], params: Id, body: PauseSchema, response: { 200: Out, ...errors } } }, async (req) => publicMatch(await run.pause(req.params.id, req.body.kind, req.body.side, req.body.reason, me(req), req.id)));
  r.post('/matches/:id/run/resume', { schema: { tags: ['run'], params: Id, response: { 200: Out, ...errors } } }, async (req) => publicMatch(await run.resume(req.params.id, me(req), req.id)));
  r.post('/matches/:id/run/disconnect', { schema: { tags: ['run'], params: Id, body: DisconnectSchema, response: { 200: Out, ...errors } } }, async (req) => publicMatch(await run.disconnect(req.params.id, req.body.side, me(req), req.id)));
  r.post('/matches/:id/run/reconnect', { schema: { tags: ['run'], params: Id, response: { 200: Out, ...errors } } }, async (req) => publicMatch(await run.reconnect(req.params.id, me(req), req.id)));
  r.get('/matches/:id/run/disconnect', { schema: { tags: ['run'], params: Id, response: { 200: Out, ...errors } } }, async (req) => {
    const m = await matchOf(req.params.id);
    if (room.sideOf(m, me(req)) < 0) await req.requirePermission('match.read_private', { type: 'match', id: m._id });
    return plain(await run.disconnectStatus(req.params.id));
  });
  r.post('/matches/:id/run/decision', { schema: { tags: ['run'], params: Id, body: RunDecisionSchema, response: { 200: Out, ...errors } } }, async (req) => publicMatch(await run.decide(req.params.id, req.body.decision, req.body.reason, me(req), req.id)));
  r.post('/matches/:id/run/device-swap', { schema: { tags: ['run'], params: Id, body: DeviceSwapSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await run.deviceSwap(req.params.id, req.body.side, req.body.note, me(req), req.id)));
  r.post('/matches/:id/run/surrender', { schema: { tags: ['run'], params: Id, body: SurrenderSchema, response: { 200: Out, ...errors } } }, async (req) => publicMatch(await run.surrender(req.params.id, req.body.reason, me(req), req.id)));
  r.post('/matches/:id/run/sanction', { schema: { tags: ['run'], params: Id, body: SanctionSchema, response: { 200: Out, ...errors } } }, async (req) => publicMatch(await run.sanction(req.params.id, req.body.type, req.body.side, req.body.principalId, req.body.reason, me(req), req.id)));
  r.get('/matches/:id/timeline', { schema: { tags: ['run'], params: Id, querystring: Token, response: { 200: Items, ...errors } } }, async (req) => {
    const m = await matchOf(req.params.id);
    await visibleEvent(req, m.eventId);
    return { items: plainAll(await run.timeline(req.params.id, viewer(req))) };
  });
  r.post('/events/:id/incidents', { schema: { tags: ['run'], params: Id, body: IncidentSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await run.openIncident(req.params.id, req.body, me(req), req.id))));
  r.post('/incidents/:id/resolve', { schema: { tags: ['run'], params: Id, body: IncidentResolveSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await run.resolveIncident(req.params.id, req.body.resume, req.body.note, me(req), req.id)));
  r.get('/events/:id/incidents', { schema: { tags: ['run'], params: Id, querystring: Token, response: { 200: Items, ...errors } } }, async (req) => {
    await visibleEvent(req, req.params.id);
    const staff = viewer(req) ? await ct.acl.can(viewer(req)!, 'match.read_private', { type: 'event', id: req.params.id }) : false;
    const items = await ct.c.incidents.find({ eventId: req.params.id }).sort({ openedAt: -1 }).limit(50).toArray();
    return { items: items.map((i) => (staff ? plain(i) : { id: i._id, kind: i.kind, publicNotice: i.publicNotice, state: i.state, openedAt: i.openedAt, resolvedAt: i.resolvedAt })) };
  });
  r.get('/events/:id/review-items', { schema: { tags: ['run'], params: Id, response: { 200: Items, ...errors } } }, async (req) => {
    await req.requirePermission('match.read_private', { type: 'event', id: req.params.id });
    return { items: plainAll(await ct.c.reviewItems.find({ eventId: req.params.id }).sort({ state: -1, createdAt: -1 }).limit(200).toArray()) };
  });
  r.post('/review-items/:id/resolve', { schema: { tags: ['run'], params: Id, body: ReviewResolveSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const item = await ct.c.reviewItems.findOne({ _id: req.params.id });
    if (!item) throw new DomainError('NOT_FOUND', 'review item not found');
    await req.requirePermission('match.result.verify', { type: 'event', id: item.eventId });
    const u = await ct.c.reviewItems.findOneAndUpdate({ _id: item._id, state: 'open' }, { $set: { state: 'resolved', resolution: req.body.resolution, resolvedBy: me(req), resolvedAt: new Date().toISOString() } }, { returnDocument: 'after' });
    if (!u) throw new DomainError('ILLEGAL_TRANSITION', 'already resolved');
    await ct.audit.append({ actorPrincipalId: me(req), action: 'review.resolve', target: { type: item.ref.type, id: item.ref.id }, scope: { type: 'event', id: item.eventId }, outcome: 'success', details: { kind: item.kind, resolution: req.body.resolution }, requestId: req.id });
    return plain(u);
  });

  // ------------------------------------------------------------------ servers and integrations
  r.post('/events/:id/servers', { schema: { tags: ['servers'], params: Id, body: ServerCreateSchema, response: { 201: Out, ...errors } } }, async (req, reply) => {
    const s = await servers.create({ ...req.body, eventId: req.params.id }, me(req), req.id);
    return reply.status(201).send({ ...plain(s), connection: null });
  });
  r.post('/servers', { schema: { tags: ['servers'], body: ServerCreateSchema, response: { 201: Out, ...errors } } }, async (req, reply) => {
    const s = await servers.create({ ...req.body, eventId: null }, me(req), req.id);
    return reply.status(201).send({ ...plain(s), connection: null });
  });
  r.get('/events/:id/servers', { schema: { tags: ['servers'], params: Id, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await servers.list(req.params.id, me(req), req.id)) }));
  r.patch('/servers/:id/health', { schema: { tags: ['servers'], params: Id, body: ServerHealthSchema, response: { 200: Out, ...errors } } }, async (req) => ({ ...plain(await servers.setHealth(req.params.id, req.body.health, req.body.enabled, me(req), req.id)), connection: null }));
  r.post('/matches/:id/server', { schema: { tags: ['servers'], params: Id, body: AllocateSchema, response: { 201: Out, ...errors } } }, async (req, reply) => {
    const a = await servers.allocate(req.params.id, req.body.serverId, req.body.reason, me(req), req.id);
    return reply.status(201).send({ id: a._id, serverId: a.serverId, state: a.state, at: a.at });
  });
  r.post('/matches/:id/server/switch', { schema: { tags: ['servers'], params: Id, body: SwitchServerSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const a = await servers.switch(req.params.id, req.body.toServerId, req.body.reason, me(req), req.id);
    return { id: a._id, serverId: a.serverId, state: a.state, at: a.at };
  });
  r.delete('/matches/:id/server', { schema: { tags: ['servers'], params: Id, body: z.object({ reason: z.string().min(2).max(300) }), response: { 200: z.object({ released: z.boolean() }), ...errors } } }, async (req) => {
    const m = await matchOf(req.params.id);
    await req.requirePermission('server.manage', { type: 'event', id: m.eventId });
    return { released: await servers.release(req.params.id, req.body.reason, me(req), req.id) };
  });
  r.post('/matches/:id/server/password', { schema: { tags: ['servers'], params: Id, response: { 204: z.null(), ...errors } } }, async (req, reply) => {
    await servers.rotatePassword(req.params.id, me(req), req.id);
    return reply.status(204).send(null);
  });
  r.get('/matches/:id/server/template', { schema: { tags: ['servers'], params: Id, response: { 200: Out, ...errors } } }, async (req) => servers.template(req.params.id, me(req), req.id));
  r.get('/games/:id/integration', { schema: { tags: ['servers'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await servers.integrationStatus(req.params.id)));
  r.post('/matches/:id/integration', { schema: { tags: ['servers'], params: Id, body: IngestSchema, response: { 201: Out, ...errors } } }, async (req, reply) => {
    const d = await servers.ingest(req.params.id, req.body.kind, req.body.raw, req.body.fileId, me(req), req.id);
    return reply.status(201).send({ id: d._id, source: d.source, kind: d.kind, comparedWithManual: d.comparedWithManual, receivedAt: d.receivedAt });
  });

  // ------------------------------------------------------------------ LAN
  r.post('/events/:id/venues', { schema: { tags: ['lan'], params: Id, body: VenueSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await lan.createVenue(req.params.id, req.body, me(req), req.id))));
  r.get('/events/:id/venues', { schema: { tags: ['lan'], params: Id, querystring: Token, response: { 200: Items, ...errors } } }, async (req) => {
    await visibleEvent(req, req.params.id);
    return { items: plainAll(await lan.venues(req.params.id)) };
  });
  r.post('/venues/:id/stations', { schema: { tags: ['lan'], params: Id, body: StationSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await lan.addStation(req.params.id, req.body.areaKey, req.body.label, me(req), req.id))));
  r.get('/events/:id/stations', { schema: { tags: ['lan'], params: Id, response: { 200: Items, ...errors } } }, async (req) => {
    await req.requirePermission('match.read_private', { type: 'event', id: req.params.id });
    return { items: plainAll(await lan.stations(req.params.id)) };
  });
  r.put('/stations/:id/checklist', { schema: { tags: ['lan'], params: Id, body: ChecklistSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await lan.checklist(req.params.id, req.body.items, me(req), req.id)));
  r.post('/stations/:id/fault', { schema: { tags: ['lan'], params: Id, body: FaultSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const f = await lan.fault(req.params.id, req.body.note, me(req), req.id);
    return { station: plain(f.station), affectedMatchId: f.affectedMatchId };
  });
  r.post('/matches/:id/station', { schema: { tags: ['lan'], params: Id, body: AssignStationSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await lan.assign(req.params.id, req.body.stationId, req.body.reason, me(req), req.id)));
  r.post('/events/:id/equipment', { schema: { tags: ['lan'], params: Id, body: EquipmentSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await lan.addEquipment(req.params.id, req.body.label, req.body.kind, req.body.serial, me(req), req.id))));
  r.get('/events/:id/equipment', { schema: { tags: ['lan'], params: Id, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await lan.equipmentList(req.params.id, me(req), req.id)) }));
  r.post('/equipment/:id/loan', { schema: { tags: ['lan'], params: Id, body: LoanSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await lan.loan(req.params.id, req.body.to, req.body.condition, me(req), req.id)));
  r.post('/equipment/:id/return', { schema: { tags: ['lan'], params: Id, body: ReturnSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await lan.returnEquipment(req.params.id, req.body.condition, req.body.faulty, me(req), req.id)));
  r.post('/events/:id/personal-equipment', { schema: { tags: ['lan'], params: Id, body: PersonalEquipmentSchema, response: { 201: Out, ...errors } } }, async (req, reply) => reply.status(201).send(plain(await lan.requestPersonal(req.params.id, req.body.item, me(req)))));
  r.get('/events/:id/personal-equipment', { schema: { tags: ['lan'], params: Id, response: { 200: Items, ...errors } } }, async (req) => {
    const staff = await ct.acl.can(me(req), 'venue.manage', { type: 'event', id: req.params.id });
    return { items: plainAll(await ct.c.personalEquipment.find(staff ? { eventId: req.params.id } : { eventId: req.params.id, principalId: me(req) }).sort({ createdAt: -1 }).limit(500).toArray()) };
  });
  r.post('/personal-equipment/:id/decision', { schema: { tags: ['lan'], params: Id, body: DecisionNoteSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await lan.decidePersonal(req.params.id, req.body.approve, req.body.note, me(req), req.id)));
  r.post('/events/:id/credentials', { schema: { tags: ['lan'], params: Id, body: CredentialSchema, response: { 201: Out, ...errors } } }, async (req, reply) => {
    const c = await lan.issueCredential(req.params.id, req.body.principalId, req.body.role, req.body.areas, me(req), req.id);
    return reply.status(201).send({ id: c._id, principalId: c.principalId, role: c.role, areas: c.areas, state: c.state });
  });
  r.get('/events/:id/credentials', { schema: { tags: ['lan'], params: Id, response: { 200: Items, ...errors } } }, async (req) => {
    await req.requirePermission('venue.manage', { type: 'event', id: req.params.id });
    const list = await ct.c.accessCredentials.find({ eventId: req.params.id }).sort({ createdAt: -1 }).limit(1000).toArray();
    return { items: list.map((c) => ({ id: c._id, principalId: c.principalId, role: c.role, areas: c.areas, state: c.state, createdAt: c.createdAt })) };
  });
  r.delete('/credentials/:id', { schema: { tags: ['lan'], params: Id, response: { 204: z.null(), ...errors } } }, async (req, reply) => {
    await lan.revokeCredential(req.params.id, me(req), req.id);
    return reply.status(204).send(null);
  });
  r.get('/events/:id/my-qr', { schema: { tags: ['lan'], params: Id, response: { 200: Items, ...errors } } }, async (req) => ({ items: plainAll(await lan.myQr(req.params.id, me(req))) }));
  r.post('/events/:id/admissions', { schema: { tags: ['lan'], params: Id, body: AdmitSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const a = await lan.admit(req.params.id, req.body.qr, req.body.gate, req.body.area, me(req), req.id);
    const p = await ct.c.principals.findOne({ _id: a.principalId }, { projection: { displayName: 1 } });
    return { admitted: true, role: a.role, displayName: p?.displayName ?? null, at: a.admission.at };
  });
  r.post('/events/:id/ticket-admissions', { schema: { tags: ['lan'], params: Id, body: TicketAdmitSchema, response: { 200: Out, ...errors } } }, async (req) => {
    const a = await lan.admitTicket(req.params.id, req.body.code, req.body.gate, req.body.area, me(req), req.id);
    return { admitted: true, at: a.at, area: a.area };
  });
  r.post('/matches/:id/callup', { schema: { tags: ['lan'], params: Id, response: { 200: Out, ...errors } } }, async (req) => plain(await lan.callUp(req.params.id, me(req), req.id)));
  r.post('/matches/:id/callup/state', { schema: { tags: ['lan'], params: Id, body: CallupStateSchema, response: { 204: z.null(), ...errors } } }, async (req, reply) => {
    await lan.setCallupState(req.params.id, req.body.state, me(req), req.id);
    return reply.status(204).send(null);
  });
  r.get('/events/:id/hall', { schema: { tags: ['lan'], params: Id, querystring: Token, response: { 200: Out, ...errors } } }, async (req) => {
    await visibleEvent(req, req.params.id);
    return plain(await lan.hallDisplay(req.params.id));
  });
  app.post('/events/:id/offline-imports', { schema: { tags: ['lan'], consumes: ['multipart/form-data'], summary: 'Fields: procedureNo (EP-xx), kind (attendance|result), file (CSV)' } }, async (req, reply) => {
    const actor = me(req);
    const parts = req.parts({ limits: { fileSize: 1024 * 1024, files: 1, fields: 4 } });
    const fields: Record<string, string> = {};
    let data: Buffer | null = null;
    for await (const part of parts) {
      if (part.type === 'file') data = await part.toBuffer();
      else fields[part.fieldname] = String(part.value);
    }
    const kind = fields['kind'];
    if (!data || (kind !== 'attendance' && kind !== 'result')) throw new DomainError('VALIDATION_FAILED', 'file and kind (attendance|result) are required');
    return reply.status(201).send(await lan.importOffline((req.params as { id: string }).id, fields['procedureNo'] ?? '', kind, data, actor, req.id));
  });
  r.get('/events/:id/offline-imports', { schema: { tags: ['lan'], params: Id, response: { 200: Items, ...errors } } }, async (req) => {
    await req.requirePermission('match.read_private', { type: 'event', id: req.params.id });
    return { items: plainAll(await ct.c.offlineImports.find({ eventId: req.params.id }).sort({ createdAt: -1 }).limit(50).toArray()) };
  });
  r.post('/offline-imports/:id/decisions', { schema: { tags: ['lan'], params: Id, body: OfflineDecisionSchema, response: { 200: Out, ...errors } } }, async (req) => plain(await lan.decideOffline(req.params.id, req.body.decisions, me(req), req.id)));

  void OffsetPageSchema;
}
