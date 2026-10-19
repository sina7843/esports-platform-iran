import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultEventConfig } from '../events/defaults.js';
import { DomainError } from '@esp/contracts';
import { rid, testContainer } from '../test/harness.js';
import { createDefaultProfile } from '../profiles/defaults.js';
import { seedIds } from '../db/seed-ids.js';
import type { EventDoc, ParticipationDoc } from '../db/collections.js';
import { TeamService } from '../teams/teams.js';
import { OrganizerService, VERIFICATION_DISCLAIMER_EN } from './organizer.js';
import { seedOrganizerDomain } from './seed.js';

type C = Awaited<ReturnType<typeof testContainer>>;
let ct: C;
let svc: OrganizerService;
let teams: TeamService;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? e.code : `ERR:${String(e)}`;
  }
};
const APP = { description: 'برگزارکننده لیگ‌های محلی با ده سال سابقه', experience: null, contactPhone: null, documentFileIds: [] as string[] };
const LIMITS = { maxActiveEvents: 2, maxCapacityPerEvent: 32, paidEventsAllowed: false };
let n = 0;

async function mk(id: string): Promise<string> {
  const t = new Date().toISOString();
  await ct.c.principals.insertOne({ _id: id, kind: 'user', displayName: id, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: t, updatedAt: t, version: 0 });
  await ct.c.profiles.insertOne(createDefaultProfile(id, `nick_${id}`));
  return id;
}
async function mkOrg(owner: string) {
  n += 1;
  return teams.createOrganization(owner, { name: `سازمان ${n}`, slug: `org-t${n}`, description: null, city: 'شیراز', links: [], sponsors: [], logoFileId: null }, rid());
}
/** Org + approved application through the full lifecycle. */
async function approvedOrg(owner: string, level: 'basic' | 'trusted' | 'partner' = 'basic') {
  const org = await mkOrg(owner);
  const a = await svc.submit(owner, { ...APP, organizationId: org._id }, rid());
  const r1 = await svc.review(seedIds.admin, a._id, { action: 'start_review', note: 'شروع', expectedVersion: a.version }, rid());
  await svc.review(seedIds.admin, a._id, { action: 'approve', note: 'تأیید', level, limits: LIMITS, expectedVersion: r1.version }, rid());
  return org;
}
async function mkEvent(orgId: string, state: EventDoc['state'], visibility: EventDoc['visibility'] = 'public'): Promise<string> {
  n += 1;
  const t = new Date().toISOString();
  const e: EventDoc = { _id: `evt_o${n}`, slug: `evt-o${n}`, name: `رویداد ${n}`, organizerOrgId: orgId, visibility, state, timeZone: 'Asia/Tehran', startsAt: t, endsAt: null, rulesSnapshot: null, config: defaultEventConfig(), createdBy: 'x', createdAt: t, updatedAt: t, version: 0 };
  await ct.c.events.insertOne(e);
  return e._id;
}
async function participate(eventId: string, principalId: string, registrationState: ParticipationDoc['registrationState'] = 'confirmed') {
  const t = new Date().toISOString();
  const p = { _id: `ptc_o${(n += 1)}`, eventId, disciplineId: 'd', kind: 'team', snapshot: { displayName: 'T', teamId: null, roster: [{ principalId, displayName: 'x', role: 'player' }] }, acceptedRules: null, registrationState, createdAt: t, updatedAt: t, version: 0 } as ParticipationDoc;
  await ct.c.participations.insertOne(p);
}

beforeAll(async () => {
  ct = await testContainer({ seed: true });
  await seedOrganizerDomain(ct.c, ct.acl);
  svc = new OrganizerService(ct);
  teams = new TeamService(ct);
});
afterAll(async () => ct.drop());

describe('applications (ADM-002)', () => {
  it('lifecycle with needs_info and resubmit, approval grants role, profile and badge', async () => {
    const owner = await mk('u_ow1');
    const org = await mkOrg(owner);
    expect(await ct.acl.can(owner, 'organizer.profile.manage', { type: 'organization', id: org._id })).toBe(false);
    const a = await svc.submit(owner, { ...APP, organizationId: org._id }, rid());
    expect(await code(svc.submit(owner, { ...APP, organizationId: org._id }, rid()))).toBe('CONFLICT'); // one open application
    // approving straight from submitted is not allowed
    expect(await code(svc.review(seedIds.admin, a._id, { action: 'approve', note: 'x', level: 'basic', limits: LIMITS, expectedVersion: a.version }, rid()))).toBe('CONFLICT');
    const ni = await svc.review(seedIds.admin, a._id, { action: 'request_info', note: 'مدارک بیشتر', expectedVersion: a.version }, rid());
    expect(ni.state).toBe('needs_info');
    expect(await code(svc.review(seedIds.admin, a._id, { action: 'start_review', note: 'x', expectedVersion: ni.version }, rid()))).toBe('CONFLICT');
    expect(await code(svc.resubmit(owner, a._id, { note: 'x', expectedVersion: 99 }, rid()))).toBe('VERSION_CONFLICT');
    const re = await svc.resubmit(owner, a._id, { note: 'مدارک اضافه شد', experience: 'سه لیگ', expectedVersion: ni.version }, rid());
    expect(re.state).toBe('submitted');
    expect(re.experience).toBe('سه لیگ');
    const ur = await svc.review(seedIds.admin, a._id, { action: 'start_review', note: 'بررسی', expectedVersion: re.version }, rid());
    expect(await code(svc.review(seedIds.admin, a._id, { action: 'approve', note: 'x', expectedVersion: ur.version }, rid()))).toBe('VALIDATION_FAILED'); // level + limits required
    const ok = await svc.review(seedIds.admin, a._id, { action: 'approve', note: 'تأیید', level: 'trusted', limits: LIMITS, expectedVersion: ur.version }, rid());
    expect(ok.state).toBe('approved');
    expect(ok.history.map((h) => h.state)).toEqual(['submitted', 'needs_info', 'submitted', 'under_review', 'approved']);

    const prof = await ct.c.organizerProfiles.findOne({ _id: org._id });
    expect(prof?.prizeGuarantee).toBe(false);
    expect(prof?.verified).toMatchObject({ state: 'verified', issuer: seedIds.admin });
    expect(prof?.level).toBe('trusted');
    expect(await ct.c.outbox.countDocuments({ type: 'organizer.application.approved', 'aggregate.id': a._id })).toBe(1);
    expect(await ct.c.audit.countDocuments({ action: 'organizer.application.approve', 'target.id': a._id })).toBe(1);
    expect(await ct.c.badges.countDocuments({ principalId: owner, kind: 'org_position', revokedAt: null })).toBe(1);
    // organizer role works on events of the organization
    const evt = await mkEvent(org._id, 'draft');
    expect(await ct.acl.can(owner, 'event.manage', { type: 'event', id: evt })).toBe(true);
  });

  it('rejection needs a terminal state, reapplying is allowed afterwards', async () => {
    const owner = await mk('u_ow2');
    const org = await mkOrg(owner);
    const a = await svc.submit(owner, { ...APP, organizationId: org._id }, rid());
    const rj = await svc.review(seedIds.admin, a._id, { action: 'reject', note: 'مدارک ناکافی', expectedVersion: a.version }, rid());
    expect(rj.state).toBe('rejected');
    expect(await ct.c.grants.countDocuments({ principalId: owner, role: 'organizer', revokedAt: null })).toBe(0);
    expect((await svc.submit(owner, { ...APP, organizationId: org._id }, rid())).state).toBe('submitted');
  });

  it('reviewer cannot be the applicant; non-reviewers are forbidden', async () => {
    const org = await mkOrg(seedIds.admin);
    const a = await svc.submit(seedIds.admin, { ...APP, organizationId: org._id }, rid());
    expect(await code(svc.review(seedIds.admin, a._id, { action: 'start_review', note: 'x', expectedVersion: a.version }, rid()))).toBe('SEPARATION_OF_DUTIES');
    const other = await mk('u_plain');
    expect(await code(svc.review(other, a._id, { action: 'reject', note: 'x', expectedVersion: a.version }, rid()))).toBe('FORBIDDEN');
    expect(await code(svc.queue(other, undefined, rid()))).toBe('FORBIDDEN');
  });

  it('non-owner cannot apply for someone else organization; foreign documents are refused', async () => {
    const owner = await mk('u_ow3');
    const thief = await mk('u_thief');
    const org = await mkOrg(owner);
    expect(await code(svc.submit(thief, { ...APP, organizationId: org._id }, rid()))).toBe('FORBIDDEN');
    expect(await code(svc.submit(owner, { ...APP, organizationId: 'org_missing' }, rid()))).toBe('NOT_FOUND');
    expect(await code(svc.submit(owner, { ...APP, organizationId: org._id, documentFileIds: ['file_missing'] }, rid()))).toBe('VALIDATION_FAILED');
  });
});

describe('verification, limits and public page (ADM-003/004)', () => {
  it('revoking verification removes access on the next check and the badge', async () => {
    const owner = await mk('u_ow4');
    const org = await approvedOrg(owner);
    const evt = await mkEvent(org._id, 'draft');
    expect(await ct.acl.can(owner, 'event.manage', { type: 'event', id: evt })).toBe(true);
    expect(await code(svc.revokeVerification(owner, org._id, 'سوءاستفاده از نام', rid()))).toBe('FORBIDDEN');
    expect(await code(svc.revokeVerification(seedIds.admin, org._id, 'کم', rid()))).toBe('VALIDATION_FAILED');
    await svc.revokeVerification(seedIds.admin, org._id, 'تخلف مالی گزارش‌شده', rid());
    expect(await ct.acl.can(owner, 'event.manage', { type: 'event', id: evt })).toBe(false);
    expect(await code(svc.assertCanPublishEvent(org._id, { capacity: 8, paid: false, activeEventsCount: 0 }))).toBe('PRECONDITION_FAILED');
    expect(await ct.c.badges.countDocuments({ principalId: owner, kind: 'org_position', revokedAt: null })).toBe(0);
    expect((await ct.c.organizerProfiles.findOne({ _id: org._id }))?.verified.state).toBe('revoked');
    expect(await code(svc.revokeVerification(seedIds.admin, org._id, 'دوباره لغو', rid()))).toBe('CONFLICT');
  });

  it('assertCanPublishEvent enforces approval and limits with details', async () => {
    const owner = await mk('u_ow5');
    const org = await mkOrg(owner);
    expect(await code(svc.assertCanPublishEvent(org._id, { capacity: 8, paid: false, activeEventsCount: 0 }))).toBe('PRECONDITION_FAILED'); // not approved
    await approvedOrg(await mk('u_ow5b')); // unrelated org does not help
    expect(await code(svc.assertCanPublishEvent(org._id, { capacity: 8, paid: false, activeEventsCount: 0 }))).toBe('PRECONDITION_FAILED');
    const ok = await approvedOrg(await mk('u_ow5c'));
    await expect(svc.assertCanPublishEvent(ok._id, { capacity: 32, paid: false, activeEventsCount: 1 })).resolves.toBeTruthy();
    for (const bad of [{ capacity: 33, paid: false, activeEventsCount: 0 }, { capacity: 8, paid: true, activeEventsCount: 0 }, { capacity: 8, paid: false, activeEventsCount: 2 }]) {
      const e = await svc.assertCanPublishEvent(ok._id, bad).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe('PRECONDITION_FAILED');
      expect(((e as DomainError).details as { violations: string[] }).violations.length).toBe(1);
    }
  });

  it('seed organizer domain is idempotent and approves org A', async () => {
    await seedOrganizerDomain(ct.c, ct.acl);
    expect(await ct.c.organizerProfiles.countDocuments({ _id: seedIds.orgA })).toBe(1);
    await expect(svc.assertCanPublishEvent(seedIds.orgA, { capacity: 10, paid: false, activeEventsCount: 0 })).resolves.toBeTruthy();
  });

  it('profile edit needs organizer.profile.manage in the organization; public page is a safe projection', async () => {
    const owner = await mk('u_ow6');
    const stranger = await mk('u_str6');
    const org = await approvedOrg(owner);
    const p = await svc.profileForEdit(owner, org._id, rid());
    expect(await code(svc.updateProfile(stranger, org._id, { intro: 'x', expectedVersion: p.version }, rid()))).toBe('FORBIDDEN');
    expect(await code(svc.updateProfile(owner, org._id, { intro: 'x', expectedVersion: 42 }, rid()))).toBe('VERSION_CONFLICT');
    await svc.updateProfile(owner, org._id, { intro: 'معرفی', staff: [{ principalId: owner, name: 'علی', role: 'مدیر' }], venue: 'سالن', venueAddressText: 'شیراز، خیابان نمونه ۱', facilities: ['اینترنت'], links: [{ label: 'سایت', url: 'https://example.ir' }], expectedVersion: p.version }, rid());
    await mkEvent(org._id, 'registration_open');
    await mkEvent(org._id, 'finished');
    await mkEvent(org._id, 'draft');
    await mkEvent(org._id, 'published', 'private');
    const page = await svc.publicPage(org.slug);
    const json = JSON.stringify(page);
    expect(page.venueAddressText).toBe('شیراز، خیابان نمونه ۱');
    expect(page.verification.verified).toBe(true);
    expect(page.verification.prizeGuarantee).toBe(false);
    expect(page.verification.disclaimerEn).toBe(VERIFICATION_DISCLAIMER_EN);
    expect(page.verification.disclaimerFa.length).toBeGreaterThan(20);
    expect(page.upcomingEvents).toHaveLength(1);
    expect(page.pastEvents).toHaveLength(1);
    expect(page.staff[0]).toEqual({ name: 'علی', role: 'مدیر' });
    for (const leak of ['documentFileIds', 'issuer', 'principalId', owner, seedIds.admin, 'limits', 'history']) expect(json).not.toContain(leak);
    const list = await svc.publicList({ city: 'شیراز', level: 'basic', limit: 50 });
    expect(list.some((o) => o.id === org._id)).toBe(true);
    expect(await svc.publicList({ level: 'partner', limit: 50 })).toEqual([]);
    await svc.revokeVerification(seedIds.admin, org._id, 'دلیل لغو آزمون', rid());
    expect((await svc.publicList({ limit: 50 })).some((o) => o.id === org._id)).toBe(false);
    expect((await svc.publicPage(org.slug)).verification.verified).toBe(false);
    expect(await code(svc.publicPage('no-such-organizer'))).toBe('NOT_FOUND');
  });
});

describe('ratings (ADM-010)', () => {
  it('only confirmed participants of finished events rate once; moderation needs a reason', async () => {
    const owner = await mk('u_ow7');
    const org = await approvedOrg(owner);
    const done = await mkEvent(org._id, 'finished');
    const running = await mkEvent(org._id, 'active');
    const player = await mk('u_pl7');
    const pending = await mk('u_pl7b');
    const outsider = await mk('u_out7');
    for (const e of [done, running]) await participate(e, player);
    await participate(done, pending, 'awaiting_review');
    const rate = (who: string, eventId: string, score = 4) => svc.rate(who, org._id, { eventId, score, comment: score < 3 ? 'ضعیف' : null }, rid());

    expect(await code(rate(outsider, done))).toBe('FORBIDDEN');
    expect(await code(rate(pending, done))).toBe('FORBIDDEN'); // not confirmed
    expect(await code(rate(player, running))).toBe('PRECONDITION_FAILED'); // unfinished event
    expect(await code(rate(owner, done))).toBe('FORBIDDEN');
    expect(await code(rate(player, 'evt_none'))).toBe('NOT_FOUND');
    const r = await rate(player, done, 1);
    expect(await code(rate(player, done))).toBe('CONFLICT'); // duplicate

    // a second participant gives a 5; the summary counts both
    const p2 = await mk('u_pl7c');
    await participate(done, p2);
    await rate(p2, done, 5);
    expect((await svc.ratingSummary(org._id)).count).toBe(2);

    // organizer cannot hide; moderator needs a reason
    expect(await code(svc.moderate(owner, r._id, 'hide', 'تلافی‌جویی', rid()))).toBe('FORBIDDEN');
    expect(await code(svc.moderate(seedIds.admin, r._id, 'hide', '', rid()))).toBe('VALIDATION_FAILED');
    expect(await code(svc.moderate(seedIds.admin, r._id, 'hide', 'abc', rid()))).toBe('VALIDATION_FAILED');
    const hidden = await svc.moderate(seedIds.admin, r._id, 'hide', 'محتوای توهین‌آمیز', rid());
    expect(hidden.state).toBe('hidden');
    expect(await code(svc.moderate(seedIds.admin, r._id, 'hide', 'دوباره پنهان', rid()))).toBe('CONFLICT');
    const sum = await svc.ratingSummary(org._id);
    expect(sum).toMatchObject({ count: 1, average: 5 });
    expect((await svc.publicPage(org.slug)).recentRatings).toHaveLength(1);
    expect(await ct.c.organizerRatings.countDocuments({ organizationId: org._id })).toBe(2); // retained
    expect(await ct.c.audit.countDocuments({ action: 'organizer.rating.hide', 'target.id': r._id })).toBe(1);
    await svc.moderate(seedIds.admin, r._id, 'unhide', 'بازبینی شد', rid());
    expect((await svc.ratingSummary(org._id)).count).toBe(2);
  });
});
