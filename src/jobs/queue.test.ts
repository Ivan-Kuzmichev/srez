import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/db/client';
import { jobSchedules, jobs } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { claimNext, completeJob, enqueue, enqueueDueSchedules, failJob, syncSchedules } from './queue';

const t0 = new Date('2026-10-08T10:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);

let database: Db;
beforeEach(() => {
  database = createTestDb();
});

describe('enqueue and claim', () => {
  it('claims due jobs in run_at order, once', () => {
    enqueue(database, 'a', { n: 2 }, { runAt: at(2000) }, t0);
    enqueue(database, 'a', { n: 1 }, { runAt: at(1000) }, t0);
    expect(claimNext(database, 'w1', ['a'], 60_000, t0)).toBeNull();

    const first = claimNext(database, 'w1', ['a'], 60_000, at(5000));
    expect(first?.payload).toEqual({ n: 1 });
    expect(first?.status).toBe('running');
    expect(first?.attempt).toBe(1);
    const second = claimNext(database, 'w2', ['a'], 60_000, at(5000));
    expect(second?.payload).toEqual({ n: 2 });
    expect(claimNext(database, 'w3', ['a'], 60_000, at(5000))).toBeNull();
  });

  it('ignores jobs with unknown names', () => {
    enqueue(database, 'other', null, {}, t0);
    expect(claimNext(database, 'w1', ['a'], 60_000, t0)).toBeNull();
  });

  it('drops a duplicate singleton while the first is active, allows it after', () => {
    expect(enqueue(database, 'a', null, { singletonKey: 'k' }, t0)).not.toBeNull();
    expect(enqueue(database, 'a', null, { singletonKey: 'k' }, t0)).toBeNull();
    const job = claimNext(database, 'w1', ['a'], 60_000, t0)!;
    expect(enqueue(database, 'a', null, { singletonKey: 'k' }, t0)).toBeNull();
    completeJob(database, job.id, t0);
    expect(enqueue(database, 'a', null, { singletonKey: 'k' }, t0)).not.toBeNull();
  });

  it('takes over a running job whose lock expired', () => {
    enqueue(database, 'a', null, {}, t0);
    claimNext(database, 'w1', ['a'], 1000, t0);
    expect(claimNext(database, 'w2', ['a'], 1000, at(500))).toBeNull();
    const again = claimNext(database, 'w2', ['a'], 1000, at(1500));
    expect(again?.lockedBy).toBe('w2');
    expect(again?.attempt).toBe(2);
  });
});

describe('failure', () => {
  it('retries with backoff, then fails for good', () => {
    enqueue(database, 'a', null, { maxAttempts: 2 }, t0);
    const first = claimNext(database, 'w', ['a'], 60_000, t0)!;
    expect(failJob(database, first, 'boom', t0)).toBe(true);
    expect(claimNext(database, 'w', ['a'], 60_000, at(5_000))).toBeNull();

    const second = claimNext(database, 'w', ['a'], 60_000, at(10_000))!;
    expect(second.attempt).toBe(2);
    expect(failJob(database, second, 'boom again', at(10_000))).toBe(false);

    const row = database.select().from(jobs).where(eq(jobs.id, first.id)).get()!;
    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('boom again');
  });
});

describe('schedules', () => {
  it('starts counting from the first tick, then enqueues once per due run', () => {
    syncSchedules(database, [{ name: 'tick', cron: '*/5 * * * *' }]);
    expect(enqueueDueSchedules(database, t0)).toEqual([]);
    expect(enqueueDueSchedules(database, at(4 * 60_000))).toEqual([]);
    expect(enqueueDueSchedules(database, at(5 * 60_000))).toEqual(['tick']);
    // An hour of downtime collapses into a single job.
    expect(enqueueDueSchedules(database, at(65 * 60_000))).toEqual(['tick']);
    expect(database.select().from(jobs).all()).toHaveLength(1);
  });

  it('removes schedules that are no longer defined and rejects bad patterns', () => {
    syncSchedules(database, [{ name: 'x', cron: '* * * * *' }]);
    syncSchedules(database, [{ name: 'y', cron: '0 3 * * *' }]);
    expect(database.select({ name: jobSchedules.name }).from(jobSchedules).all()).toEqual([{ name: 'y' }]);
    expect(() => syncSchedules(database, [{ name: 'z', cron: 'nope' }])).toThrow();
  });
});
