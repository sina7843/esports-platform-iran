import { DomainError, type Scope } from '@esp/contracts';
import type { Container } from '../container.js';
import type { AdminTaskDoc, BulkJobDoc, PlatformSettingDoc, SupportTicketDoc } from '../db/collections-esp07.js';
import { newId } from '../ids.js';
import { clean } from '../news/news.js';
import { NotificationService } from '../notifications/notifications.js';
import { RegistrationService } from '../registration/registration.js';

const iso = () => new Date().toISOString();
const SITE: Scope = { type: 'site', id: 'site' };
const scopeOf = (s: AdminTaskDoc['scope']): Scope => (s.type === 'site' ? SITE : { type: 'event', id: s.id });
const SLA_HOURS: Record<SupportTicketDoc['priority'], number> = { urgent: 2, high: 8, normal: 24, low: 72 };

/** ADM-007: tasks with owner, deadline, internal notes and shift handover, per event or platform-wide. */
export class TaskService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  async create(input: { scope: AdminTaskDoc['scope']; title: string; description: string; ownerId: string | null; dueAt: string | null; priority: AdminTaskDoc['priority']; links?: Partial<AdminTaskDoc['links']> | undefined }, actor: string, requestId: string): Promise<AdminTaskDoc> {
    await this.ct.acl.require(actor, 'admin.tasks', scopeOf(input.scope), requestId);
    if (clean(input.title, 200).length < 3) throw new DomainError('VALIDATION_FAILED', 'title is required');
    if (input.dueAt && Number.isNaN(Date.parse(input.dueAt))) throw new DomainError('VALIDATION_FAILED', 'invalid deadline');
    const doc: AdminTaskDoc = { _id: newId('tsk'), scope: input.scope, title: clean(input.title, 200), description: clean(input.description, 4000), ownerId: input.ownerId, dueAt: input.dueAt, priority: input.priority, state: 'open', links: { matchId: input.links?.matchId ?? null, paymentId: input.links?.paymentId ?? null, ticketId: input.links?.ticketId ?? null }, notes: [], handovers: [], createdBy: actor, createdAt: iso(), updatedAt: iso(), version: 0 };
    await this.c.adminTasks.insertOne(doc);
    if (doc.ownerId) await new NotificationService(this.ct).notify({ principalIds: [doc.ownerId], category: 'system', title: `وظیفه جدید: ${doc.title}`, body: doc.dueAt ? `مهلت: ${doc.dueAt}` : '', link: '/admin/tasks', dedupeKey: `task:${doc._id}` });
    return doc;
  }
  private async load(id: string, actor: string, requestId: string) {
    const t = await this.c.adminTasks.findOne({ _id: id });
    if (!t) throw new DomainError('NOT_FOUND', 'task not found');
    await this.ct.acl.require(actor, 'admin.tasks', scopeOf(t.scope), requestId);
    return t;
  }
  async update(id: string, input: { state?: AdminTaskDoc['state'] | undefined; ownerId?: string | null | undefined; dueAt?: string | null | undefined; note?: string | undefined; expectedVersion: number }, actor: string, requestId: string): Promise<AdminTaskDoc> {
    const t = await this.load(id, actor, requestId);
    const set: Partial<AdminTaskDoc> = { updatedAt: iso() };
    if (input.state) set.state = input.state;
    if (input.ownerId !== undefined) set.ownerId = input.ownerId;
    if (input.dueAt !== undefined) set.dueAt = input.dueAt;
    const r = await this.c.adminTasks.findOneAndUpdate({ _id: t._id, version: input.expectedVersion }, { $set: set, ...(input.note ? { $push: { notes: { by: actor, at: iso(), text: clean(input.note, 2000) } } } : {}), $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('VERSION_CONFLICT', 'the task changed; reload');
    return r;
  }
  async handover(id: string, to: string, note: string, actor: string, requestId: string): Promise<AdminTaskDoc> {
    const t = await this.load(id, actor, requestId);
    if (clean(note, 2000).length < 5) throw new DomainError('VALIDATION_FAILED', 'leave a handover note');
    const r = (await this.c.adminTasks.findOneAndUpdate({ _id: t._id }, { $set: { ownerId: to, updatedAt: iso() }, $push: { handovers: { from: t.ownerId ?? actor, to, note: clean(note, 2000), at: iso() } }, $inc: { version: 1 } }, { returnDocument: 'after' }))!;
    await new NotificationService(this.ct).notify({ principalIds: [to], category: 'system', title: `تحویل وظیفه: ${t.title}`, body: clean(note, 300), link: '/admin/tasks', dedupeKey: `task-hand:${t._id}:${r.version}` });
    return r;
  }
  async list(scope: AdminTaskDoc['scope'], f: { state?: string | undefined; mine?: boolean | undefined }, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'admin.tasks', scopeOf(scope), requestId);
    return this.c.adminTasks.find({ 'scope.type': scope.type, 'scope.id': scope.id, ...(f.state ? { state: f.state as AdminTaskDoc['state'] } : { state: { $in: ['open', 'in_progress'] } }), ...(f.mine ? { ownerId: actor } : {}) }).sort({ dueAt: 1, priority: -1 }).limit(300).toArray();
  }
}

/** ADM-008: support tickets with priority, category, owner, history and links to a match/payment/registration. */
export class TicketService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  async open(input: { subject: string; text: string; category: SupportTicketDoc['category']; priority: SupportTicketDoc['priority']; links?: Partial<SupportTicketDoc['links']> | undefined }, actor: string): Promise<SupportTicketDoc> {
    if (clean(input.subject, 200).length < 3 || clean(input.text, 4000).length < 5) throw new DomainError('VALIDATION_FAILED', 'subject and description are required');
    const recent = await this.c.supportTickets.countDocuments({ requesterId: actor, createdAt: { $gt: new Date(Date.now() - 3600_000).toISOString() } });
    if (recent >= 10) throw new DomainError('RATE_LIMITED', 'too many tickets in the last hour');
    // links must belong to the requester or be public context; staff verify on assignment
    const links = { eventId: input.links?.eventId ?? null, matchId: input.links?.matchId ?? null, paymentId: input.links?.paymentId ?? null, registrationId: input.links?.registrationId ?? null };
    if (links.paymentId) {
      const pay = await this.c.payments.findOne({ _id: links.paymentId }, { projection: { orderId: 1 } });
      const order = pay ? await this.c.orders.findOne({ _id: pay.orderId }, { projection: { payerPrincipalId: 1 } }) : null;
      if (order?.payerPrincipalId !== actor) throw new DomainError('FORBIDDEN', 'you can only link your own payment');
    }
    const priority = input.priority === 'urgent' ? 'high' : input.priority; // requesters cannot self-escalate to urgent
    const doc: SupportTicketDoc = {
      _id: newId('stk'), requesterId: actor, subject: clean(input.subject, 200), category: input.category, priority, state: 'open', assigneeId: null, links,
      messages: [{ by: actor, at: iso(), text: clean(input.text, 4000), internal: false }], history: [{ at: iso(), by: actor, action: 'opened', note: null }],
      slaDueAt: new Date(Date.now() + SLA_HOURS[priority] * 3600_000).toISOString(), createdAt: iso(), updatedAt: iso(), version: 0,
    };
    await this.c.supportTickets.insertOne(doc);
    return doc;
  }
  private async staff(actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'support.tickets', SITE, requestId);
  }
  /** Requester view: never the internal notes. */
  view(t: SupportTicketDoc, staff: boolean) {
    return staff ? t : { ...t, messages: t.messages.filter((m) => !m.internal), history: t.history.filter((h) => h.action !== 'internal_note') };
  }
  async get(id: string, actor: string, requestId: string) {
    const t = await this.c.supportTickets.findOne({ _id: id });
    if (!t) throw new DomainError('NOT_FOUND', 'ticket not found');
    const staff = await this.ct.acl.can(actor, 'support.tickets', SITE);
    if (!staff && t.requesterId !== actor) {
      await this.ct.acl.require(actor, 'support.tickets', SITE, requestId); // audited denial
    }
    return this.view(t, staff);
  }
  async reply(id: string, text: string, internal: boolean, actor: string, requestId: string) {
    const t = await this.c.supportTickets.findOne({ _id: id });
    if (!t) throw new DomainError('NOT_FOUND', 'ticket not found');
    const staff = await this.ct.acl.can(actor, 'support.tickets', SITE);
    if (!staff && t.requesterId !== actor) throw new DomainError('NOT_FOUND', 'ticket not found');
    if (internal && !staff) throw new DomainError('FORBIDDEN', 'internal notes are for staff');
    if (t.state === 'closed') throw new DomainError('PRECONDITION_FAILED', 'the ticket is closed');
    const nextState = staff ? (internal ? t.state : 'pending') : 'open';
    const r = (await this.c.supportTickets.findOneAndUpdate({ _id: id }, { $push: { messages: { by: actor, at: iso(), text: clean(text, 4000), internal }, history: { at: iso(), by: actor, action: internal ? 'internal_note' : 'reply', note: null } }, $set: { state: nextState, updatedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' }))!;
    if (staff && !internal) await new NotificationService(this.ct).notify({ principalIds: [t.requesterId], category: 'system', title: `پاسخ پشتیبانی: ${t.subject}`, body: '', link: `/support/${t._id}`, dedupeKey: `ticket:${t._id}:${r.version}` });
    void requestId;
    return this.view(r, staff);
  }
  async manage(id: string, input: { state?: SupportTicketDoc['state'] | undefined; priority?: SupportTicketDoc['priority'] | undefined; assigneeId?: string | null | undefined; note?: string | undefined }, actor: string, requestId: string): Promise<SupportTicketDoc> {
    await this.staff(actor, requestId);
    const t = await this.c.supportTickets.findOne({ _id: id });
    if (!t) throw new DomainError('NOT_FOUND', 'ticket not found');
    const set: Partial<SupportTicketDoc> = { updatedAt: iso() };
    const hist: SupportTicketDoc['history'] = [];
    if (input.state && input.state !== t.state) {
      set.state = input.state;
      hist.push({ at: iso(), by: actor, action: `state:${input.state}`, note: input.note ?? null });
    }
    if (input.priority && input.priority !== t.priority) {
      set.priority = input.priority;
      set.slaDueAt = new Date(Date.parse(t.createdAt) + SLA_HOURS[input.priority] * 3600_000).toISOString();
      hist.push({ at: iso(), by: actor, action: `priority:${input.priority}`, note: null });
    }
    if (input.assigneeId !== undefined && input.assigneeId !== t.assigneeId) {
      if (input.assigneeId && !(await this.ct.acl.can(input.assigneeId, 'support.tickets', SITE))) throw new DomainError('VALIDATION_FAILED', 'the assignee is not support staff');
      set.assigneeId = input.assigneeId;
      hist.push({ at: iso(), by: actor, action: `assign:${input.assigneeId ?? 'none'}`, note: null });
    }
    const r = (await this.c.supportTickets.findOneAndUpdate({ _id: id }, { $set: set, $push: { history: { $each: hist } }, $inc: { version: 1 } }, { returnDocument: 'after' }))!;
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'support.ticket.manage', target: { type: 'ticket', id }, scope: SITE, outcome: 'success', details: { changes: hist.map((h) => h.action) }, requestId });
    return r;
  }
  async queue(f: { state?: string | undefined; category?: string | undefined; assignee?: string | undefined; eventId?: string | undefined }, actor: string, requestId: string) {
    await this.staff(actor, requestId);
    const rows = await this.c.supportTickets.find({ ...(f.state ? { state: f.state as SupportTicketDoc['state'] } : { state: { $in: ['open', 'pending'] } }), ...(f.category ? { category: f.category as SupportTicketDoc['category'] } : {}), ...(f.assignee ? { assigneeId: f.assignee } : {}), ...(f.eventId ? { 'links.eventId': f.eventId } : {}) }).sort({ slaDueAt: 1 }).limit(300).toArray();
    const now = iso();
    return rows.map((t) => ({ ...t, overdue: t.state !== 'resolved' && t.state !== 'closed' && t.slaDueAt < now }));
  }
  async mine(actor: string) {
    return (await this.c.supportTickets.find({ requesterId: actor }).sort({ createdAt: -1 }).limit(100).toArray()).map((t) => this.view(t, false));
  }
}

/**
 * ADM-006 bulk actions: a preview lists the effect on each item; execution records the outcome of each item
 * separately, so one failure is never hidden by the others.
 */
export class BulkService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  async preview(input: { kind: BulkJobDoc['kind']; eventId: string; refs: string[]; params: Record<string, unknown> }, actor: string, requestId: string): Promise<BulkJobDoc> {
    await this.ct.acl.require(actor, 'event.manage', { type: 'event', id: input.eventId }, requestId);
    if (!input.refs.length || input.refs.length > 500) throw new DomainError('VALIDATION_FAILED', '1..500 items');
    const items: BulkJobDoc['items'] = [];
    if (input.kind === 'registration.approve' || input.kind === 'registration.reject') {
      const regs = new Map((await this.c.registrations.find({ _id: { $in: input.refs }, eventId: input.eventId }).toArray()).map((r) => [r._id, r]));
      for (const ref of input.refs) {
        const r = regs.get(ref);
        if (!r) items.push({ ref, label: ref, preview: 'not found in this event', status: 'skipped', error: 'not found' });
        else if (r.state !== 'awaiting_review') items.push({ ref, label: r.displayName ?? ref, preview: `state is ${r.state}; unchanged`, status: 'skipped', error: null });
        else items.push({ ref, label: r.displayName ?? ref, preview: `${r.state} → ${input.kind === 'registration.approve' ? 'confirmed' : 'rejected'}`, status: 'pending', error: null });
      }
    } else if (input.kind === 'notify') {
      if (clean(String(input.params['title'] ?? ''), 200).length < 3) throw new DomainError('VALIDATION_FAILED', 'a notification title is required');
      const ps = new Map((await this.c.principals.find({ _id: { $in: input.refs } }, { projection: { displayName: 1, status: 1 } }).toArray()).map((p) => [p._id, p]));
      for (const ref of input.refs) {
        const p = ps.get(ref);
        items.push(p && p.status === 'active' ? { ref, label: p.displayName, preview: `notify: ${String(input.params['title'])}`, status: 'pending', error: null } : { ref, label: ref, preview: 'inactive or unknown account', status: 'skipped', error: null });
      }
    } else {
      const minutes = Number(input.params['minutes']);
      if (!Number.isInteger(minutes) || minutes === 0 || Math.abs(minutes) > 24 * 60) throw new DomainError('VALIDATION_FAILED', 'minutes is a non-zero whole number up to a day');
      const ms = new Map((await this.c.matches.find({ _id: { $in: input.refs }, eventId: input.eventId }).toArray()).map((m) => [m._id, m]));
      for (const ref of input.refs) {
        const m = ms.get(ref);
        items.push(!m ? { ref, label: ref, preview: 'not found', status: 'skipped', error: 'not found' } : !m.scheduledAt ? { ref, label: m.slot?.key ?? ref, preview: 'not scheduled', status: 'skipped', error: null } : { ref, label: m.slot?.key ?? ref, preview: `${m.scheduledAt} → ${new Date(Date.parse(m.scheduledAt) + minutes * 60_000).toISOString()}`, status: 'pending', error: null });
      }
    }
    const doc: BulkJobDoc = { _id: newId('blk'), kind: input.kind, scope: { type: 'event', id: input.eventId }, params: input.params, items, state: 'previewed', createdBy: actor, executedBy: null, createdAt: iso(), finishedAt: null };
    await this.c.bulkJobs.insertOne(doc);
    return doc;
  }
  async execute(jobId: string, actor: string, requestId: string): Promise<BulkJobDoc> {
    const pre = await this.c.bulkJobs.findOne({ _id: jobId });
    if (!pre) throw new DomainError('NOT_FOUND', 'job not found');
    await this.ct.acl.require(actor, 'event.manage', { type: 'event', id: pre.scope.id }, requestId);
    const job = await this.c.bulkJobs.findOneAndUpdate({ _id: jobId, state: 'previewed' }, { $set: { state: 'running', executedBy: actor } }, { returnDocument: 'after' });
    if (!job) throw new DomainError('PRECONDITION_FAILED', 'the job is not waiting for execution');
    const regs = new RegistrationService(this.ct);
    const items = [...job.items];
    if (job.kind === 'match.shift') {
      const refs = items.filter((i) => i.status === 'pending').map((i) => i.ref);
      try {
        const { ScheduleService } = await import('../competition/schedule.js');
        await new ScheduleService(this.ct).bulkShift(job.scope.id, { matchIds: refs, minutes: Number(job.params['minutes']), reason: String(job.params['reason'] ?? 'bulk shift') }, actor, requestId);
        for (const it of items) if (it.status === 'pending') Object.assign(it, { status: 'ok', preview: `${it.preview} (proposal created; apply it in the schedule)` });
      } catch (e) {
        for (const it of items) if (it.status === 'pending') Object.assign(it, { status: 'failed', error: (e as Error).message });
      }
    } else {
      for (const it of items) {
        if (it.status !== 'pending') continue;
        try {
          if (job.kind === 'notify') await new NotificationService(this.ct).notify({ principalIds: [it.ref], category: 'system', title: String(job.params['title']), body: String(job.params['body'] ?? ''), dedupeKey: `bulk:${job._id}` });
          else {
            const r = (await this.c.registrations.findOne({ _id: it.ref }))!;
            await regs.decide(r._id, job.kind === 'registration.approve' ? 'approve' : 'reject', job.kind === 'registration.reject' ? String(job.params['reason'] ?? 'bulk decision') : null, r.version, actor, requestId);
          }
          it.status = 'ok';
        } catch (e) {
          it.status = 'failed';
          it.error = (e as Error).message;
        }
      }
    }
    const done = (await this.c.bulkJobs.findOneAndUpdate({ _id: jobId }, { $set: { items, state: 'done', finishedAt: iso() } }, { returnDocument: 'after' }))!;
    await this.ct.audit.append({ actorPrincipalId: actor, action: `bulk.${job.kind}`, target: { type: 'bulk_job', id: jobId }, scope: { type: 'event', id: job.scope.id }, outcome: items.some((i) => i.status === 'failed') ? 'failed' : 'success', details: { ok: items.filter((i) => i.status === 'ok').length, failed: items.filter((i) => i.status === 'failed').length, skipped: items.filter((i) => i.status === 'skipped').length }, requestId });
    return done;
  }
  async list(eventId: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'event.manage', { type: 'event', id: eventId }, requestId);
    return this.c.bulkJobs.find({ 'scope.id': eventId }).sort({ createdAt: -1 }).limit(50).toArray();
  }
}

/** ADM-001 platform settings: versioned values with reason and history; only `platform.settings` holders change them. */
export class SettingsService {
  constructor(private readonly ct: Container) {}
  static readonly KEYS = ['support.sla_hours', 'registration.default_payment_window_minutes', 'community.chat_per_minute', 'live.default_low_data', 'maintenance.banner'] as const;
  async list(actor: string, requestId: string): Promise<PlatformSettingDoc[]> {
    await this.ct.acl.require(actor, 'platform.settings', SITE, requestId);
    return this.ct.c.platformSettings.find({}).toArray();
  }
  async set(key: string, value: unknown, reason: string, actor: string, requestId: string): Promise<PlatformSettingDoc> {
    await this.ct.acl.require(actor, 'platform.settings', SITE, requestId);
    if (!(SettingsService.KEYS as readonly string[]).includes(key)) throw new DomainError('VALIDATION_FAILED', 'unknown setting');
    if (clean(reason, 500).length < 5) throw new DomainError('VALIDATION_FAILED', 'a reason is required');
    const cur = await this.ct.c.platformSettings.findOne({ _id: key });
    const doc = (await this.ct.c.platformSettings.findOneAndUpdate({ _id: key }, { $set: { value, updatedBy: actor, updatedAt: iso() }, $inc: { version: 1 }, $push: { history: { value: cur?.value ?? null, by: actor, at: iso(), reason: clean(reason, 500) } } }, { upsert: true, returnDocument: 'after' }))!;
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'settings.set', target: { type: 'setting', id: key }, scope: SITE, outcome: 'success', details: { reason }, requestId });
    return doc;
  }
  async publicValue<T>(key: string, fallback: T): Promise<T> {
    return ((await this.ct.c.platformSettings.findOne({ _id: key }))?.value as T | undefined) ?? fallback;
  }
}

/** ADM-001 users panel: search, view and suspend/restore with a reason; suspension revokes sessions immediately. */
export class UserAdminService {
  constructor(private readonly ct: Container) {}
  async search(q: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'admin.users', SITE, requestId);
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 60), 'i');
    const ps = await this.ct.c.principals.find({ $or: [{ displayName: rx }, { _id: q }] }, { projection: { displayName: 1, status: 1, createdAt: 1 } }).limit(50).toArray();
    const profs = new Map((await this.ct.c.profiles.find({ _id: { $in: ps.map((p) => p._id) } }, { projection: { nickname: 1 } }).toArray()).map((p) => [p._id, p.nickname]));
    return ps.map((p) => ({ id: p._id, displayName: p.displayName, nickname: profs.get(p._id) ?? null, status: p.status, createdAt: p.createdAt }));
  }
  async setStatus(principalId: string, status: 'active' | 'suspended', reason: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'admin.users', SITE, requestId);
    if (principalId === actor) throw new DomainError('SEPARATION_OF_DUTIES', 'you cannot change your own account status');
    if (clean(reason, 500).length < 5) throw new DomainError('VALIDATION_FAILED', 'a reason is required');
    const p = await this.ct.c.principals.findOne({ _id: principalId });
    if (!p || p.status === 'deleted') throw new DomainError('NOT_FOUND', 'account not found');
    await this.ct.c.principals.updateOne({ _id: principalId }, { $set: { status, updatedAt: iso() }, $inc: { version: 1, aclVersion: 1 } });
    if (status === 'suspended') await this.ct.c.sessions.updateMany({ principalId, revokedAt: null }, { $set: { revokedAt: iso() } });
    await this.ct.audit.append({ actorPrincipalId: actor, action: `admin.user.${status}`, target: { type: 'principal', id: principalId }, scope: SITE, outcome: 'success', details: { reason }, requestId });
    return { id: principalId, status };
  }
}

/** ADM-009 appeal of a moderation decision by the affected author; a different moderator decides. */
export class ModerationAppealService {
  constructor(private readonly ct: Container) {}
  private async authorOf(type: string, id: string): Promise<string | null> {
    if (type === 'comment') return (await this.ct.c.comments.findOne({ _id: id }))?.principalId ?? null;
    if (type === 'chat') return (await this.ct.c.chatMessages.findOne({ _id: id }))?.principalId ?? null;
    if (type === 'match_message') return (await this.ct.c.matchMessages.findOne({ _id: id }))?.by ?? null;
    return null;
  }
  async appeal(reportId: string, text: string, actor: string) {
    const r = await this.ct.c.contentReports.findOne({ _id: reportId, state: 'actioned' });
    if (!r) throw new DomainError('NOT_FOUND', 'decision not found');
    if ((await this.authorOf(r.targetType, r.targetId)) !== actor) throw new DomainError('FORBIDDEN', 'only the author of the content appeals');
    if (r.appeal) throw new DomainError('CONFLICT', 'already appealed');
    if (clean(text, 2000).length < 10) throw new DomainError('VALIDATION_FAILED', 'explain the appeal');
    await this.ct.c.contentReports.updateOne({ _id: reportId }, { $set: { appeal: { by: actor, text: clean(text, 2000), at: iso(), decidedBy: null, outcome: null, decidedAt: null } } });
    return { id: reportId, appealed: true };
  }
  async decide(reportId: string, outcome: 'upheld' | 'reversed', actor: string, requestId: string) {
    const r = await this.ct.c.contentReports.findOne({ _id: reportId, 'appeal.outcome': null });
    if (!r?.appeal) throw new DomainError('NOT_FOUND', 'open appeal not found');
    const scope = r.scope.eventId ? { type: 'event' as const, id: r.scope.eventId } : SITE;
    if (!(await this.ct.acl.can(actor, 'community.moderate', SITE))) await this.ct.acl.require(actor, 'community.moderate', scope, requestId);
    if (r.decidedBy === actor) throw new DomainError('SEPARATION_OF_DUTIES', 'the original moderator cannot decide the appeal');
    if (outcome === 'reversed') {
      if (r.targetType === 'comment') await this.ct.c.comments.updateOne({ _id: r.targetId }, { $set: { hidden: null } });
      if (r.targetType === 'chat') await this.ct.c.chatMessages.updateOne({ _id: r.targetId }, { $set: { hidden: null } });
      if (r.targetType === 'match_message') await this.ct.c.matchMessages.updateOne({ _id: r.targetId }, { $set: { hidden: false } });
    }
    await this.ct.c.contentReports.updateOne({ _id: reportId }, { $set: { 'appeal.decidedBy': actor, 'appeal.outcome': outcome, 'appeal.decidedAt': iso() } });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'community.appeal', target: { type: r.targetType, id: r.targetId }, scope, outcome: 'success', details: { outcome }, requestId });
    return { id: reportId, outcome };
  }
  async queue(actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'community.moderate', SITE, requestId);
    return this.ct.c.contentReports.find({ 'appeal.outcome': null, appeal: { $ne: null } }).limit(200).toArray();
  }
}
