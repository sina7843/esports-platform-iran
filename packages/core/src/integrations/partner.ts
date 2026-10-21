import { createHash, randomBytes } from 'node:crypto';
import { DomainError, type Scope } from '@esp/contracts';
import type { Container } from '../container.js';
import type { PartnerClientDoc, WebhookDeliveryDoc, WebhookDoc } from '../db/collections-esp07.js';
import { hmacHex, safeEqual, seal, unseal } from '../identity/crypto.js';
import { newId } from '../ids.js';
import { LiveService } from '../live/live.js';
import { maxDelaySeconds } from '../live/policy.js';
import { assertPublicUrl } from './ssrf.js';

const iso = () => new Date().toISOString();
const SITE: Scope = { type: 'site', id: 'site' };
export const PARTNER_API_VERSION = 'v1';
const SKEW_MS = 5 * 60_000;
const SCOPES = ['events:read', 'results:read', 'news:read', 'webhooks:manage'] as const;
/** Event types a partner may receive; result-bearing ones wait for the longest stream delay (CAST-005, INTG-007). */
export const WEBHOOK_TYPES = ['competition.match.finalized', 'competition.event.finished', 'competition.event.closed', 'honors.issued', 'competition.result.corrected'] as const;
const RESULT_TYPES = new Set<string>(WEBHOOK_TYPES);
const MAX_ATTEMPTS = 6;
const BACKOFF_S = [30, 120, 600, 3600, 14_400, 43_200];

export interface PartnerRequest {
  method: string;
  path: string; // path + query exactly as sent
  body: string;
  headers: Record<string, string | undefined>;
}
export const signPartnerRequest = (secret: string, ts: string, nonce: string, method: string, path: string, body: string) =>
  hmacHex(secret, [ts, nonce, method.toUpperCase(), path, createHash('sha256').update(body).digest('hex')].join('\n'));

/**
 * INTG-005/006: public/partner API v1. Every request carries key id, timestamp, single-use nonce and an HMAC over
 * method, path and body hash; clients have scopes, an optional event list and a per-minute quota; every call is
 * audited. Data goes through the same publication policy as the public site (delay, provisional labels).
 * ponytail: quota counters are per process (like the HTTP rate limit); share them through Redis when scaling out.
 */
export class PartnerService {
  private readonly usage = new Map<string, { minute: number; n: number }>();
  constructor(private readonly ct: Container) {}
  private get c() {
    return this.ct.c;
  }
  private get secret() {
    return this.ct.config.appSecret;
  }

  async createClient(input: { name: string; scopes: PartnerClientDoc['scopes']; eventIds: string[]; quotaPerMinute: number }, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'partner.manage', SITE, requestId);
    if (!input.scopes.length || input.scopes.some((s) => !(SCOPES as readonly string[]).includes(s))) throw new DomainError('VALIDATION_FAILED', 'unknown scope');
    if (input.name.trim().length < 3) throw new DomainError('VALIDATION_FAILED', 'name is required');
    if (!Number.isInteger(input.quotaPerMinute) || input.quotaPerMinute < 1 || input.quotaPerMinute > 6000) throw new DomainError('VALIDATION_FAILED', 'quota is 1..6000 per minute');
    const keyId = `pk_${randomBytes(8).toString('hex')}`;
    const secret = randomBytes(32).toString('base64url');
    const doc: PartnerClientDoc = { _id: newId('ptn'), name: input.name.trim().slice(0, 120), scopes: input.scopes, eventIds: input.eventIds, keyId, secretEnc: seal(this.secret, secret), quotaPerMinute: input.quotaPerMinute, createdBy: actor, createdAt: iso(), revokedAt: null, lastUsedAt: null };
    await this.c.partnerClients.insertOne(doc);
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'partner.create', target: { type: 'partner', id: doc._id }, scope: SITE, outcome: 'success', details: { scopes: doc.scopes }, requestId });
    return { id: doc._id, keyId, secret, note: 'the secret is shown once' }; // never returned again
  }
  async rotate(id: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'partner.manage', SITE, requestId);
    const secret = randomBytes(32).toString('base64url');
    const r = await this.c.partnerClients.updateOne({ _id: id, revokedAt: null }, { $set: { secretEnc: seal(this.secret, secret) } });
    if (!r.matchedCount) throw new DomainError('NOT_FOUND', 'client not found');
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'partner.rotate', target: { type: 'partner', id }, scope: SITE, outcome: 'success', requestId });
    return { id, secret, note: 'the secret is shown once' };
  }
  async revoke(id: string, actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'partner.manage', SITE, requestId);
    const r = await this.c.partnerClients.updateOne({ _id: id, revokedAt: null }, { $set: { revokedAt: iso() } });
    if (!r.matchedCount) throw new DomainError('NOT_FOUND', 'client not found');
    await this.c.webhooks.updateMany({ clientId: id }, { $set: { active: false } });
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'partner.revoke', target: { type: 'partner', id }, scope: SITE, outcome: 'success', requestId });
  }
  async list(actor: string, requestId: string) {
    await this.ct.acl.require(actor, 'partner.manage', SITE, requestId);
    return (await this.c.partnerClients.find({}).sort({ createdAt: -1 }).toArray()).map(({ secretEnc: _s, ...p }) => p);
  }

  /** Verifies signature, freshness, replay and quota. Failures are audited without the secret. */
  async authenticate(req: PartnerRequest, now = Date.now()): Promise<PartnerClientDoc> {
    const keyId = req.headers['x-esp-key'];
    const ts = req.headers['x-esp-timestamp'];
    const nonce = req.headers['x-esp-nonce'];
    const sig = req.headers['x-esp-signature'];
    const deny = async (reason: string, status: 'UNAUTHENTICATED' | 'RATE_LIMITED' | 'FORBIDDEN' = 'UNAUTHENTICATED'): Promise<never> => {
      await this.ct.audit.append({ actorPrincipalId: keyId ? `partner:${keyId}` : 'partner:anonymous', action: 'partner.denied', target: { type: 'partner_api', id: req.path.split('?')[0]! }, scope: SITE, outcome: 'denied', details: { reason }, requestId: 'partner' });
      throw new DomainError(status, reason === 'quota' ? 'quota exceeded' : 'invalid partner credentials');
    };
    if (!keyId || !ts || !nonce || !sig || nonce.length < 12 || nonce.length > 80) return deny('missing_headers');
    const client = await this.c.partnerClients.findOne({ keyId });
    if (!client || client.revokedAt) return deny('unknown_or_revoked');
    const t = Number(ts);
    if (!Number.isFinite(t) || Math.abs(now - t) > SKEW_MS) return deny('stale_timestamp');
    const expected = signPartnerRequest(unseal(this.secret, client.secretEnc), ts, nonce, req.method, req.path, req.body);
    if (!safeEqual(expected, sig)) return deny('bad_signature');
    try {
      await this.c.partnerNonces.insertOne({ _id: `${keyId}:${nonce}`, at: new Date(now) });
    } catch {
      return deny('replay');
    }
    const minute = Math.floor(now / 60_000);
    const u = this.usage.get(client._id);
    if (!u || u.minute !== minute) this.usage.set(client._id, { minute, n: 1 });
    else if (++u.n > client.quotaPerMinute) return deny('quota', 'RATE_LIMITED');
    await this.c.partnerClients.updateOne({ _id: client._id }, { $set: { lastUsedAt: iso() } });
    return client;
  }
  private need(client: PartnerClientDoc, scope: PartnerClientDoc['scopes'][number], eventId?: string) {
    if (!client.scopes.includes(scope)) throw new DomainError('FORBIDDEN', `scope ${scope} is required`);
    if (eventId && client.eventIds.length && !client.eventIds.includes(eventId)) throw new DomainError('NOT_FOUND', 'not found');
  }
  private async log(client: PartnerClientDoc, action: string, id: string) {
    await this.ct.audit.append({ actorPrincipalId: `partner:${client.keyId}`, action: `partner.${action}`, target: { type: 'partner_api', id }, scope: SITE, outcome: 'success', requestId: 'partner' });
  }

  // ---- data (public information only, delay policy applied by the shared live service)
  async events(client: PartnerClientDoc) {
    this.need(client, 'events:read');
    await this.log(client, 'events.list', '*');
    const rows = await this.c.events.find({ visibility: 'public', state: { $in: ['published', 'registration_open', 'registration_closed', 'live', 'finished', 'closed', 'archived'] }, ...(client.eventIds.length ? { _id: { $in: client.eventIds } } : {}) } as never, { projection: { slug: 1, name: 1, state: 1, startsAt: 1, endsAt: 1 } }).sort({ startsAt: -1 }).limit(100).toArray();
    return { apiVersion: PARTNER_API_VERSION, items: rows.map((e) => ({ id: e._id, slug: e.slug, name: e.name, state: e.state, startsAt: e.startsAt, endsAt: e.endsAt })) };
  }
  async results(client: PartnerClientDoc, eventId: string, view?: string) {
    this.need(client, 'results:read', eventId);
    await this.log(client, 'results.read', eventId);
    const s = await new LiveService(this.ct).snapshot(eventId, view, {}, null, null);
    return { apiVersion: PARTNER_API_VERSION, view: s.view, serverTime: s.serverTime, event: s.event, now: s.now, results: s.results, next: s.next, archive: s.archive };
  }
  async news(client: PartnerClientDoc, eventId: string) {
    this.need(client, 'news:read', eventId);
    await this.log(client, 'news.read', eventId);
    const live = new LiveService(this.ct);
    await live.event(eventId, null, null);
    const v = await live.view(eventId, undefined);
    return { apiVersion: PARTNER_API_VERSION, ...(await live.timeline(eventId, v, {})) };
  }

  // ---- webhooks
  async createWebhook(client: PartnerClientDoc, input: { url: string; events: string[] }, opts: { allowPrivate?: boolean } = {}) {
    this.need(client, 'webhooks:manage');
    if (!input.events.length || input.events.some((e) => !(WEBHOOK_TYPES as readonly string[]).includes(e))) throw new DomainError('VALIDATION_FAILED', 'unknown event type');
    await assertPublicUrl(input.url, opts);
    if ((await this.c.webhooks.countDocuments({ clientId: client._id, active: true })) >= 10) throw new DomainError('CONFLICT', 'at most 10 active webhooks per client');
    const secret = randomBytes(32).toString('base64url');
    const doc: WebhookDoc = { _id: newId('whk'), clientId: client._id, url: input.url, events: input.events, secretEnc: seal(this.secret, secret), active: true, createdBy: `partner:${client.keyId}`, createdAt: iso() };
    await this.c.webhooks.insertOne(doc);
    await this.log(client, 'webhook.create', doc._id);
    return { id: doc._id, url: doc.url, events: doc.events, secret, note: 'the secret is shown once' };
  }
  async listWebhooks(client: PartnerClientDoc) {
    this.need(client, 'webhooks:manage');
    return (await this.c.webhooks.find({ clientId: client._id }).toArray()).map(({ secretEnc: _s, ...w }) => w);
  }
  async deleteWebhook(client: PartnerClientDoc, id: string) {
    this.need(client, 'webhooks:manage');
    const r = await this.c.webhooks.updateOne({ _id: id, clientId: client._id }, { $set: { active: false } });
    if (!r.matchedCount) throw new DomainError('NOT_FOUND', 'not found');
    await this.log(client, 'webhook.delete', id);
  }
}

/** Outbox consumer: one delivery per (hook, event) — redelivery of the same event changes nothing. */
export async function enqueueWebhooks(ct: Container, event: { id: string; type: string; payload: Record<string, unknown>; occurredAt: string }): Promise<number> {
  if (!RESULT_TYPES.has(event.type)) return 0;
  const hooks = await ct.c.webhooks.find({ active: true, events: event.type }).toArray();
  if (!hooks.length) return 0;
  const eventId = typeof event.payload['eventId'] === 'string' ? event.payload['eventId'] : null;
  const clients = new Map((await ct.c.partnerClients.find({ _id: { $in: hooks.map((h) => h.clientId) }, revokedAt: null }).toArray()).map((c) => [c._id, c]));
  const delay = await maxDelaySeconds(ct.c, eventId); // never ahead of the broadcast
  const at = new Date(Date.parse(event.occurredAt) + delay * 1000).toISOString();
  let n = 0;
  for (const h of hooks) {
    const cl = clients.get(h.clientId);
    if (!cl || !cl.scopes.includes('results:read') || (eventId && cl.eventIds.length && !cl.eventIds.includes(eventId))) continue;
    const doc: WebhookDeliveryDoc = { _id: `${h._id}:${event.id}`, webhookId: h._id, eventId: event.id, type: event.type, payload: { apiVersion: PARTNER_API_VERSION, id: event.id, type: event.type, occurredAt: event.occurredAt, data: { eventId, matchId: event.payload['matchId'] ?? null } }, attempts: 0, state: 'pending', nextAttemptAt: at, lastStatus: null, lastError: null, createdAt: iso(), deliveredAt: null };
    const r = await ct.c.webhookDeliveries.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
    if (r.upsertedCount) n++;
  }
  return n;
}

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number }>;

/** Delivery job: signed POST, bounded retries with backoff, then dead-letter (replayable by an operator). */
export async function deliverWebhooks(ct: Container, opts: { now?: Date; fetcher?: Fetcher; allowPrivate?: boolean; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const doFetch: Fetcher = opts.fetcher ?? ((url, init) => fetch(url, { ...init, redirect: 'manual' }));
  const out = { delivered: 0, retried: 0, dead: 0 };
  const due = await ct.c.webhookDeliveries.find({ state: 'pending', nextAttemptAt: { $lte: now.toISOString() } }).sort({ nextAttemptAt: 1 }).limit(opts.limit ?? 50).toArray();
  for (const d of due) {
    const claimed = await ct.c.webhookDeliveries.findOneAndUpdate({ _id: d._id, state: 'pending', attempts: d.attempts }, { $inc: { attempts: 1 }, $set: { nextAttemptAt: new Date(now.getTime() + 120_000).toISOString() } }, { returnDocument: 'after' });
    if (!claimed) continue;
    const hook = await ct.c.webhooks.findOne({ _id: d.webhookId });
    let status: number | null = null;
    let error: string | null = null;
    if (!hook || !hook.active) error = 'webhook disabled';
    else {
      try {
        const body = JSON.stringify(d.payload);
        const ts = String(now.getTime());
        const url = await assertPublicUrl(hook.url, opts.allowPrivate ? { allowPrivate: true } : {});
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 5000);
        try {
          const r = await doFetch(url.toString(), { method: 'POST', headers: { 'content-type': 'application/json', 'x-esp-delivery': d._id, 'x-esp-timestamp': ts, 'x-esp-signature': hmacHex(unseal(ct.config.appSecret, hook.secretEnc), `${ts}.${body}`) }, body, signal: ctl.signal });
          status = r.status;
        } finally {
          clearTimeout(timer);
        }
        if (status < 200 || status >= 300) error = `HTTP ${status}`;
      } catch (e) {
        error = (e as Error).message.slice(0, 200);
      }
    }
    if (!error) {
      await ct.c.webhookDeliveries.updateOne({ _id: d._id }, { $set: { state: 'delivered', deliveredAt: iso(), lastStatus: status, lastError: null } });
      out.delivered++;
    } else if (claimed.attempts >= MAX_ATTEMPTS || !hook?.active) {
      await ct.c.webhookDeliveries.updateOne({ _id: d._id }, { $set: { state: 'dead', lastStatus: status, lastError: error } });
      out.dead++;
    } else {
      await ct.c.webhookDeliveries.updateOne({ _id: d._id }, { $set: { nextAttemptAt: new Date(now.getTime() + BACKOFF_S[Math.min(claimed.attempts - 1, BACKOFF_S.length - 1)]! * 1000).toISOString(), lastStatus: status, lastError: error } });
      out.retried++;
    }
  }
  return out;
}

/** Operator replay of a dead delivery (INTG-003 DLQ). */
export async function replayWebhook(ct: Container, id: string, actor: string, requestId: string) {
  await ct.acl.require(actor, 'partner.manage', SITE, requestId);
  const r = await ct.c.webhookDeliveries.updateOne({ _id: id, state: 'dead' }, { $set: { state: 'pending', attempts: 0, nextAttemptAt: iso(), lastError: null } });
  if (!r.matchedCount) throw new DomainError('NOT_FOUND', 'dead delivery not found');
  await ct.audit.append({ actorPrincipalId: actor, action: 'webhook.replay', target: { type: 'webhook_delivery', id }, scope: SITE, outcome: 'success', requestId });
}

export function registerPartnerConsumers(ct: Container): void {
  ct.consumer.register({
    name: 'partner-webhooks',
    matches: [...WEBHOOK_TYPES],
    async handle(event) {
      await enqueueWebhooks(ct, event);
    },
  });
}
