import { ApiClientError, type ClientErrorCode } from './api/client';
import { t, type MessageKey } from './i18n';

export function toClientError(e: unknown): ApiClientError {
  return e instanceof ApiClientError ? e : new ApiClientError({ code: 'UNKNOWN', message: e instanceof Error ? e.message : 'Unknown', status: 0 });
}

export function errorText(code: ClientErrorCode): string {
  return t(`err.${code}` as MessageKey);
}

export function isForbidden(e: ApiClientError | null): boolean {
  return e?.code === 'FORBIDDEN' || e?.code === 'UNAUTHENTICATED';
}
