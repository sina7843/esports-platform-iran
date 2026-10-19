import { createContainer } from '../container.js';
import { runMigrations } from './migrations.js';
import { seedDatabase } from './seed.js';

const container = await createContainer({ serviceName: 'seed' });
try {
  if (container.config.isProduction) throw new Error('seed is TEST ONLY and refuses to run in production/staging');
  await runMigrations(container.dbh.db, container.logger);
  await seedDatabase(container.c, container.acl, container.logger);
  console.log('seed applied (TEST ONLY synthetic data)');
} finally {
  await container.close();
}
