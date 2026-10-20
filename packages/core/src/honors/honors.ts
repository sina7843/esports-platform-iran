import { randomBytes } from 'node:crypto';
import { DomainError } from '@esp/contracts';
import type { Container } from '../container.js';
import type { CertificateDoc, DeclaredAchievementDoc, HonorDoc, SpecialAwardDoc } from '../db/collections-esp05.js';
import type { StandingRow } from '../competition/engine/index.js';
import { newId } from '../ids.js';

const iso = () => new Date().toISOString();
const code = () => randomBytes(6).toString('hex').toUpperCase(); // 48-bit public verification code
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
type Spec = Omit<HonorDoc, '_id' | 'state' | 'verifyCode' | 'correctionOf' | 'revokedReason' | 'issuedAt' | 'revokedAt'>;

/**
 * AWD-001..004, END-003..005: honors come only from final standings (or an approved special award). Issuing is
 * idempotent (one active honor per entitlement, unique index), so a replayed close or a retried consumer never
 * creates a second trophy. Individual honors go to the roster of that time, and only to members who meet the
 * presence condition; team honors carry the team identity and its name at the time, so a later rename, ownership
 * change or roster move never rewrites history.
 */
export class HonorService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }

  private clause<T>(snapshot: { clauses: Array<{ key: string; value: unknown }> } | null, key: string): T | undefined {
    return snapshot?.clauses.find((c) => c.key === key)?.value as T | undefined;
  }

  /** The honors the final results entitle (pure read). */
  async desired(eventId: string): Promise<Spec[]> {
    const ev = await this.c.events.findOne({ _id: eventId });
    if (!ev) throw new DomainError('NOT_FOUND', 'event not found');
    const out: Spec[] = [];
    for (const d of await this.c.disciplines.find({ eventId }).toArray()) {
      const stages = await this.c.stages.find({ disciplineId: d._id, state: { $ne: 'cancelled' } }).sort({ order: -1 }).toArray();
      const last = stages[0];
      if (!last) continue;
      const rv = await this.c.resultVersions.find({ targetType: 'standing', targetId: last._id, 'data.final': true }).sort({ version: -1 }).limit(1).next();
      if (!rv) continue; // no final standing → no honor (AWD-001)
      const medalPlaces = this.clause<number>(d.rulesSnapshot, 'honors.medal_places') ?? 3;
      const minMatches = this.clause<number>(d.rulesSnapshot, 'honors.presence_min_matches') ?? 1;
      const rows = ((rv.data['rows'] as StandingRow[]) ?? []).filter((r) => !r.metrics['withdrawn']);
      const matches = await this.c.matches.find({ eventId, disciplineId: d._id, state: 'final' }).toArray();
      for (const row of rows.filter((r) => r.rank <= medalPlaces)) {
        const p = await this.c.participations.findOne({ _id: row.id });
        if (!p) continue;
        const team = p.snapshot.teamId ? { teamId: p.snapshot.teamId, nameAtTime: p.snapshot.displayName } : null;
        const recipients = p.snapshot.roster.map((r) => {
          const played = matches.filter((m) => m.sides.some((s) => s.participationId === p._id && s.roster.some((x) => x.principalId === r.principalId && x.present))).length;
          const eligible = played >= minMatches;
          return { principalId: r.principalId, displayName: r.displayName, eligible, reason: eligible ? `present in ${played} match(es)` : `present in ${played} of the required ${minMatches} match(es)` };
        });
        const kind = row.rank === 1 ? ('trophy' as const) : ('medal' as const);
        const label = row.rank === 1 ? 'champion' : row.rank === 2 ? 'silver' : row.rank === 3 ? 'bronze' : `place_${row.rank}`;
        out.push({ kind, eventId, eventName: ev.name, disciplineId: d._id, stageId: last._id, place: row.rank, label, participationId: p._id, team, recipients, basis: { kind: 'standing', ref: last._id, version: rv.version } });
      }
    }
    return out;
  }

  private key(h: Pick<HonorDoc, 'disciplineId' | 'kind' | 'place' | 'participationId' | 'label'>) {
    return [h.disciplineId, h.kind, h.place, h.participationId, h.label].join('|');
  }

  private async insert(spec: Spec, correctionOf: string | null): Promise<HonorDoc | null> {
    const doc: HonorDoc = { ...spec, _id: newId('hon'), state: 'active', verifyCode: code(), correctionOf, revokedReason: null, issuedAt: iso(), revokedAt: null };
    try {
      await this.c.honors.insertOne(doc);
      return doc;
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return null; // already issued (replay / concurrent close)
      throw e;
    }
  }

  /** END-003: exactly-once issue at event close. */
  async issueForEvent(eventId: string, requestId: string): Promise<{ issued: number; existing: number }> {
    let issued = 0;
    let existing = 0;
    for (const spec of await this.desired(eventId)) {
      const doc = await this.insert(spec, null);
      if (!doc) {
        existing++;
        continue;
      }
      issued++;
      await this.ct.outbox.append({ type: 'honors.issued', aggregate: { type: 'honor', id: doc._id }, aggregateVersion: 0, actor: { principalId: 'system', kind: 'system' }, payload: { honorId: doc._id, eventId, kind: doc.kind, place: doc.place, label: doc.label, teamId: doc.team?.teamId ?? null, principals: doc.recipients.filter((r) => r.eligible).map((r) => r.principalId) }, correlationId: requestId });
    }
    await this.issueCertificates(eventId);
    return { issued, existing };
  }

  /** After a correction: revoke honors the corrected standings no longer support and issue the new ones (linked). */
  async reconcile(eventId: string, reason: string, actor: string, requestId: string): Promise<{ revoked: number; issued: number }> {
    const active = await this.c.honors.find({ eventId, state: 'active', 'basis.kind': 'standing' }).toArray();
    if (!active.length) return { revoked: 0, issued: 0 }; // honors not issued yet: the close will issue from the corrected result
    const want = await this.desired(eventId);
    const wantKeys = new Set(want.map((w) => this.key(w)));
    let revoked = 0;
    let issued = 0;
    const replaced = new Map<string, string>();
    for (const h of active) {
      if (wantKeys.has(this.key(h))) continue;
      await this.c.honors.updateOne({ _id: h._id, state: 'active' }, { $set: { state: 'revoked', revokedReason: reason, revokedAt: iso() } });
      await this.c.certificates.updateMany({ eventId, kind: 'placement', state: 'active', principalId: { $in: h.recipients.map((r) => r.principalId) } }, { $set: { state: 'corrected', reason } });
      replaced.set(`${h.disciplineId}|${h.place}`, h._id);
      revoked++;
      await this.ct.outbox.append({ type: 'honors.revoked', aggregate: { type: 'honor', id: h._id }, aggregateVersion: 1, actor: { principalId: actor, kind: 'user' }, payload: { honorId: h._id, eventId, reason, principals: h.recipients.map((r) => r.principalId) }, correlationId: requestId });
    }
    const have = new Set(active.filter((h) => wantKeys.has(this.key(h))).map((h) => this.key(h)));
    for (const w of want) {
      if (have.has(this.key(w))) continue;
      const doc = await this.insert(w, replaced.get(`${w.disciplineId}|${w.place}`) ?? null);
      if (doc) {
        issued++;
        await this.ct.outbox.append({ type: 'honors.issued', aggregate: { type: 'honor', id: doc._id }, aggregateVersion: 0, actor: { principalId: actor, kind: 'user' }, payload: { honorId: doc._id, eventId, kind: doc.kind, place: doc.place, label: doc.label, correctionOf: doc.correctionOf, principals: doc.recipients.filter((r) => r.eligible).map((r) => r.principalId) }, correlationId: requestId });
      }
    }
    await this.issueCertificates(eventId);
    return { revoked, issued };
  }

  async revoke(honorId: string, reason: string, actor: string, requestId: string): Promise<HonorDoc> {
    const h = await this.c.honors.findOne({ _id: honorId });
    if (!h) throw new DomainError('NOT_FOUND', 'honor not found');
    await this.ct.acl.require(actor, 'honor.revoke', { type: 'site', id: 'site' }, requestId);
    if (reason.trim().length < 10) throw new DomainError('VALIDATION_FAILED', 'a revocation needs a documented reason');
    const r = await this.c.honors.findOneAndUpdate({ _id: h._id, state: 'active' }, { $set: { state: 'revoked', revokedReason: reason, revokedAt: iso() } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('PRECONDITION_FAILED', 'already revoked');
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'honor.revoke', target: { type: 'honor', id: h._id }, scope: { type: 'event', id: h.eventId }, outcome: 'success', details: { reason }, requestId });
    await this.ct.outbox.append({ type: 'honors.revoked', aggregate: { type: 'honor', id: h._id }, aggregateVersion: 1, actor: { principalId: actor, kind: 'user' }, payload: { honorId: h._id, eventId: h.eventId, reason, principals: h.recipients.map((x) => x.principalId) }, correlationId: requestId });
    return r;
  }

  // ------------------------------------------------------------------ public read models
  publicHonor(h: HonorDoc) {
    return { id: h._id, kind: h.kind, label: h.label, place: h.place, eventId: h.eventId, eventName: h.eventName, disciplineId: h.disciplineId, team: h.team, recipients: h.recipients.filter((r) => r.eligible).map((r) => ({ principalId: r.principalId, displayName: r.displayName })), state: h.state, verifyCode: h.verifyCode, correctionOf: h.correctionOf, revokedReason: h.revokedReason, issuedAt: h.issuedAt, revokedAt: h.revokedAt };
  }
  async forPrincipal(principalId: string) {
    const hs = await this.c.honors.find({ recipients: { $elemMatch: { principalId, eligible: true } } }).sort({ issuedAt: -1 }).limit(200).toArray();
    const declared = await this.c.declaredAchievements.find({ 'owner.kind': 'principal', 'owner.ref': principalId, state: { $ne: 'rejected' } }).sort({ createdAt: -1 }).limit(100).toArray();
    return { verified: hs.map((h) => this.publicHonor(h)), declared: declared.map((d) => this.publicDeclared(d)) };
  }
  async forTeam(teamId: string) {
    const hs = await this.c.honors.find({ 'team.teamId': teamId }).sort({ issuedAt: -1 }).limit(200).toArray();
    const declared = await this.c.declaredAchievements.find({ 'owner.kind': 'team', 'owner.ref': teamId, state: { $ne: 'rejected' } }).sort({ createdAt: -1 }).limit(100).toArray();
    return { verified: hs.map((h) => this.publicHonor(h)), declared: declared.map((d) => this.publicDeclared(d)) };
  }
  async forEvent(eventId: string) {
    return (await this.c.honors.find({ eventId }).sort({ place: 1, issuedAt: 1 }).toArray()).map((h) => this.publicHonor(h));
  }
  /** AWD-004 public verification of an honor or a certificate by its code. */
  async verify(value: string) {
    const v = value.trim().toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(v)) throw new DomainError('VALIDATION_FAILED', 'invalid code');
    const h = await this.c.honors.findOne({ verifyCode: v });
    if (h) return { kind: 'honor' as const, valid: h.state === 'active', honor: this.publicHonor(h) };
    const cert = await this.c.certificates.findOne({ code: v });
    if (cert) return { kind: 'certificate' as const, valid: cert.state === 'active', certificate: this.publicCert(cert) };
    throw new DomainError('NOT_FOUND', 'no honor or certificate has this code');
  }
  /** AWD-003 share card: a self-contained SVG (no remote assets), RTL text, with the verification code. */
  async shareCard(honorId: string): Promise<string> {
    const h = await this.c.honors.findOne({ _id: honorId });
    if (!h) throw new DomainError('NOT_FOUND', 'honor not found');
    const title = { champion: 'قهرمان', silver: 'نایب‌قهرمان', bronze: 'مقام سوم' }[h.label] ?? `مقام ${h.place ?? ''}`;
    const who = h.team?.nameAtTime ?? h.recipients.filter((r) => r.eligible).map((r) => r.displayName).join('، ');
    const revoked = h.state === 'revoked' ? '<text x="600" y="330" text-anchor="middle" font-size="40" fill="#b91c1c">باطل‌شده</text>' : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" direction="rtl"><rect width="1200" height="630" fill="#0f172a"/><rect x="24" y="24" width="1152" height="582" rx="24" fill="none" stroke="${h.label === 'champion' ? '#eab308' : h.label === 'silver' ? '#94a3b8' : '#b45309'}" stroke-width="6"/><text x="600" y="170" text-anchor="middle" font-size="72" font-weight="700" fill="#f8fafc">${esc(title)}</text><text x="600" y="270" text-anchor="middle" font-size="48" fill="#e2e8f0">${esc(who)}</text>${revoked}<text x="600" y="400" text-anchor="middle" font-size="36" fill="#cbd5e1">${esc(h.eventName)}</text><text x="600" y="540" text-anchor="middle" font-size="26" fill="#94a3b8">کد تأیید: ${h.verifyCode}</text></svg>`;
  }

  // ------------------------------------------------------------------ certificates (END-004)
  publicCert(c: CertificateDoc) {
    return { id: c._id, kind: c.kind, displayName: c.displayName, eventId: c.eventId, eventName: c.eventName, place: c.place, code: c.code, state: c.state, correctedBy: c.correctedBy, reason: c.reason, issuedAt: c.issuedAt };
  }
  /** Attendance for everyone present in a final match; placement for eligible honor recipients. Idempotent. */
  async issueCertificates(eventId: string): Promise<number> {
    const ev = await this.c.events.findOne({ _id: eventId });
    if (!ev) return 0;
    let n = 0;
    const put = async (kind: CertificateDoc['kind'], principalId: string, displayName: string, place: number | null) => {
      try {
        await this.c.certificates.insertOne({ _id: newId('crt'), kind, principalId, displayName, eventId, eventName: ev.name, place, code: code(), state: 'active', correctedBy: null, reason: null, issuedAt: iso() });
        n++;
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
      }
    };
    const present = new Map<string, string>();
    for (const m of await this.c.matches.find({ eventId, state: 'final' }).toArray()) for (const s of m.sides) for (const r of s.roster) if (r.present) present.set(r.principalId, r.displayName);
    for (const [pid, name] of present) await put('attendance', pid, name, null);
    for (const h of await this.c.honors.find({ eventId, state: 'active', 'basis.kind': 'standing' }).toArray()) for (const r of h.recipients.filter((x) => x.eligible)) await put('placement', r.principalId, r.displayName, h.place);
    return n;
  }
  async myCertificates(principalId: string) {
    return (await this.c.certificates.find({ principalId }).sort({ issuedAt: -1 }).limit(200).toArray()).map((c) => this.publicCert(c));
  }
  async revokeCertificate(id: string, reason: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'honor.revoke', { type: 'site', id: 'site' }, requestId);
    const r = await this.c.certificates.findOneAndUpdate({ _id: id, state: 'active' }, { $set: { state: 'revoked', reason } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('PRECONDITION_FAILED', 'certificate is not active');
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'certificate.revoke', target: { type: 'certificate', id }, scope: { type: 'event', id: r.eventId }, outcome: 'success', details: { reason }, requestId });
    return this.publicCert(r);
  }
  /** A corrected certificate keeps the old one (state corrected → pointer to the new one). */
  async correctCertificate(id: string, input: { displayName: string; place: number | null; reason: string }, actor: string, requestId: string) {
    const old = await this.c.certificates.findOne({ _id: id, state: 'active' });
    if (!old) throw new DomainError('PRECONDITION_FAILED', 'certificate is not active');
    await this.ct.acl.require(actor, 'honor.manage', { type: 'event', id: old.eventId }, requestId);
    const fresh: CertificateDoc = { ...old, _id: newId('crt'), displayName: input.displayName, place: input.place, code: code(), state: 'active', correctedBy: null, reason: null, issuedAt: iso() };
    await this.ct.dbh.withTransaction(async (session) => {
      await this.c.certificates.updateOne({ _id: old._id, state: 'active' }, { $set: { state: 'corrected', correctedBy: fresh._id, reason: input.reason } }, { session });
      await this.c.certificates.insertOne(fresh, { session });
      await this.ct.audit.append({ actorPrincipalId: actor, action: 'certificate.correct', target: { type: 'certificate', id: old._id }, scope: { type: 'event', id: old.eventId }, outcome: 'success', details: { newId: fresh._id, reason: input.reason }, requestId }, session);
    });
    return this.publicCert(fresh);
  }

  // ------------------------------------------------------------------ special awards / MVP (END-005)
  async proposeSpecial(input: { eventId: string; title: string; method: SpecialAwardDoc['method']; approverRole: SpecialAwardDoc['approverRole']; participationId: string; principalId: string | null; justification: string }, actor: string, requestId: string): Promise<SpecialAwardDoc> {
    await this.ct.acl.require(actor, 'honor.manage', { type: 'event', id: input.eventId }, requestId);
    const p = await this.c.participations.findOne({ _id: input.participationId, eventId: input.eventId });
    if (!p) throw new DomainError('VALIDATION_FAILED', 'nominee is not a participant of this event');
    if (input.principalId && !p.snapshot.roster.some((r) => r.principalId === input.principalId)) throw new DomainError('VALIDATION_FAILED', "the person is not on the nominee's roster");
    if (input.justification.trim().length < 10) throw new DomainError('VALIDATION_FAILED', 'explain the method and the basis');
    const doc: SpecialAwardDoc = { _id: newId('spa'), eventId: input.eventId, title: input.title.trim(), method: input.method, approverRole: input.approverRole, nominee: { participationId: p._id, principalId: input.principalId }, justification: input.justification, proposedBy: actor, state: 'proposed', decidedBy: null, honorId: null, createdAt: iso() };
    await this.c.specialAwards.insertOne(doc);
    return doc;
  }
  async decideSpecial(id: string, approve: boolean, actor: string, requestId: string): Promise<SpecialAwardDoc> {
    const a = await this.c.specialAwards.findOne({ _id: id });
    if (!a) throw new DomainError('NOT_FOUND', 'award not found');
    if (a.state !== 'proposed') throw new DomainError('PRECONDITION_FAILED', `award is ${a.state}`);
    if (a.proposedBy === actor) throw new DomainError('SEPARATION_OF_DUTIES', 'the proposer cannot approve the award');
    const grants = await this.ct.acl.activeGrants(actor);
    const ctx = await this.ct.acl.resourceContext({ type: 'event', id: a.eventId });
    const chain = [ctx.scope, ...ctx.ancestors];
    if (!grants.some((g) => g.role === a.approverRole && chain.some((s) => s.type === g.scope.type && s.id === g.scope.id))) throw new DomainError('FORBIDDEN', `only the event's ${a.approverRole} approves this award`);
    let honorId: string | null = null;
    if (approve) {
      const ev = (await this.c.events.findOne({ _id: a.eventId }))!;
      const p = (await this.c.participations.findOne({ _id: a.nominee.participationId }))!;
      const recips = p.snapshot.roster.filter((r) => !a.nominee.principalId || r.principalId === a.nominee.principalId).map((r) => ({ principalId: r.principalId, displayName: r.displayName, eligible: true, reason: `${a.method} approved by ${a.approverRole}` }));
      const doc = await this.insert({ kind: a.title.toLowerCase() === 'mvp' ? 'mvp' : 'special', eventId: a.eventId, eventName: ev.name, disciplineId: p.disciplineId, stageId: null, place: null, label: a.title, participationId: p._id, team: a.nominee.principalId ? null : p.snapshot.teamId ? { teamId: p.snapshot.teamId, nameAtTime: p.snapshot.displayName } : null, recipients: recips, basis: { kind: 'special_award', ref: a._id, version: 1 } }, null);
      honorId = doc?._id ?? null;
    }
    const r = (await this.c.specialAwards.findOneAndUpdate({ _id: a._id, state: 'proposed' }, { $set: { state: approve ? 'approved' : 'rejected', decidedBy: actor, honorId } }, { returnDocument: 'after' }))!;
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'honor.special.decide', target: { type: 'special_award', id: a._id }, scope: { type: 'event', id: a.eventId }, outcome: 'success', details: { approve }, requestId });
    return r;
  }
  async specials(eventId: string) {
    return this.c.specialAwards.find({ eventId }).sort({ createdAt: -1 }).toArray();
  }

  // ------------------------------------------------------------------ declared achievements (AWD-004: shown apart)
  publicDeclared(d: DeclaredAchievementDoc) {
    return { id: d._id, title: d.title, eventName: d.eventName, year: d.year, state: d.state, note: d.state === 'rejected' ? d.note : null, label: d.state === 'verified' ? 'declared_verified' : 'declared_unverified' };
  }
  async declare(input: { owner: DeclaredAchievementDoc['owner']; title: string; eventName: string; year: number | null; evidenceFileIds: string[] }, actor: string, requestId: string): Promise<DeclaredAchievementDoc> {
    if (input.owner.kind === 'principal' && input.owner.ref !== actor) throw new DomainError('FORBIDDEN', 'you declare achievements only for yourself');
    if (input.owner.kind === 'team') await this.ct.acl.require(actor, 'team.manage', { type: 'team', id: input.owner.ref }, requestId);
    if (input.title.trim().length < 3 || input.eventName.trim().length < 3) throw new DomainError('VALIDATION_FAILED', 'title and event are required');
    for (const f of input.evidenceFileIds) {
      const file = await this.c.files.findOne({ _id: f });
      if (!file || file.ownerPrincipalId !== actor || file.quarantined) throw new DomainError('VALIDATION_FAILED', 'evidence must be your own clean files');
    }
    const doc: DeclaredAchievementDoc = { _id: newId('dac'), owner: input.owner, title: input.title.trim(), eventName: input.eventName.trim(), year: input.year, evidenceFileIds: input.evidenceFileIds, state: 'pending', reviewer: null, note: null, createdAt: iso() };
    await this.c.declaredAchievements.insertOne(doc);
    return doc;
  }
  async reviewDeclared(id: string, decision: 'verified' | 'rejected', note: string | null, actor: string, requestId: string): Promise<DeclaredAchievementDoc> {
    await this.ct.acl.require(actor, 'account.review', { type: 'site', id: 'site' }, requestId);
    const d = await this.c.declaredAchievements.findOne({ _id: id });
    if (!d) throw new DomainError('NOT_FOUND', 'not found');
    if (d.owner.ref === actor) throw new DomainError('SEPARATION_OF_DUTIES', 'you cannot review your own claim');
    const r = await this.c.declaredAchievements.findOneAndUpdate({ _id: id, state: 'pending' }, { $set: { state: decision, reviewer: actor, note } }, { returnDocument: 'after' });
    if (!r) throw new DomainError('PRECONDITION_FAILED', 'already reviewed');
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'honor.declared.review', target: { type: 'declared_achievement', id }, scope: { type: 'site', id: 'site' }, outcome: 'success', details: { decision }, requestId });
    return r;
  }
  async declaredQueue(actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'account.review', { type: 'site', id: 'site' }, requestId);
    return this.c.declaredAchievements.find({ state: 'pending' }).sort({ createdAt: 1 }).limit(200).toArray();
  }
}
