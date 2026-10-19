import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testContainer, rid } from '../test/harness.js';
import { clause, openEvent, preparePublishable } from '../test/esp03-fixture.js';
import { seedIds } from '../db/seed-ids.js';
import { newId } from '../ids.js';
import { EventsService } from './events.js';

let t: Awaited<ReturnType<typeof testContainer>>;
let ev: EventsService;
let pkg: string;
beforeAll(async () => {
  t = await testContainer({ seed: true });
  ev = new EventsService(t);
  pkg = await preparePublishable(t, [clause('roster.min', 1)]);
});
afterAll(async () => {
  await t.drop();
});

/** A draft event with one discipline, ready to publish. */
async function draft(): Promise<{ eventId: string; disciplineId: string }> {
  const e = await ev.create({ organizerOrgId: seedIds.orgA, name: 'مراحل (TEST ONLY)', slug: `stg-${newId().toLowerCase()}`, visibility: 'public', timeZone: 'Asia/Tehran', startsAt: new Date(Date.now() + 3 * 3600_000).toISOString(), endsAt: null, description: null, posterFileId: null, presence: 'hybrid', regions: [], language: 'fa', contact: null, rated: false, prizes: [], refundPolicy: null, cancellationTerms: 'TEST ONLY', disputeTerms: 'TEST ONLY', isTemplate: false, seasonId: null }, seedIds.organizer, rid());
  const d = await ev.addDiscipline(e._id, {
    name: 'D', gameId: 'game_seed_synthetic', gameVersion: 'test', platform: 'pc', mode: '5v5', rulesPackageId: pkg, participantKind: 'player', capacity: 8, minParticipants: 0, feeRial: 0,
    registrationOpensAt: null, registrationClosesAt: new Date(Date.now() + 3600_000).toISOString(), lateRegistrationUntil: null, editDeadline: null, withdrawalDeadline: null, paymentWindowMinutes: 30,
    autoApprove: true, quotas: [], formFields: [], requiredDocuments: [], checkin: null, seasonChangeCap: null, presence: 'online', regions: [],
  }, seedIds.organizer, rid());
  return { eventId: e._id, disciplineId: d._id };
}

describe('stages (STG-001/003/004/006)', () => {
  it('a dependent stage waits for its source; an exception needs an independent approval and is recorded', async () => {
    const { eventId, disciplineId } = await draft();
    const a = await ev.addStage(disciplineId, { name: 'مقدماتی آنلاین', order: 1, format: 'swiss', presence: 'online', dependsOnStageIds: [], links: [] }, seedIds.organizer, rid());
    const b = await ev.addStage(disciplineId, { name: 'نهایی حضوری', order: 2, format: 'single_elim', presence: 'offline', dependsOnStageIds: [a._id], links: [{ fromStageId: a._id, kind: 'qualifier', slots: 4, points: 'factor', factor: 0.5 }] }, seedIds.organizer, rid());
    expect(b.links[0]).toMatchObject({ points: 'factor', factor: 0.5, slots: 4 });
    expect(await ev.canStartStage(b._id)).toEqual({ ok: false, waitingFor: [a._id], exception: false });

    const appr = await t.approvals.request({ action: 'stage.start_exception', scope: { type: 'event', id: eventId }, payload: {}, reason: 'source delayed by outage' }, { principalId: seedIds.organizer, requestId: rid() });
    await expect(ev.grantStageStartException(b._id, appr._id, 'impact reviewed', seedIds.organizer, rid())).rejects.toBeTruthy();
    await t.approvals.decide(appr._id, { decision: 'approve', reason: 'impact reviewed', expectedVersion: 0 }, { principalId: seedIds.admin, requestId: rid() });
    await expect(ev.grantStageStartException(b._id, appr._id, 'impact reviewed', seedIds.organizerB, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await ev.grantStageStartException(b._id, appr._id, 'impact reviewed', seedIds.organizer, rid());
    expect(await ev.canStartStage(b._id)).toEqual({ ok: true, waitingFor: [a._id], exception: true });
    expect(await t.c.audit.countDocuments({ action: 'event.stage.start_exception' })).toBeGreaterThanOrEqual(1);
  });
});

describe('qualification slots and seasons (STG-002/005)', () => {
  it('a stage slot needs a final result at its origin, records provenance and cannot be duplicated', async () => {
    const { disciplineId } = await draft();
    const src = { kind: 'stage' as const, ref: 'stg_source_x', rank: 1 };
    await expect(ev.createSlot(disciplineId, { targetStageId: null, source: src, holderKey: 'team:team_a', reason: 'winner' }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await t.c.resultVersions.insertOne({ _id: newId('rv'), targetType: 'standing', targetId: 'stg_source_x', version: 3, calcVersion: 'test', data: { final: true }, provenance: { source: 'test', actorPrincipalId: null, reason: null, evidenceFileIds: [] }, createdAt: new Date().toISOString() });
    const slot = await ev.createSlot(disciplineId, { targetStageId: null, source: src, holderKey: 'team:team_a', reason: 'winner', resultVersion: 3 }, seedIds.organizer, rid());
    expect(slot.provenance).toMatchObject({ createdBy: seedIds.organizer, resultVersion: 3, reason: 'winner' });
    await expect(ev.createSlot(disciplineId, { targetStageId: null, source: { kind: 'invite', ref: 'direct', rank: null }, holderKey: 'team:team_a', reason: 'again' }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(ev.createSlot(disciplineId, { targetStageId: null, source: { kind: 'invite', ref: 'direct', rank: null }, holderKey: 'team:team_b', reason: 'invite' }, seedIds.organizerB, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('seasons need catalog authority and a valid period', async () => {
    const base = { gameId: 'game_seed_synthetic', name: 'فصل ۱', from: '2026-11-01T00:00:00.000Z', to: '2027-02-01T00:00:00.000Z', pointsPolicy: 'TEST ONLY points policy', nextEventQuotas: [] };
    await expect(ev.createSeason(base, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(ev.createSeason({ ...base, to: base.from }, seedIds.admin, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await ev.createSeason(base, seedIds.admin, rid())).name).toBe('فصل ۱');
  });
});

describe('badges (EVT-008)', () => {
  it('rated, organizer verification and official affiliation are independent; affiliation needs evidence and an independent reviewer', async () => {
    const { eventId } = await draft();
    let e = (await t.c.events.findOne({ _id: eventId }))!;
    expect((await ev.badges(e)).affiliation).toBeNull();
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 9)]);
    const foreign = await t.files.upload({ data: png, originalName: 'x.png', declaredMime: 'image/png', visibility: 'private', scope: { type: 'site', id: 'site' }, retentionClass: 'dispute_evidence' }, { principalId: seedIds.admin, requestId: rid() });
    await expect(ev.claimAffiliation(eventId, { kind: 'publisher_licensed', body: 'TEST ONLY Publisher', evidenceFileId: foreign._id }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const own = await t.files.upload({ data: png, originalName: 'license.png', declaredMime: 'image/png', visibility: 'private', scope: { type: 'event', id: eventId }, retentionClass: 'dispute_evidence' }, { principalId: seedIds.organizer, requestId: rid() });
    await expect(ev.claimAffiliation(eventId, { kind: 'publisher_licensed', body: 'TEST ONLY Publisher', evidenceFileId: own._id }, seedIds.organizerB, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await ev.claimAffiliation(eventId, { kind: 'publisher_licensed', body: 'TEST ONLY Publisher', evidenceFileId: own._id }, seedIds.organizer, rid());
    e = (await t.c.events.findOne({ _id: eventId }))!;
    expect((await ev.badges(e)).affiliation).toBeNull(); // pending claims are never public
    expect((await ev.pendingAffiliations(seedIds.admin, rid())).map((x) => x._id)).toContain(eventId);
    await expect(ev.decideAffiliation(eventId, 'verify', 'looks fine', seedIds.organizer, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await ev.decideAffiliation(eventId, 'verify', 'license letter checked', seedIds.admin, rid());
    e = (await t.c.events.findOne({ _id: eventId }))!;
    const b = await ev.badges(e);
    expect(b.affiliation).toEqual({ kind: 'publisher_licensed', body: 'TEST ONLY Publisher' });
    expect(b.rated).toBe(false); // independent of affiliation
    await expect(ev.decideAffiliation(eventId, 'reject', 'second decision', seedIds.admin, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const copy = await ev.duplicate(eventId, { slug: `aff-${newId().toLowerCase()}`, name: 'copy', asTemplate: false }, seedIds.organizer, rid());
    expect(copy.config.affiliation).toBeNull(); // a copy must earn its own badge
  });
});

describe('drafts, scheduling and duplication (EVT-006)', () => {
  it('scheduled publication runs through the same gate when due', async () => {
    const { eventId } = await draft();
    const e = await t.c.events.findOne({ _id: eventId });
    await ev.schedule(eventId, new Date(Date.now() + 60_000).toISOString(), e!.version, seedIds.organizer, rid());
    expect((await ev.publishDue(new Date())).published).not.toContain(eventId);
    const due = await ev.publishDue(new Date(Date.now() + 120_000));
    expect(due.failed).toEqual([]);
    expect(due.published).toContain(eventId);
    const after = await t.c.events.findOne({ _id: eventId });
    expect(after!.state).toBe('published');
    expect((await t.c.disciplines.findOne({ eventId }))!.rulesSnapshot).not.toBeNull();
  });

  it('a duplicate or template is a fresh draft: no frozen rules, no link token, stages remapped', async () => {
    const { eventId } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'X', participantKind: 'player', capacity: 4 }] });
    const [d] = await t.c.disciplines.find({ eventId }).toArray();
    const s1 = await t.c.stages.findOne({ disciplineId: d!._id });
    expect(s1).toBeNull(); // fixture adds no stages; add two to check remapping on a copy of a copy
    const copy = await ev.duplicate(eventId, { slug: `dup-${newId().toLowerCase()}`, name: 'کپی', asTemplate: true }, seedIds.organizer, rid());
    expect(copy.state).toBe('draft');
    expect(copy.config.isTemplate).toBe(true);
    expect(copy.config.linkToken).toBeNull();
    const [cd] = await t.c.disciplines.find({ eventId: copy._id }).toArray();
    expect(cd!.rulesSnapshot).toBeNull();
    const a = await ev.addStage(cd!._id, { name: 'A', order: 1, format: 'groups', presence: 'online', dependsOnStageIds: [], links: [] }, seedIds.organizer, rid());
    await ev.addStage(cd!._id, { name: 'B', order: 2, format: 'single_elim', presence: 'offline', dependsOnStageIds: [a._id], links: [{ fromStageId: a._id, kind: 'qualifier', slots: 2, points: 'carry', factor: null }] }, seedIds.organizer, rid());
    const copy2 = await ev.duplicate(copy._id, { slug: `dup-${newId().toLowerCase()}`, name: 'کپی ۲', asTemplate: false }, seedIds.organizer, rid());
    const stages = await t.c.stages.find({ eventId: copy2._id }).sort({ order: 1 }).toArray();
    expect(stages).toHaveLength(2);
    expect(stages[1]!.dependsOnStageIds).toEqual([stages[0]!._id]);
    expect(stages[1]!.links[0]!.fromStageId).toBe(stages[0]!._id);
    await expect(ev.duplicate(eventId, { slug: copy.slug, name: 'dup slug', asTemplate: false }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(ev.duplicate(eventId, { slug: `dup-${newId().toLowerCase()}`, name: 'other org', asTemplate: false }, seedIds.organizerB, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
