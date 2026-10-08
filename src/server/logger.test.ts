import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { logs } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { createLogger, toLogRow } from './logger';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { lines, stream };
}

describe('logger', () => {
  it('writes to stdout and to the logs table with source, ids and redacted context', () => {
    const db = createTestDb();
    const out = capture();
    const { root, sink } = createLogger({ level: 'info', getDb: () => db, console: out.stream });

    const log = root.child({ source: 'collector', requestId: 'req_1' });
    log.info(
      { account: 'a1', token: 't-secret', headers: { Authorization: 'Bearer x' } },
      'Fetched operations',
    );
    log.debug('below level');
    root.child({ source: 'jobs', jobId: 'job_7' }).error({ err: new Error('boom') }, 'Job failed');
    sink.flush();

    const rows = db.select().from(logs).all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      level: 'info',
      source: 'collector',
      message: 'Fetched operations',
      requestId: 'req_1',
      jobId: null,
      context: { account: 'a1', token: '[redacted]', headers: { Authorization: '[redacted]' } },
    });
    expect(rows[1]).toMatchObject({ level: 'error', source: 'jobs', jobId: 'job_7' });
    expect((rows[1]!.context as { err: { message: string } }).err.message).toBe('boom');

    const stdout = out.lines.join('');
    expect(stdout).toContain('Fetched operations');
    expect(stdout).not.toContain('t-secret');
    expect(stdout).not.toContain('Bearer x');
  });

  it('batches rows until flushed', () => {
    const db = createTestDb();
    const { root, sink } = createLogger({ level: 'info', getDb: () => db, console: capture().stream });
    root.info({ source: 'web' }, 'one');
    expect(db.select().from(logs).all()).toHaveLength(0);
    sink.flush();
    expect(db.select().from(logs).all()).toHaveLength(1);
  });

  it('ignores lines that are not JSON', () => {
    expect(toLogRow('not json')).toBeNull();
  });
});
