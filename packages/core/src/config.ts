import { z } from 'zod';

/**
 * Runtime configuration validated at startup (SEC-005, OPS-005).
 * Development/test may use deterministic defaults and test doubles. Production REQUIRES explicit values and
 * real providers; a missing provider blocks with PROVIDER_NOT_CONFIGURED instead of falling back to a double.
 */
const envBoolean = z.preprocess(v => v === 'true' ? true : v === 'false' ? false : v, z.boolean().default(false));
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'ci', 'staging', 'production']).default('local'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  PUBLIC_API_ORIGIN: z.string().url().default('http://localhost:3000'),
  MONGO_URL: z.string().min(1).default('mongodb://127.0.0.1:27018/esports?directConnection=true'),
  DATA_DIR: z.string().min(1).default('./data'),
  /** Backup target on an independent failure domain (OPS-004); the key comes from BACKUP_ENCRYPTION_KEY and is never stored with the data. */
  BACKUP_TARGET_DIR: z.string().min(1).optional(),
  BACKUP_ENCRYPTION_KEY: z.string().min(32).optional(),
  BACKUP_KEEP: z.coerce.number().int().min(2).max(500).default(24),
  BACKUP_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Session cookie signing and signed-link HMAC. Required in production. */
  APP_SECRET: z.string().min(32).optional(),
  /** Comma-separated previous APP_SECRET values kept only while rotating (SEC-006); remove after `rotate-secrets` has run. */
  APP_SECRET_PREVIOUS: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 14),
  SIGNED_LINK_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  TRUST_PROXY: envBoolean,

  /** Development identity double. Must be absent in production. */
  AUTH_DEV_LOGIN_ENABLED: envBoolean,
  AUTH_DEV_CODE: z.string().min(8).optional(),

  /** OTP / login hardening (SEC-002, USR-001). */
  AUTH_OTP_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(120),
  AUTH_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  AUTH_OTP_RESEND_SECONDS: z.coerce.number().int().min(0).max(600).default(60),
  AUTH_OTP_PHONE_HOURLY: z.coerce.number().int().min(1).default(5),
  AUTH_OTP_IP_HOURLY: z.coerce.number().int().min(1).default(20),
  AUTH_SMS_TIMEOUT_MS: z.coerce.number().int().min(10).default(8000),
  AUTH_LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).default(5),
  AUTH_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
  AUTH_REAUTH_MINUTES: z.coerce.number().int().min(1).default(10),
  /** Signups from one IP within 24h at/over this count open an account review (USR-010). */
  AUTH_SIGNUP_IP_REVIEW_THRESHOLD: z.coerce.number().int().min(2).default(3),
  /** Explicit 'true'/'false'; default: on in production, off in development/test. */
  MFA_ENFORCED: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false']).optional()),

  /** Provider adapters. Values are adapter names; '' or absent means unconfigured. */
  PAYMENT_ADAPTER: z.enum(['dev', 'none']).default('dev'),
  SMS_ADAPTER: z.enum(['dev', 'none', 'kavenegar']).default('dev'),
  KAVENEGAR_API_KEY: z.preprocess(v => v === '' ? undefined : v, z.string().regex(/^[A-Za-z0-9]+$/).optional()),
  KAVENEGAR_OTP_TEMPLATE: z.preprocess(v => v === '' ? undefined : v, z.string().regex(/^[A-Za-z0-9-]{1,100}$/).optional()),
  KAVENEGAR_SENDER: z.preprocess(v => v === '' ? undefined : v, z.string().regex(/^\d{3,20}$/).optional()),
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

  /** How often an API process tails the realtime store for events published by other processes (worker). */
  REALTIME_BRIDGE_MS: z.coerce.number().int().min(50).max(5000).default(500),
  OUTBOX_POLL_MS: z.coerce.number().int().min(50).default(500),
  OUTBOX_LEASE_MS: z.coerce.number().int().min(1000).default(30_000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),

  /** Payments (FIN-002/004): in-flight payment lifetime and the refund size that needs an independent approval (ACL-003). */
  PAYMENT_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(20),
  REFUND_APPROVAL_THRESHOLD_RIAL: z.coerce.number().int().min(0).default(50_000_000),

  /** Admission control: concurrent requests per API process before it answers 503 (protects memory under overload). */
  MAX_INFLIGHT: z.coerce.number().int().min(10).default(1500),
  RATE_LIMIT_MAX: z.coerce.number().int().default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(60_000),
});

export type AppConfig = z.infer<typeof EnvSchema> & { isProduction: boolean; appSecret: string; devLoginEnabled: boolean; mfaEnforced: boolean; previousSecrets: string[] };

const DEV_SECRET = 'development-only-secret-do-not-use-in-production-0123456789';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const c = parsed.data;
  if (c.SMS_ADAPTER === 'kavenegar' && (!c.KAVENEGAR_API_KEY || !c.KAVENEGAR_OTP_TEMPLATE)) {
    throw new Error('Kavenegar configuration requires KAVENEGAR_API_KEY and KAVENEGAR_OTP_TEMPLATE');
  }
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
    if (c.MFA_ENFORCED === 'false') problems.push('MFA_ENFORCED=false is forbidden');
    if (!c.TRUST_PROXY) problems.push('TRUST_PROXY must be true behind the Iranian edge/CDN');
    if (problems.length) {
      // Fail closed: production never silently degrades to development doubles.
      throw new Error(`Production configuration blocked: ${problems.join('; ')}`);
    }
  }
  const previousSecrets = (c.APP_SECRET_PREVIOUS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (previousSecrets.some((x) => x.length < 32)) throw new Error('Invalid configuration: APP_SECRET_PREVIOUS entries must be at least 32 characters');
  return {
    ...c,
    isProduction,
    appSecret: c.APP_SECRET ?? DEV_SECRET,
    previousSecrets,
    devLoginEnabled: !isProduction && c.AUTH_DEV_LOGIN_ENABLED && !!c.AUTH_DEV_CODE,
    mfaEnforced: c.MFA_ENFORCED ? c.MFA_ENFORCED === 'true' : isProduction,
  };
}
