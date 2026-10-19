import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContainer } from '@esp/core';
import { buildApp } from './app.js';

/** Writes the generated OpenAPI 3.1 document to docs/api/openapi.json (contract deliverable 17.1 #3). */
const container = await createContainer({ serviceName: 'openapi', env: { ...process.env, LOG_LEVEL: 'silent', AUTH_DEV_LOGIN_ENABLED: 'true', AUTH_DEV_CODE: 'documentation-only-code' } });
try {
  const app = await buildApp(container);
  await app.ready();
  const spec = app.swagger();
  const target = resolve(process.cwd(), '../../docs/api/openapi.json');
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, JSON.stringify(spec, null, 2) + '\n', 'utf8');
  console.log(`wrote ${target} (${Object.keys((spec as { paths: object }).paths).length} paths)`);
  await app.close();
} finally {
  await container.close();
}
