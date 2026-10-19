import { loadConfig } from '../config.js';
import { connectDb } from './client.js';
import { migrationStatus, runMigrations } from './migrations.js';
import { createLogger } from '../logging.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, 'migrate');
const dbh = await connectDb(config.MONGO_URL, logger);
try {
  const mode = process.argv[2] ?? 'up';
  if (mode === 'status') {
    console.log(JSON.stringify(await migrationStatus(dbh.db), null, 2));
  } else {
    const r = await runMigrations(dbh.db, logger);
    console.log(JSON.stringify(r, null, 2));
  }
} finally {
  await dbh.close();
}
