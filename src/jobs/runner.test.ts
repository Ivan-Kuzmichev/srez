import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Db } from '@/db/client';
import { jobs, logs } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { createLogger } from '@/server/logger';
import { enqueue } from './queue';
import { defineJob, runOnce, type JobDefinition } from './runner';
import { heartbeat } from './system';

const silent = new Writable({ write: (_c, _e, cb) => cb() });

function setup() {
  const db = createTestDb();
  const { root, sink } = createLogger({ level: 'info', getDb: () => db as Db, console: silent });
  return { db, sink, log: root.child({ source: 'jobs' }) };
}

describe('runOnce', () => {
  it('runs the heartbeat job, which writes a log row tagged with the job id', async () => {
    const { db, sink, log } = setup();
    const id = enqueue(db, heartbeat.name, null);
    const worked = await runOnce({
      db,
      workerId: 'w',
      definitions: [heartbeat as JobDefinition<never>],
      schedules: [],
      log,
    });
    expect(worked).toBe(true);
    sink.flush();
    const rows = db.select().from(logs).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'jobs', message: 'Worker heartbeat', jobId: `job_${id}` });
    expect(db.select().from(jobs).get()?.status).toBe('done');
  });

  it('rejects an invalid payload as a failure', async () => {
    const { db, log } = setup();
    const handler = vi.fn();
    const def = defineJob({ name: 'typed', payload: z.object({ n: z.number() }), handler });
    enqueue(db, 'typed', { n: 'x' }, { maxAttempts: 1 });
    await runOnce({ db, workerId: 'w', definitions: [def as JobDefinition<never>], schedules: [], log });
    expect(handler).not.toHaveBeenCalled();
    expect(db.select().from(jobs).get()?.status).toBe('failed');
  });

  it('returns false when nothing is due', async () => {
    const { db, log } = setup();
    expect(await runOnce({ db, workerId: 'w', definitions: [], schedules: [], log })).toBe(false);
  });
});
