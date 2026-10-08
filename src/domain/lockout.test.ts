import { describe, expect, it } from 'vitest';
import { LOCKOUT_DURATION_MS, lockoutState, type Attempt } from './lockout';

const t0 = new Date('2026-10-08T10:00:00Z').getTime();
const fail = (sec: number): Attempt => ({ success: false, at: new Date(t0 + sec * 1000) });
const ok = (sec: number): Attempt => ({ success: true, at: new Date(t0 + sec * 1000) });
const at = (sec: number) => new Date(t0 + sec * 1000);

describe('lockoutState', () => {
  it('counts down remaining attempts', () => {
    expect(lockoutState([], at(0))).toEqual({ locked: false, lockedUntil: null, remaining: 5 });
    expect(lockoutState([fail(1), fail(2)], at(3)).remaining).toBe(3);
  });

  it('locks on the fifth failure in a row', () => {
    const four = [fail(1), fail(2), fail(3), fail(4)];
    expect(lockoutState(four, at(5)).locked).toBe(false);
    const five = [...four, fail(5)];
    const state = lockoutState(five, at(6));
    expect(state.locked).toBe(true);
    expect(state.lockedUntil).toEqual(new Date(t0 + 5000 + LOCKOUT_DURATION_MS));
  });

  it('unlocks after 15 minutes with a fresh counter', () => {
    const five = [fail(1), fail(2), fail(3), fail(4), fail(5)];
    const justBefore = new Date(t0 + 5000 + LOCKOUT_DURATION_MS - 1);
    const after = new Date(t0 + 5000 + LOCKOUT_DURATION_MS);
    expect(lockoutState(five, justBefore).locked).toBe(true);
    expect(lockoutState(five, after)).toEqual({ locked: false, lockedUntil: null, remaining: 5 });
    const oneMore = [...five, { success: false, at: new Date(after.getTime() + 1000) }];
    expect(lockoutState(oneMore, new Date(after.getTime() + 2000)).remaining).toBe(4);
  });

  it('resets the counter on success', () => {
    const attempts = [fail(1), fail(2), fail(3), fail(4), ok(5), fail(6)];
    expect(lockoutState(attempts, at(7))).toMatchObject({ locked: false, remaining: 4 });
  });

  it('accepts attempts in any order', () => {
    const attempts = [fail(5), fail(1), fail(4), fail(2), fail(3)];
    expect(lockoutState(attempts, at(6)).locked).toBe(true);
  });
});
