import { MongoClient, type ClientSession, type Db, type TransactionOptions } from 'mongodb';
import type { Logger } from 'pino';

/** Callbacks to run only after the transaction that owns `session` commits (e.g. announcing realtime events). */
const afterCommitHooks = new WeakMap<ClientSession, Array<() => void>>();
export function afterCommit(session: ClientSession, fn: () => void): void {
  const list = afterCommitHooks.get(session) ?? [];
  list.push(fn);
  afterCommitHooks.set(session, list);
}

export interface DbHandle {
  client: MongoClient;
  db: Db;
  /** Runs `fn` inside a multi-document transaction (requires replica set). Retries transient errors via the driver. */
  withTransaction<T>(fn: (session: ClientSession) => Promise<T>, opts?: TransactionOptions): Promise<T>;
  ping(): Promise<{ ok: boolean; latencyMs: number; replicaSet: boolean; detail?: string }>;
  close(): Promise<void>;
}

export async function connectDb(url: string, logger?: Logger): Promise<DbHandle> {
  const client = new MongoClient(url, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 8000,
    retryWrites: true,
    retryReads: true,
  });
  await client.connect();
  const db = client.db(); // database name from URL
  logger?.info({ db: db.databaseName }, 'mongo connected');

  const handle: DbHandle = {
    client,
    db,
    async withTransaction(fn, opts) {
      const session = client.startSession();
      try {
        let result: unknown;
        await session.withTransaction(
          async () => {
            result = await fn(session);
          },
          {
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' },
            readPreference: 'primary',
            ...opts,
          },
        );
        for (const hook of afterCommitHooks.get(session) ?? []) hook();
        afterCommitHooks.delete(session);
        return result as Awaited<ReturnType<typeof fn>>;
      } finally {
        await session.endSession();
      }
    },
    async ping() {
      const started = performance.now();
      try {
        const hello = (await db.command({ hello: 1 })) as { setName?: string; isWritablePrimary?: boolean };
        const latencyMs = Math.round(performance.now() - started);
        const replicaSet = !!hello.setName;
        return {
          ok: hello.isWritablePrimary === true,
          latencyMs,
          replicaSet,
          ...(replicaSet ? {} : { detail: 'not a replica set: multi-document transactions unavailable' }),
        };
      } catch (err) {
        return { ok: false, latencyMs: Math.round(performance.now() - started), replicaSet: false, detail: (err as Error).message };
      }
    },
    async close() {
      await client.close();
    },
  };
  return handle;
}
