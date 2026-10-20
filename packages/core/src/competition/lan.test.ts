import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testContainer, rid } from '../test/harness.js';
import { clause } from '../test/esp03-fixture.js';
import { competition, drawAndGenerate, toLive, win } from '../test/esp04-fixture.js';
import { seedIds } from '../db/seed-ids.js';
import { LanService } from './lan.js';
import { MatchResultService } from './results.js';
import { CommerceService } from '../finance/commerce.js';
import { PaymentsService } from '../finance/payments.js';
import type { DevGatewayAdapter } from '../adapters/devGateway.js';

let t: Awaited<ReturnType<typeof testContainer>>;
let lan: LanService;
beforeAll(async () => {
  t = await testContainer({ seed: true });
  lan = new LanService(t);
});
afterAll(async () => {
  await t.drop();
});

async function setup() {
  const fx = await competition(t, { clauses: [clause('elim.third_place', false)], stages: [{ name: 'فینال حضوری', format: 'single_elim', presence: 'offline' }], n: 4 });
  await drawAndGenerate(t, fx.stageIds[0]!, { method: 'manual', attributes: Object.fromEntries(fx.participants.map((id, i) => [id, { seed: i + 1 }])) });
  const venue = await lan.createVenue(fx.eventId, { name: 'سالن آزادی (TEST ONLY)', addressText: 'تهران، خیابان آزمون، پلاک ۱', directions: 'ورودی شمالی', parking: 'پارکینگ طبقه منفی یک', attendanceGuide: 'کارت شناسایی همراه داشته باشید', mapUrl: null, areas: [{ key: 'hall', name: 'سالن اصلی', kind: 'hall', capacity: 50 }, { key: 'media', name: 'رسانه', kind: 'media', capacity: 10 }, { key: 'aud', name: 'تماشاگران', kind: 'audience', capacity: 1 }] }, seedIds.organizer, rid());
  return { fx, venue };
}

describe('venue, stations and equipment (LAN-001/003/005)', () => {
  it('a station is usable only after its checklist passes; assignment is atomic; a fault frees the match for a move', async () => {
    const { fx, venue } = await setup();
    await expect(lan.createVenue(fx.eventId, { ...venue, addressText: ' ' }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const s1 = await lan.addStation(venue._id, 'hall', 'A1', seedIds.organizer, rid());
    const s2 = await lan.addStation(venue._id, 'hall', 'A2', seedIds.organizer, rid());
    const [m1, m2] = await t.c.matches.find({ stageId: fx.stageIds[0]!, state: 'scheduled' }).toArray();
    await expect(lan.assign(m1!._id, s1._id, 'plan', seedIds.organizer, rid())).rejects.toMatchObject({ code: 'CONFLICT' }); // not ready yet
    expect((await lan.checklist(s1._id, [{ item: 'network', ok: true }, { item: 'monitor 240Hz', ok: false }], seedIds.organizer, rid())).state).toBe('maintenance');
    await lan.checklist(s1._id, [{ item: 'network', ok: true }, { item: 'monitor 240Hz', ok: true }], seedIds.organizer, rid());
    await lan.checklist(s2._id, [{ item: 'network', ok: true }], seedIds.organizer, rid());
    const race = await Promise.allSettled([lan.assign(m1!._id, s1._id, 'plan', seedIds.organizer, rid()), lan.assign(m2!._id, s1._id, 'plan', seedIds.organizer, rid())]);
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const holder = (await t.c.stations.findOne({ _id: s1._id }))!.matchId!;
    const f = await lan.fault(s1._id, 'keyboard dead', seedIds.organizer, rid());
    expect(f.affectedMatchId).toBe(holder);
    await lan.assign(holder, s2._id, 'station A1 faulty', seedIds.organizer, rid());
    expect((await t.c.matches.findOne({ _id: holder }))!.resources!.stationId).toBe(s2._id);
    expect((await t.c.matches.findOne({ _id: holder }))!.schedule!.history.at(-1)!.reason).toMatch(/A2: station A1 faulty/);
    // equipment loans are atomic and returned with condition
    const eq = await lan.addEquipment(fx.eventId, 'Headset 07', 'headset', 'SN-7', seedIds.organizer, rid());
    const loans = await Promise.allSettled([lan.loan(eq._id, fx.principals[0]!, 'new', seedIds.organizer, rid()), lan.loan(eq._id, fx.principals[1]!, 'new', seedIds.organizer, rid())]);
    expect(loans.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await lan.returnEquipment(eq._id, 'cable damaged', true, seedIds.organizer, rid())).state).toBe('faulty');
    const pe = await lan.requestPersonal(fx.eventId, 'my own mouse', fx.principals[0]!);
    await expect(lan.decidePersonal(pe._id, true, 'ok', fx.principals[0]!, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await lan.decidePersonal(pe._id, true, 'inspected', seedIds.organizer, rid())).state).toBe('approved');
  });
});

describe('access and admission (LAN-002/004/006)', () => {
  it('rotating QR admits once, concurrent scans of one code admit once, areas follow the role', async () => {
    const { fx } = await setup();
    const player = fx.principals[0]!;
    await lan.issueCredential(fx.eventId, player, 'player', null, seedIds.organizer, rid());
    await expect(lan.issueCredential(fx.eventId, player, 'player', null, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'CONFLICT' });
    const [qr1] = await lan.myQr(fx.eventId, player);
    const [qr2] = await lan.myQr(fx.eventId, player);
    // the older code expired when a newer one was displayed
    await expect(lan.admit(fx.eventId, qr1!.qr, 'G1', 'hall', seedIds.organizer, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(lan.admit(fx.eventId, qr2!.qr, 'G1', 'hall', fx.principals[1]!, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' }); // not gate staff
    const scans = await Promise.allSettled([lan.admit(fx.eventId, qr2!.qr, 'G1', 'hall', seedIds.organizer, rid()), lan.admit(fx.eventId, qr2!.qr, 'G2', 'hall', seedIds.organizer, rid())]);
    expect(scans.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(lan.admit(fx.eventId, qr2!.qr, 'G1', 'hall', seedIds.organizer, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' }); // replay
    const [qr3] = await lan.myQr(fx.eventId, player);
    await expect(lan.admit(fx.eventId, qr3!.qr, 'G3', 'media', seedIds.organizer, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' }); // player ≠ media area
    expect(await t.c.admissions.countDocuments({ eventId: fx.eventId, kind: 'credential' })).toBe(1);
  });

  it('a paid spectator ticket admits once and the audience area capacity is enforced', async () => {
    const { fx } = await setup();
    const commerce = new CommerceService(t);
    const pay = new PaymentsService(t);
    const gw = t.adapters.payment as unknown as DevGatewayAdapter;
    await commerce.configureTickets(fx.eventId, 10, 100_000, seedIds.organizer, rid());
    const fan = fx.principals[3]!;
    const order = await commerce.buyTickets(fx.eventId, 2, fan, rid());
    const { payment } = await pay.pay(order.orderId, fan, 'http://localhost/r', rid());
    await pay.handleCallback((await gw.settle(payment.gatewayRef!, 'success'))!, rid());
    await t.consumer.drain();
    const [a, b] = await t.c.tickets.find({ orderId: order.orderId }).toArray();
    await lan.admitTicket(fx.eventId, a!.code, 'G1', 'aud', seedIds.organizer, rid());
    await expect(lan.admitTicket(fx.eventId, a!.code, 'G1', 'aud', seedIds.organizer, rid())).rejects.toBeTruthy();
    await expect(lan.admitTicket(fx.eventId, b!.code, 'G1', 'aud', seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' }); // capacity 1
  });
});

describe('call-up, hall display and emergency import (LAN-002/005/007)', () => {
  it('hall display is public-safe; offline rows never overwrite official data without a human decision', async () => {
    const { fx } = await setup();
    const results = new MatchResultService(t);
    const [m1, m2] = await t.c.matches.find({ stageId: fx.stageIds[0]!, state: 'scheduled' }).toArray();
    await t.c.matches.updateOne({ _id: m1!._id }, { $set: { lobby: { host: 'secret-host', password: 'secret-pass', releasedAt: null } } });
    await lan.callUp(m1!._id, seedIds.organizer, rid());
    const hall = await lan.hallDisplay(fx.eventId);
    expect(hall.called.map((x) => x.id)).toContain(m1!._id);
    expect(JSON.stringify(hall)).not.toContain('secret-pass');
    expect(JSON.stringify(hall)).not.toContain(m1!.principalIds![0]!);
    // m1 is final with side 0; m2 is provisional; the paper sheet disagrees on m1
    const l1 = await toLive(t, m1!);
    await results.submit(l1._id, win(0), [], seedIds.referee, rid());
    await results.finalize(l1._id, null, seedIds.referee, rid());
    const l2 = await toLive(t, m2!);
    await results.submit(l2._id, win(1), [], seedIds.referee, rid());
    const csv = Buffer.from(`matchId,winnerSide,scoreA,scoreB\n${m1!._id},1,0,2\n${m2!._id},1,0,2\nmch_unknown,0,1,0\n`);
    await expect(lan.importOffline(fx.eventId, 'paper-1', 'result', csv, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const imp = await lan.importOffline(fx.eventId, 'EP-03', 'result', csv, seedIds.organizer, rid());
    expect(imp.rows.map((r) => r.status)).toEqual(['conflict', 'pending', 'rejected']);
    expect(await t.c.reviewItems.countDocuments({ eventId: fx.eventId, kind: 'offline_conflict' })).toBe(1);
    // applying the conflicting row is impossible; the pending row becomes official through the result service
    await expect(lan.decideOffline(imp._id, [{ row: 3, apply: true }], seedIds.organizer, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' }); // organizers cannot make results official
    const after = await lan.decideOffline(imp._id, [{ row: 2, apply: true }, { row: 3, apply: true }], seedIds.referee, rid());
    expect(after.rows.map((r) => r.status)).toEqual(['conflict', 'applied', 'rejected']);
    expect((await t.c.matches.findOne({ _id: m1!._id }))!.outcome).toMatchObject({ winnerSide: 0 }); // official data untouched
    expect((await t.c.matches.findOne({ _id: m2!._id }))!.state).toBe('final');
    const rejected = await lan.decideOffline(imp._id, [{ row: 2, apply: false }], seedIds.referee, rid());
    expect(rejected.state).toBe('applied');
  });
});
