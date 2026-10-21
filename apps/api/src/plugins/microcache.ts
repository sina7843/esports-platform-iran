import type { FastifyInstance } from 'fastify';

/**
 * Single-flight micro-cache for viewer-independent public reads (NFR-001/002): concurrent identical requests share one
 * computation and a result is reused for a very short TTL. Only used where the response is the same for every viewer
 * (public events' stream-synced views). Staleness is bounded by `ttlMs` and is already inside the stream delay;
 * realtime catch-up replays anything after the cached cursor, so a cached snapshot can only cause a replay, never a gap.
 * ponytail: per process (each replica warms its own copy); put a shared cache or the CDN in front when scaling out.
 */
const store = new Map<string, { at: number; value: unknown }>();
const flights = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 2000;

export async function shared<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const running = flights.get(key);
  if (running) return running as Promise<T>;
  const p = compute()
    .then((value) => {
      if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string);
      store.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => flights.delete(key));
  flights.set(key, p);
  return p;
}
export const clearMicroCache = (): void => store.clear();

/**
 * Admission control: beyond `maxInflight` concurrent requests the API answers 503 + Retry-After immediately instead of
 * queueing without bound until memory is exhausted (found by the load run: 13k queued requests exhausted the heap).
 * Health probes are exempt so orchestration still sees the process.
 */
export function registerAdmissionControl(app: FastifyInstance, maxInflight: number): void {
  let inflight = 0;
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.includes('/health/')) return;
    if (inflight >= maxInflight) {
      void reply.header('retry-after', '2');
      return reply.code(503).send({ error: { code: 'PROVIDER_UNAVAILABLE', message: 'the service is busy; retry shortly', requestId: req.id } });
    }
    inflight++;
    reply.raw.once('close', () => {
      inflight--;
    });
  });
}
