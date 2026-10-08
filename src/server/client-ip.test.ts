import { describe, expect, it } from 'vitest';
import { clientIp, isLocalAddress, parseTrustedProxies, resolveClientIp } from './client-ip';

describe('clientIp', () => {
  const trusted = parseTrustedProxies('10.0.0.0/24, 192.168.1.5, fd00::/8');

  it('takes the rightmost untrusted hop', () => {
    expect(clientIp('203.0.113.7, 10.0.0.3', trusted, true)).toBe('203.0.113.7');
    expect(clientIp('1.1.1.1, 203.0.113.7, 192.168.1.5', trusted, true)).toBe('203.0.113.7');
    expect(clientIp('198.51.100.1, fd00::1', trusted, true)).toBe('198.51.100.1');
  });

  it('ignores a spoofed left part when the proxy appends the real peer', () => {
    // Client sent «X-Forwarded-For: 127.0.0.1», proxy appended the real address.
    expect(clientIp('127.0.0.1, 203.0.113.9', trusted, true)).toBe('203.0.113.9');
  });

  it('gives up on garbage or an all-trusted chain', () => {
    expect(clientIp('nonsense, 10.0.0.3', trusted, true)).toBeNull();
    expect(clientIp('10.0.0.1, 10.0.0.2', trusted, true)).toBeNull();
    expect(clientIp(null, trusted, true)).toBeNull();
  });

  it('without trusted proxies believes only a single entry', () => {
    const none = parseTrustedProxies('');
    expect(clientIp('203.0.113.7', none, false)).toBe('203.0.113.7');
    expect(clientIp('1.1.1.1, 203.0.113.7', none, false)).toBeNull();
  });

  it('rejects malformed configuration', () => {
    expect(() => parseTrustedProxies('proxy.local')).toThrow();
  });
});

describe('resolveClientIp (06, section 3)', () => {
  const key = 'k'.repeat(32);
  const h = (peer: string | null, xff?: string, k = key) =>
    new Headers({
      ...(peer !== null ? { 'x-srez-peer': `${k} ${peer}` } : {}),
      ...(xff ? { 'x-forwarded-for': xff } : {}),
    });
  const none = parseTrustedProxies('');
  const proxy = parseTrustedProxies('10.0.0.2,172.18.0.0/16');

  it('takes the socket address and ignores a forged X-Forwarded-For from anyone else', () => {
    expect(resolveClientIp(h('203.0.113.7', '192.168.1.5'), none, key)).toBe('203.0.113.7');
    expect(resolveClientIp(h('::ffff:192.168.1.20'), none, key)).toBe('192.168.1.20');
  });

  it('believes the header only from a trusted proxy, taking the rightmost untrusted hop', () => {
    expect(resolveClientIp(h('10.0.0.2', '192.168.1.5, 203.0.113.7'), proxy, key)).toBe('203.0.113.7');
    expect(resolveClientIp(h('172.18.0.4', '203.0.113.7, 10.0.0.2'), proxy, key)).toBe('203.0.113.7');
    expect(resolveClientIp(h('10.0.0.2'), proxy, key)).toBe('10.0.0.2');
    expect(resolveClientIp(h('10.0.0.2', 'garbage'), proxy, key)).toBeNull();
  });

  it('knows nothing without the preload or with a forged peer header', () => {
    expect(resolveClientIp(h(null, '192.168.1.5'), none, key)).toBeNull();
    expect(resolveClientIp(h('192.168.1.5', undefined, 'wrong-key'), none, key)).toBeNull();
    expect(resolveClientIp(h('192.168.1.5'), none, undefined)).toBeNull();
  });

  it('marks the local ranges of «только из локальной сети»', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.5',
      '::1',
      'fd00::5',
      '::ffff:192.168.0.1',
    ])
      expect(isLocalAddress(ip), ip).toBe(true);
    for (const ip of ['203.0.113.7', '172.32.0.1', '8.8.8.8', '2001:db8::1', null])
      expect(isLocalAddress(ip), String(ip)).toBe(false);
  });
});
