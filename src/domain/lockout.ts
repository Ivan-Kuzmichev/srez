/** Password lockout by username (docs/07-auth-security.md, section 2). */
export const LOCKOUT_MAX_FAILURES = 5;
export const LOCKOUT_DURATION_MS = 15 * 60_000;

export interface Attempt {
  success: boolean;
  at: Date;
}

export interface LockoutState {
  locked: boolean;
  /** When the current lock ends; null if not locked. */
  lockedUntil: Date | null;
  /** Failures left before the next lock. */
  remaining: number;
}

/**
 * Replays attempts in time order: a success resets the counter, the fifth failure in a row
 * locks for 15 minutes, and the counter starts over once the lock has passed.
 */
export function lockoutState(attempts: readonly Attempt[], now: Date): LockoutState {
  const ordered = [...attempts].sort((a, b) => a.at.getTime() - b.at.getTime());
  let failures = 0;
  let lockedUntil: Date | null = null;

  for (const attempt of ordered) {
    if (lockedUntil) {
      if (attempt.at < lockedUntil) continue; // rejected before reaching the password check
      lockedUntil = null;
      failures = 0;
    }
    if (attempt.success) {
      failures = 0;
      continue;
    }
    failures += 1;
    if (failures >= LOCKOUT_MAX_FAILURES) {
      lockedUntil = new Date(attempt.at.getTime() + LOCKOUT_DURATION_MS);
      failures = 0;
    }
  }

  if (lockedUntil && now < lockedUntil) return { locked: true, lockedUntil, remaining: 0 };
  if (lockedUntil) failures = 0;
  return { locked: false, lockedUntil: null, remaining: LOCKOUT_MAX_FAILURES - failures };
}
