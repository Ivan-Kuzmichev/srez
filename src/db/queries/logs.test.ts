import { describe, expect, it } from 'vitest';
import { logs } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { ftsQuery, listLogs } from './logs';

function setup() {
  const db = createTestDb();
  const t = (m: number) => new Date(Date.UTC(2026, 9, 8, 12, m));
  db.insert(logs)
    .values([
      { ts: t(0), level: 'info', source: 'collector', message: 'T-Invest sync done', jobId: 'job_7' },
      {
        ts: t(1),
        level: 'error',
        source: 'collector',
        message: 'External request failed',
        jobId: 'job_8',
        context: { method: 'OperationsService/GetOperationsByCursor' },
      },
      { ts: t(2), level: 'warn', source: 'jobs', message: 'Job failed', jobId: 'job_8' },
      { ts: t(3), level: 'debug', source: 'prices', message: 'CoinGecko prices' },
      { ts: t(4), level: 'info', source: 'api', message: 'GET /api/v1/health', requestId: 'req_42' },
    ])
    .run();
  return { db, t };
}

describe('listLogs', () => {
  it('filters by level and above, source and period, newest first', () => {
    const { db, t } = setup();
    expect(listLogs(db, { minLevel: 'warn' }).rows.map((r) => r.level)).toEqual(['warn', 'error']);
    expect(listLogs(db, { source: 'collector' }).total).toBe(2);
    expect(listLogs(db, { from: t(2), to: t(3) }).rows.map((r) => r.source)).toEqual(['prices', 'jobs']);
  });

  it('finds by text, by job or request id, and inside the context', () => {
    const { db } = setup();
    expect(listLogs(db, { q: 'sync' }).rows.map((r) => r.message)).toEqual(['T-Invest sync done']);
    expect(listLogs(db, { q: 'job_8' }).rows.map((r) => r.level)).toEqual(['warn', 'error']);
    expect(listLogs(db, { q: 'req_42' }).total).toBe(1);
    expect(listLogs(db, { q: 'GetOperationsByCursor' }).total).toBe(1);
    expect(listLogs(db, { jobId: 'job_8', minLevel: 'error' }).total).toBe(1);
    expect(listLogs(db, { q: 'quote " and * stars' }).total).toBe(0);
  });

  it('pages back with a cursor', () => {
    const { db } = setup();
    const first = listLogs(db, {}, 2);
    expect(first.rows).toHaveLength(2);
    const second = listLogs(db, {}, 2, first.nextCursor!);
    expect(second.rows.map((r) => r.message)).toEqual(['Job failed', 'External request failed']);
    const last = listLogs(db, {}, 2, second.nextCursor!);
    expect([last.rows.length, last.nextCursor]).toEqual([1, null]);
    expect(ftsQuery('  ')).toBeNull();
  });
});
