import { describe, expect, it } from 'vitest';
import { clientIp, parseTrustedProxies } from './client-ip';

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
