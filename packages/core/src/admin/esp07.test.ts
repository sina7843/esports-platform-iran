import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testContainer, rid } from '../test/harness.js';
import { clause, openEvent, preparePublishable } from '../test/esp03-fixture.js';
import { seedIds } from '../db/seed-ids.js';
import { newId } from '../ids.js';
import { RegistrationService } from '../registration/registration.js';
import { BulkService, ModerationAppealService, SettingsService, TaskService, TicketService, UserAdminService } from './admin.js';
import { DataRequestService, LegalHoldService, LegalService, RetentionService, reapplyTombstones } from './privacy.js';
import { OpsDashboardService, ReportService, ServiceHealthService } from './ops.js';
import { ProviderRegistryService, breakerStates, guarded, resetBreaker, setQuota } from '../integrations/providers.js';
import { DomainError } from '@esp/contracts';
import { setPreviousSecrets } from '../identity/crypto.js';
import { rotateSealedSecrets } from './security.js';
import { PartnerService, signPartnerRequest, enqueueWebhooks, deliverWebhooks, replayWebhook } from '../integrations/partner.js';
import { assertPublicUrl, isPrivateAddress } from '../integrations/ssrf.js';

let t: Awaited<ReturnType<typeof testContainer>>;
const A = seedIds.admin;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
beforeAll(async () => {
  t = await testContainer({ seed: true });
});
afterAll(async () => {
  await t.drop();
});

let n = 0;
async function person(role: string | null = 'player'): Promise<string> {
  const id = `usr_t7_${++n}_${newId().slice(-6)}`;
  const now = new Date().toISOString();
  await t.c.principals.insertOne({ _id: id, kind: 'user', displayName: `کاربر ${n}`, locale: 'fa', timeZone: 'Asia/Tehran', status: 'active', aclVersion: 0, deletedAt: null, anonymizedAt: null, createdAt: now, updatedAt: now, version: 0 });
  if (role) await t.acl.grant({ principalId: id, role: role as never, scope: { type: 'site', id: 'site' }, expiresAt: null, reason: 'test' }, { principalId: 'system', requestId: rid() });
  const { createDefaultProfile } = await import('../profiles/defaults.js');
  await t.c.profiles.insertOne(createDefaultProfile(id, `p7_${n}_${newId().slice(-4).toLowerCase()}`));
  return id;
}
const dispute = async (eventId: string, parties: string[], state: string, updatedAt = new Date().toISOString(), evidence: string[] = []) => {
  const id = newId('dsp');
  await t.c.disputes.insertOne({ _id: id, eventId, matchId: null, category: 'other', claim: 'test', filedBy: parties[0], filedSide: null, parties, state, deadlines: { defenseBy: null, appealBy: null, fileBy: null }, assignee: null, appealAuthority: null, evidence: evidence.map((fileId) => ({ fileId, by: parties[0], at: updatedAt, note: null })), defense: [], evidenceRequests: [], reports: [], decisions: [], createdAt: updatedAt, updatedAt, version: 0 } as never);
  return id;
};

describe('versioned legal texts and consents (ADM-012)', () => {
  it('a new version needs re-acceptance; terms cannot be withdrawn, marketing can and turns promotion off', async () => {
    const legal = new LegalService(t);
    const u = await person();
    await expect(legal.publish({ kind: 'terms', title: 'شرایط', body: 'متن کامل شرایط استفاده از سرویس آزمون', requiresAcceptance: true, effectiveAt: null }, u, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const v1 = await legal.publish({ kind: 'terms', title: 'شرایط', body: 'متن کامل شرایط استفاده از سرویس آزمون', requiresAcceptance: true, effectiveAt: null }, A, rid());
    expect((await legal.pending(u)).map((p) => p.kind)).toContain('terms');
    await legal.accept(u, 'terms', v1.version);
    expect((await legal.pending(u)).map((p) => p.kind)).not.toContain('terms');
    const v2 = await legal.publish({ kind: 'terms', title: 'شرایط ۲', body: 'متن کامل نسخه دوم شرایط استفاده از سرویس', requiresAcceptance: true, effectiveAt: null }, A, rid());
    expect(v2.version).toBe(v1.version + 1);
    expect((await legal.pending(u)).find((p) => p.kind === 'terms')?.version).toBe(v2.version);
    await expect(legal.withdraw(u, 'terms')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const m = await legal.publish({ kind: 'consent_marketing', title: 'بازاریابی', body: 'رضایت اختیاری دریافت پیام تبلیغاتی آزمون', requiresAcceptance: false, effectiveAt: null }, A, rid());
    await legal.accept(u, 'consent_marketing', m.version);
    await t.c.profiles.updateOne({ _id: u }, { $set: { 'notificationPrefs.promotional': true } });
    expect(await legal.withdraw(u, 'consent_marketing')).toBe(1);
    expect((await t.c.profiles.findOne({ _id: u }))!.notificationPrefs).toMatchObject({ promotional: false });
  });
});

describe('retention, holds, deletion and restore (OPS-001..003, ADM-012)', () => {
  it('identity and financial documents are blocked until an approved policy with a reference exists', async () => {
    const ret = new RetentionService(t);
    const up = () => t.files.upload({ data: PNG, originalName: 'f.png', declaredMime: 'image/png', visibility: 'private', scope: { type: 'site', id: 'site' }, retentionClass: 'financial_document' }, { principalId: A, requestId: rid() });
    await expect(up()).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(await ret.allowsCollection('financial_document')).toBe(false);
    await expect(ret.setPolicy('financial_document', { days: 1825, approved: true, note: 'short' }, A, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await ret.setPolicy('financial_document', { days: 1825, approved: true, note: 'TEST ONLY policy ref FIN-POL-2026-01 approved' }, A, rid());
    await expect(up()).resolves.toMatchObject({ retentionClass: 'financial_document' });
    await ret.setPolicy('financial_document', { days: null, approved: false, note: 'revert for the other tests' }, A, rid());
  });

  it('the job deletes expired evidence and demos but never under a hold or an open case; deleted files cannot be read', async () => {
    const ret = new RetentionService(t);
    const holds = new LegalHoldService(t);
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const up = async (retentionClass: string, eventId?: string) => t.files.upload({ data: PNG, originalName: 'e.png', declaredMime: 'image/png', visibility: 'private', scope: eventId ? { type: 'event', id: eventId } : { type: 'site', id: 'site' }, retentionClass }, { principalId: A, requestId: rid() });
    const u = await person();
    const closedEv = await up('dispute_evidence');
    const heldEv = await up('dispute_evidence');
    const openEv = await up('dispute_evidence');
    await dispute('evt_x1', [u], 'closed', old, [closedEv._id, heldEv._id]);
    await dispute('evt_x2', [u], 'under_review', old, [openEv._id]);
    const demo = await up('demo');
    await t.c.files.updateOne({ _id: demo._id }, { $set: { createdAt: old } });
    await holds.place({ kind: 'file', id: heldEv._id, reason: 'TEST ONLY court request' }, A, rid());
    const dry = await ret.run({ dryRun: true });
    expect(dry.report['dispute_evidence']!.deleted).toBe(0);
    expect((await t.c.files.findOne({ _id: closedEv._id }))!.deletedAt).toBeUndefined();
    const r = await ret.run();
    expect(r.report['dispute_evidence']).toMatchObject({ deleted: 1, held: 1 });
    expect(r.report['demo']!.deleted).toBeGreaterThanOrEqual(1);
    expect((await t.c.files.findOne({ _id: closedEv._id }))!.deletedAt).toBeTruthy();
    expect((await t.c.files.findOne({ _id: heldEv._id }))!.deletedAt).toBeUndefined();
    expect((await t.c.files.findOne({ _id: openEv._id }))!.deletedAt).toBeUndefined(); // open case keeps its evidence
    expect(await t.c.tombstones.findOne({ _id: `file:${closedEv._id}` })).toBeTruthy();
    await expect(t.files.signPrivateLink(closedEv._id, { principalId: A, requestId: rid() })).rejects.toBeTruthy();
  });

  it('deletion waits for an open case, then anonymises history; a restored backup re-applies the deletion', async () => {
    const dsr = new DataRequestService(t);
    const u = await person();
    const other = await person();
    await t.c.honors.insertOne({ _id: newId('hon'), kind: 'trophy', eventId: 'evt_h', eventName: 'رویداد', disciplineId: 'd', stageId: null, place: 1, label: 'قهرمان', participationId: null, recipients: [{ principalId: u, displayName: 'نام واقعی' }], createdAt: new Date().toISOString() } as never);
    const caseId = await dispute('evt_h', [u, other], 'filed');
    const { request } = await dsr.create(u, 'deletion', 'please delete', rid());
    expect(request.state).toBe('on_hold');
    await expect(dsr.decide(request._id, 'complete', 'approved after review', u, rid())).rejects.toBeTruthy(); // not own (and no permission)
    await expect(dsr.decide(request._id, 'complete', 'approved after review', A, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    // snapshot = what a backup taken now would contain
    const backup = (await t.c.principals.findOne({ _id: u }))!;
    await t.c.disputes.updateOne({ _id: caseId }, { $set: { state: 'closed' } });
    const done = await dsr.decide(request._id, 'complete', 'approved after review', A, rid());
    expect(done.state).toBe('completed');
    const p = (await t.c.principals.findOne({ _id: u }))!;
    expect(p.status).toBe('deleted');
    const honor = (await t.c.honors.findOne({ 'recipients.principalId': u }))!;
    expect((honor as unknown as { recipients: Array<{ displayName: string }> }).recipients[0]!.displayName).not.toBe('نام واقعی');
    expect(await t.c.tombstones.findOne({ _id: `principal:${u}` })).toBeTruthy();
    // restore the old backup copy of the principal, then re-apply tombstones
    await t.c.principals.replaceOne({ _id: u }, backup);
    expect((await t.c.principals.findOne({ _id: u }))!.status).toBe('active');
    const re = await reapplyTombstones(t);
    expect(re.principals).toBeGreaterThanOrEqual(1);
    expect((await t.c.principals.findOne({ _id: u }))!.status).toBe('deleted');
  });

  it('export covers cross-stage data and never internal notes or secrets', async () => {
    const dsr = new DataRequestService(t);
    const tickets = new TicketService(t);
    const u = await person();
    const tk = await tickets.open({ subject: 'مشکل', text: 'شرح مشکل آزمون', category: 'other', priority: 'normal' }, u);
    await tickets.reply(tk._id, 'یادداشت داخلی کارکنان', true, A, rid());
    const { export: ex } = await dsr.create(u, 'export', '', rid());
    const json = JSON.stringify(ex);
    expect(json).toContain('شرح مشکل آزمون');
    expect(json).not.toContain('یادداشت داخلی کارکنان');
    expect(json).not.toMatch(/passwordHash|secretEnc/);
  });
});

describe('support, tasks, bulk, settings, users and appeals (ADM-001/006/007/008/009)', () => {
  it('tickets: requester sees no internal notes, cannot self-escalate, cannot link another person payment; SLA and audit', async () => {
    const tickets = new TicketService(t);
    const u = await person();
    const tk = await tickets.open({ subject: 'پرداخت', text: 'پرداخت ثبت نشد', category: 'payment', priority: 'urgent' }, u);
    expect(tk.priority).toBe('high');
    expect(Date.parse(tk.slaDueAt) - Date.parse(tk.createdAt)).toBe(8 * 3600_000);
    await expect(tickets.open({ subject: 'x پرداخت', text: 'لینک دیگری', category: 'payment', priority: 'normal', links: { paymentId: 'pay_missing' } }, u)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await tickets.reply(tk._id, 'note for staff', true, A, rid());
    await tickets.reply(tk._id, 'پاسخ به کاربر', false, A, rid());
    const view = await tickets.get(tk._id, u, rid());
    expect(view.messages.map((m) => m.text)).toEqual(['پرداخت ثبت نشد', 'پاسخ به کاربر']);
    const stranger = await person();
    await expect(tickets.get(tk._id, stranger, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(tickets.reply(tk._id, 'x', true, u, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(tickets.manage(tk._id, { assigneeId: stranger }, A, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const m = await tickets.manage(tk._id, { state: 'resolved', priority: 'low' }, A, rid());
    expect(m.history.map((h) => h.action)).toEqual(expect.arrayContaining(['state:resolved', 'priority:low']));
    expect(await t.c.audit.findOne({ action: 'support.ticket.manage', 'target.id': tk._id })).toBeTruthy();
  });

  it('tasks: owner, deadline, notes with optimistic version and handover', async () => {
    const tasks = new TaskService(t);
    const owner = await person('support_moderator');
    const next = await person('support_moderator');
    const k = await tasks.create({ scope: { type: 'site', id: 'site' }, title: 'بررسی صف', description: '', ownerId: owner, dueAt: new Date(Date.now() + 3600_000).toISOString(), priority: 'high' }, A, rid());
    const u1 = await tasks.update(k._id, { state: 'in_progress', note: 'شروع شد', expectedVersion: 0 }, owner, rid());
    await expect(tasks.update(k._id, { note: 'stale', expectedVersion: 0 }, owner, rid())).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(tasks.handover(k._id, next, 'x', owner, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const h = await tasks.handover(k._id, next, 'پایان شیفت؛ دو مورد باز مانده', owner, rid());
    expect(h.ownerId).toBe(next);
    expect(h.version).toBe(u1.version + 1);
    expect(h.handovers[0]).toMatchObject({ from: owner, to: next });
    expect((await tasks.list({ type: 'site', id: 'site' }, { mine: true }, next, rid())).map((x) => x._id)).toContain(k._id);
    const player = await person();
    await expect(tasks.list({ type: 'site', id: 'site' }, {}, player, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('bulk registration decision: preview per item, per-item result, outsiders cannot run it', async () => {
    const pkg = await preparePublishable(t, [clause('roster.min', 1)]);
    const { disciplineIds } = await openEvent(t, { packageId: pkg, disciplines: [{ name: 'انفرادی', participantKind: 'player', capacity: 10, autoApprove: false }] });
    const d = disciplineIds[0]!;
    const regs = new RegistrationService(t);
    const hash = (await t.c.disciplines.findOne({ _id: d }))!.rulesSnapshot!.hash;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await regs.create(d, { teamId: null, roster: [], formAnswers: {}, documentFileIds: {}, entryCode: null, acceptRulesHash: hash }, await person(), rid()))._id);
    const eventId = (await t.c.disciplines.findOne({ _id: d }))!.eventId;
    const bulk = new BulkService(t);
    const job = await bulk.preview({ kind: 'registration.approve', eventId, refs: [...ids, 'reg_missing'], params: {} }, seedIds.organizer, rid());
    expect(job.items.map((i) => i.status)).toEqual(['pending', 'pending', 'pending', 'skipped']);
    // one registration changes after the preview: it must fail alone, not hide the others
    await regs.decide(ids[1]!, 'reject', 'changed meanwhile', (await t.c.registrations.findOne({ _id: ids[1]! }))!.version, seedIds.organizer, rid());
    await expect(bulk.execute(job._id, seedIds.player, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const done = await bulk.execute(job._id, seedIds.organizer, rid());
    expect(done.items.map((i) => i.status)).toEqual(['ok', 'failed', 'ok', 'skipped']);
    expect((await t.c.registrations.findOne({ _id: ids[0]! }))!.state).toBe('confirmed');
    await expect(bulk.execute(job._id, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('settings history with reason; suspension revokes sessions; no self-change', async () => {
    const s = new SettingsService(t);
    await expect(s.set('unknown.key', 1, 'reason here', A, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await s.set('support.sla_hours', { normal: 24 }, 'first value', A, rid());
    const v2 = await s.set('support.sla_hours', { normal: 12 }, 'faster support', A, rid());
    expect(v2.history.at(-1)).toMatchObject({ value: { normal: 24 }, reason: 'faster support' });
    const users = new UserAdminService(t);
    const u = await person();
    await t.c.sessions.insertOne({ _id: newId('ses'), principalId: u, revokedAt: null } as never);
    await expect(users.setStatus(A, 'suspended', 'self change', A, rid())).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTIES' });
    await users.setStatus(u, 'suspended', 'abuse report confirmed', A, rid());
    expect(await t.c.sessions.countDocuments({ principalId: u, revokedAt: null })).toBe(0);
    expect((await t.c.principals.findOne({ _id: u }))!.status).toBe('suspended');
  });

  it('moderation appeal: only the author appeals, another moderator decides, reversal restores content', async () => {
    const ap = new ModerationAppealService(t);
    const author = await person();
    const mod1 = await person('support_moderator');
    const cid = newId('cmt');
    await t.c.comments.insertOne({ _id: cid, postId: 'post_x', principalId: author, text: 'نظر', hidden: { by: mod1, at: new Date().toISOString(), reason: 'x' } as never, createdAt: new Date().toISOString() });
    const rep = newId('rpt');
    await t.c.contentReports.insertOne({ _id: rep, targetType: 'comment', targetId: cid, scope: { eventId: null, teamId: null }, reporterId: A, reason: 'spam', state: 'actioned', decidedBy: mod1, note: null, createdAt: new Date().toISOString() });
    await expect(ap.appeal(rep, 'این نظر اسپم نبود و حذف آن اشتباه بود', mod1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await ap.appeal(rep, 'این نظر اسپم نبود و حذف آن اشتباه بود', author);
    await expect(ap.decide(rep, 'reversed', mod1, rid())).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTIES' });
    await ap.decide(rep, 'reversed', A, rid());
    expect((await t.c.comments.findOne({ _id: cid }))!.hidden).toBeNull();
  });
});

describe('operations dashboard, reports and service health (ADM-005/011/013)', () => {
  it('event dashboard counts and raises alerts; sponsor CSV is formula-safe; health reports backup RPO', async () => {
    const ops = new OpsDashboardService(t);
    const eventId = seedIds.eventA;
    await dispute(eventId, [seedIds.player], 'filed');
    const tickets = new TicketService(t);
    const tk = await tickets.open({ subject: 'مسابقه', text: 'سرور قطع شد', category: 'match', priority: 'normal', links: { eventId } }, seedIds.player);
    await t.c.supportTickets.updateOne({ _id: tk._id }, { $set: { slaDueAt: new Date(Date.now() - 1000).toISOString() } });
    await expect(ops.event(eventId, seedIds.player, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const dash = await ops.event(eventId, seedIds.organizer, rid());
    expect(dash.cases).toBeGreaterThanOrEqual(1);
    expect(dash.alerts.map((a) => a.kind)).toEqual(expect.arrayContaining(['open_cases', 'tickets_overdue']));
    const reports = new ReportService(t);
    const rep = await reports.platform({ from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' }, A, rid());
    expect(rep.support.ticketsOpened).toBeGreaterThanOrEqual(1);
    await expect(reports.platform({ from: '2000', to: '2100' }, seedIds.player, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await t.c.events.updateOne({ _id: eventId }, { $set: { name: '=HYPERLINK("x")' } });
    const csv = await reports.sponsorCsv(eventId, seedIds.organizer, rid());
    expect(csv.startsWith('﻿metric,value\n')).toBe(true);
    expect(csv).toContain(`event,"'=HYPERLINK(""x"")"`);
    const health = await new ServiceHealthService(t).snapshot(A, rid());
    expect(health.alerts.map((a) => a.kind)).toContain('backup_rpo');
    expect(health.providers.length).toBeGreaterThan(0);
    await t.c.backups.insertOne({ _id: newId('bak'), startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), target: 'test', file: null, sizeBytes: 1, collections: 1, documents: 1, encrypted: true, ok: true, error: null } as never);
    expect((await new ServiceHealthService(t).snapshot(A, rid())).alerts.map((a) => a.kind)).not.toContain('backup_rpo');
  });
});


describe('provider registry and resilience (INTG-001..004/006/009)', () => {
  it('retries idempotent calls only, opens the circuit after repeated failures, keeps business errors out, enforces quota', async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls < 3) throw new Error('timeout');
      return 'ok';
    };
    expect(await guarded('storage', 'get', flaky, { backoffMs: 1 })).toBe('ok');
    expect(calls).toBe(3);
    resetBreaker('sms');
    let sends = 0;
    await expect(guarded('sms', 'send', async () => (sends++, Promise.reject(new Error('down'))))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(sends).toBe(1); // non-idempotent: no blind retry
    await expect(guarded('sms', 'send', async () => Promise.reject(new DomainError('VALIDATION_FAILED', 'bad number')))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(breakerStates().find((b) => b.kind === 'sms')!.failures).toBe(1); // business error did not count
    for (let i = 0; i < 4; i++) await guarded('sms', 'send', async () => Promise.reject(new Error('down'))).catch(() => undefined);
    expect(breakerStates().find((b) => b.kind === 'sms')!.state).toBe('open');
    let reached = false;
    await expect(guarded('sms', 'send', async () => ((reached = true), 'x'))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(reached).toBe(false);
    // after the cool-down one trial call closes it again
    expect(await guarded('sms', 'send', async () => 'sent', { now: () => Date.now() + 31_000 })).toBe('sent');
    expect(breakerStates().find((b) => b.kind === 'sms')!.state).toBe('closed');
    resetBreaker('map');
    setQuota('map', 2);
    await guarded('map', 'geocode', async () => 1);
    await guarded('map', 'geocode', async () => 1);
    await expect(guarded('map', 'geocode', async () => 1)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    resetBreaker('map');
  });

  it('selection needs Iranian/self-hosted, a passed test, contract and exit plan; allowlist and readiness follow', async () => {
    const reg = new ProviderRegistryService(t);
    const base = { category: 'sms' as const, name: 'پیامک آزمون (TEST ONLY)', origins: ['https://sms.example.ir/'], iranian: false, selfHosted: false, publisherException: null, evaluation: { capabilities: ['otp'], limits: '100/min', costNote: 'n/a', contractRef: null, exitPlan: '', result: 'not_tested' as const }, keyEnvNames: ['ESP_TEST_SMS_KEY_UNSET'], quota: { perMinute: 100, perDay: null } };
    await expect(reg.upsert({ ...base, keyEnvNames: ['sk-live-123'] }, A, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(reg.upsert({ ...base, origins: ['http://sms.example.ir'] }, A, rid())).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(reg.upsert(base, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const p = await reg.upsert(base, A, rid());
    await expect(reg.decide(p._id, 'selected', A, rid())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const ok = await reg.upsert({ ...base, id: p._id, iranian: true, evaluation: { ...base.evaluation, contractRef: 'TEST-CONTRACT-1', exitPlan: 'export templates, switch to the second candidate', result: 'passed' } }, A, rid());
    expect(ok.evaluation.testedBy).toBe(A);
    await reg.decide(p._id, 'selected', A, rid());
    expect(await reg.isAllowedOrigin('https://sms.example.ir/v1/send')).toBe(true);
    expect(await reg.isAllowedOrigin('https://evil.example.com/')).toBe(false);
    const rd = await reg.readiness(A, rid());
    const sms = rd.rows.find((r) => r.kind === 'sms')!;
    expect(rd.ready).toBe(false); // development doubles are wired in tests
    expect(sms.blockers.join(' ')).toMatch(/development double/);
    expect(sms.keys).toEqual([{ name: 'ESP_TEST_SMS_KEY_UNSET', set: false }]);
    expect(JSON.stringify(rd)).not.toMatch(/secret|password/i);
    await reg.decide(p._id, 'retired', A, rid());
    resetBreaker('sms');
  });
});

describe('partner API and webhooks (INTG-005..008, SEC-005)', () => {
  const sign = (secret: string, keyId: string, method: string, path: string, body = '', over: { ts?: number; nonce?: string } = {}) => {
    const ts = String(over.ts ?? Date.now());
    const nonce = over.nonce ?? `n${newId()}`;
    return { method, path, body, headers: { 'x-esp-key': keyId, 'x-esp-timestamp': ts, 'x-esp-nonce': nonce, 'x-esp-signature': signPartnerRequest(secret, ts, nonce, method, path, body) } };
  };
  it('signature, freshness, replay, scope, event restriction, quota and revocation; secret never listed', async () => {
    const svc = new PartnerService(t);
    await expect(svc.createClient({ name: 'شریک', scopes: ['events:read'], eventIds: [], quotaPerMinute: 10 }, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const made = await svc.createClient({ name: 'شریک آزمون', scopes: ['events:read', 'results:read'], eventIds: [seedIds.eventA], quotaPerMinute: 2 }, A, rid());
    expect(JSON.stringify(await svc.list(A, rid()))).not.toContain(made.secret);
    const ok = sign(made.secret, made.keyId, 'GET', '/partner/v1/events');
    const client = await svc.authenticate(ok);
    expect((await svc.events(client)).apiVersion).toBe('v1');
    await expect(svc.authenticate(ok)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); // replayed nonce
    await expect(svc.authenticate(sign(made.secret, made.keyId, 'GET', '/partner/v1/events', '', { ts: Date.now() - 10 * 60_000 }))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const tampered = sign(made.secret, made.keyId, 'GET', '/partner/v1/events');
    await expect(svc.authenticate({ ...tampered, path: '/partner/v1/other' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(svc.authenticate(sign('wrong-secret', made.keyId, 'GET', '/x'))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(svc.news(client, seedIds.eventA)).rejects.toMatchObject({ code: 'FORBIDDEN' }); // no news scope
    await expect(svc.results(client, seedIds.eventB)).rejects.toMatchObject({ code: 'NOT_FOUND' }); // outside the client's events
    await svc.authenticate(sign(made.secret, made.keyId, 'GET', '/a'));
    await expect(svc.authenticate(sign(made.secret, made.keyId, 'GET', '/b'))).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(await t.c.audit.countDocuments({ action: 'partner.denied' })).toBeGreaterThanOrEqual(5);
    expect(await t.c.audit.countDocuments({ action: 'partner.events.list' })).toBe(1);
    const rotated = await svc.rotate(client._id, A, rid());
    await expect(svc.authenticate(sign(made.secret, made.keyId, 'GET', '/old'))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await svc.revoke(client._id, A, rid());
    await expect(svc.authenticate(sign(rotated.secret, made.keyId, 'GET', '/new'))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('SSRF guard rejects private targets; webhooks are idempotent per event, retried, dead-lettered and replayable', async () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::ffff:10.0.0.5')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    for (const u of ['http://example.com/x', 'https://127.0.0.1/x', 'https://user:pw@example.com/', 'https://[::1]/x', 'ftp://example.com']) await expect(assertPublicUrl(u)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const svc = new PartnerService(t);
    const made = await svc.createClient({ name: 'شریک وبهوک', scopes: ['results:read', 'webhooks:manage'], eventIds: [], quotaPerMinute: 100 }, A, rid());
    const client = await svc.authenticate(sign(made.secret, made.keyId, 'GET', '/hooks'));
    await expect(svc.createWebhook(client, { url: 'https://127.0.0.1/hook', events: ['honors.issued'] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(svc.createWebhook(client, { url: 'https://example.ir/hook', events: ['finance.order.paid'] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const hook = await svc.createWebhook(client, { url: 'http://localhost:9/hook', events: ['competition.match.finalized'] }, { allowPrivate: true });
    const ev = { id: `evt_${newId()}`, type: 'competition.match.finalized', payload: { eventId: seedIds.eventA, matchId: seedIds.matchA }, occurredAt: new Date(Date.now() - 1000).toISOString() };
    expect(await enqueueWebhooks(t, ev)).toBe(1);
    expect(await enqueueWebhooks(t, ev)).toBe(0); // same event again: no duplicate delivery
    expect(await enqueueWebhooks(t, { ...ev, id: 'x', type: 'finance.order.paid' })).toBe(0);
    const seen: Array<{ url: string; sig: string }> = [];
    let fail = true;
    const fetcher = async (url: string, init: { headers: Record<string, string> }) => (seen.push({ url, sig: init.headers['x-esp-signature']! }), { status: fail ? 500 : 200 });
    const t0 = new Date();
    expect(await deliverWebhooks(t, { now: t0, fetcher, allowPrivate: true })).toMatchObject({ retried: 1 });
    expect(await deliverWebhooks(t, { now: t0, fetcher, allowPrivate: true })).toMatchObject({ delivered: 0, retried: 0 }); // not due yet
    fail = false;
    expect(await deliverWebhooks(t, { now: new Date(t0.getTime() + 60_000), fetcher, allowPrivate: true })).toMatchObject({ delivered: 1 });
    expect(seen).toHaveLength(2);
    expect(seen[0]!.sig).toMatch(/^[0-9a-f]{64}$/);
    // exhausted retries → dead letter → operator replay
    await t.c.webhookDeliveries.updateOne({ webhookId: hook.id }, { $set: { state: 'pending', attempts: 5, nextAttemptAt: new Date(0).toISOString() } });
    fail = true;
    expect(await deliverWebhooks(t, { now: new Date(t0.getTime() + 120_000), fetcher, allowPrivate: true })).toMatchObject({ dead: 1 });
    const dead = (await t.c.webhookDeliveries.findOne({ webhookId: hook.id }))!;
    expect(dead.state).toBe('dead');
    await expect(replayWebhook(t, dead._id, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await replayWebhook(t, dead._id, A, rid());
    fail = false;
    expect(await deliverWebhooks(t, { now: new Date(t0.getTime() + 180_000), fetcher, allowPrivate: true })).toMatchObject({ delivered: 1 });
    // production mode (no allowPrivate) refuses the internal target even if it was stored
    await t.c.webhookDeliveries.updateOne({ _id: dead._id }, { $set: { state: 'pending', attempts: 0, nextAttemptAt: new Date(0).toISOString() } });
    expect(await deliverWebhooks(t, { now: new Date(t0.getTime() + 240_000), fetcher })).toMatchObject({ delivered: 0, retried: 1 });
  });

  it('secret rotation: old key still opens data during the window, rotation re-seals, then the old key can go (SEC-006)', async () => {
    const svc = new PartnerService(t);
    const made = await svc.createClient({ name: 'شریک چرخش', scopes: ['events:read'], eventIds: [], quotaPerMinute: 100 }, A, rid());
    const cfg = t.config as { appSecret: string };
    const oldKey = cfg.appSecret;
    try {
      cfg.appSecret = 'rotated-secret-0123456789-abcdefghijklmnop';
      setPreviousSecrets([oldKey]);
      await expect(svc.authenticate(sign(made.secret, made.keyId, 'GET', '/r1'))).resolves.toBeTruthy(); // still readable
      const r = await rotateSealedSecrets(t, A, rid());
      expect(r.partners).toBeGreaterThanOrEqual(1);
      expect(r.failed).toBe(0);
      setPreviousSecrets([]); // old key retired
      await expect(svc.authenticate(sign(made.secret, made.keyId, 'GET', '/r2'))).resolves.toBeTruthy();
      expect((await rotateSealedSecrets(t, A, rid())).partners).toBe(0); // idempotent
      await expect(rotateSealedSecrets(t, seedIds.organizer, rid())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      cfg.appSecret = oldKey;
      setPreviousSecrets([]);
    }
  });

  it('a delivery for an event with a stream delay waits for the delay', async () => {
    const svc = new PartnerService(t);
    const made = await svc.createClient({ name: 'شریک تأخیر', scopes: ['results:read', 'webhooks:manage'], eventIds: [], quotaPerMinute: 100 }, A, rid());
    const client = await svc.authenticate(sign(made.secret, made.keyId, 'GET', '/d'));
    await svc.createWebhook(client, { url: 'http://localhost:9/d', events: ['honors.issued'] }, { allowPrivate: true });
    await t.c.broadcastStreams.insertOne({ _id: newId('str'), eventId: 'evt_delay', role: 'primary', label: 'main', delaySeconds: 90 } as never);
    const occurred = new Date().toISOString();
    await enqueueWebhooks(t, { id: `evt_${newId()}`, type: 'honors.issued', payload: { eventId: 'evt_delay' }, occurredAt: occurred });
    const d = (await t.c.webhookDeliveries.find({ type: 'honors.issued' }).sort({ createdAt: -1 }).limit(1).toArray())[0]!;
    expect(Date.parse(d.nextAttemptAt) - Date.parse(occurred)).toBe(90_000);
  });
});
