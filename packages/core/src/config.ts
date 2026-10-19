import { z } from 'zod';

/**
 * Runtime configuration validated at startup (SEC-005, OPS-005).
 * Development/test may use deterministic defaults and test doubles. Production REQUIRES explicit values and
 * real providers; a missing provider blocks with PROVIDER_NOT_CONFIGURED instead of falling back to a double.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'ci', 'staging', 'production']).default('local'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  PUBLIC_API_ORIGIN: z.string().url().default('http://localhost:3000'),
  MONGO_URL: z.string().min(1).default('mongodb://127.0.0.1:27018/esports?directConnection=true'),
  DATA_DIR: z.string().min(1).default('./data'),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Session cookie signing and signed-link HMAC. Required in production. */
  APP_SECRET: z.string().min(32).optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 14),
  SIGNED_LINK_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  TRUST_PROXY: z.coerce.boolean().default(false),

  /** Development identity double. Must be absent in production. */
  AUTH_DEV_LOGIN_ENABLED: z.coerce.boolean().default(false),
  AUTH_DEV_CODE: z.string().min(8).optional(),

  /** Provider adapters. Values are adapter names; '' or absent means unconfigured. */
  PAYMENT_ADAPTER: z.enum(['dev', 'none']).default('dev'),
  SMS_ADAPTER: z.enum(['dev', 'none']).default('dev'),
  EMAIL_ADAPTER: z.enum(['dev', 'none']).default('dev'),
  STORAGE_ADAPTER: z.enum(['local', 'none']).default('local'),
  VIDEO_ADAPTER: z.enum(['dev', 'none']).default('dev'),
  MAP_ADAPTER: z.enum(['dev', 'none']).default('dev'),
  PUBLISHER_ADAPTER: z.enum(['none']).default('none'),
  SCANNER_ADAPTER: z.enum(['dev', 'clamav', 'none']).default('dev'),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().optional(),

  UPLOAD_MAX_BYTES_PRIVATE: z.coerce.number().int().default(25 * 1024 * 1024),
  UPLOAD_MAX_BYTES_PUBLIC: z.coerce.number().int().default(8 * 1024 * 1024),

  OUTBOX_POLL_MS: z.coerce.number().int().min(50).default(500),
  OUTBOX_LEASE_MS: z.coerce.number().int().min(1000).default(30_000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),

  RATE_LIMIT_MAX: z.coerce.number().int().default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(60_000),
});

export type AppConfig = z.infer<typeof EnvSchema> & { isProduction: boolean; appSecret: string; devLoginEnabled: boolean };

const DEV_SECRET = 'development-only-secret-do-not-use-in-production-0123456789';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const c = parsed.data;
  const isProduction = c.NODE_ENV === 'production' || c.APP_ENV === 'production' || c.APP_ENV === 'staging';
  if (isProduction) {
    const problems: string[] = [];
    if (!c.APP_SECRET) problems.push('APP_SECRET is required');
    if (c.AUTH_DEV_LOGIN_ENABLED) problems.push('AUTH_DEV_LOGIN_ENABLED must be false');
    if (c.PAYMENT_ADAPTER === 'dev') problems.push('PAYMENT_ADAPTER=dev (test double) is forbidden');
    if (c.SMS_ADAPTER === 'dev') problems.push('SMS_ADAPTER=dev (test double) is forbidden');
    if (c.EMAIL_ADAPTER === 'dev') problems.push('EMAIL_ADAPTER=dev (test double) is forbidden');
    if (c.VIDEO_ADAPTER === 'dev') problems.push('VIDEO_ADAPTER=dev (test double) is forbidden');
    if (c.MAP_ADAPTER === 'dev') problems.push('MAP_ADAPTER=dev (test double) is forbidden');
    if (c.SCANNER_ADAPTER === 'dev') problems.push('SCANNER_ADAPTER=dev (test double) is forbidden');
    if (!c.TRUST_PROXY) problems.push('TRUST_PROXY must be true behind the Iranian edge/CDN');
    if (problems.length) {
      // Fail closed: production never silently degrades to development doubles.
      throw new Error(`Production configuration blocked: ${problems.join('; ')}`);
    }
  }
  return {
    ...c,
    isProduction,
    appSecret: c.APP_SECRET ?? DEV_SECRET,
    devLoginEnabled: !isProduction && c.AUTH_DEV_LOGIN_ENABLED && !!c.AUTH_DEV_CODE,
  };
}
