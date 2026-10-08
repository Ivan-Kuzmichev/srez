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
