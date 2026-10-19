import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';
import type { Logger } from 'pino';
import { collectionNames, collections } from './collections.js';

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
