import { DomainError, prizeMachine, type Scope } from '@esp/contracts';
import type { Container } from '../container.js';
import type { PrizeDoc } from '../db/collections-esp03.js';
import { applyTransition } from '../domain/transition.js';
import { Ledger } from './ledger.js';

/**
 * Prize obligations (END-001/002, FIN-007/008, chapter 15 prize machine).
 * - A prize is defined at publication with an explicit responsible party (platform/organizer/sponsor).
 * - Release (`ready_to_pay`) requires a FINAL result reference (provided by ESP-05; contract-tested here against
 *   `result_versions` with `data.final === true`) and a closed/finished event.
 * - Payout needs an independent approval; "paid" needs provider reference or evidence. Re-payment is impossible
 *   because every step is a version-checked transition.
 */
const iso = () => new Date().toISOString();

export class PrizeService {
  private readonly ledger: Ledger;
  constructor(private readonly ct: Container) {
    this.ledger = new Ledger(ct.c);
  }
  private get c() {
    return this.ct.c;
  }
  private scope(eventId: string): Scope {
    return { type: 'event', id: eventId };
  }
  private async load(id: string): Promise<PrizeDoc> {
    const p = await this.c.prizes.findOne({ _id: id });
    if (!p) throw new DomainError('NOT_FOUND', 'prize not found');
    return p;
  }
  private async roles(actor: string, eventId: string) {
    const grants = await this.ct.acl.activeGrants(actor);
    const ctx = await this.ct.acl.resourceContext(this.scope(eventId));
    const chain = [ctx.scope, ...ctx.ancestors];
    return grants.filter((g) => chain.some((a) => a.type === g.scope.type && a.id === g.scope.id)).map((g) => g.role);
  }
  private async manager(actor: string, eventId: string, requestId: string) {
    if (!(await this.ct.acl.can(actor, 'finance.payout', this.scope(eventId)))) await this.ct.acl.require(actor, 'event.manage', this.scope(eventId), requestId);
  }

  /** Public view: amounts, responsibility and state; never payee details (END-002). */
  async publicList(eventId: string) {
    const rows = await this.c.prizes.find({ eventId }).sort({ createdAt: 1 }).toArray();
    return rows.map((p) => ({ id: p._id, prizeKey: p.prizeKey, title: p.title, kind: p.kind, amountRial: p.amountRial, responsible: p.responsible, state: p.state, guaranteed: false as const }));
  }

  async list(eventId: string, actor: string, requestId: string): Promise<PrizeDoc[]> {
    await this.manager(actor, eventId, requestId);
    return this.c.prizes.find({ eventId }).sort({ createdAt: 1 }).toArray();
  }

  /** FIN-007: the authorized recipient; changing an already verified recipient needs an independent approval. */
  async setRecipient(prizeId: string, input: { kind: 'team' | 'player'; ref: string; payeePrincipalId: string; shares: Array<{ principalId: string; percent: number }>; expectedVersion: number; approvalId: string | null }, actor: string, requestId: string): Promise<PrizeDoc> {
    const p = await this.load(prizeId);
    await this.manager(actor, p.eventId, requestId);
    if (input.shares.length && input.shares.reduce((a, s) => a + s.percent, 0) !== 100) throw new DomainError('VALIDATION_FAILED', 'shares must add up to 100%');
    if (input.kind === 'team') {
      // the payee must be the team owner or a manager at the time of the decision
      const m = await this.c.teamMemberships.findOne({ teamId: input.ref, principalId: input.payeePrincipalId, to: null, role: { $in: ['owner', 'manager'] } });
      if (!m) throw new DomainError('PRECONDITION_FAILED', 'the payee must be the owner or a manager of the winning team');
    } else if (input.payeePrincipalId !== input.ref) throw new DomainError('VALIDATION_FAILED', 'an individual prize is paid to the player');
    if (p.recipient && p.state !== 'defined') {
      if (!input.approvalId) throw new DomainError('PRECONDITION_FAILED', 'changing a verified prize recipient needs an independent approval', { secondApproval: true });
      await this.ct.approvals.consume(input.approvalId, 'finance.prize.recipient_change', this.scope(p.eventId), { principalId: actor, requestId });
    }
    const recipient = { kind: input.kind, ref: input.ref, payeePrincipalId: input.payeePrincipalId, shares: input.shares };
    const roles = await this.roles(actor, p.eventId);
    const doc = await this.ct.dbh.withTransaction(async (session) => {
      if (p.state === 'defined') return (await applyTransition(prizeMachine, this.c.prizes, p._id, { transition: 'verify_recipient', expectedVersion: input.expectedVersion, actorRoles: roles }, { recipient, history: [...p.history, { at: iso(), by: actor, transition: 'verify_recipient', note: null }] } as Partial<PrizeDoc>, session)).doc;
      const upd = await this.c.prizes.findOneAndUpdate({ _id: p._id, version: input.expectedVersion, state: { $in: ['recipient_verified', 'disputed'] } }, { $set: { recipient }, $push: { history: { at: iso(), by: actor, transition: 'recipient_change', note: input.approvalId } }, $inc: { version: 1 } }, { returnDocument: 'after', session });
      if (!upd) throw new DomainError('VERSION_CONFLICT', 'prize changed or is already being paid');
      return upd;
    });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'prize.recipient', target: { type: 'prize', id: p._id }, scope: this.scope(p.eventId), outcome: 'success', details: { recipient, approvalId: input.approvalId }, requestId });
    return doc;
  }

  /** END-004/006: release only from a final result of a finished/closed event. */
  async release(prizeId: string, resultRef: { matchOrStandingId: string; resultVersion: number; final: true }, expectedVersion: number, actor: string, requestId: string): Promise<PrizeDoc> {
    const p = await this.load(prizeId);
    await this.ct.acl.require(actor, 'finance.payout', this.scope(p.eventId), requestId); // finance releases; organizers cannot
    const e = await this.c.events.findOne({ _id: p.eventId });
    if (!e || !['finished', 'closed'].includes(e.state)) throw new DomainError('PRECONDITION_FAILED', 'prizes are released only after the event is finished');
    const final = await this.c.resultVersions.findOne({ targetId: resultRef.matchOrStandingId, version: resultRef.resultVersion, 'data.final': true });
    if (!final) throw new DomainError('PRECONDITION_FAILED', 'a final result version is required (ESP-05)');
    const roles = await this.roles(actor, p.eventId);
    const doc = await this.ct.dbh.withTransaction(async (session) => {
      const { doc } = await applyTransition(prizeMachine, this.c.prizes, p._id, { transition: 'mark_ready', expectedVersion, actorRoles: roles }, { resultRef, history: [...p.history, { at: iso(), by: actor, transition: 'mark_ready', note: `${resultRef.matchOrStandingId}@${resultRef.resultVersion}` }] } as Partial<PrizeDoc>, session);
      if (p.kind === 'cash' && p.amountRial > 0) await this.ledger.post({ lines: [{ account: `prize:expense:${p.responsible}`, amountRial: p.amountRial }, { account: `prize:payable:${p._id}`, amountRial: -p.amountRial }], kind: 'prize', refs: { prizeId: p._id, eventId: p.eventId }, reason: 'obligation recognised', createdBy: actor }, session);
      return doc;
    });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'prize.release', target: { type: 'prize', id: p._id }, scope: this.scope(p.eventId), outcome: 'success', details: { resultRef }, requestId });
    return doc;
  }

  async startPayout(prizeId: string, approvalId: string, expectedVersion: number, actor: string, requestId: string): Promise<PrizeDoc> {
    const p = await this.load(prizeId);
    await this.ct.acl.require(actor, 'finance.payout', this.scope(p.eventId), requestId);
    await this.ct.approvals.consume(approvalId, 'finance.payout', this.scope(p.eventId), { principalId: actor, requestId });
    const roles = await this.roles(actor, p.eventId);
    const doc = await this.ct.dbh.withTransaction(async (session) => (await applyTransition(prizeMachine, this.c.prizes, p._id, { transition: 'start_payout', expectedVersion, actorRoles: roles, approvalId }, { payout: { approvalId, providerRef: null, evidenceFileId: null, paidAt: null }, history: [...p.history, { at: iso(), by: actor, transition: 'start_payout', note: approvalId }] } as Partial<PrizeDoc>, session)).doc);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'prize.start_payout', target: { type: 'prize', id: p._id }, scope: this.scope(p.eventId), outcome: 'success', details: { approvalId }, requestId });
    return doc;
  }

  /** "Paid" is never recorded without a provider reference or evidence file (FIN-008). */
  async confirmPaid(prizeId: string, input: { evidenceFileId: string | null; providerRef: string | null; expectedVersion: number }, actor: string, requestId: string): Promise<PrizeDoc> {
    const p = await this.load(prizeId);
    await this.ct.acl.require(actor, 'finance.payout', this.scope(p.eventId), requestId);
    if (!input.evidenceFileId && !input.providerRef) throw new DomainError('PRECONDITION_FAILED', 'payment evidence or a provider reference is required');
    if (input.evidenceFileId) {
      const f = await this.c.files.findOne({ _id: input.evidenceFileId });
      if (!f || f.quarantined || f.visibility !== 'private') throw new DomainError('PRECONDITION_FAILED', 'evidence must be a clean private file');
    }
    const roles = await this.roles(actor, p.eventId);
    const doc = await this.ct.dbh.withTransaction(async (session) => {
      const { doc } = await applyTransition(prizeMachine, this.c.prizes, p._id, { transition: 'confirm_paid', expectedVersion: input.expectedVersion, actorRoles: roles }, { payout: { ...p.payout!, providerRef: input.providerRef, evidenceFileId: input.evidenceFileId, paidAt: iso() }, history: [...p.history, { at: iso(), by: actor, transition: 'confirm_paid', note: input.providerRef ?? input.evidenceFileId }] } as Partial<PrizeDoc>, session);
      if (p.kind === 'cash' && p.amountRial > 0) await this.ledger.post({ lines: [{ account: `prize:payable:${p._id}`, amountRial: p.amountRial }, { account: input.providerRef ? 'cash:payout' : 'cash:manual', amountRial: -p.amountRial }], kind: 'payout', refs: { prizeId: p._id, eventId: p.eventId }, reason: null, createdBy: actor }, session);
      return doc;
    });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'prize.paid', target: { type: 'prize', id: p._id }, scope: this.scope(p.eventId), outcome: 'success', details: { providerRef: input.providerRef, evidenceFileId: input.evidenceFileId }, requestId });
    return doc;
  }

  async dispute(prizeId: string, note: string, expectedVersion: number, actor: string, requestId: string): Promise<PrizeDoc> {
    const p = await this.load(prizeId);
    await this.manager(actor, p.eventId, requestId);
    const roles = await this.roles(actor, p.eventId);
    return this.ct.dbh.withTransaction(async (session) => (await applyTransition(prizeMachine, this.c.prizes, p._id, { transition: 'dispute', expectedVersion, actorRoles: roles }, { history: [...p.history, { at: iso(), by: actor, transition: 'dispute', note }] } as Partial<PrizeDoc>, session)).doc);
  }

  /** Event cancelled: open prize obligations are cancelled (system, under the event's cancellation approval). */
  async cancelForEvent(eventId: string): Promise<number> {
    const r = await this.c.prizes.updateMany({ eventId, state: { $in: ['defined', 'recipient_verified', 'ready_to_pay', 'disputed'] } }, { $set: { state: 'cancelled' }, $push: { history: { at: iso(), by: 'system', transition: 'cancel', note: 'event cancelled' } }, $inc: { version: 1 } });
    return r.modifiedCount;
  }

  /** FIN-008: obligations and settlement schedule. */
  async obligations(eventId: string, actor: string, requestId: string) {
    await this.manager(actor, eventId, requestId);
    const rows = await this.c.prizes.find({ eventId }).toArray();
    const by = (s: string) => rows.filter((p) => p.state === s).reduce((a, p) => a + p.amountRial, 0);
    return { totalRial: rows.reduce((a, p) => a + p.amountRial, 0), paidRial: by('paid'), payableRial: by('ready_to_pay') + by('paying'), disputedRial: by('disputed'), items: rows.map((p) => ({ id: p._id, title: p.title, state: p.state, amountRial: p.amountRial, responsible: p.responsible, paidAt: p.payout?.paidAt ?? null })) };
  }
}
