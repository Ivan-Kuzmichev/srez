/** Fixed-window counter in process memory. One web process, so this is the whole picture. */
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Counts a hit; returns false when the key is over the limit for the current window. */
  hit(key: string, now = Date.now()): boolean {
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.windows.size > 10_000) this.prune(now);
      return true;
    }
    current.count += 1;
    return current.count <= this.max;
  }

  private prune(now: number) {
    for (const [key, w] of this.windows) if (w.resetAt <= now) this.windows.delete(key);
  }
}

/**
 * Failed 2FA codes per challenge, for «Осталось N попыток». Better Auth enforces the limit itself
 * but does not expose the count. Keyed by the challenge cookie; entries expire with the challenge.
 */
export class ChallengeFailures {
  private failures = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  record(key: string, now = Date.now()): number {
    const current = this.failures.get(key);
    const count = current && current.expiresAt > now ? current.count + 1 : 1;
    this.failures.set(key, { count, expiresAt: now + this.ttlMs });
    return count;
  }

  count(key: string, now = Date.now()): number {
    const current = this.failures.get(key);
    return current && current.expiresAt > now ? current.count : 0;
  }
}
