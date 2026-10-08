import { describe, expect, it } from 'vitest';
import { ChallengeFailures, RateLimiter } from './rate-limit';

describe('RateLimiter', () => {
  it('allows max hits per window and resets after it', () => {
    const limiter = new RateLimiter(20, 60_000);
    for (let i = 0; i < 20; i++) expect(limiter.hit('ip', 1000)).toBe(true);
    expect(limiter.hit('ip', 1000)).toBe(false);
    expect(limiter.hit('other', 1000)).toBe(true);
    expect(limiter.hit('ip', 61_001)).toBe(true);
  });
});

describe('ChallengeFailures', () => {
  it('counts per key until expiry', () => {
    const f = new ChallengeFailures(600_000);
    expect(f.record('c', 0)).toBe(1);
    expect(f.record('c', 10)).toBe(2);
    expect(f.count('c', 20)).toBe(2);
    expect(f.count('c', 700_000)).toBe(0);
  });
});
