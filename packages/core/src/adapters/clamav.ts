import { connect, type Socket } from 'node:net';
import type { ProviderHealth } from '@esp/contracts';
import type { ScannerAdapter } from './types.js';

/**
 * Self-hosted ClamAV (clamd) scanner over its TCP INSTREAM protocol (SEC-004, INTG-002). No external service: clamd runs
 * on the platform's own network. A clamd outage never reports "clean": the verdict is `failed`, which the upload path
 * treats as quarantine/refusal.
 */
const CHUNK = 64 * 1024;

function exchange(host: string, port: number, timeoutMs: number, run: (s: Socket) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = connect({ host, port });
    const chunks: Buffer[] = [];
    const fail = (e: Error) => {
      s.destroy();
      reject(e);
    };
    s.setTimeout(timeoutMs, () => fail(new Error('clamd timeout')));
    s.on('error', fail);
    s.on('data', (d) => chunks.push(d));
    s.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim()));
    s.on('connect', () => run(s));
  });
}

export class ClamAvAdapter implements ScannerAdapter {
  readonly name = 'clamav';
  readonly mode = 'production' as const;
  readonly capabilities = ['scan', 'instream'] as const;
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 15_000,
  ) {}

  async health(): Promise<ProviderHealth> {
    const base = { kind: 'scanner' as const, adapter: this.name, mode: this.mode, capabilities: [...this.capabilities], checkedAt: new Date().toISOString() };
    try {
      const r = await exchange(this.host, this.port, 3000, (s) => s.end('zPING\0'));
      return r === 'PONG' ? { ...base, status: 'ok', detail: `clamd ${this.host}:${this.port}` } : { ...base, status: 'degraded', detail: `unexpected reply: ${r.slice(0, 40)}` };
    } catch (e) {
      return { ...base, status: 'down', detail: (e as Error).message };
    }
  }

  async scan(data: Buffer): Promise<{ verdict: 'clean' | 'infected' | 'failed'; detail?: string }> {
    try {
      const reply = await exchange(this.host, this.port, this.timeoutMs, (s) => {
        s.write('zINSTREAM\0');
        for (let i = 0; i < data.length; i += CHUNK) {
          const part = data.subarray(i, i + CHUNK);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.length);
          s.write(len);
          s.write(part);
        }
        s.end(Buffer.alloc(4)); // zero-length chunk terminates the stream
      });
      if (/\bOK$/.test(reply)) return { verdict: 'clean' };
      const found = /^stream:\s*(.+?)\s+FOUND$/.exec(reply);
      if (found) return { verdict: 'infected', detail: found[1]! };
      return { verdict: 'failed', detail: reply.slice(0, 120) || 'empty reply' };
    } catch (e) {
      return { verdict: 'failed', detail: (e as Error).message };
    }
  }
}
