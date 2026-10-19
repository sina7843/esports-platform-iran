import { z } from 'zod';

/**
 * Uniform API error contract. Every non-2xx response from the API uses this envelope.
 * `code` is stable and machine-readable; `message` is a safe, non-sensitive English summary;
 * the web shell maps `code` to localized Persian/English text. Stack traces never leave the server.
 */
export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  SEPARATION_OF_DUTIES: 'SEPARATION_OF_DUTIES',
  CONFLICT_OF_INTEREST: 'CONFLICT_OF_INTEREST',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  NOT_IMPLEMENTED_IN_STAGE: 'NOT_IMPLEMENTED_IN_STAGE',
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_ENROLLMENT_REQUIRED: 'MFA_ENROLLMENT_REQUIRED',
  OTP_INVALID: 'OTP_INVALID',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const httpStatusForCode: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  ILLEGAL_TRANSITION: 409,
  PRECONDITION_FAILED: 412,
  SEPARATION_OF_DUTIES: 403,
  CONFLICT_OF_INTEREST: 403,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_NOT_CONFIGURED: 503,
  NOT_IMPLEMENTED_IN_STAGE: 501,
  MFA_REQUIRED: 403,
  MFA_ENROLLMENT_REQUIRED: 403,
  OTP_INVALID: 401,
  INTERNAL: 500,
};

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum(Object.keys(ErrorCodes) as [ErrorCode, ...ErrorCode[]]),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Thrown by domain/application code; the API layer serialises it into the envelope. */
export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
  get status(): number {
    return httpStatusForCode[this.code];
  }
}
