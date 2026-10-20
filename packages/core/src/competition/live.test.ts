import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchMachine } from '@esp/contracts';
import { testContainer, rid } from '../test/harness.js';
import { clause } from '../test/esp03-fixture.js';
import { competition, drawAndGenerate } from '../test/esp04-fixture.js';
import { seedIds } from '../db/seed-ids.js';
import { applyTransition } from '../domain/transition.js';
import { RoomService, publicMatch } from './room.js';
import { SelectionService } from './selection.js';
import { RunService } from './run.js';
import { ServerService } from './servers.js';
import { MatchResultService } from './results.js';
import { ScheduleService } from './schedule.js';
import { StructureService } from './structure.js';
import type { MatchDoc } from '../db/collections.js';

let t: Awaited<ReturnType<typeof testContainer>>;
let room: RoomService;
let sel: SelectionService;
let run: RunService;
let servers: ServerService;
beforeAll(async () => {
  t = await testContainer({ seed: true });
  room = new RoomService(t);
  sel = new SelectionService(t);
  run = new RunService(t);
  servers = new ServerService(t);
});
afterAll(async () => {
  await t.drop();
});

const LIVE_RULES = (timeout: string) => [
  clause('elim.third_place', false), clause('match.bo', 3), clause('maps.pool', ['m1', 'm2', 'm3', 'm4', 'm5']), clause('veto.sequence', ['ban:0', 'ban:1', 'pick:0', 'pick:1', 'decider']),
  clause('veto.turn_seconds', 30), clause('veto.timeout_action', timeout), clause('pause.tactical_per_side', 1), clause('pause.tactical_seconds', 60), clause('pause.technical_per_side', 2),
  clause('pause.technical_seconds', 300), clause('disconnect.return_seconds', 120), clause('disconnect.on_expiry', 'forfeit_match'), clause('match.replay', 'TEST ONLY: restore the round from the last checkpoint'), clause('match.countdown_seconds', 60),
];

async function readyMatch(timeout = 'pool_order_first'): Promise<{ m: MatchDoc; fx: Awaited<ReturnType<typeof competition>> }> {
  const fx = await competition(t, { clauses: LIVE_RULES(timeout), stages: [{ name: 'SE', format: 'single_elim' }], n: 4 });
  await drawAndGenerate(t, fx.stageIds[0]!, { method: 'manual', attributes: Object.fromEntries(fx.participants.map((id, i) => [id, { seed: i + 1 }])) });
  const m = (await t.c.matches.findOne({ stageId: fx.stageIds[0]!, state: 'scheduled' }))!;
  return { m, fx };
}
const p = (m: MatchDoc, side: number) => m.sides[side]!.roster[0]!.principalId;

describe('room, readiness and lobby (ROOM-001..004)', () => {
  it('both sides ready → ready with the rules countdown; lobby only for sides/officials in the allowed states; public view is safe', async () => {
    const { m, fx } = await readyMatch();
    expect(m.config!.bestOf).toBe(3);
    expect(m.config!.undecided).toEqual([]);
    await expect(room.ready(m._id, p(m, 0), rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(room.openReadiness(m._id, p(m, 0), rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await room.openReadiness(m._id, seedIds.organizer, rid());
    const outsider = fx.principals.find((x) => !m.principalIds!.includes(x))!;
    await expect(room.ready(m._id, outsider, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await room.ready(m._id, p(m, 0), rid());
    await expect(room.ready(m._id, p(m, 0), rid())).rejects.toMatchObject({ code: 'CONFLICT' });
    // lobby is not released before both sides are ready
    await room.setManualLobby(m._id, 'lobby.test.local', 'pass-1234', seedIds.organizer, rid());
    await expect(room.lobby(m._id, p(m, 1), rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const r = await room.ready(m._id, p(m, 1), rid());
    expect(r.state).toBe('ready');
    expect(Date.parse(r.room!.countdownTo!)).toBeGreaterThan(Date.now());
    expect((await room.lobby(m._id, p(m, 1), rid())).password).toBe('pass-1234');
    await expect(room.lobby(m._id, outsider, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await t.c.audit.countDocuments({ action: 'match.lobby.read', 'target.id': m._id })).toBe(1);
    // public view never carries lobby, principals or private data
    const pub = JSON.stringify(publicMatch((await t.c.matches.findOne({ _id: m._id }))!));
    expect(pub).not.toContain('pass-1234');
    expect(pub).not.toContain(p(m, 0));
    const anon = await room.view(m._id, null);
    expect(anon.private).toBeNull();
    expect((await room.view(m._id, p(m, 0))).private!.lobbyAvailable).toBe(true);
    // chat and referee call
    await room.chat(m._id, 'سلام، آماده‌ایم', 'private', p(m, 0));
    await expect(room.chat(m._id, 'x', 'private', outsider)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await room.messages(m._id, p(m, 1))).map((x) => x.text)).toEqual(['سلام، آماده‌ایم']);
    const call = await room.callReferee(m._id, 'لابی باز نمی‌شود', p(m, 1));
    expect((await room.openCalls(m.eventId, seedIds.referee, rid())).map((c) => c._id)).toContain(call._id);
    await room.updateCall(call._id, 'closed', seedIds.referee, rid());
  });
});

async function toReady(m: MatchDoc) {
  await room.openReadiness(m._id, seedIds.organizer, rid());
  await room.ready(m._id, p(m, 0), rid());
  return room.ready(m._id, p(m, 1), rid());
}

describe('pre-game selection (CFG-003/004)', () => {
  it('turns are enforced, concurrent answers to one step have one effect, timeouts follow the rule, the decider is automatic', async () => {
    const { m } = await readyMatch('pool_order_first');
    await toReady(m);
    await expect(sel.start(m._id, p(m, 0), rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const s0 = await sel.start(m._id, seedIds.organizer, rid());
    expect(s0.step).toBe(0);
    await expect(sel.act(m._id, 0, 'm1', p(m, 1), rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const both = await Promise.allSettled([sel.act(m._id, 0, 'm1', p(m, 0), rid()), sel.act(m._id, 0, 'm2', p(m, 0), rid())]);
    expect(both.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await t.c.selections.findOne({ _id: m._id }))!.actions).toHaveLength(1);
    // side 1 lets the timer run out: the rule picks the first remaining map in the published pool order
    await t.c.selections.updateOne({ _id: m._id }, { $set: { turnDeadline: new Date(Date.now() - 1000).toISOString() } });
    const v = (await sel.view(m._id))!;
    const banned = v.actions.find((a) => a.step === 1)!;
    expect(banned.via).toBe('timeout');
    expect(banned.value).toBe(['m1', 'm2', 'm3', 'm4', 'm5'].find((x) => x !== v.actions[0]!.value));
    const opts = (await sel.view(m._id))!.options;
    await sel.act(m._id, 2, opts[0]!, p(m, 0), rid());
    const last = await sel.act(m._id, 3, (await sel.view(m._id))!.options[0]!, p(m, 1), rid());
    expect(last.state).toBe('complete');
    expect(last.actions.at(-1)).toMatchObject({ kind: 'decider', via: 'timeout' });
    expect(new Set(last.actions.map((a) => a.value)).size).toBe(5);
    await expect(sel.act(m._id, 5, 'm1', p(m, 0), rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const started = await run.start(m._id, seedIds.organizer, rid());
    expect(started.state).toBe('live');
  });

  it('a "referee" timeout rule hands the turn to the referee instead of choosing', async () => {
    const { m } = await readyMatch('referee');
    await toReady(m);
    await sel.start(m._id, seedIds.organizer, rid());
    await t.c.selections.updateOne({ _id: m._id }, { $set: { turnDeadline: new Date(Date.now() - 1000).toISOString() } });
    expect(await sel.sweep()).toBe(1);
    expect((await t.c.selections.findOne({ _id: m._id }))!.state).toBe('waiting_referee');
    expect(await t.c.refereeCalls.countDocuments({ matchId: m._id, by: 'system' })).toBe(1);
    await expect(sel.act(m._id, 0, 'm3', p(m, 0), rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const r = await sel.act(m._id, 0, 'm3', seedIds.referee, rid());
    expect(r.actions[0]).toMatchObject({ value: 'm3', via: 'referee' });
    await expect(run.start(m._id, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' }); // selection incomplete
  });
});

describe('live run (RUN-001..006, AC-08)', () => {
  it('pause allowance, disconnect with the rules deadline, and the referee forfeit decision advance the bracket', async () => {
    const fx = await competition(t, { clauses: LIVE_RULES('pool_order_first').filter((c) => c.key !== 'veto.sequence'), stages: [{ name: 'SE', format: 'single_elim' }], n: 4 });
    await drawAndGenerate(t, fx.stageIds[0]!, { method: 'manual', attributes: Object.fromEntries(fx.participants.map((id, i) => [id, { seed: i + 1 }])) });
    const m = (await t.c.matches.findOne({ stageId: fx.stageIds[0]!, state: 'scheduled' }))!;
    await toReady(m);
    await expect(run.start(m._id, p(m, 0), rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await run.start(m._id, seedIds.organizer, rid());
    await run.pause(m._id, 'tactical', null, 'strategy', p(m, 0), rid());
    await run.resume(m._id, seedIds.organizer, rid());
    await expect(run.pause(m._id, 'tactical', null, 'again', p(m, 0), rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' }); // 1 per side
    await expect(run.pause(m._id, 'tactical', 1, 'not mine', p(m, 0), rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const d = await run.disconnect(m._id, 1, p(m, 1), rid());
    expect(d.state).toBe('paused');
    const st = await run.disconnectStatus(m._id);
    expect(st).toMatchObject({ open: true, side: 1, expired: false, onExpiry: 'forfeit_match' });
    expect(Date.parse(st.deadline!) - Date.now()).toBeGreaterThan(100_000);
    await expect(run.resume(m._id, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    // the deadline passes on the server clock (a refresh would not move it)
    await t.c.matches.updateOne({ _id: m._id }, { $set: { 'run.disconnect.deadline': new Date(Date.now() - 1000).toISOString() } });
    expect((await run.disconnectStatus(m._id)).expired).toBe(true);
    await expect(run.decide(m._id, 'forfeit_match', 'did not return in time', p(m, 0), rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const fin = await run.decide(m._id, 'forfeit_match', 'side 2 did not return within 120 s (rules)', seedIds.referee, rid());
    expect(fin.state).toBe('final');
    expect(fin.outcome).toMatchObject({ kind: 'win', winnerSide: 0, forfeit: true });
    await t.consumer.drain();
    // the winner is already placed in the final slot (sides are assigned once both semis are final)
    const view = await new StructureService(t).view(fx.stageIds[0]!, { round: 2, offset: 0, limit: 5 });
    expect(view.slots[0]!.participants.map((x) => x.id)).toContain(m.participantIds![0]);
    const types = (await run.timeline(m._id, seedIds.referee)).map((e) => (e as { type: string }).type);
    expect(types).toEqual(expect.arrayContaining(['ready', 'start', 'pause', 'resume', 'disconnect', 'decision']));
    // spectators get safe texts only
    const pub = await run.timeline(m._id, null);
    expect(JSON.stringify(pub)).not.toContain('did not return');
  });

  it('a forced game update pauses live matches, posts a public notice and only proposes a new schedule', async () => {
    const fx = await competition(t, { clauses: [clause('elim.third_place', false)], stages: [{ name: 'SE', format: 'single_elim' }], n: 8 });
    await drawAndGenerate(t, fx.stageIds[0]!);
    const ms = await t.c.matches.find({ stageId: fx.stageIds[0]!, state: 'scheduled' }).toArray();
    for (const m of ms.slice(0, 2)) for (const tr of ['open_checkin', 'mark_ready', 'start']) { const cur = (await t.c.matches.findOne({ _id: m._id }))!; await applyTransition(matchMachine, t.c.matches, m._id, { transition: tr, expectedVersion: cur.version, actorRoles: ['system'] }); }
    const sch = new ScheduleService(t);
    await sch.setConfig(fx.eventId, { windows: [], defaultDurationMinutes: 45, bufferMinutes: 5, minRestMinutes: 10, broadcastWindows: [], unavailable: [] }, seedIds.organizer, rid());
    for (const [i, m] of ms.slice(2).entries()) await sch.setTime(m._id, { at: new Date(Date.parse('2027-04-01T10:00:00Z') + i * 3_600_000).toISOString(), confirmed: true, reason: 'plan' }, seedIds.organizer, rid());
    const inc = await run.openIncident(fx.eventId, { kind: 'game_update', disciplineIds: null, publicNotice: 'به‌روزرسانی اجباری بازی؛ مسابقه‌ها متوقف شدند', internalNote: 'patch 1.2', delayMinutes: 60, newGameVersion: 'test-2' }, seedIds.organizer, rid());
    expect(inc.pausedMatchIds).toHaveLength(2);
    expect((await t.c.matches.findOne({ _id: ms[0]!._id }))!.state).toBe('paused');
    const pr = (await t.c.scheduleProposals.findOne({ _id: inc.proposalId! }))!;
    expect(pr).toMatchObject({ kind: 'disruption', state: 'draft' });
    expect(await t.c.reviewItems.countDocuments({ eventId: fx.eventId, kind: 'rule_missing' })).toBeGreaterThan(0);
    await expect(run.resolveIncident(inc._id, true, 'ok', seedIds.organizer, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await run.resolveIncident(inc._id, true, 'version test-2 checked against the rules package: compatible', seedIds.organizer, rid());
    expect((await t.c.matches.findOne({ _id: ms[0]!._id }))!.state).toBe('live');
  });
});

describe('servers and integrations (SRV-001..004, AC-18)', () => {
  it('atomic allocation within capacity, release and switch; integration refused without a real adapter while manual results work', async () => {
    const { m, fx } = await readyMatch();
    const other = (await t.c.matches.find({ stageId: fx.stageIds[0]!, state: 'scheduled' }).toArray()).find((x) => x._id !== m._id)!;
    const base = { eventId: fx.eventId, gameId: 'game_seed_synthetic', name: 'srv-a', region: 'tehran', kind: 'dedicated' as const, connection: { host: '10.0.0.5', port: 27015 }, capacity: 1, enabled: true, configTemplate: { tickrate: 128 } };
    const a = await servers.create(base, seedIds.organizer, rid());
    await expect(servers.allocate(m._id, null, 'auto', seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' }); // health unknown: not auto-picked
    await servers.setHealth(a._id, 'healthy', true, seedIds.organizer, rid());
    const race = await Promise.allSettled([servers.allocate(m._id, null, 'auto', seedIds.organizer, rid()), servers.allocate(other._id, null, 'auto', seedIds.organizer, rid())]);
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await t.c.gameServers.findOne({ _id: a._id }))!.inUse).toBe(1);
    const winner = (await t.c.serverAllocations.findOne({ serverId: a._id, state: 'active' }))!;
    const b = await servers.create({ ...base, name: 'srv-b' }, seedIds.organizer, rid());
    await servers.setHealth(b._id, 'healthy', true, seedIds.organizer, rid());
    await expect(servers.switch(winner.matchId, b._id, 'no', seedIds.organizer, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await servers.switch(winner.matchId, b._id, 'server a lagging', seedIds.organizer, rid());
    expect((await t.c.gameServers.findOne({ _id: a._id }))!.inUse).toBe(0);
    expect((await t.c.gameServers.findOne({ _id: b._id }))!.inUse).toBe(1);
    expect(await servers.template(winner.matchId, seedIds.organizer, rid())).toMatchObject({ tickrate: 128, bestOf: 3 });
    expect(await servers.release(winner.matchId, 'done', seedIds.organizer, rid())).toBe(true);
    expect(await servers.release(winner.matchId, 'done', seedIds.organizer, rid())).toBe(false); // released once
    // no publisher adapter: ingestion refused, status explains the manual path
    expect((await servers.integrationStatus('game_seed_synthetic')).enabled).toBe(false);
    await expect(servers.ingest(m._id, 'result', { outcome: { kind: 'win', winnerSide: 0 } }, null, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    // the manual authorized path still finalises the match
    await toReady(m);
    await run.start(m._id, seedIds.organizer, rid()).catch(async () => undefined);
    const res = new MatchResultService(t);
    const cur = (await t.c.matches.findOne({ _id: m._id }))!;
    if (cur.state !== 'live') await applyTransition(matchMachine, t.c.matches, m._id, { transition: 'start', expectedVersion: cur.version, actorRoles: ['system'] });
    await res.submit(m._id, { kind: 'win', winnerSide: 0, scores: null, maps: [2, 1], forfeit: false, reason: null }, [], seedIds.referee, rid());
    expect((await res.finalize(m._id, null, seedIds.referee, rid())).state).toBe('final');
  });

  it('with a real-capability adapter, raw data keeps provenance, is deduplicated, and a disagreement opens a review item', async () => {
    const { m } = await readyMatch();
    const original = t.adapters.publisher;
    (t.adapters as { publisher: typeof original }).publisher = { ...original, name: 'test-publisher', capabilities: ['results'], availability: async () => ({ status: 'available' as const, detail: 'TEST ONLY stub' }), health: original.health.bind(original) };
    try {
      await t.c.matches.updateOne({ _id: m._id }, { $set: { state: 'final', outcome: { kind: 'win', winnerSide: 0, scores: null, maps: [2, 0], forfeit: false, reason: null } } });
      const r1 = await servers.ingest(m._id, 'result', { outcome: { kind: 'win', winnerSide: 1, scores: null, maps: [0, 2], forfeit: false, reason: null } }, null, seedIds.organizer, rid());
      expect(r1).toMatchObject({ source: 'test-publisher', comparedWithManual: 'mismatch' });
      const again = await servers.ingest(m._id, 'result', { outcome: { kind: 'win', winnerSide: 1, scores: null, maps: [0, 2], forfeit: false, reason: null } }, null, seedIds.organizer, rid());
      expect(again._id).toBe(r1._id);
      expect(await t.c.reviewItems.countDocuments({ kind: 'integration_mismatch', 'ref.id': m._id })).toBe(1);
      expect((await t.c.matches.findOne({ _id: m._id }))!.outcome).toMatchObject({ winnerSide: 0 }); // never applied automatically
    } finally {
      (t.adapters as { publisher: typeof original }).publisher = original;
    }
  });
});
