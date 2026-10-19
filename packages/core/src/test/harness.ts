import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContainer, type Container } from '../container.js';
import { runMigrations } from '../db/migrations.js';
import { seedDatabase } from '../db/seed.js';
import { newId } from '../ids.js';

/**
 * Integration-test harness: one fresh database per test file on the replica set from MONGO_URL
 * (default: the compose.local-tools.yaml loopback port). Dropped on teardown.
 */
export async function testContainer(opts: { seed?: boolean } = {}): Promise<Container & { drop(): Promise<void> }> {
  const base = process.env['MONGO_URL'] ?? 'mongodb://127.0.0.1:27018/esports?directConnection=true';
  const url = new URL(base);
  url.pathname = `/test_${newId().toLowerCase()}`;
  const dataDir = mkdtempSync(join(tmpdir(), 'esp-test-'));
  const container = await createContainer({
    serviceName: 'test',
    workerId: `test-${process.pid}`,
    env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'ci', MONGO_URL: url.toString(), DATA_DIR: dataDir, LOG_LEVEL: 'silent', AUTH_DEV_LOGIN_ENABLED: 'true', AUTH_DEV_CODE: 'test-dev-code-123' },
  });
  await runMigrations(container.dbh.db);
  if (opts.seed) await seedDatabase(container.c, container.acl);
  return Object.assign(container, {
    async drop() {
      await container.dbh.db.dropDatabase();
      await container.close();
    },
  });
}

export const rid = () => `req_${newId()}`;
