import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';
import type { Logger } from 'pino';
import { collectionNames, collections } from './collections.js';
import { defaultDisciplineConfig, defaultEventConfig } from '../events/defaults.js';

/**
 * Versioned, forward-only migrations recorded in the `migrations` collection with a checksum of the
 * migration definition. Re-running is a no-op; a changed checksum of an applied migration fails loudly
 * (OPS-006 controlled tooling). Index creation is idempotent.
 */
export interface Migration {
  id: string;
  description: string;
  /** Bump when the migration body changes before it has shipped; an applied migration with a changed revision fails loudly. */
  revision: number;
  up(db: Db): Promise<void>;
}

export const migrations: Migration[] = [
  {
    id: '0001_initial_indexes',
    revision: 1,
    description: 'Unique and query indexes for identity, ACL, outbox, realtime, audit, files and competition hierarchy',
    async up(db) {
      const c = collections(db);
      await c.sessions.createIndexes([
        { key: { tokenHash: 1 }, unique: true },
        { key: { principalId: 1, revokedAt: 1 } },
        { key: { expiresAt: 1 }, expireAfterSeconds: 60 * 60 * 24 * 30 },
      ]);
      await c.grants.createIndexes([
        { key: { principalId: 1, revokedAt: 1 } },
        { key: { 'scope.type': 1, 'scope.id': 1, role: 1 } },
        // one active grant per principal/role/scope
        { key: { principalId: 1, role: 1, 'scope.type': 1, 'scope.id': 1 }, unique: true, partialFilterExpression: { revokedAt: null } },
      ]);
      await c.approvals.createIndexes([{ key: { state: 1, expiresAt: 1 } }, { key: { 'scope.type': 1, 'scope.id': 1 } }]);
      await c.outbox.createIndexes([
        { key: { status: 1, nextAttemptAt: 1 } },
        { key: { 'aggregate.type': 1, 'aggregate.id': 1, aggregateVersion: 1 } },
        { key: { status: 1, leaseUntil: 1 } },
      ]);
      await c.processedEvents.createIndexes([{ key: { consumer: 1, processedAt: 1 } }]);
      await c.realtime.createIndexes([{ key: { seq: 1 }, unique: true }, { key: { channel: 1, seq: 1 } }, { key: { createdAt: 1 }, expireAfterSeconds: 60 * 60 * 24 * 7 }]);
      await c.audit.createIndexes([{ key: { seq: 1 }, unique: true }, { key: { 'target.type': 1, 'target.id': 1 } }, { key: { actorPrincipalId: 1, at: -1 } }]);
      await c.files.createIndexes([{ key: { sha256: 1, 'scope.type': 1, 'scope.id': 1 } }, { key: { ownerPrincipalId: 1 } }, { key: { scanState: 1, quarantined: 1 } }]);
      await c.events.createIndexes([{ key: { slug: 1 }, unique: true }, { key: { organizerOrgId: 1, state: 1 } }]);
      await c.disciplines.createIndexes([{ key: { eventId: 1 } }]);
      await c.stages.createIndexes([{ key: { disciplineId: 1, order: 1 }, unique: true }]);
      await c.matches.createIndexes([{ key: { stageId: 1 } }, { key: { eventId: 1, state: 1 } }, { key: { 'sides.participationId': 1 } }]);
      await c.gameUnits.createIndexes([{ key: { matchId: 1, order: 1 }, unique: true }]);
      await c.participations.createIndexes([
        { key: { disciplineId: 1, registrationState: 1 } },
        // a team/player may hold only one non-terminal participation per discipline (REG-003 base)
        {
          key: { disciplineId: 1, 'snapshot.teamId': 1 },
          unique: true,
          partialFilterExpression: { 'snapshot.teamId': { $type: 'string' }, registrationState: { $in: ['awaiting_payment', 'awaiting_review', 'awaiting_capacity', 'confirmed'] } },
        },
      ]);
      await c.organizations.createIndexes([{ key: { slug: 1 }, unique: true }]);
      await c.teams.createIndexes([{ key: { tag: 1 } }, { key: { organizationId: 1 } }]);
      await c.teamMemberships.createIndexes([{ key: { teamId: 1, principalId: 1, to: 1 } }, { key: { principalId: 1, to: 1 } }]);
      await c.resultVersions.createIndexes([{ key: { targetType: 1, targetId: 1, version: 1 }, unique: true }]);
      await c.counters.createIndexes([{ key: { _id: 1 } }]);
      // Audit log is append-only: application role must not hold update/remove on it (see docs/architecture/security.md
      // for the Mongo role definition). Schema validation forbids documents without a hash chain.
      await db.command({
        collMod: collectionNames.audit,
        validator: { $jsonSchema: { bsonType: 'object', required: ['seq', 'at', 'actorPrincipalId', 'action', 'hash', 'prevHash'] } },
        validationLevel: 'strict',
      }).catch(async (err: Error) => {
        if (/not found|ns does not exist/i.test(err.message)) {
          await db.createCollection(collectionNames.audit, {
            validator: { $jsonSchema: { bsonType: 'object', required: ['seq', 'at', 'actorPrincipalId', 'action', 'hash', 'prevHash'] } },
          });
        } else throw err;
      });
    },
  },
  {
    id: '0002_esp02_identity_teams_catalog_rules',
    revision: 1,
    description: 'Indexes for OTP, login records, profiles, game identities, social graph, teams, recruitment, organizer, catalog and rules packages',
    async up(db) {
      const c = collections(db);
      await c.otpChallenges.createIndexes([{ key: { target: 1, purpose: 1, createdAt: -1 } }, { key: { ip: 1, createdAt: -1 } }, { key: { expiresAt: 1 }, expireAfterSeconds: 60 * 60 * 24 }]);
      await c.credentials.createIndexes([
        { key: { phone: 1 }, unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
        { key: { email: 1 }, unique: true, partialFilterExpression: { email: { $type: 'string' } } },
      ]);
      await c.profiles.createIndexes([{ key: { nicknameLower: 1 }, unique: true }, { key: { 'lookingForTeam.active': 1, 'lookingForTeam.gameIds': 1 } }, { key: { city: 1 } }]);
      await c.gameIdentities.createIndexes([
        { key: { principalId: 1, gameId: 1, platform: 1 } },
        { key: { gameId: 1, platform: 1, valueNormalized: 1, active: 1 } },
      ]);
      await c.badges.createIndexes([{ key: { principalId: 1, kind: 1, revokedAt: 1 } }]);
      await c.follows.createIndexes([{ key: { followerId: 1, targetType: 1, targetId: 1 }, unique: true }, { key: { targetType: 1, targetId: 1 } }]);
      await c.blocks.createIndexes([{ key: { blockerId: 1, blockedId: 1 }, unique: true }, { key: { blockedId: 1 } }]);
      await c.accountReviews.createIndexes([{ key: { state: 1, createdAt: -1 } }, { key: { principalIds: 1 } }]);
      await c.teams.createIndexes([{ key: { ownerPrincipalId: 1 } }, { key: { gameId: 1 } }]);
      await c.organizations.createIndexes([{ key: { ownerPrincipalId: 1 } }]);
      await c.teamInvitations.createIndexes([{ key: { teamId: 1, principalId: 1, state: 1 } }, { key: { principalId: 1, state: 1 } }]);
      await c.teamJoinRequests.createIndexes([{ key: { teamId: 1, state: 1 } }, { key: { principalId: 1, state: 1 } }]);
      await c.ownershipTransfers.createIndexes([{ key: { targetType: 1, targetId: 1, state: 1 } }, { key: { toPrincipalId: 1, state: 1 } }]);
      await c.teamCalendar.createIndexes([{ key: { teamId: 1, startsAt: 1 } }]);
      await c.recruitmentAds.createIndexes([{ key: { state: 1, gameId: 1, kind: 1, city: 1, createdAt: -1 } }, { key: { teamId: 1, state: 1 } }]);
      await c.recruitmentApplications.createIndexes([{ key: { adId: 1, principalId: 1 }, unique: true }, { key: { principalId: 1, state: 1 } }]);
      await c.scrims.createIndexes([{ key: { state: 1, gameId: 1, windowStart: 1 } }, { key: { requesterTeamId: 1, state: 1 } }]);
      await c.organizerApplications.createIndexes([{ key: { organizationId: 1, state: 1 } }, { key: { state: 1, createdAt: -1 } }]);
      await c.organizerRatings.createIndexes([{ key: { organizationId: 1, eventId: 1, principalId: 1 }, unique: true }, { key: { organizationId: 1, state: 1 } }]);
      await c.games.createIndexes([{ key: { slug: 1 }, unique: true }, { key: { state: 1, family: 1 } }, { key: { title: 'text', publisher: 'text' } }]);
      await c.gameReadiness.createIndexes([{ key: { gameId: 1, version: 1, platform: 1, mode: 1 }, unique: true }]);
      await c.rulesPackages.createIndexes([{ key: { gameId: 1, 'scope.kind': 1, 'scope.ref': 1, versionLabel: 1 }, unique: true }, { key: { state: 1, nextReviewDueAt: 1 } }]);
      await c.rulesAcceptances.createIndexes([{ key: { packageId: 1, principalId: 1, 'context.eventId': 1, 'context.participationId': 1 }, unique: true }, { key: { principalId: 1 } }]);
    },
  },
  {
    id: '0003_esp02_membership_uniqueness',
    revision: 1,
    description: 'One active membership per team/principal and one pending invitation per team/principal',
    async up(db) {
      const c = collections(db);
      await c.teamMemberships.createIndex({ teamId: 1, principalId: 1 }, { unique: true, partialFilterExpression: { to: { $type: 'null' } }, name: 'uniq_active_membership' });
      await c.teamInvitations.createIndex({ teamId: 1, principalId: 1 }, { unique: true, partialFilterExpression: { state: 'pending' }, name: 'uniq_pending_invitation' });
    },
  },
  {
    id: '0004_esp02_one_open_organizer_application',
    revision: 1,
    description: 'At most one open organizer application per organization',
    async up(db) {
      await collections(db).organizerApplications.createIndex({ organizationId: 1 }, { unique: true, partialFilterExpression: { state: { $in: ['submitted', 'needs_info', 'under_review'] } }, name: 'uniq_open_application' });
    },
  },
  {
    id: '0005_backfill_esp01_documents',
    revision: 1,
    description: 'Backfill ESP-02 fields on principals, organizations, teams and memberships created before ESP-02',
    async up(db) {
      const c = collections(db);
      const miss = (f: string) => ({ [f]: { $exists: false } });
      // principals: deletion/anonymization markers
      await c.principals.updateMany(miss('deletedAt'), { $set: { deletedAt: null, anonymizedAt: null } });
      // organizations: owner = first organizer grant holder in that organization, else unassigned (resolved by an admin)
      for (const o of await c.organizations.find(miss('ownerPrincipalId')).toArray()) {
        const g = await c.grants.findOne({ 'scope.type': 'organization', 'scope.id': o._id, role: { $in: ['organizer', 'team_owner'] }, revokedAt: null }, { sort: { grantedAt: 1 } });
        const owner = g?.principalId ?? 'system:unassigned';
        await c.organizations.updateOne({ _id: o._id }, { $set: { ownerPrincipalId: owner, description: null, city: null, links: [], sponsors: [], logoFileId: null, nameHistory: [{ name: o.name, from: o.createdAt, to: null }], ownerHistory: [{ principalId: owner, from: o.createdAt, to: null }], updatedAt: o.createdAt } });
      }
      // teams: owner = active team_owner grant holder, else unassigned; game unknown until an admin assigns it
      for (const t of await c.teams.find(miss('ownerPrincipalId')).toArray()) {
        const g = await c.grants.findOne({ 'scope.type': 'team', 'scope.id': t._id, role: 'team_owner', revokedAt: null }, { sort: { grantedAt: 1 } });
        const owner = g?.principalId ?? 'system:unassigned';
        await c.teams.updateOne({ _id: t._id }, { $set: { ownerPrincipalId: owner, ownerHistory: [{ principalId: owner, from: t.createdAt, to: null }], updatedAt: t.createdAt } });
      }
      await c.teams.updateMany(miss('gameId'), { $set: { gameId: 'unassigned' } });
      for (const f of ['description', 'city', 'logoFileId', 'coverFileId']) await c.teams.updateMany(miss(f), { $set: { [f]: null } });
      for (const f of ['links', 'sponsors']) await c.teams.updateMany(miss(f), { $set: { [f]: [] } });
      // memberships: historical display name from the principal at migration time (best available)
      for (const m of await c.teamMemberships.find(miss('displayNameAtJoin')).toArray()) {
        const p = await c.principals.findOne({ _id: m.principalId }, { projection: { displayName: 1 } });
        await c.teamMemberships.updateOne({ _id: m._id }, { $set: { displayNameAtJoin: p?.displayName ?? m.principalId, endedReason: null, endedBy: null } });
      }
    },
  },
  {
    id: '0006_esp03_events_registration_finance',
    revision: 1,
    description: 'ESP-03 indexes (registration uniqueness, capacity, payments, ledger, refunds idempotency) and config backfill for events, disciplines and stages',
    async up(db) {
      const c = collections(db);
      const active = ['incomplete', 'awaiting_payment', 'awaiting_review', 'awaiting_capacity', 'confirmed'];
      await c.registrations.createIndexes([
        { key: { trackingCode: 1 }, unique: true },
        // REG-003/REG-009: one non-terminal registration per team/player per discipline
        { key: { disciplineId: 1, holderKey: 1 }, unique: true, partialFilterExpression: { state: { $in: active } }, name: 'uniq_active_registration' },
        { key: { disciplineId: 1, state: 1, waitlistSeq: 1 } },
        { key: { state: 1, 'reservation.expiresAt': 1 } },
        { key: { applicantPrincipalId: 1, createdAt: -1 } },
        { key: { 'roster.principalId': 1, disciplineId: 1 } },
      ]);
      await c.capacityCounters.createIndexes([{ key: { disciplineId: 1 } }]);
      await c.entryCodes.createIndexes([{ key: { disciplineId: 1 } }]);
      await c.qualificationSlots.createIndexes([{ key: { targetDisciplineId: 1, holderKey: 1 }, unique: true, partialFilterExpression: { state: { $in: ['reserved', 'claimed'] } }, name: 'uniq_slot_holder' }]);
      await c.substitutions.createIndexes([{ key: { registrationId: 1, createdAt: 1 } }, { key: { seasonId: 1, registrationId: 1 } }]);
      await c.checkins.createIndexes([{ key: { level: 1, ref: 1, state: 1 } }]);
      await c.priceLists.createIndexes([{ key: { productKey: 1, version: 1 }, unique: true }]);
      await c.orders.createIndexes([{ key: { payerPrincipalId: 1, createdAt: -1 } }, { key: { 'refs.registrationId': 1 } }, { key: { receiptNo: 1 }, unique: true, partialFilterExpression: { receiptNo: { $type: 'string' } } }]);
      await c.payments.createIndexes([
        { key: { gatewayRef: 1 }, unique: true, partialFilterExpression: { gatewayRef: { $type: 'string' } } },
        // at most one in-flight payment per order: parallel "pay" clicks cannot create two charges
        { key: { orderId: 1 }, unique: true, partialFilterExpression: { state: { $in: ['created', 'awaiting_gateway', 'unknown'] } }, name: 'uniq_inflight_payment' },
        { key: { state: 1, expiresAt: 1 } },
      ]);
      await c.gatewayCallbacks.createIndexes([{ key: { gatewayRef: 1, receivedAt: 1 } }]);
      await c.ledger.createIndexes([{ key: { seq: 1 }, unique: true }, { key: { txId: 1 } }, { key: { account: 1, createdAt: 1 } }]);
      await c.refunds.createIndexes([{ key: { idempotencyKey: 1 }, unique: true }, { key: { paymentId: 1 } }, { key: { state: 1 } }]);
      await c.prizes.createIndexes([{ key: { eventId: 1, prizeKey: 1 }, unique: true }, { key: { state: 1 } }]);
      await c.subscriptions.createIndexes([{ key: { 'holder.kind': 1, 'holder.ref': 1, state: 1 } }, { key: { state: 1, periodEnd: 1 } }]);
      await c.tickets.createIndexes([{ key: { code: 1 }, unique: true }, { key: { eventId: 1, state: 1 } }]);
      await c.sponsorPlacements.createIndexes([{ key: { eventId: 1, state: 1 } }]);
      await c.events.createIndexes([{ key: { 'config.linkToken': 1 }, sparse: true }, { key: { state: 1, 'config.publishAt': 1 } }]);
      await db.command({ collMod: collectionNames.ledger, validator: { $jsonSchema: { bsonType: 'object', required: ['seq', 'txId', 'account', 'amountRial', 'kind', 'createdAt'], properties: { amountRial: { bsonType: ['int', 'long', 'double'] } } } } }).catch(async (err: Error) => {
        if (/not found|ns does not exist/i.test(err.message)) await db.createCollection(collectionNames.ledger, { validator: { $jsonSchema: { bsonType: 'object', required: ['seq', 'txId', 'account', 'amountRial', 'kind', 'createdAt'] } } });
        else throw err;
      });
      // backfill configuration of documents created before ESP-03
      await c.events.updateMany({ config: { $exists: false } }, { $set: { config: defaultEventConfig() } });
      await c.disciplines.updateMany({ config: { $exists: false } }, { $set: { config: defaultDisciplineConfig() } });
      await c.stages.updateMany({ links: { $exists: false } }, { $set: { presence: 'online', links: [], startException: null } });
    },
  },
  {
    id: '0007_esp03_one_open_subscription',
    revision: 1,
    description: 'At most one active or pending subscription per plan and holder (concurrent purchases cannot double-charge)',
    async up(db) {
      await collections(db).subscriptions.createIndex({ plan: 1, 'holder.ref': 1 }, { unique: true, partialFilterExpression: { state: { $in: ['active', 'pending_payment'] } }, name: 'uniq_open_subscription' });
    },
  },
];

// Deliberately independent of the compiled function text (tsx and tsc emit different source) — see `revision`.
function checksumOf(m: Migration): string {
  return createHash('sha256').update(`${m.id}\n${m.description}\n${m.revision}`).digest('hex');
}

export async function runMigrations(db: Db, logger?: Logger): Promise<{ applied: string[]; skipped: string[] }> {
  const c = collections(db);
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const m of migrations) {
    const checksum = checksumOf(m);
    const existing = await c.migrations.findOne({ _id: m.id });
    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`Migration ${m.id} was modified after being applied (checksum mismatch). Create a new migration instead.`);
      }
      skipped.push(m.id);
      continue;
    }
    logger?.info({ migration: m.id }, 'applying migration');
    await m.up(db);
    await c.migrations.insertOne({ _id: m.id, appliedAt: new Date().toISOString(), checksum });
    applied.push(m.id);
  }
  return { applied, skipped };
}

export async function migrationStatus(db: Db): Promise<{ pending: string[]; applied: string[] }> {
  const c = collections(db);
  const rows = await c.migrations.find({}).toArray();
  const appliedIds = new Set(rows.map((r) => r._id));
  return { applied: migrations.filter((m) => appliedIds.has(m.id)).map((m) => m.id), pending: migrations.filter((m) => !appliedIds.has(m.id)).map((m) => m.id) };
}
