import type { FastifyInstance, FastifyError } from 'fastify';
import { DomainError, type ApiError, type ErrorCode } from '@esp/contracts';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';

/**
 * Uniform error envelope. Stack traces and internal messages never reach clients; the request id lets
 * operators correlate the safe response with the server-side log line (SEC-001, typescript.md rules).
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | DomainError | Error, req, reply) => {
    const requestId = req.id;
    const send = (status: number, code: ErrorCode, message: string, details?: unknown) => {
      const body: ApiError = { error: { code, message, requestId, ...(details !== undefined ? { details } : {}) } };
      return reply.status(status).send(body);
    };
    if (err instanceof DomainError) {
      if (err.code === 'INTERNAL') req.log.error({ err }, 'domain internal error');
      return send(err.status, err.code, err.message, err.details);
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return send(400, 'VALIDATION_FAILED', 'request validation failed', err.validation.map((v) => ({ path: v.instancePath, message: v.message })));
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err }, 'response serialization failed');
      return send(500, 'INTERNAL', 'response did not match its contract');
    }
    const fe = err as FastifyError;
    if (fe.statusCode === 429) return send(429, 'RATE_LIMITED', 'too many requests');
    if (fe.statusCode === 413 || fe.code === 'FST_REQ_FILE_TOO_LARGE') return send(413, 'PAYLOAD_TOO_LARGE', 'payload too large');
    if (fe.statusCode === 415) return send(415, 'UNSUPPORTED_MEDIA_TYPE', 'unsupported media type');
    if (fe.statusCode === 404) return send(404, 'NOT_FOUND', 'route not found');
    if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) return send(fe.statusCode, 'VALIDATION_FAILED', fe.message);
    req.log.error({ err }, 'unhandled error');
    return send(500, 'INTERNAL', 'internal error');
  });

  app.setNotFoundHandler((req, reply) => {
    const body: ApiError = { error: { code: 'NOT_FOUND', message: 'route not found', requestId: req.id } };
    return reply.status(404).send(body);
  });
}
