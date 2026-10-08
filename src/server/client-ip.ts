import { BlockList, isIP } from 'node:net';

/** Parses TRUSTED_PROXIES: comma-separated addresses or CIDR ranges, IPv4 or IPv6. */
export function parseTrustedProxies(value: string | undefined): BlockList {
  const list = new BlockList();
  for (const raw of (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [address = '', prefix] = raw.split('/');
    const family = isIP(address);
    if (family === 0) throw new Error(`TRUSTED_PROXIES: not an IP address: ${raw}`);
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) list.addAddress(address, type);
    else list.addSubnet(address, Number(prefix), type);
  }
  return list;
}

function isTrusted(list: BlockList, ip: string): boolean {
  const family = isIP(ip);
  return family !== 0 && list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Client address from X-Forwarded-For: the rightmost entry that is not a trusted proxy,
 * the same rule Better Auth uses. Without trusted proxies only a single-entry header is believed.
 * Returns null when the address cannot be determined.
 */
export function clientIp(
  forwardedFor: string | null,
  trusted: BlockList,
  hasTrusted: boolean,
): string | null {
  const hops = (forwardedFor ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (hops.length === 0) return null;
  if (!hasTrusted) return hops.length === 1 && isIP(hops[0]!) ? hops[0]! : null;
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i]!;
    if (isIP(hop) === 0) return null;
    if (!isTrusted(trusted, hop)) return hop;
  }
  return null;
}

export const PEER_HEADER = 'x-srez-peer';
export const CLIENT_IP_HEADER = 'x-srez-client-ip';

/** «::ffff:192.168.1.5» → «192.168.1.5». */
const plain = (ip: string) => (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip);

/** The socket address set by scripts/remote-address.mjs; null without the preload or with a forged header. */
export function peerAddress(headers: Headers, key = process.env.SREZ_PEER_KEY): string | null {
  const value = headers.get(PEER_HEADER);
  if (!value || !key) return null;
  const [given, ip = ''] = value.split(' ');
  return given === key && isIP(plain(ip)) ? plain(ip) : null;
}

/**
 * docs/06-api.md, section 3: the connection address; when it is a trusted proxy, the rightmost
 * address of X-Forwarded-For that is not one. A header from anyone else is not believed.
 */
export function resolveClientIp(
  headers: Headers,
  trusted: BlockList,
  key = process.env.SREZ_PEER_KEY,
): string | null {
  const peer = peerAddress(headers, key);
  if (!peer) return null;
  if (!isTrusted(trusted, peer)) return peer;
  const hops = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => plain(s.trim()))
    .filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i]!;
    if (isIP(hop) === 0) return null;
    if (!isTrusted(trusted, hop)) return hop;
  }
  // Only proxies in the chain: the request came from a proxy itself (a healthcheck).
  return peer;
}

const LOCAL = (() => {
  const list = new BlockList();
  list.addSubnet('127.0.0.0', 8, 'ipv4');
  list.addSubnet('10.0.0.0', 8, 'ipv4');
  list.addSubnet('172.16.0.0', 12, 'ipv4');
  list.addSubnet('192.168.0.0', 16, 'ipv4');
  list.addAddress('::1', 'ipv6');
  list.addSubnet('fc00::', 7, 'ipv6');
  return list;
})();

/** The «только из локальной сети» ranges of docs/06-api.md, section 3. */
export function isLocalAddress(ip: string | null): boolean {
  return ip !== null && isTrusted(LOCAL, plain(ip));
}
