import type { Money, ProviderHealth } from '@esp/contracts';

/**
 * Provider adapter contracts (INTG-002/003/007, BASE-002). Every adapter declares its capabilities and a health
 * probe. Development doubles are deterministic and clearly labeled `mode: 'development_double'`; production
 * wiring refuses them (see config.ts). Real Iranian providers are selected by the owner after evaluation
 * (INTG-001) and implemented against the current official contract at that time — no provider is pre-selected here.
 */
export interface AdapterBase {
  readonly name: string;
  readonly mode: 'development_double' | 'production';
  readonly capabilities: readonly string[];
  health(): Promise<ProviderHealth>;
}

export interface PaymentAdapter extends AdapterBase {
  /** Creates a gateway payment and returns the redirect target. `orderId` is the idempotency key. */
  createPayment(input: { orderId: string; amount: Money; description: string; callbackUrl: string }): Promise<{ gatewayRef: string; redirectUrl: string }>;
  /** Server-side verification (FIN-002). Must be idempotent per gatewayRef (FIN-004). */
  verify(input: { gatewayRef: string; expectedAmount: Money; orderId: string }): Promise<{ status: 'verified' | 'failed' | 'unknown'; providerRef: string | null; amount: Money | null }>;
  refund(input: { providerRef: string; amount: Money; reason: string; idempotencyKey: string }): Promise<{ status: 'accepted' | 'rejected' | 'unknown'; refundRef: string | null }>;
}

export interface SmsAdapter extends AdapterBase {
  send(input: { to: string; text: string; kind: 'otp' | 'transactional' | 'promotional'; idempotencyKey: string }): Promise<{ status: 'queued' | 'sent' | 'failed'; providerRef: string | null }>;
  deliveryStatus?(providerRef: string): Promise<'delivered' | 'failed' | 'unknown'>;
}

export interface EmailAdapter extends AdapterBase {
  send(input: { to: string; subject: string; text: string; html?: string; idempotencyKey: string }): Promise<{ status: 'queued' | 'sent' | 'failed'; providerRef: string | null }>;
}

export interface StorageAdapter extends AdapterBase {
  put(key: string, data: Buffer, visibility: 'private' | 'public', contentType: string): Promise<void>;
  get(key: string, visibility: 'private' | 'public'): Promise<Buffer | null>;
  delete(key: string, visibility: 'private' | 'public'): Promise<void>;
  publicUrl(key: string): string | null;
}

export interface VideoAdapter extends AdapterBase {
  /** Returns stream descriptors for a channel; provider is Iranian or self-hosted (CAST-001). */
  streamInfo(streamKey: string): Promise<{ status: 'live' | 'offline' | 'unknown'; playbackUrl: string | null }>;
}

export interface MapAdapter extends AdapterBase {
  /** Textual address must always be available even when the map provider is down. */
  geocode(address: string): Promise<{ lat: number; lng: number } | null>;
  staticMapUrl(lat: number, lng: number): string | null;
}

export interface PublisherAdapter extends AdapterBase {
  /** Per-title exception (13.2). Returns availability; core workflows never depend on it (BASE-003). */
  availability(gameId: string): Promise<{ status: 'unavailable' | 'limited' | 'available'; detail: string }>;
}

export interface ScannerAdapter extends AdapterBase {
  scan(data: Buffer): Promise<{ verdict: 'clean' | 'infected' | 'failed' | 'skipped_dev'; detail?: string }>;
}

export interface Adapters {
  payment: PaymentAdapter;
  sms: SmsAdapter;
  email: EmailAdapter;
  storage: StorageAdapter;
  video: VideoAdapter;
  map: MapAdapter;
  publisher: PublisherAdapter;
  scanner: ScannerAdapter;
}
