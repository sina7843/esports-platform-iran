import { createContainer, runMigrations } from '@esp/core';
import { buildApp } from './app.js';

const container = await createContainer({ serviceName: 'api' });
const { config, logger } = container;

// Fail closed on schema drift: the API refuses to serve with pending migrations.
const migrations = await runMigrations(container.dbh.db, logger);
if (migrations.applied.length) logger.info({ applied: migrations.applied }, 'migrations applied at startup');

const app = await buildApp(container);

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  try {
    await app.close();
    await container.close();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'shutdown failed');
    process.exit(1);
  }
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.HOST, port: config.PORT });
logger.info({ host: config.HOST, port: config.PORT, env: config.APP_ENV, devLogin: config.devLoginEnabled }, 'api listening');
