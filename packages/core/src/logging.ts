import pino, { type Logger } from 'pino';

/**
 * Structured logging without secrets (SEC-002). Paths listed here are redacted at the logger level so
 * OTP codes, tokens, cookies and provider keys never reach log sinks even if a caller passes them.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.otp',
  '*.code',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.devCode',
  '*.sessionToken',
  'password',
  'otp',
  'token',
  'secret',
  'apiKey',
  'devCode',
];

export function createLogger(level: string, name: string): Logger {
  return pino({
    name,
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: name },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type { Logger };
