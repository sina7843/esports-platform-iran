import { applyTransition } from '../domain/transition.js';
import { eventMachine, type Clause } from '@esp/contracts';
import type { Container } from '../container.js';
import { seedIds } from '../db/seed-ids.js';
import { hashClauses } from '../rules/rules.js';
import { EventsService } from '../events/events.js';
import { newId } from '../ids.js';

/**
 * TEST ONLY fixture for ESP-03 tests: makes the synthetic game ready for one mode, publishes a synthetic rules package
 * and raises the seed organizer's limits, then builds a published, registration-open event with the given disciplines.
 * Publication itself goes through the real EventsService gate.
 */
export async function preparePublishable(ct: Container, clauses: Clause[]): Promise<string> {
  const now = new Date().toISOString();
  await ct.c.games.updateOne({ _id: 'game_seed_synthetic' }, { $set: { state: 'ready' } });
  await ct.c.gameReadiness.updateOne({ gameId: 'game_seed_synthetic', version: 'test', platform: 'pc', mode: '5v5' }, { $setOnInsert: { _id: newId('grd'), gameId: 'game_seed_synthetic', version: 'test', platform: 'pc', mode: '5v5', state: 'ready', evidence: 'TEST ONLY', reviewedBy: 'test', reviewedAt: now } }, { upsert: true });
  await ct.c.organizerProfiles.updateOne({ _id: seedIds.orgA }, { $set: { limits: { maxActiveEvents: 100, maxCapacityPerEvent: 10_000, paidEventsAllowed: true } } });
  const id = newId('rpk');
  await ct.c.rulesPackages.insertOne({
    _id: id, gameId: 'game_seed_synthetic', scope: { kind: 'catalog', ref: 'game_seed_synthetic' }, title: 'TEST ONLY fixture rules', versionLabel: `fx-${id}`, state: 'published',
    sourceUrl: null, sourceText: 'synthetic', sourcePublishedAt: null, sourceRetrievedAt: null, reviewedAt: now, nextReviewDueAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    applicability: 'tests', originalLanguage: 'fa', translationFa: { text: null, reviewed: true, reviewer: 'test', reviewedAt: now }, clauses, clausesHash: hashClauses(clauses), conflicts: [],
    publisherRights: { reviewed: true, restrictions: null, reviewedBy: 'test' }, adaptedFrom: null, supersedes: null, supersededBy: null, amendment: null, testOnly: true,
    history: [], createdBy: 'test', createdAt: now, updatedAt: now, version: 0,
  } as never);
  return id;
}

export const clause = (key: string, value: unknown): Clause => ({ key, kind: 'mandatory', value: value as Clause['value'], allowed: null, citation: `TEST ONLY ${key}`, textOriginal: null, textFa: null });

export async function openEvent(
  ct: Container,
  opts: { packageId: string; disciplines: Array<{ name: string; participantKind: 'team' | 'player'; capacity: number; feeRial?: number; autoApprove?: boolean; checkin?: boolean; quotas?: Array<{ kind: 'invite' | 'organization' | 'qualifier'; size: number }> }>; refund?: { before: number; after: number; cancel: number; dq: number }; visibility?: 'public' | 'link_only' | 'private' | 'invite' },
): Promise<{ eventId: string; disciplineIds: string[] }> {
  const ev = new EventsService(ct);
  const rid = `fx_${newId()}`;
  const start = new Date(Date.now() + 3 * 3600_000).toISOString();
  const e = await ev.create({ organizerOrgId: seedIds.orgA, name: 'رویداد آزمون (TEST ONLY)', slug: `fx-${newId().toLowerCase()}`, visibility: opts.visibility ?? 'public', timeZone: 'Asia/Tehran', startsAt: start, endsAt: null, description: null, posterFileId: null, presence: 'hybrid', regions: [], language: 'fa', contact: null, rated: false, prizes: [{ key: 'first', title: 'قهرمان', kind: 'cash', amountRial: 10_000_000, description: null, responsible: 'organizer', responsibleName: null }], refundPolicy: opts.refund ? { beforeDeadlinePercent: opts.refund.before, afterDeadlinePercent: opts.refund.after, onEventCancelPercent: opts.refund.cancel, onDisqualificationPercent: opts.refund.dq, text: 'TEST ONLY refund policy' } : null, cancellationTerms: 'TEST ONLY cancellation terms', disputeTerms: 'TEST ONLY dispute terms', isTemplate: false, seasonId: null }, seedIds.organizer, rid);
  const disciplineIds: string[] = [];
  for (const d of opts.disciplines) {
    const dd = await ev.addDiscipline(e._id, {
      name: d.name, gameId: 'game_seed_synthetic', gameVersion: 'test', platform: 'pc', mode: '5v5', rulesPackageId: opts.packageId, participantKind: d.participantKind, capacity: d.capacity, minParticipants: 0, feeRial: d.feeRial ?? 0,
      registrationOpensAt: null, registrationClosesAt: new Date(Date.now() + 3600_000).toISOString(), lateRegistrationUntil: null, editDeadline: null, withdrawalDeadline: new Date(Date.now() + 1800_000).toISOString(), paymentWindowMinutes: 30,
      autoApprove: d.autoApprove ?? true, quotas: (d.quotas ?? []).map((q) => ({ ...q, ref: null })), formFields: [{ key: 'note', label: 'یادداشت', type: 'text', required: false, options: null, private: true }], requiredDocuments: [],
      checkin: d.checkin ? { opensMinutesBefore: 240, closesMinutesBefore: 30, graceMinutes: 10, policy: 'captain', minMembers: null } : null, seasonChangeCap: 1, presence: 'online', regions: [],
    }, seedIds.organizer, rid);
    disciplineIds.push(dd._id);
  }
  const pub = await ev.publish(e._id, seedIds.organizer, rid);
  await applyTransition(eventMachine, ct.c.events, e._id, { transition: 'open_registration', expectedVersion: pub.version, actorRoles: ['organizer'] });
  return { eventId: e._id, disciplineIds };
}
