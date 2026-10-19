import { reactive } from 'vue';
import { rolePermissions, type MeResponse } from '@esp/contracts';
import { api, ApiClientError } from './api/client';

/** Tiny reactive session store (no pinia). `loaded` flips once after the first /auth/me attempt. */
export const session = reactive<{ me: MeResponse | null; loaded: boolean }>({ me: null, loaded: false });

let inflight: Promise<MeResponse | null> | null = null;

/** Fetches /auth/me once. 401 means anonymous; network/other errors propagate and are retried on the next call. */
export function ensureMe(): Promise<MeResponse | null> {
  if (session.loaded) return Promise.resolve(session.me);
  inflight ??= api
    .me()
    .then((me) => {
      session.me = me;
      session.loaded = true;
      return me;
    })
    .catch((e: unknown) => {
      if (e instanceof ApiClientError && e.code === 'UNAUTHENTICATED') {
        session.me = null;
        session.loaded = true;
        return null;
      }
      throw e;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function setMe(me: MeResponse | null): void {
  session.me = me;
  session.loaded = true;
}

export function resetSession(): void {
  session.me = null;
  session.loaded = false;
  inflight = null;
}

/** Client-side hint only: the server re-checks every request against the scope of the resource. */
export function can(permission: string): boolean {
  const now = Date.now();
  return (
    session.me?.grants.some(
      (g) =>
        !g.revokedAt &&
        (!g.expiresAt || Date.parse(g.expiresAt) > now) &&
        (rolePermissions[g.role] as readonly string[]).includes(permission),
    ) ?? false
  );
}
