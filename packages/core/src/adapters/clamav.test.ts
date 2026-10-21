import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { ClamAvAdapter } from './clamav.js';

/**
 * Protocol test against a stub that speaks clamd's INSTREAM/PING framing. It proves the framing, verdict mapping and
 * outage handling; it is NOT evidence about a real clamd (that needs the self-hosted daemon, see readiness.md).
 */
let server: Server;
let port = 0;
let received = Buffer.alloc(0);
let mode: 'ok' | 'found' | 'error' | 'hang' = 'ok';
beforeAll(async () => {
  server = createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.subarray(0, 6).toString() === 'zPING\0' && buf.length >= 6) {
        sock.end('PONG\0');
        return;
      }
      if (buf.subarray(0, 10).toString() === 'zINSTREAM\0') {
        // walk the length-prefixed chunks until the zero-length terminator
        let off = 10;
        const body: Buffer[] = [];
        while (off + 4 <= buf.length) {
          const len = buf.readUInt32BE(off);
          if (len === 0) {
            received = Buffer.concat(body);
            if (mode === 'hang') return;
            sock.end(mode === 'ok' ? 'stream: OK\0' : mode === 'found' ? 'stream: Eicar-Test-Signature FOUND\0' : 'INSTREAM size limit exceeded. ERROR\0');
            return;
          }
          if (off + 4 + len > buf.length) return;
          body.push(buf.subarray(off + 4, off + 4 + len));
          off += 4 + len;
        }
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.close();
});

describe('ClamAV adapter (protocol)', () => {
  it('streams the file in chunks and maps clean / infected / error replies', async () => {
    const a = new ClamAvAdapter('127.0.0.1', port, 2000);
    const big = Buffer.alloc(200_000, 3);
    mode = 'ok';
    expect(await a.scan(big)).toEqual({ verdict: 'clean' });
    expect(received.equals(big)).toBe(true);
    mode = 'found';
    expect(await a.scan(Buffer.from('x'))).toEqual({ verdict: 'infected', detail: 'Eicar-Test-Signature' });
    mode = 'error';
    expect(await a.scan(Buffer.from('x'))).toMatchObject({ verdict: 'failed' });
  });

  it('health reflects the daemon; an outage or a hang is "failed"/"down", never clean', async () => {
    expect((await new ClamAvAdapter('127.0.0.1', port).health()).status).toBe('ok');
    mode = 'hang';
    expect(await new ClamAvAdapter('127.0.0.1', port, 300).scan(Buffer.from('x'))).toMatchObject({ verdict: 'failed' });
    const dead = new ClamAvAdapter('127.0.0.1', 1, 300);
    expect(await dead.scan(Buffer.from('x'))).toMatchObject({ verdict: 'failed' });
    expect((await dead.health()).status).toBe('down');
  });
});
