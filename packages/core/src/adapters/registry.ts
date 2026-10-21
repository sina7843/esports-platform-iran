import { DomainError, type ProviderHealth } from '@esp/contracts';
import type { AppConfig } from '../config.js';
import type { AdapterBase, Adapters } from './types.js';
import type { Db } from 'mongodb';
import { DevGatewayAdapter } from './devGateway.js';
import { ClamAvAdapter } from './clamav.js';
import { resilient } from '../integrations/providers.js';
import { DevEmailAdapter, DevMapAdapter, DevScannerAdapter, DevSmsAdapter, DevVideoAdapter, LocalStorageAdapter, NoPublisherAdapter } from './dev.js';

/**
 * Adapter selection from configuration. 'none' yields a blocking adapter that reports `unconfigured` and throws
 * PROVIDER_NOT_CONFIGURED on use — production fails loudly instead of degrading to a double (D-004).
 * Production adapters for the selected Iranian providers are added in later stages behind these same interfaces.
 */
function unconfigured<T extends AdapterBase>(kind: ProviderHealth['kind'], methods: string[]): T {
  const base = {
    name: 'none',
    mode: 'production' as const,
    capabilities: [] as string[],
    async health(): Promise<ProviderHealth> {
      return { kind, adapter: 'none', mode: 'production', status: 'unconfigured', capabilities: [], detail: `${kind} provider not configured; the owner selects an Iranian provider after evaluation (INTG-001)`, checkedAt: new Date().toISOString() };
    },
  } as Record<string, unknown>;
  for (const m of methods) {
    base[m] = async () => {
      throw new DomainError('PROVIDER_NOT_CONFIGURED', `${kind} provider is not configured`);
    };
  }
  return base as unknown as T;
}

export function buildAdapters(config: AppConfig, db: Db): Adapters {
  const storageMode = config.isProduction ? 'production' : 'development_double';
  return resilient({
    payment: config.PAYMENT_ADAPTER === 'dev' ? new DevGatewayAdapter(db, config.appSecret, config.PUBLIC_API_ORIGIN) : unconfigured('payment', ['createPayment', 'verify', 'refund', 'verifyCallback']),
    sms: config.SMS_ADAPTER === 'dev' ? new DevSmsAdapter(config.DATA_DIR) : unconfigured('sms', ['send']),
    email: config.EMAIL_ADAPTER === 'dev' ? new DevEmailAdapter(config.DATA_DIR) : unconfigured('email', ['send']),
    storage: config.STORAGE_ADAPTER === 'local' ? new LocalStorageAdapter(config.DATA_DIR, config.PUBLIC_API_ORIGIN, storageMode) : unconfigured('storage', ['put', 'get', 'delete', 'publicUrl']),
    video: config.VIDEO_ADAPTER === 'dev' ? new DevVideoAdapter() : unconfigured('video', ['streamInfo']),
    map: config.MAP_ADAPTER === 'dev' ? new DevMapAdapter() : unconfigured('map', ['geocode', 'staticMapUrl']),
    publisher: new NoPublisherAdapter(),
    scanner: config.SCANNER_ADAPTER === 'dev' ? new DevScannerAdapter() : config.SCANNER_ADAPTER === 'clamav' && config.CLAMAV_HOST ? new ClamAvAdapter(config.CLAMAV_HOST, config.CLAMAV_PORT ?? 3310) : unconfigured('scanner', ['scan']),
  });
}

export async function adaptersHealth(adapters: Adapters): Promise<ProviderHealth[]> {
  return Promise.all(Object.values(adapters).map((a) => a.health()));
}
