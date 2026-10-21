import { DomainError, type Scope } from '@esp/contracts';
import type { Container } from '../container.js';
import type { ConsentDoc, DataRequestDoc, LegalDocumentDoc, LegalHoldDoc, RetentionPolicyDoc } from '../db/collections-esp07.js';
import { AccountService } from '../identity/account.js';
import { newId } from '../ids.js';
import { appendTombstoneLog } from '../ops/backup.js';
import { clean } from '../news/news.js';

const iso = () => new Date().toISOString();
const SITE: Scope = { type: 'site', id: 'site' };
const OPEN_CASE = ['filed', 'assigned', 'defense_received', 'under_review', 'first_decision', 'appeal'] as const;

/** ADM-012: versioned terms, privacy and consent texts; acceptance and withdrawal are recorded per version. */
export class LegalService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  async publish(input: { kind: LegalDocumentDoc['kind']; title: string; body: string; requiresAcceptance: boolean; effectiveAt: string | null }, actor: string, requestId: string): Promise<LegalDocumentDoc> {
    await this.ct.acl.require(actor, 'privacy.manage', SITE, requestId);
    if (clean(input.title, 200).length < 3 || clean(input.body, 50_000).length < 20) throw new DomainError('VALIDATION_FAILED', 'title and full text are required');
    const last = await this.c.legalDocuments.find({ kind: input.kind }).sort({ version: -1 }).limit(1).next();
    const version = (last?.version ?? 0) + 1;
    const doc: LegalDocumentDoc = { _id: `${input.kind}:${version}`, kind: input.kind, version, title: clean(input.title, 200), body: clean(input.body, 50_000), requiresAcceptance: input.requiresAcceptance, effectiveAt: input.effectiveAt ?? iso(), publishedBy: actor, publishedAt: iso() };
    await this.c.legalDocuments.insertOne(doc);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'legal.publish', target: { type: 'legal_document', id: doc._id }, scope: SITE, outcome: 'success', requestId });
    return doc;
  }
  async current(kind: LegalDocumentDoc['kind']): Promise<LegalDocumentDoc | null> {
    return this.c.legalDocuments.find({ kind, effectiveAt: { $lte: iso() } }).sort({ version: -1 }).limit(1).next();
  }
  async history(kind: LegalDocumentDoc['kind']) {
    return (await this.c.legalDocuments.find({ kind }).sort({ version: -1 }).toArray()).map((d) => ({ id: d._id, version: d.version, title: d.title, effectiveAt: d.effectiveAt, requiresAcceptance: d.requiresAcceptance }));
  }
  /** Documents whose current version the person still has to accept. */
  async pending(principalId: string) {
    const out: Array<{ kind: string; version: number; title: string }> = [];
    for (const kind of ['terms', 'privacy'] as const) {
      const d = await this.current(kind);
      if (d?.requiresAcceptance && !(await this.c.consents.findOne({ _id: `${principalId}:${kind}:${d.version}`, withdrawnAt: null }))) out.push({ kind, version: d.version, title: d.title });
    }
    return out;
  }
  async accept(principalId: string, kind: LegalDocumentDoc['kind'], version: number): Promise<ConsentDoc> {
    const d = await this.c.legalDocuments.findOne({ _id: `${kind}:${version}` });
    if (!d) throw new DomainError('NOT_FOUND', 'document version not found');
    const doc: ConsentDoc = { _id: `${principalId}:${kind}:${version}`, principalId, kind, version, acceptedAt: iso(), withdrawnAt: null };
    await this.c.consents.updateOne({ _id: doc._id }, { $set: { acceptedAt: doc.acceptedAt, withdrawnAt: null }, $setOnInsert: { principalId, kind, version } }, { upsert: true });
    return doc;
  }
  /** Optional consents (e.g. marketing) can be withdrawn at any time; terms/privacy are accepted per version. */
  async withdraw(principalId: string, kind: LegalDocumentDoc['kind']): Promise<number> {
    if (kind === 'terms' || kind === 'privacy') throw new DomainError('VALIDATION_FAILED', 'terms and privacy are accepted per version; close the account to stop using the service');
    const r = await this.c.consents.updateMany({ principalId, kind, withdrawnAt: null }, { $set: { withdrawnAt: iso() } });
    if (kind === 'consent_marketing') await this.c.profiles.updateOne({ _id: principalId }, { $set: { 'notificationPrefs.promotional': false } });
    return r.modifiedCount;
  }
  async mine(principalId: string) {
    return this.c.consents.find({ principalId }).sort({ acceptedAt: -1 }).toArray();
  }
}

/** OPS-002: legal holds and open cases take precedence over scheduled deletion. */
export class LegalHoldService {
  constructor(private readonly ct: Container) {}
  async place(input: { kind: LegalHoldDoc['scope']['kind']; id: string; reason: string }, actor: string, requestId: string): Promise<LegalHoldDoc> {
    await this.ct.acl.require(actor, 'privacy.manage', SITE, requestId);
    if (clean(input.reason, 500).length < 5) throw new DomainError('VALIDATION_FAILED', 'a hold needs a documented reason');
    const doc: LegalHoldDoc = { _id: newId('hld'), scope: { kind: input.kind, id: input.id }, reason: clean(input.reason, 500), createdBy: actor, createdAt: iso(), releasedBy: null, releasedAt: null };
    await this.ct.c.legalHolds.insertOne(doc);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'legal.hold.place', target: { type: input.kind, id: input.id }, scope: SITE, outcome: 'success', details: { reason: input.reason }, requestId });
    return doc;
  }
  async release(id: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'privacy.manage', SITE, requestId);
    const r = await this.ct.c.legalHolds.findOneAndUpdate({ _id: id, releasedAt: null }, { $set: { releasedBy: actor, releasedAt: iso() } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('NOT_FOUND', 'active hold not found');
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'legal.hold.release', target: { type: r.scope.kind, id: r.scope.id }, scope: SITE, outcome: 'success', requestId });
    return r;
  }
  async list(actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'privacy.manage', SITE, requestId);
    return this.ct.c.legalHolds.find({ releasedAt: null }).sort({ createdAt: -1 }).toArray();
  }
  /** A person is held by a direct hold or by being a party of an open case. */
  async isHeld(kind: LegalHoldDoc['scope']['kind'], id: string): Promise<boolean> {
    if (await this.ct.c.legalHolds.findOne({ 'scope.kind': kind, 'scope.id': id, releasedAt: null })) return true;
    if (kind === 'principal') return !!(await this.ct.c.disputes.findOne({ parties: id, state: { $in: [...OPEN_CASE] } }, { projection: { _id: 1 } }));
    if (kind === 'event') return !!(await this.ct.c.disputes.findOne({ eventId: id, state: { $in: [...OPEN_CASE] } }, { projection: { _id: 1 } }));
    return false;
  }
}

/**
 * OPS-001..003 retention: configurable policies (proposed durations from OPS-001), applied by a job that skips
 * anything under a hold or linked to an open case. Identity and financial document classes stay blocked until an
 * approved policy exists. Deleted files keep their metadata with `deletedAt`; tombstones let a restore re-apply
 * deletions so data removed from the primary does not reappear from a backup.
 */
export class RetentionService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  async policies(actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'privacy.manage', SITE, requestId);
    return this.c.retentionPolicies.find({}).sort({ _id: 1 }).toArray();
  }
  async setPolicy(id: string, input: { days: number | null; approved: boolean; note: string }, actor: string, requestId: string): Promise<RetentionPolicyDoc> {
    await this.ct.acl.require(actor, 'privacy.manage', SITE, requestId);
    const cur = await this.c.retentionPolicies.findOne({ _id: id });
    if (!cur) throw new DomainError('NOT_FOUND', 'unknown data class');
    if (input.days !== null && (!Number.isInteger(input.days) || input.days < 1 || input.days > 3650)) throw new DomainError('VALIDATION_FAILED', 'days is 1..3650 or empty for the life of the service');
    if (input.approved && ['identity_document', 'financial_document'].includes(id) && clean(input.note, 1000).length < 20) throw new DomainError('VALIDATION_FAILED', 'approving a sensitive class needs the approved policy reference in the note');
    const r = (await this.c.retentionPolicies.findOneAndUpdate({ _id: id }, { $set: { days: input.days, approved: input.approved, approvedBy: input.approved ? actor : null, note: clean(input.note, 1000), updatedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' }))!;
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'retention.policy.set', target: { type: 'retention_policy', id }, scope: SITE, outcome: 'success', details: { days: input.days, approved: input.approved }, requestId });
    return r;
  }
  async allowsCollection(dataClass: string): Promise<boolean> {
    return !!(await this.c.retentionPolicies.findOne({ _id: dataClass, approved: true }));
  }

  private async deleteFile(fileId: string, reason: string): Promise<'deleted' | 'held' | 'missing'> {
    const f = await this.c.files.findOne({ _id: fileId });
    if (!f || f.deletedAt) return 'missing';
    const holds = new LegalHoldService(this.ct);
    if ((await holds.isHeld('file', f._id)) || (f.scope.type === 'event' && (await holds.isHeld('event', f.scope.id)))) return 'held';
    await this.ct.adapters.storage.delete(f.storageKey, f.visibility).catch(() => undefined);
    await this.c.files.updateOne({ _id: f._id }, { $set: { deletedAt: iso(), publicUrl: null } });
    await appendTombstoneLog(this.ct, { kind: 'file', ref: f._id, at: iso(), reason });
    await this.c.tombstones.updateOne({ _id: `file:${f._id}` }, { $setOnInsert: { _id: `file:${f._id}`, kind: 'file', ref: f._id, at: iso(), reason } }, { upsert: true });
    return 'deleted';
  }

  /** The retention job. `dryRun` reports what would happen. */
  async run(opts: { now?: Date; dryRun?: boolean } = {}) {
    const now = opts.now ?? new Date();
    const pol = new Map((await this.c.retentionPolicies.find({ approved: true }).toArray()).map((p) => [p._id, p]));
    const cutoff = (id: string) => (pol.get(id)?.days ? new Date(now.getTime() - pol.get(id)!.days! * 86_400_000).toISOString() : null);
    const report: Record<string, { candidates: number; deleted: number; held: number }> = {};
    const tally = (k: string) => (report[k] ??= { candidates: 0, deleted: 0, held: 0 });
    // dispute evidence: N days after the case closed; open cases always keep theirs
    const ev = cutoff('dispute_evidence');
    if (ev) {
      for (const d of await this.c.disputes.find({ state: 'closed', updatedAt: { $lt: ev } }).limit(500).toArray()) {
        for (const e of d.evidence) {
          const t = tally('dispute_evidence');
          t.candidates++;
          if (opts.dryRun) continue;
          const r = await this.deleteFile(e.fileId, `retention dispute_evidence (case ${d._id})`);
          if (r === 'deleted') t.deleted++;
          if (r === 'held') t.held++;
        }
      }
    }
    const demo = cutoff('demo');
    if (demo) {
      for (const f of await this.c.files.find({ retentionClass: 'demo', createdAt: { $lt: demo }, deletedAt: { $exists: false } }).limit(500).toArray()) {
        const t = tally('demo');
        t.candidates++;
        if (opts.dryRun) continue;
        const r = await this.deleteFile(f._id, 'retention demo');
        if (r === 'deleted') t.deleted++;
        if (r === 'held') t.held++;
      }
    }
    for (const [cls, col] of [['notifications', this.c.notifications], ['chat_messages', this.c.chatMessages]] as const) {
      const cut = cutoff(cls);
      if (!cut) continue;
      const t = tally(cls);
      t.candidates = await (col as typeof this.c.notifications).countDocuments({ createdAt: { $lt: cut } });
      if (!opts.dryRun) t.deleted = (await (col as typeof this.c.notifications).deleteMany({ createdAt: { $lt: cut } })).deletedCount;
    }
    const rt = pol.get('realtime_events');
    if (rt?.days && !opts.dryRun) tally('realtime_events').deleted = await this.ct.realtime.prune(rt.days * 86_400_000, now);
    // sensitive audit is never edited in place: candidates are reported for encrypted archival (chain checkpoint)
    const au = cutoff('sensitive_audit');
    if (au) tally('sensitive_audit').candidates = await this.c.audit.countDocuments({ at: { $lt: au } });
    return { at: now.toISOString(), dryRun: !!opts.dryRun, report };
  }
}

/** ADM-012 data-subject requests: export (immediate), correction (reviewed), deletion (holds first). */
export class DataRequestService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  /** Full personal export across stages; secrets (password hashes, TOTP secrets, tokens) are never included. */
  async exportAll(principalId: string, requestId: string) {
    const base = await new AccountService(this.ct).exportData(principalId, { requestId } as never);
    const c = this.c;
    const [registrations, orders, notifications, comments, messages, tickets, consents, requests, posts, honors, certificates] = await Promise.all([
      c.registrations.find({ applicantPrincipalId: principalId }).limit(1000).toArray(),
      c.orders.find({ payerPrincipalId: principalId }).limit(1000).toArray(),
      c.notifications.find({ principalId }).limit(2000).toArray(),
      c.comments.find({ principalId }).limit(2000).toArray(),
      c.chatMessages.find({ principalId }).limit(5000).toArray(),
      c.supportTickets.find({ requesterId: principalId }).limit(500).toArray(),
      c.consents.find({ principalId }).toArray(),
      c.dataRequests.find({ principalId }).toArray(),
      c.newsPosts.find({ authorId: principalId }).limit(1000).toArray(),
      c.honors.find({ 'recipients.principalId': principalId }).toArray(),
      c.certificates.find({ principalId }).toArray(),
    ]);
    return {
      ...base,
      data: {
        ...base.data,
        registrations: registrations.map((r) => ({ id: r._id, eventId: r.eventId, state: r.state, createdAt: r.createdAt })),
        orders: orders.map((o) => ({ id: o._id, kind: o.kind, totalRial: o.totalRial, state: o.state, createdAt: o.createdAt })),
        notifications: notifications.map((n) => ({ category: n.category, title: n.title, deliverAt: n.deliverAt, readAt: n.readAt })),
        comments: comments.map((x) => ({ postId: x.postId, text: x.text, createdAt: x.createdAt })),
        messages: messages.map((x) => ({ roomId: x.roomId, text: x.text, createdAt: x.createdAt })),
        tickets: tickets.map((t) => ({ id: t._id, subject: t.subject, state: t.state, messages: t.messages.filter((m) => !m.internal) })),
        consents, dataRequests: requests.map((r) => ({ kind: r.kind, state: r.state, createdAt: r.createdAt })),
        posts: posts.map((p) => ({ id: p._id, title: p.title, state: p.state })), honors: honors.map((h) => ({ id: h._id, label: h.label, eventName: h.eventName })), certificates: certificates.map((x) => ({ code: x.code, kind: x.kind, eventName: x.eventName })),
      },
    };
  }
  async create(principalId: string, kind: DataRequestDoc['kind'], detail: string, requestId: string) {
    const open = await this.c.dataRequests.findOne({ principalId, kind, state: { $in: ['open', 'in_review', 'on_hold'] } });
    if (open && kind !== 'export') throw new DomainError('CONFLICT', 'a request of this kind is already open');
    const doc: DataRequestDoc = { _id: newId('dsr'), principalId, kind, state: 'open', detail: clean(detail, 2000), decidedBy: null, decisionNote: null, createdAt: iso(), completedAt: null };
    if (kind === 'export') {
      doc.state = 'completed';
      doc.completedAt = iso();
      await this.c.dataRequests.insertOne(doc);
      return { request: doc, export: await this.exportAll(principalId, requestId) };
    }
    if (kind === 'deletion' && (await new LegalHoldService(this.ct).isHeld('principal', principalId))) doc.state = 'on_hold';
    await this.c.dataRequests.insertOne(doc);
    return { request: doc, export: null };
  }
  async queue(actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'privacy.manage', SITE, requestId);
    return this.c.dataRequests.find({ state: { $in: ['open', 'in_review', 'on_hold'] } }).sort({ createdAt: 1 }).toArray();
  }
  async decide(id: string, decision: 'complete' | 'reject', note: string, actor: string, requestId: string): Promise<DataRequestDoc> {
    await this.ct.acl.require(actor, 'privacy.manage', SITE, requestId);
    const r = await this.c.dataRequests.findOne({ _id: id, state: { $in: ['open', 'in_review', 'on_hold'] } });
    if (!r) throw new DomainError('NOT_FOUND', 'open request not found');
    if (r.principalId === actor) throw new DomainError('SEPARATION_OF_DUTIES', 'you cannot decide your own request');
    if (clean(note, 1000).length < 5) throw new DomainError('VALIDATION_FAILED', 'a decision note is required');
    if (decision === 'complete' && r.kind === 'deletion') {
      if (await new LegalHoldService(this.ct).isHeld('principal', r.principalId)) {
        await this.c.dataRequests.updateOne({ _id: id }, { $set: { state: 'on_hold', decisionNote: 'legal hold or open case' } });
        throw new DomainError('PRECONDITION_FAILED', 'a legal hold or open case prevents deletion (OPS-002)');
      }
      await new AccountService(this.ct).anonymize(r.principalId, actor, requestId);
    }
    const out = (await this.c.dataRequests.findOneAndUpdate({ _id: id }, { $set: { state: decision === 'complete' ? 'completed' : 'rejected', decidedBy: actor, decisionNote: clean(note, 1000), completedAt: iso() } }, { returnDocument: 'after' }))!;
    await this.ct.audit.append({ actorPrincipalId: actor, action: `privacy.request.${decision}`, target: { type: 'data_request', id }, scope: SITE, outcome: 'success', details: { kind: r.kind }, requestId });
    return out;
  }
  async mine(principalId: string) {
    return this.c.dataRequests.find({ principalId }).sort({ createdAt: -1 }).toArray();
  }
}

/** After a restore: re-apply every deletion recorded since the backup (OPS-003). */
export async function reapplyTombstones(ct: Container): Promise<{ principals: number; files: number }> {
  let principals = 0;
  let files = 0;
  const acct = new AccountService(ct);
  for (const t of await ct.c.tombstones.find({}).toArray()) {
    if (t.kind === 'principal') {
      const p = await ct.c.principals.findOne({ _id: t.ref }, { projection: { status: 1 } });
      if (p && p.status !== 'deleted') {
        await acct.anonymize(t.ref, 'system:restore', `tombstone:${t._id}`);
        principals++;
      }
    } else {
      const f = await ct.c.files.findOne({ _id: t.ref });
      if (f && !f.deletedAt) {
        await ct.adapters.storage.delete(f.storageKey, f.visibility).catch(() => undefined);
        await ct.c.files.updateOne({ _id: f._id }, { $set: { deletedAt: t.at, publicUrl: null } });
        files++;
      }
    }
  }
  return { principals, files };
}
