import type { ClientSession } from 'mongodb';
import { DomainError, type OrganizerProfileUpdateSchema, type OrganizerResubmitSchema, type Scope } from '@esp/contracts';
import type { z } from 'zod';
import type { Container } from '../container.js';
import type { EventDoc } from '../db/collections.js';
import type { OrganizerApplicationDoc, OrganizerProfileDoc, OrganizerRatingDoc } from '../db/collections-esp02.js';
import { newId } from '../ids.js';
import { BadgeService } from '../profiles/badges.js';

/** ADM-002/003/004/010: organizer applications, verified profiles with limits, public page and participant ratings. */

const SITE: Scope = { type: 'site', id: 'site' };
const orgScope = (id: string): Scope => ({ type: 'organization', id });
const now = () => new Date().toISOString();
const RATEABLE: EventDoc['state'][] = ['finished', 'closed', 'archived'];
const UPCOMING: EventDoc['state'][] = ['published', 'registration_open', 'registration_closed', 'preparing', 'active', 'paused'];

/** Shown verbatim on every public organizer page (EVT-008: three different claims, none implied by the badge). */
export const VERIFICATION_DISCLAIMER_FA =
  'نشان تأیید فقط به معنای بررسی هویت و سوابق برگزارکننده توسط پلتفرم است. این نشان ضمانت مالی یا تضمین پرداخت جوایز نیست و به معنای وابستگی رسمی به ناشر بازی یا فدراسیون نیست.';
export const VERIFICATION_DISCLAIMER_EN = 'The verification badge is NOT a financial or prize guarantee and does NOT imply official affiliation with a game publisher or federation.';

type Limits = OrganizerProfileDoc['limits'];

export class OrganizerService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }

  private async au(s: ClientSession, actor: string, action: string, target: { type: string; id: string }, scope: Scope, details: Record<string, unknown>, rid: string) {
    await this.ct.audit.append({ actorPrincipalId: actor, action, target, scope, outcome: 'success', details, requestId: rid }, s);
  }
  private async ev(s: ClientSession, type: string, aggregate: { type: string; id: string }, version: number, actor: string, payload: Record<string, unknown>, rid: string) {
    await this.ct.outbox.append({ type, aggregate, aggregateVersion: version, actor: { principalId: actor, kind: 'user' }, payload, correlationId: rid }, s);
  }
  private async fileUrl(fileId: string | null): Promise<string | null> {
    if (!fileId) return null;
    const f = await this.ct.files.get(fileId);
    return f && f.visibility === 'public' && !f.quarantined ? f.publicUrl : null;
  }

  // ---------------------------------------------------------------- applications (ADM-002)
  applicationView(a: OrganizerApplicationDoc) {
    return { id: a._id, principalId: a.principalId, organizationId: a.organizationId, description: a.description, experience: a.experience, contactPhone: a.contactPhone, documentFileIds: a.documentFileIds, state: a.state, history: a.history, createdAt: a.createdAt, version: a.version };
  }

  /** Documents must be the applicant's own, private, non-quarantined files. */
  private async assertOwnDocuments(me: string, ids: string[]): Promise<void> {
    for (const id of new Set(ids)) {
      const f = await this.ct.files.get(id);
      if (!f || f.ownerPrincipalId !== me || f.visibility !== 'private' || f.quarantined) throw new DomainError('VALIDATION_FAILED', 'documents must be your own private, non-quarantined uploads', { fileId: id });
    }
  }

  async submit(me: string, input: { organizationId: string; description: string; experience: string | null; contactPhone: string | null; documentFileIds: string[] }, rid: string): Promise<OrganizerApplicationDoc> {
    const org = await this.c.organizations.findOne({ _id: input.organizationId });
    if (!org) throw new DomainError('NOT_FOUND', 'organization not found');
    if (org.ownerPrincipalId !== me && !(await this.ct.acl.can(me, 'organization.manage', orgScope(org._id)))) {
      await this.ct.acl.require(me, 'organization.manage', orgScope(org._id), rid); // audits the denial, throws FORBIDDEN
    }
    await this.assertOwnDocuments(me, input.documentFileIds);
    const t = now();
    const doc: OrganizerApplicationDoc = { _id: newId('oap'), principalId: me, organizationId: org._id, description: input.description, experience: input.experience, contactPhone: input.contactPhone, documentFileIds: input.documentFileIds, state: 'submitted', history: [{ state: 'submitted', by: me, at: t, note: 'submitted' }], createdAt: t, version: 0 };
    await this.ct.dbh.withTransaction(async (s) => {
      // ponytail: check-then-insert (no partial unique index available); the transaction narrows but does not close the race
      if (await this.c.organizerApplications.findOne({ organizationId: org._id, state: { $in: ['submitted', 'needs_info', 'under_review'] } }, { session: s, projection: { _id: 1 } })) throw new DomainError('CONFLICT', 'an open application already exists for this organization');
      await this.c.organizerApplications.insertOne(doc, { session: s });
      await this.au(s, me, 'organizer.application.submit', { type: 'organizer_application', id: doc._id }, orgScope(org._id), {}, rid);
      await this.ev(s, 'organizer.application.submitted', { type: 'organizer_application', id: doc._id }, 0, me, { organizationId: org._id }, rid);
    });
    return doc;
  }

  async resubmit(me: string, appId: string, input: z.infer<typeof OrganizerResubmitSchema>, rid: string) {
    const a = await this.c.organizerApplications.findOne({ _id: appId });
    if (!a || a.principalId !== me) throw new DomainError('NOT_FOUND', 'application not found');
    if (a.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'application was modified', { currentVersion: a.version });
    if (a.state !== 'needs_info') throw new DomainError('CONFLICT', `application is ${a.state}; only needs_info can be resubmitted`);
    if (input.documentFileIds) await this.assertOwnDocuments(me, input.documentFileIds);
    const t = now();
    const set: Record<string, unknown> = { state: 'submitted' };
    for (const k of ['description', 'experience', 'contactPhone', 'documentFileIds'] as const) if (input[k] !== undefined) set[k] = input[k];
    return this.ct.dbh.withTransaction(async (s) => {
      const r = await this.c.organizerApplications.findOneAndUpdate({ _id: appId, version: input.expectedVersion, state: 'needs_info' }, { $set: set, $push: { history: { state: 'submitted', by: me, at: t, note: input.note } }, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
      if (!r) throw new DomainError('VERSION_CONFLICT', 'application was modified');
      await this.au(s, me, 'organizer.application.resubmit', { type: 'organizer_application', id: appId }, orgScope(a.organizationId), {}, rid);
      await this.ev(s, 'organizer.application.resubmitted', { type: 'organizer_application', id: appId }, r.version, me, { organizationId: a.organizationId }, rid);
      return r;
    });
  }

  myApplications(me: string) {
    return this.c.organizerApplications.find({ principalId: me }).sort({ createdAt: -1 }).limit(50).toArray();
  }

  async queue(me: string, state: OrganizerApplicationDoc['state'] | undefined, rid: string) {
    await this.ct.acl.require(me, 'organizer.review', SITE, rid);
    return this.c.organizerApplications.find(state ? { state } : { state: { $in: ['submitted', 'needs_info', 'under_review'] } }).sort({ createdAt: 1 }).limit(200).toArray();
  }

  async review(me: string, appId: string, input: { action: 'request_info' | 'start_review' | 'approve' | 'reject'; note: string; level?: OrganizerProfileDoc['level'] | undefined; limits?: Limits | undefined; expectedVersion: number }, rid: string) {
    await this.ct.acl.require(me, 'organizer.review', SITE, rid);
    const a = await this.c.organizerApplications.findOne({ _id: appId });
    if (!a) throw new DomainError('NOT_FOUND', 'application not found');
    if (a.principalId === me) throw new DomainError('SEPARATION_OF_DUTIES', 'the reviewer cannot be the applicant');
    if (a.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'application was modified', { currentVersion: a.version });
    const allowed: Record<typeof input.action, OrganizerApplicationDoc['state'][]> = { request_info: ['submitted', 'under_review'], start_review: ['submitted'], approve: ['under_review'], reject: ['submitted', 'under_review'] };
    if (!allowed[input.action].includes(a.state)) throw new DomainError('CONFLICT', `cannot ${input.action} an application that is ${a.state}`);
    if (input.action === 'approve' && (!input.level || !input.limits)) throw new DomainError('VALIDATION_FAILED', 'approval requires level and limits');
    const org = await this.c.organizations.findOne({ _id: a.organizationId });
    if (!org) throw new DomainError('NOT_FOUND', 'organization not found');
    const next = { request_info: 'needs_info', start_review: 'under_review', approve: 'approved', reject: 'rejected' }[input.action] as OrganizerApplicationDoc['state'];
    const t = now();
    const out = await this.ct.dbh.withTransaction(async (s) => {
      const r = await this.c.organizerApplications.findOneAndUpdate({ _id: appId, version: input.expectedVersion }, { $set: { state: next }, $push: { history: { state: next, by: me, at: t, note: input.note } }, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
      if (!r) throw new DomainError('VERSION_CONFLICT', 'application was modified');
      if (input.action === 'approve') {
        const limits = input.limits!;
        const set = { verified: { state: 'verified' as const, issuer: me, at: t, expiresAt: null, note: input.note }, level: input.level!, limits, prizeGuarantee: false as const, updatedAt: t };
        const existing = await this.c.organizerProfiles.findOne({ _id: org._id }, { session: s, projection: { _id: 1 } });
        if (existing) await this.c.organizerProfiles.updateOne({ _id: org._id }, { $set: set, $inc: { version: 1 } }, { session: s });
        else await this.c.organizerProfiles.insertOne({ _id: org._id, ...set, intro: org.description, staff: [], venue: null, venueAddressText: null, facilities: [], links: [], sponsors: [], createdAt: t, version: 0 }, { session: s });
        const hasGrant = await this.c.grants.findOne({ principalId: org.ownerPrincipalId, role: 'organizer', 'scope.type': 'organization', 'scope.id': org._id, revokedAt: null }, { session: s, projection: { _id: 1 } });
        if (!hasGrant) await this.ct.acl.grant({ principalId: org.ownerPrincipalId, role: 'organizer', scope: orgScope(org._id), expiresAt: null, reason: `organizer application ${appId} approved` }, { principalId: me, requestId: rid }, s);
        await this.au(s, me, 'organizer.application.approve', { type: 'organizer_application', id: appId }, orgScope(org._id), { level: input.level, limits, owner: org.ownerPrincipalId }, rid);
        await this.ev(s, 'organizer.application.approved', { type: 'organizer_application', id: appId }, r.version, me, { organizationId: org._id, level: input.level, limits }, rid);
      } else {
        await this.au(s, me, `organizer.application.${input.action}`, { type: 'organizer_application', id: appId }, orgScope(org._id), { note: input.note }, rid);
        await this.ev(s, `organizer.application.${next}`, { type: 'organizer_application', id: appId }, r.version, me, { organizationId: org._id }, rid);
      }
      return r;
    });
    if (input.action === 'approve') {
      const has = await this.c.badges.findOne({ principalId: org.ownerPrincipalId, kind: 'org_position', 'ref.organizationId': org._id, revokedAt: null }, { projection: { _id: 1 } });
      if (!has) {
        try {
          await new BadgeService(this.ct).issue({ kind: 'org_position', principalId: org.ownerPrincipalId, organizationId: org._id, position: 'organizer', expiresAt: null }, me, rid);
        } catch (e) {
          if (!(e instanceof DomainError && e.code === 'NOT_FOUND')) throw e; // owner without profile: no badge, approval stands
        }
      }
    }
    return out;
  }

  /** Revoke/suspend verification: organizer grants in the organization scope are revoked immediately. */
  async revokeVerification(me: string, orgId: string, reason: string, rid: string) {
    await this.ct.acl.require(me, 'organizer.review', SITE, rid);
    if (reason.trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'reason is required');
    const p = await this.c.organizerProfiles.findOne({ _id: orgId });
    if (!p) throw new DomainError('NOT_FOUND', 'organizer profile not found');
    if (p.verified.state !== 'verified') throw new DomainError('CONFLICT', `verification is already ${p.verified.state}`);
    const t = now();
    await this.ct.dbh.withTransaction(async (s) => {
      await this.c.organizerProfiles.updateOne({ _id: orgId }, { $set: { 'verified.state': 'revoked', 'verified.note': reason, updatedAt: t }, $inc: { version: 1 } }, { session: s });
      const grants = await this.c.grants.find({ role: 'organizer', 'scope.type': 'organization', 'scope.id': orgId, revokedAt: null }, { session: s }).toArray();
      for (const g of grants) await this.ct.acl.revoke(g._id, { principalId: me, requestId: rid }, `organizer verification revoked: ${reason}`, s);
      await this.au(s, me, 'organizer.verification.revoke', { type: 'organizer_profile', id: orgId }, orgScope(orgId), { reason, revokedGrants: grants.length }, rid);
      await this.ev(s, 'organizer.verification.revoked', { type: 'organizer_profile', id: orgId }, p.version + 1, me, { organizationId: orgId, reason }, rid);
    });
    const badges = new BadgeService(this.ct);
    for (const b of await this.c.badges.find({ kind: 'org_position', 'ref.organizationId': orgId, revokedAt: null }).toArray()) await badges.revoke(b._id, `organizer verification revoked: ${reason}`, me, rid);
    return this.c.organizerProfiles.findOne({ _id: orgId });
  }

  // ---------------------------------------------------------------- limits (ADM-004)
  /** ESP-03 calls this before publishing an event: no approved profile or exceeded limits means PRECONDITION_FAILED. */
  async assertCanPublishEvent(orgId: string, input: { capacity: number; paid: boolean; activeEventsCount: number }): Promise<OrganizerProfileDoc> {
    const p = await this.c.organizerProfiles.findOne({ _id: orgId });
    if (!p || p.verified.state !== 'verified') throw new DomainError('PRECONDITION_FAILED', 'organizer is not approved; events cannot be published', { reason: 'organizer_not_approved', verification: p?.verified.state ?? 'none' });
    const v: string[] = [];
    if (input.activeEventsCount >= p.limits.maxActiveEvents) v.push('maxActiveEvents');
    if (input.capacity > p.limits.maxCapacityPerEvent) v.push('maxCapacityPerEvent');
    if (input.paid && !p.limits.paidEventsAllowed) v.push('paidEventsAllowed');
    if (v.length) throw new DomainError('PRECONDITION_FAILED', 'organizer limits exceeded', { reason: 'limits_exceeded', violations: v, limits: p.limits, requested: input });
    return p;
  }

  // ---------------------------------------------------------------- profile + public pages (ADM-003)
  async updateProfile(me: string, orgId: string, input: z.infer<typeof OrganizerProfileUpdateSchema>, rid: string) {
    await this.ct.acl.require(me, 'organizer.profile.manage', orgScope(orgId), rid);
    const p = await this.c.organizerProfiles.findOne({ _id: orgId });
    if (!p) throw new DomainError('NOT_FOUND', 'organizer profile not found');
    if (p.verified.state !== 'verified') throw new DomainError('PRECONDITION_FAILED', 'organizer is not verified');
    if (p.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'profile was modified', { currentVersion: p.version });
    const { expectedVersion, ...rest } = input;
    const set: Record<string, unknown> = { updatedAt: now() };
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) set[k] = v;
    return this.ct.dbh.withTransaction(async (s) => {
      const r = await this.c.organizerProfiles.findOneAndUpdate({ _id: orgId, version: expectedVersion }, { $set: set, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
      if (!r) throw new DomainError('VERSION_CONFLICT', 'profile was modified');
      await this.au(s, me, 'organizer.profile.update', { type: 'organizer_profile', id: orgId }, orgScope(orgId), { fields: Object.keys(rest) }, rid);
      await this.ev(s, 'organizer.profile.updated', { type: 'organizer_profile', id: orgId }, r.version, me, { fields: Object.keys(rest) }, rid);
      return r;
    });
  }

  /** Editor view (includes version and limits). */
  async profileForEdit(me: string, orgId: string, rid: string) {
    await this.ct.acl.require(me, 'organizer.profile.manage', orgScope(orgId), rid);
    const p = await this.c.organizerProfiles.findOne({ _id: orgId });
    if (!p) throw new DomainError('NOT_FOUND', 'organizer profile not found');
    return p;
  }

  async ratingSummary(orgId: string) {
    const rows = await this.c.organizerRatings.aggregate<{ _id: number; n: number }>([{ $match: { organizationId: orgId, state: 'visible' } }, { $group: { _id: '$score', n: { $sum: 1 } } }]).toArray();
    const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    let count = 0;
    let sum = 0;
    for (const r of rows) {
      distribution[String(r._id)] = r.n;
      count += r.n;
      sum += r._id * r.n;
    }
    return { count, average: count ? Math.round((sum / count) * 100) / 100 : null, distribution };
  }

  async publicPage(slug: string) {
    const org = await this.c.organizations.findOne({ slug });
    const p = org && (await this.c.organizerProfiles.findOne({ _id: org._id }));
    if (!org || !p) throw new DomainError('NOT_FOUND', 'organizer not found');
    const events = await this.c.events.find({ organizerOrgId: org._id, visibility: 'public', state: { $in: [...UPCOMING, ...RATEABLE] } }).sort({ startsAt: -1 }).limit(100).toArray();
    const ev = (e: EventDoc) => ({ id: e._id, slug: e.slug, name: e.name, state: e.state, startsAt: e.startsAt, endsAt: e.endsAt });
    const recent = await this.c.organizerRatings.find({ organizationId: org._id, state: 'visible' }).sort({ createdAt: -1 }).limit(10).toArray();
    const verified = p.verified.state === 'verified';
    return {
      id: org._id,
      slug: org.slug,
      name: org.name,
      city: org.city,
      logoUrl: await this.fileUrl(org.logoFileId),
      intro: p.intro,
      staff: p.staff.map((x) => ({ name: x.name, role: x.role })),
      venue: p.venue,
      venueAddressText: p.venueAddressText,
      facilities: p.facilities,
      links: p.links,
      sponsors: await Promise.all(p.sponsors.map(async (x) => ({ name: x.name, url: x.url, logoUrl: await this.fileUrl(x.logoFileId) }))),
      verification: { verified, level: verified ? p.level : null, issuedAt: verified ? p.verified.at : null, prizeGuarantee: false as const, disclaimerFa: VERIFICATION_DISCLAIMER_FA, disclaimerEn: VERIFICATION_DISCLAIMER_EN },
      ratingSummary: await this.ratingSummary(org._id),
      recentRatings: recent.map((r) => ({ score: r.score, comment: r.comment, createdAt: r.createdAt })),
      upcomingEvents: events.filter((e) => UPCOMING.includes(e.state)).map(ev),
      pastEvents: events.filter((e) => RATEABLE.includes(e.state)).map(ev),
    };
  }

  async publicList(q: { city?: string | undefined; level?: OrganizerProfileDoc['level'] | undefined; limit: number }) {
    const profiles = await this.c.organizerProfiles.find({ 'verified.state': 'verified', ...(q.level ? { level: q.level } : {}) }).limit(500).toArray();
    const orgs = await this.c.organizations.find({ _id: { $in: profiles.map((p) => p._id) }, ...(q.city ? { city: q.city } : {}) }).sort({ name: 1 }).limit(q.limit).toArray();
    return Promise.all(orgs.map(async (o) => ({ id: o._id, slug: o.slug, name: o.name, city: o.city, level: profiles.find((p) => p._id === o._id)!.level, logoUrl: await this.fileUrl(o.logoFileId), ratingSummary: await this.ratingSummary(o._id) })));
  }

  // ---------------------------------------------------------------- ratings (ADM-010)
  ratingView(r: OrganizerRatingDoc) {
    return { id: r._id, organizationId: r.organizationId, eventId: r.eventId, score: r.score, comment: r.comment, state: r.state, moderation: r.moderation, createdAt: r.createdAt, version: r.version };
  }

  async rate(me: string, orgId: string, input: { eventId: string; score: number; comment: string | null }, rid: string) {
    const [org, event] = await Promise.all([this.c.organizations.findOne({ _id: orgId }), this.c.events.findOne({ _id: input.eventId })]);
    if (!org || !event || event.organizerOrgId !== orgId) throw new DomainError('NOT_FOUND', 'event not found for this organizer');
    if (org.ownerPrincipalId === me) throw new DomainError('FORBIDDEN', 'organizers cannot rate themselves');
    if (!RATEABLE.includes(event.state)) throw new DomainError('PRECONDITION_FAILED', 'ratings open only after the event has finished', { state: event.state });
    const part = await this.c.participations.findOne({ eventId: event._id, registrationState: 'confirmed', 'snapshot.roster.principalId': me }, { projection: { _id: 1 } });
    if (!part) throw new DomainError('FORBIDDEN', 'only confirmed participants of this event can rate the organizer');
    const doc: OrganizerRatingDoc = { _id: newId('orr'), organizationId: orgId, eventId: event._id, principalId: me, score: input.score, comment: input.comment, state: 'visible', moderation: null, createdAt: now(), version: 0 };
    try {
      await this.ct.dbh.withTransaction(async (s) => {
        await this.c.organizerRatings.insertOne(doc, { session: s });
        await this.au(s, me, 'organizer.rating.create', { type: 'organizer_rating', id: doc._id }, orgScope(orgId), { eventId: event._id, score: input.score }, rid);
        await this.ev(s, 'organizer.rating.created', { type: 'organizer_rating', id: doc._id }, 0, me, { organizationId: orgId, eventId: event._id, score: input.score }, rid);
      });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new DomainError('CONFLICT', 'you have already rated this organizer for this event');
      throw e;
    }
    return doc;
  }

  async moderate(me: string, ratingId: string, action: 'hide' | 'unhide', reason: string, rid: string) {
    await this.ct.acl.require(me, 'rating.moderate', SITE, rid);
    if (reason.trim().length < 5) throw new DomainError('VALIDATION_FAILED', 'a reason of at least 5 characters is required');
    const r = await this.c.organizerRatings.findOne({ _id: ratingId });
    if (!r) throw new DomainError('NOT_FOUND', 'rating not found');
    const to = action === 'hide' ? 'hidden' : 'visible';
    if (r.state === to) throw new DomainError('CONFLICT', `rating is already ${r.state}`);
    return this.ct.dbh.withTransaction(async (s) => {
      const u = await this.c.organizerRatings.findOneAndUpdate({ _id: ratingId, version: r.version }, { $set: { state: to, moderation: { by: me, at: now(), reason } }, $inc: { version: 1 } }, { session: s, returnDocument: 'after' });
      if (!u) throw new DomainError('VERSION_CONFLICT', 'rating was modified');
      await this.au(s, me, `organizer.rating.${action}`, { type: 'organizer_rating', id: ratingId }, orgScope(r.organizationId), { reason, score: r.score }, rid);
      await this.ev(s, `organizer.rating.${action}`, { type: 'organizer_rating', id: ratingId }, u.version, me, { organizationId: r.organizationId }, rid);
      return u;
    });
  }

  async moderationList(me: string, q: { organizationId?: string | undefined; state?: 'visible' | 'hidden' | undefined }, rid: string) {
    await this.ct.acl.require(me, 'rating.moderate', SITE, rid);
    return this.c.organizerRatings.find({ ...(q.organizationId ? { organizationId: q.organizationId } : {}), ...(q.state ? { state: q.state } : {}) }).sort({ createdAt: -1 }).limit(200).toArray();
  }
}
