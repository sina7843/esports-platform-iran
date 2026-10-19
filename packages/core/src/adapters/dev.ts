import { mkdir, readFile, writeFile, unlink, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { DomainError, type Money, type ProviderHealth } from '@esp/contracts';
import type { EmailAdapter, MapAdapter, PaymentAdapter, PublisherAdapter, ScannerAdapter, SmsAdapter, StorageAdapter, VideoAdapter } from './types.js';

/**
 * Deterministic development doubles. They never contact a network, write their "outbound" messages to a
 * protected local inbox under DATA_DIR/dev-inbox (gitignored) and report `mode: development_double`.
 * They are NOT live integrations and production configuration refuses them.
 */
function health(kind: ProviderHealth['kind'], adapter: string, capabilities: string[], detail: string): ProviderHealth {
  return { kind, adapter, mode: 'development_double', status: 'ok', capabilities, detail, checkedAt: new Date().toISOString() };
}

async function appendInbox(dataDir: string, file: string, record: Record<string, unknown>): Promise<void> {
  const dir = join(dataDir, 'dev-inbox');
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, file), JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n', 'utf8');
}

export class DevPaymentAdapter implements PaymentAdapter {
  readonly name = 'dev-payment';
  readonly mode = 'development_double' as const;
  readonly capabilities = ['create', 'verify', 'refund', 'deterministic'] as const;
  private readonly store = new Map<string, { orderId: string; amount: Money; verified: boolean; refunded: number }>();
  constructor(private readonly dataDir: string) {}
  async health() {
    return health('payment', this.name, [...this.capabilities], 'test double: no real gateway; amounts never move');
  }
  async createPayment(input: { orderId: string; amount: Money; description: string; callbackUrl: string }) {
    const gatewayRef = `dev_${createHash('sha256').update(input.orderId).digest('hex').slice(0, 16)}`;
    if (!this.store.has(gatewayRef)) this.store.set(gatewayRef, { orderId: input.orderId, amount: input.amount, verified: false, refunded: 0 });
    await appendInbox(this.dataDir, 'payments.jsonl', { action: 'create', gatewayRef, ...input });
    return { gatewayRef, redirectUrl: `${input.callbackUrl}?ref=${gatewayRef}&dev=1` };
  }
  async verify(input: { gatewayRef: string; expectedAmount: Money; orderId: string }) {
    const p = this.store.get(input.gatewayRef);
    if (!p) return { status: 'unknown' as const, providerRef: null, amount: null };
    if (p.orderId !== input.orderId || p.amount.amount !== input.expectedAmount.amount) return { status: 'failed' as const, providerRef: null, amount: p.amount };
    p.verified = true; // idempotent: re-verify returns the same answer
    return { status: 'verified' as const, providerRef: `${input.gatewayRef}_ok`, amount: p.amount };
  }
  async refund(input: { providerRef: string; amount: Money; reason: string; idempotencyKey: string }) {
    await appendInbox(this.dataDir, 'payments.jsonl', { action: 'refund', ...input });
    return { status: 'accepted' as const, refundRef: `rf_${input.idempotencyKey}` };
  }
}

export class DevSmsAdapter implements SmsAdapter {
  readonly name = 'dev-sms';
  readonly mode = 'development_double' as const;
  readonly capabilities = ['send', 'otp', 'inbox-file'] as const;
  constructor(private readonly dataDir: string) {}
  async health() {
    return health('sms', this.name, [...this.capabilities], 'test double: messages written to DATA_DIR/dev-inbox/sms.jsonl');
  }
  async send(input: { to: string; text: string; kind: 'otp' | 'transactional' | 'promotional'; idempotencyKey: string }) {
    await appendInbox(this.dataDir, 'sms.jsonl', { ...input });
    return { status: 'sent' as const, providerRef: `sms_${input.idempotencyKey}` };
  }
}

export class DevEmailAdapter implements EmailAdapter {
  readonly name = 'dev-email';
  readonly mode = 'development_double' as const;
  readonly capabilities = ['send', 'inbox-file'] as const;
  constructor(private readonly dataDir: string) {}
  async health() {
    return health('email', this.name, [...this.capabilities], 'test double: messages written to DATA_DIR/dev-inbox/email.jsonl');
  }
  async send(input: { to: string; subject: string; text: string; html?: string; idempotencyKey: string }) {
    await appendInbox(this.dataDir, 'email.jsonl', { ...input });
    return { status: 'sent' as const, providerRef: `mail_${input.idempotencyKey}` };
  }
}

/** Local filesystem storage. Also valid for production when the host is inside Iran and the volume is backed up (13.1). */
export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'local-fs';
  readonly capabilities = ['put', 'get', 'delete', 'public-url', 'private-bucket'] as const;
  constructor(
    private readonly dataDir: string,
    private readonly publicBaseUrl: string,
    readonly mode: 'development_double' | 'production',
  ) {}
  private path(key: string, visibility: 'private' | 'public'): string {
    const base = resolve(this.dataDir, visibility === 'public' ? 'public-files' : 'private-files');
    const full = resolve(base, key);
    if (!full.startsWith(base + sep)) throw new DomainError('VALIDATION_FAILED', 'invalid storage key');
    return full;
  }
  async health() {
    const ok = existsSync(this.dataDir) || (await mkdir(this.dataDir, { recursive: true }).then(() => true).catch(() => false));
    return { kind: 'storage' as const, adapter: this.name, mode: this.mode, status: ok ? ('ok' as const) : ('down' as const), capabilities: [...this.capabilities], detail: `root=${resolve(this.dataDir)}`, checkedAt: new Date().toISOString() };
  }
  async put(key: string, data: Buffer, visibility: 'private' | 'public') {
    const p = this.path(key, visibility);
    await mkdir(resolve(p, '..'), { recursive: true });
    await writeFile(p, data, { mode: 0o600 });
  }
  async get(key: string, visibility: 'private' | 'public') {
    try {
      return await readFile(this.path(key, visibility));
    } catch {
      return null;
    }
  }
  async delete(key: string, visibility: 'private' | 'public') {
    await unlink(this.path(key, visibility)).catch(() => undefined);
  }
  publicUrl(key: string) {
    return `${this.publicBaseUrl}/api/v1/files/public/${key}`;
  }
}

export class DevVideoAdapter implements VideoAdapter {
  readonly name = 'dev-video';
  readonly mode = 'development_double' as const;
  readonly capabilities = ['stream-info'] as const;
  async health() {
    return health('video', this.name, [...this.capabilities], 'test double: no streaming provider selected (CAST-001 pending owner evaluation)');
  }
  async streamInfo(streamKey: string) {
    return { status: 'unknown' as const, playbackUrl: null, streamKey } as { status: 'unknown'; playbackUrl: null };
  }
}

export class DevMapAdapter implements MapAdapter {
  readonly name = 'dev-map';
  readonly mode = 'development_double' as const;
  readonly capabilities = ['geocode', 'static-map'] as const;
  async health() {
    return health('map', this.name, [...this.capabilities], 'test double: returns null; textual address is always shown (13.1)');
  }
  async geocode() {
    return null;
  }
  staticMapUrl() {
    return null;
  }
}

/** Publisher connectivity is a per-title documented exception; no double pretends availability. */
export class NoPublisherAdapter implements PublisherAdapter {
  readonly name = 'none';
  readonly mode = 'production' as const;
  readonly capabilities = [] as const;
  async health(): Promise<ProviderHealth> {
    return { kind: 'publisher', adapter: this.name, mode: this.mode, status: 'unconfigured', capabilities: [], detail: 'no publisher integration configured; manual authorized paths remain available (BASE-003, INTG-007)', checkedAt: new Date().toISOString() };
  }
  async availability(gameId: string) {
    return { status: 'unavailable' as const, detail: `no publisher connection for ${gameId}` };
  }
}

export class DevScannerAdapter implements ScannerAdapter {
  readonly name = 'dev-scanner';
  readonly mode = 'development_double' as const;
  readonly capabilities = ['eicar-detect'] as const;
  async health() {
    return health('scanner', this.name, [...this.capabilities], 'test double: only detects the EICAR test string; production must use ClamAV or an Iranian-hosted scanner');
  }
  async scan(data: Buffer) {
    const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    if (data.includes(Buffer.from(eicar, 'latin1'))) return { verdict: 'infected' as const, detail: 'EICAR test signature' };
    return { verdict: 'skipped_dev' as const };
  }
}
