import { createServer } from 'node:http';
import { createContainer, runMigrations } from '@esp/core';

/**
 * Worker: hosts the outbox consumer loop (and, in later stages, scheduled jobs such as reservation expiry,
 * payment reconciliation and notification fan-out). Safe to run with several replicas: records are leased.
 * `--once` drains the queue and exits (used by operators and CI).
 */
const container = await createContainer({ serviceName: 'worker' });
const { config, logger, consumer } = container;
await runMigrations(container.dbh.db, logger);

if (process.argv.includes('--once')) {
  const n = await consumer.drain();
  logger.info({ processed: n }, 'drained outbox once');
  await container.close();
  process.exit(0);
}

consumer.start();
logger.info({ pollMs: config.OUTBOX_POLL_MS, leaseMs: config.OUTBOX_LEASE_MS }, 'outbox consumer started');

// Minimal health endpoint for container orchestration (no business routes here).
const health = createServer(async (req, res) => {
  if (req.url === '/health/live') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (req.url === '/health/ready') {
    const ping = await container.dbh.ping();
    res.writeHead(ping.ok ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: ping.ok ? 'ok' : 'down', outbox: await consumer.stats() }));
    return;
  }
  res.writeHead(404);
  res.end();
});
health.listen(config.PORT + 1, config.HOST);

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'worker shutting down');
  health.close();
  await consumer.stop(); // releases leases so another replica continues without loss
  await container.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
