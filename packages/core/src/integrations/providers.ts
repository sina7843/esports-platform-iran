import { DomainError, type ProviderHealth, type Scope } from '@esp/contracts';
import type { Container } from '../container.js';
import type { Adapters } from '../adapters/types.js';
import type { ProviderDoc } from '../db/collections-esp07.js';
import { newId } from '../ids.js';
import { clean } from '../news/news.js';

const iso = () => new Date().toISOString();
const SITE: Scope = { type: 'site', id: 'site' };

/**
 * INTG-002/003 resilience around every provider call: a per-provider circuit breaker, bounded retry with backoff for
 * idempotent operations only, and a per-minute quota. Business errors (DomainError other than provider
 * unavailability) pass through untouched and never trip the breaker. Failures that survive retries surface to the
 * caller, whose outbox/notification job records them and dead-letters after its own attempts (INTG-003 DLQ).
 * ponytail: breaker and quota state is per process; a multi-replica deployment shares it through Redis or accepts
 * per-replica limits.
 */
export interface BreakerState {
  kind: string;
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  openedAt: number | null;
  lastError: string | null;
  calls: number;
  rejected: number;
  quotaPerMinute: number | null;
}
const FAIL_THRESHOLD = 5;
const OPEN_MS = 30_000;
const IDEMPOTENT: Record<string, string[]> = {
  payment: ['verify'], // createPayment/refund carry idempotency keys but are not retried blindly; their callers reconcile
  storage: ['put', 'get', 'delete'],
  video: ['streamInfo'],
  map: ['geocode'],
  scanner: ['scan'],
  publisher: ['availability'],
};
/** The provider calls of each adapter contract (adapters/types.ts); helpers and sync methods pass through. */
const CALLS: Record<string, string[]> = {
  payment: ['createPayment', 'verify', 'refund'],
  sms: ['send', 'deliveryStatus'],
  email: ['send'],
  storage: ['put', 'get', 'delete'],
  video: ['streamInfo'],
  map: ['geocode'],
  publisher: ['availability'],
  scanner: ['scan'],
};
const breakers = new Map<string, BreakerState & { window: number; windowCalls: number }>();
const state = (kind: string) => {
  let b = breakers.get(kind);
  if (!b) breakers.set(kind, (b = { kind, state: 'closed', failures: 0, openedAt: null, lastError: null, calls: 0, rejected: 0, quotaPerMinute: null, window: 0, windowCalls: 0 }));
  return b;
};
export const breakerStates = (): BreakerState[] => [...breakers.values()].map(({ window: _w, windowCalls: _c, ...s }) => s);
export const setQuota = (kind: string, perMinute: number | null) => {
  state(kind).quotaPerMinute = perMinute;
};
/** Test/ops hook: close a breaker after the provider is repaired. */
export const resetBreaker = (kind: string) => {
  breakers.delete(kind);
};
const isProviderFailure = (e: unknown) => !(e instanceof DomainError) || e.code === 'PROVIDER_UNAVAILABLE';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function guarded<T>(kind: string, method: string, fn: () => Promise<T>, opts: { retries?: number; backoffMs?: number; now?: () => number } = {}): Promise<T> {
  const b = state(kind);
  const now = opts.now ?? Date.now;
  const minute = Math.floor(now() / 60_000);
  if (b.window !== minute) Object.assign(b, { window: minute, windowCalls: 0 });
  if (b.quotaPerMinute !== null && b.windowCalls >= b.quotaPerMinute) {
    b.rejected++;
    throw new DomainError('RATE_LIMITED', `${kind} provider quota reached (${b.quotaPerMinute}/min)`);
  }
  if (b.state === 'open') {
    if (now() - (b.openedAt ?? 0) < OPEN_MS) {
      b.rejected++;
      throw new DomainError('PROVIDER_UNAVAILABLE', `${kind} provider circuit is open after repeated failures`);
    }
    b.state = 'half_open';
  }
  const retries = (IDEMPOTENT[kind] ?? []).includes(method) ? (opts.retries ?? 2) : 0;
  for (let attempt = 0; ; attempt++) {
    b.calls++;
    b.windowCalls++;
    try {
      const r = await fn();
      Object.assign(b, { state: 'closed', failures: 0, openedAt: null });
      return r;
    } catch (e) {
      if (!isProviderFailure(e)) throw e;
      b.failures++;
      b.lastError = (e as Error).message.slice(0, 200);
      if (b.state === 'half_open' || b.failures >= FAIL_THRESHOLD) {
        Object.assign(b, { state: 'open', openedAt: now() });
        throw e instanceof DomainError ? e : new DomainError('PROVIDER_UNAVAILABLE', `${kind} provider failed: ${b.lastError}`);
      }
      if (attempt >= retries) throw e instanceof DomainError ? e : new DomainError('PROVIDER_UNAVAILABLE', `${kind} provider failed: ${b.lastError}`);
      await sleep((opts.backoffMs ?? 200) * 2 ** attempt);
    }
  }
}

/** Wrap every async adapter method with `guarded`; health reports an open circuit as degraded. */
export function resilient(adapters: Adapters): Adapters {
  const out = {} as Record<string, unknown>;
  for (const [kind, a] of Object.entries(adapters)) {
    out[kind] = new Proxy(a as object, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver) as unknown;
        if (typeof v !== 'function' || typeof prop !== 'string') return v;
        if (prop === 'health') {
          return async (): Promise<ProviderHealth> => {
            const h = await (v as () => Promise<ProviderHealth>).call(target);
            const b = breakers.get(kind);
            return b && b.state !== 'closed' && h.status === 'ok' ? { ...h, status: 'degraded', detail: `circuit ${b.state}: ${b.lastError ?? ''}` } : h;
          };
        }
        if (!(CALLS[kind] ?? []).includes(prop)) return (v as (...x: unknown[]) => unknown).bind(target);
        return (...args: unknown[]) => guarded(kind, prop, () => (v as (...x: unknown[]) => Promise<unknown>).apply(target, args));
      },
    });
  }
  return out as unknown as Adapters;
}

/**
 * INTG-001/004/006 provider registry: candidates with an evaluation (capabilities, limits, cost, contract, exit plan,
 * test result), selection rules (Iranian or self-hosted, or a documented publisher exception), the network
 * allowlist derived from selected providers and the readiness checklist. Keys are never stored here: only the
 * names of the environment variables, and readiness reports whether each is set — never its value.
 */
export class ProviderRegistryService {
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  async list(actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'providers.manage', SITE, requestId);
    return this.c.providers.find({}).sort({ category: 1, name: 1 }).toArray();
  }
  async upsert(input: { id?: string | undefined; category: ProviderDoc['category']; name: string; origins: string[]; iranian: boolean; selfHosted: boolean; publisherException: ProviderDoc['publisherException']; evaluation: Omit<ProviderDoc['evaluation'], 'testedAt' | 'testedBy'>; keyEnvNames: string[]; quota: ProviderDoc['quota'] }, actor: string, requestId: string): Promise<ProviderDoc> {
    await this.ct.acl.require(actor, 'providers.manage', SITE, requestId);
    const origins = input.origins.map((o) => {
      let u: URL;
      try {
        u = new URL(o);
      } catch {
        throw new DomainError('VALIDATION_FAILED', `invalid origin ${o}`);
      }
      if (u.protocol !== 'https:' && !input.selfHosted) throw new DomainError('VALIDATION_FAILED', 'external provider origins must use https');
      return u.origin;
    });
    if (input.keyEnvNames.some((k) => !/^[A-Z][A-Z0-9_]{2,63}$/.test(k))) throw new DomainError('VALIDATION_FAILED', 'key names are environment variable names, never values');
    const now = iso();
    const evaluation = { ...input.evaluation, limits: clean(input.evaluation.limits, 2000), costNote: clean(input.evaluation.costNote, 2000), exitPlan: clean(input.evaluation.exitPlan, 2000), testedAt: input.evaluation.result === 'not_tested' ? null : now, testedBy: input.evaluation.result === 'not_tested' ? null : actor };
    const id = input.id ?? newId('prv');
    const r = (await this.c.providers.findOneAndUpdate(
      { _id: id },
      { $set: { category: input.category, name: clean(input.name, 120), origins, iranian: input.iranian, selfHosted: input.selfHosted, publisherException: input.publisherException, evaluation, keyEnvNames: input.keyEnvNames, quota: input.quota }, $setOnInsert: { state: 'candidate', decidedBy: null, decidedAt: null, createdBy: actor, createdAt: now }, $inc: { version: 1 } },
      { upsert: true, returnDocument: 'after' },
    ))!;
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'provider.upsert', target: { type: 'provider', id }, scope: SITE, outcome: 'success', details: { result: evaluation.result }, requestId });
    return r;
  }
  async decide(id: string, decision: 'selected' | 'rejected' | 'retired', actor: string, requestId: string): Promise<ProviderDoc> {
    await this.ct.acl.require(actor, 'providers.manage', SITE, requestId);
    const p = await this.c.providers.findOne({ _id: id });
    if (!p) throw new DomainError('NOT_FOUND', 'provider not found');
    if (decision === 'selected') {
      const why: string[] = [];
      if (!p.iranian && !p.selfHosted && !p.publisherException) why.push('the provider must be Iranian or self-hosted, or carry a documented publisher exception (13.2)');
      if (p.evaluation.result !== 'passed') why.push('the evaluation test has not passed');
      if (p.evaluation.exitPlan.length < 10) why.push('an exit plan is required');
      if (!p.evaluation.contractRef) why.push('a contract or terms reference is required');
      if (why.length) throw new DomainError('PRECONDITION_FAILED', why.join('; '));
    }
    const r = (await this.c.providers.findOneAndUpdate({ _id: id }, { $set: { state: decision, decidedBy: actor, decidedAt: iso() }, $inc: { version: 1 } }, { returnDocument: 'after' }))!;
    if (decision === 'selected' && p.quota.perMinute) setQuota(p.category, p.quota.perMinute);
    await this.ct.audit.append({ actorPrincipalId: actor, action: `provider.${decision}`, target: { type: 'provider', id }, scope: SITE, outcome: 'success', requestId });
    return r;
  }
  /** INTG-006 allowlist: the only external origins the server may call. */
  async allowlist(): Promise<string[]> {
    return [...new Set((await this.c.providers.find({ state: 'selected' }, { projection: { origins: 1 } }).toArray()).flatMap((p) => p.origins))].sort();
  }
  async isAllowedOrigin(url: string): Promise<boolean> {
    try {
      return (await this.allowlist()).includes(new URL(url).origin);
    } catch {
      return false;
    }
  }
  /** INTG-009 readiness checklist: what blocks production for each provider category the product uses. */
  async readiness(actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'providers.manage', SITE, requestId);
    const health = await Promise.all(Object.values(this.ct.adapters).map((a) => a.health()));
    const selected = await this.c.providers.find({ state: 'selected' }).toArray();
    const kinds: Array<ProviderHealth['kind']> = ['payment', 'sms', 'email', 'storage', 'video', 'map', 'scanner', 'publisher'];
    const rows = kinds.map((kind) => {
      const h = health.find((x) => x.kind === kind);
      const p = selected.find((s) => s.category === kind);
      const blockers: string[] = [];
      if (!p) blockers.push('no provider selected after evaluation');
      if (h?.mode !== 'production') blockers.push('a development double is wired (forbidden in production)');
      if (h && h.status !== 'ok') blockers.push(`health: ${h.status}`);
      const keys = (p?.keyEnvNames ?? []).map((name) => ({ name, set: typeof process.env[name] === 'string' && process.env[name] !== '' }));
      for (const k of keys) if (!k.set) blockers.push(`environment variable ${k.name} is not set`);
      return { kind, provider: p ? { id: p._id, name: p.name, iranian: p.iranian, selfHosted: p.selfHosted } : null, adapter: h?.adapter ?? null, mode: h?.mode ?? null, status: h?.status ?? null, keys, ready: blockers.length === 0, blockers, optional: kind === 'publisher' };
    });
    return { at: iso(), ready: rows.every((r) => r.ready || r.optional), rows, breakers: breakerStates() };
  }
}
