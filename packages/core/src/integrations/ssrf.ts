import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { DomainError } from '@esp/contracts';

/** SEC-005 SSRF guard for server-side requests to user/partner supplied URLs. */
const blocked = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked.addSubnet(net, prefix, 'ipv6');

export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return blocked.check(mapped[1]!, 'ipv4');
  const v = isIP(ip);
  return v === 0 ? true : blocked.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Rejects non-https URLs, credentials in URLs, and hosts that resolve to private, loopback, link-local or multicast
 * addresses. Call it again right before each request (DNS can change). ponytail: re-resolution narrows but does not
 * remove the DNS-rebinding window; pin the resolved address in a custom agent if partners become untrusted at scale.
 */
export async function assertPublicUrl(raw: string, opts: { allowPrivate?: boolean } = {}): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'invalid URL');
  }
  if (u.username || u.password) throw new DomainError('VALIDATION_FAILED', 'credentials in URLs are not allowed');
  if (opts.allowPrivate) {
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new DomainError('VALIDATION_FAILED', 'http(s) only');
    return u;
  }
  if (u.protocol !== 'https:') throw new DomainError('VALIDATION_FAILED', 'webhook URLs must use https');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new DomainError('VALIDATION_FAILED', 'host does not resolve');
  if (addrs.some(isPrivateAddress)) throw new DomainError('VALIDATION_FAILED', 'the URL points to a private or internal address');
  return u;
}
