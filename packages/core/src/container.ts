import type { Logger } from 'pino';
import { loadConfig, type AppConfig } from './config.js';
import { connectDb, type DbHandle } from './db/client.js';
import { collections, type Collections } from './db/collections.js';
import { AuditLog } from './audit/audit.js';
import { OutboxWriter } from './outbox/outbox.js';
import { OutboxConsumer } from './outbox/consumer.js';
import { Acl } from './acl/acl.js';
import { Sessions } from './identity/sessions.js';
import { Approvals } from './approvals/approvals.js';
import { Realtime } from './realtime/realtime.js';
import { buildAdapters } from './adapters/registry.js';
import type { Adapters } from './adapters/types.js';
import { Files } from './files/files.js';
import { createLogger } from './logging.js';
import { registerCoreConsumers } from './outbox/consumers.js';
import { registerEsp03Consumers } from './finance/consumers.js';

/** Composition root shared by api, worker, CLIs and tests. */
export interface Container {
  config: AppConfig;
  logger: Logger;
  dbh: DbHandle;
  c: Collections;
  audit: AuditLog;
  outbox: OutboxWriter;
  consumer: OutboxConsumer;
  acl: Acl;
  sessions: Sessions;
  approvals: Approvals;
  realtime: Realtime;
  adapters: Adapters;
  files: Files;
  close(): Promise<void>;
}

export async function createContainer(opts: { serviceName: string; env?: NodeJS.ProcessEnv; workerId?: string } = { serviceName: 'esp' }): Promise<Container> {
  const config = loadConfig(opts.env ?? process.env);
  const logger = createLogger(config.LOG_LEVEL, opts.serviceName);
  const dbh = await connectDb(config.MONGO_URL, logger);
  const c = collections(dbh.db);
  const audit = new AuditLog(c);
  const outbox = new OutboxWriter(c, config.OUTBOX_MAX_ATTEMPTS);
  const acl = new Acl(c, audit, outbox);
  const sessions = new Sessions(c, config.SESSION_TTL_HOURS);
  const approvals = new Approvals(c, acl, audit, outbox);
  const realtime = new Realtime(c, acl, sessions);
  const adapters = buildAdapters(config, dbh.db);
  const files = new Files(c, acl, audit, adapters, {
    secret: config.appSecret,
    linkTtlSeconds: config.SIGNED_LINK_TTL_SECONDS,
    maxPrivate: config.UPLOAD_MAX_BYTES_PRIVATE,
    maxPublic: config.UPLOAD_MAX_BYTES_PUBLIC,
    apiOrigin: config.PUBLIC_API_ORIGIN,
  });
  const consumer = new OutboxConsumer(dbh, c, audit, { workerId: opts.workerId ?? `${opts.serviceName}-${process.pid}`, pollMs: config.OUTBOX_POLL_MS, leaseMs: config.OUTBOX_LEASE_MS, logger });
  registerCoreConsumers(consumer, { realtime, sessions, c, logger });
  const container: Container = {
    config,
    logger,
    dbh,
    c,
    audit,
    outbox,
    consumer,
    acl,
    sessions,
    approvals,
    realtime,
    adapters,
    files,
    async close() {
      realtime.close();
      await dbh.close();
    },
  };
  registerEsp03Consumers(container);
  return container;
}
