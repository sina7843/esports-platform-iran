import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testContainer, rid } from '../test/harness.js';
import { clause } from '../test/esp03-fixture.js';
import { competition, drawAndGenerate, TABLE_RULES } from '../test/esp04-fixture.js';
import { seedIds } from '../db/seed-ids.js';
import { ScheduleService } from './schedule.js';

let t: Awaited<ReturnType<typeof testContainer>>;
let sch: ScheduleService;
beforeAll(async () => {
  t = await testContainer({ seed: true });
  sch = new ScheduleService(t);
});
afterAll(async () => {
  await t.drop();
});

const base = Date.parse('2027-03-01T08:30:00.000Z'); // 12:00 Tehran
const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString();
const cfg = { windows: [{ from: at(0), to: at(600) }], defaultDurationMinutes: 60, bufferMinutes: 10, minRestMinutes: 15, broadcastWindows: [], unavailable: [] };

async function bracket(n = 4) {
  const fx = await competition(t, { clauses: [clause('elim.third_place', false)], stages: [{ name: 'SE', format: 'single_elim' }], n });
  await drawAndGenerate(t, fx.stageIds[0]!, { method: 'manual', attributes: Object.fromEntries(fx.participants.map((id, i) => [id, { seed: i + 1 }])) });
  await sch.setConfig(fx.eventId, cfg, seedIds.organizer, rid());
  const ms = await t.c.matches.find({ stageId: fx.stageIds[0]! }).sort({ 'slot.round': 1, 'slot.order': 1 }).toArray();
  return { fx, ms };
}

describe('manual scheduling and conflicts (SCH-001/002/005)', () => {
  it('hard conflicts are refused, an override needs permission and a reason; estimated vs confirmed is kept', async () => {
    const { fx, ms } = await bracket();
    const [a, b, final] = ms as [typeof ms[0], typeof ms[0], typeof ms[0]];
    await expect(sch.setTime(a._id, { at: at(0), confirmed: true, reason: 'plan' }, fx.principals[0]!, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await sch.setTime(a._id, { at: at(0), confirmed: true, reason: 'plan' }, seedIds.organizer, rid())).match.estimated).toBe(false);
    await sch.setTime(b._id, { at: at(0), confirmed: true, reason: 'plan' }, seedIds.organizer, rid()); // different participants: fine
    // the final depends on both semis: starting at +30 min is a hard dependency conflict
    await expect(sch.setTime(final._id, { at: at(30), confirmed: true, reason: 'plan' }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(sch.setTime(final._id, { at: at(30), confirmed: true, reason: 'x', override: true }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const ok = await sch.setTime(final._id, { at: at(85), confirmed: true, reason: 'plan' }, seedIds.organizer, rid());
    expect(ok.match.estimated).toBe(true); // sides unknown → still an estimate
    expect(ok.conflicts.some((c) => c.kind === 'dependency')).toBe(false);
    // outside the window
    await expect(sch.setTime(final._id, { at: at(700), confirmed: false, reason: 'late' }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'CONFLICT' });
    // override with reason (organizer holds schedule.override) is recorded in the history
    const forced = await sch.setTime(final._id, { at: at(30), confirmed: false, reason: 'broadcast slot agreed with both teams', override: true }, seedIds.organizer, rid());
    expect(forced.match.schedule!.history.at(-1)!.reason).toMatch(/^OVERRIDE/);
  });

  it('the same player in another event, a shared station and a shared referee are hard conflicts', async () => {
    const one = await bracket();
    const two = await bracket();
    const [a] = one.ms;
    const [x, y] = two.ms;
    await sch.setTime(a!._id, { at: at(0), confirmed: true, reason: 'plan', refereeIds: [seedIds.referee] }, seedIds.organizer, rid());
    // a player of event one also plays in event two (multi-discipline player)
    await t.c.matches.updateOne({ _id: x!._id }, { $push: { principalIds: a!.principalIds![0]! } });
    const cx = sch.setTime(x!._id, { at: at(20), confirmed: true, reason: 'plan' }, seedIds.organizer, rid());
    await expect(cx).rejects.toMatchObject({ code: 'CONFLICT', details: { conflicts: [expect.objectContaining({ kind: 'player', hard: true })] } });
    await sch.setTime(y!._id, { at: at(0), confirmed: true, reason: 'plan', stationId: 'stn_1' }, seedIds.organizer, rid());
    const [, b2] = one.ms;
    await expect(sch.setTime(b2!._id, { at: at(0), confirmed: true, reason: 'plan', refereeIds: [seedIds.referee] }, seedIds.organizer, rid())).rejects.toMatchObject({ details: { conflicts: [expect.objectContaining({ kind: 'referee' })] } });
  });
});

describe('automatic scheduling, delays and bulk changes (SCH-001/004/006, AC-07)', () => {
  it('auto proposal is conflict-free and respects dependencies; a delay proposes a cascade that waits for approval', async () => {
    const { fx, ms } = await bracket(8);
    const pr = await sch.autoPropose(fx.eventId, { from: at(0), reason: 'initial plan' }, seedIds.organizer, rid());
    expect(pr.state).toBe('draft');
    expect(pr.changes).toHaveLength(ms.length);
    expect(pr.conflicts.filter((c) => c.hard)).toEqual([]);
    expect((await t.c.matches.findOne({ _id: ms[0]!._id }))!.scheduledAt).toBeNull(); // nothing applied yet
    await sch.applyProposal(pr._id, { confirm: true }, seedIds.organizer, rid());
    const placed = await t.c.matches.find({ stageId: fx.stageIds[0]! }).toArray();
    const end = (m: (typeof placed)[0]) => Date.parse(m.scheduledAt!) + 70 * 60_000;
    for (const m of placed) for (const s of m.slot!.sources) if (s.kind === 'winner') expect(Date.parse(m.scheduledAt!)).toBeGreaterThanOrEqual(end(placed.find((x) => x.slot!.key === s.slot)!) + 15 * 60_000);
    // delay of a quarter-final pushes its semi-final and the final, as a draft
    const qf = placed.find((m) => m.slot!.key === 'W1-1')!;
    const delay = await sch.proposeDelay(qf._id, 90, 'game client crashed', seedIds.organizer, rid());
    const moved = delay.changes.map((c) => c.matchId);
    expect(moved).toContain(placed.find((m) => m.slot!.key === 'W2-1')!._id);
    expect(moved).toContain(placed.find((m) => m.slot!.key === 'W3-1')!._id);
    expect(moved).not.toContain(placed.find((m) => m.slot!.key === 'W1-4')!._id);
    expect((await t.c.matches.findOne({ _id: qf._id }))!.scheduledAt).toBe(qf.scheduledAt); // not published on its own
    // a change made meanwhile supersedes the stale proposal (all-or-nothing)
    await sch.setTime(qf._id, { at: qf.scheduledAt!, confirmed: true, reason: 'touch' }, seedIds.organizer, rid());
    await expect(sch.applyProposal(delay._id, { confirm: true }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect((await t.c.scheduleProposals.findOne({ _id: delay._id }))!.state).toBe('superseded');
    const fresh = await sch.proposeDelay(qf._id, 90, 'game client crashed', seedIds.organizer, rid());
    await sch.applyProposal(fresh._id, { confirm: true }, seedIds.organizer, rid());
    expect(Date.parse((await t.c.matches.findOne({ _id: qf._id }))!.scheduledAt!)).toBe(Date.parse(qf.scheduledAt!) + 90 * 60_000);
    // bulk shift preview of a whole round
    const r1 = placed.filter((m) => m.slot!.round === 1).map((m) => m._id);
    const bulk = await sch.bulkShift(fx.eventId, { matchIds: r1, minutes: -600, reason: 'earlier start' }, seedIds.organizer, rid());
    expect(bulk.conflicts.some((c) => c.kind === 'window' && c.hard)).toBe(true);
    await expect(sch.applyProposal(bulk._id, { confirm: true }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('reschedule: a side asks, the opponent agrees, an official approves; the calendar shows tentative vs confirmed', async () => {
    const { fx, ms } = await bracket();
    const m = ms[0]!;
    await sch.setTime(m._id, { at: at(0), confirmed: true, reason: 'plan' }, seedIds.organizer, rid());
    const p0 = m.sides[0]!.roster[0]!.principalId;
    const p1 = m.sides[1]!.roster[0]!.principalId;
    const outsider = fx.principals.find((p) => !m.principalIds!.includes(p))!;
    await expect(sch.request(m._id, at(120), 'travel delay', outsider)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const req = await sch.request(m._id, at(120), 'exam in the morning', p0);
    await expect(sch.request(m._id, at(180), 'another reason', p1)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(sch.agree(req._id, p0)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(sch.decide(req._id, true, 'ok', seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await sch.agree(req._id, p1);
    await sch.decide(req._id, true, 'approved', seedIds.organizer, rid());
    expect((await t.c.matches.findOne({ _id: m._id }))!.scheduledAt).toBe(at(120));
    const cal = await sch.calendar(p0);
    expect(cal.find((c) => c.matchId === m._id)).toMatchObject({ scheduledAt: at(120), estimated: false });
    expect(await sch.ics(p0)).toContain('STATUS:CONFIRMED');
  });

  it('round robin: one participant in two overlapping matches is refused', async () => {
    const fx = await competition(t, { clauses: TABLE_RULES(), stages: [{ name: 'RR', format: 'round_robin' }], n: 3 });
    await drawAndGenerate(t, fx.stageIds[0]!);
    await sch.setConfig(fx.eventId, cfg, seedIds.organizer, rid());
    const [a, b] = await t.c.matches.find({ stageId: fx.stageIds[0]! }).toArray();
    await sch.setTime(a!._id, { at: at(0), confirmed: true, reason: 'plan' }, seedIds.organizer, rid());
    await expect(sch.setTime(b!._id, { at: at(30), confirmed: true, reason: 'plan' }, seedIds.organizer, rid())).rejects.toMatchObject({ details: { conflicts: [expect.objectContaining({ kind: 'participant' })] } });
  });
});
