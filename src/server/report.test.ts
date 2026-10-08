import { describe, expect, it } from 'vitest';
import { createTinvestSource } from '@/db/mutations/sources';
import { logs, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { issueToken } from './api-tokens';
import { buildReport } from './report';

const now = new Date('2026-10-08T12:00:00Z');
const probes = {
  fetchFn: async () => new Response('', { status: 200 }),
  transport: async () => ({ status: 401, headers: {}, body: '{}' }),
};

describe('problem report (FR-DEV-7)', () => {
  it('has the version, settings, sources and the last 500 log lines, and no secret', async () => {
    const db = createTestDb();
    db.insert(user)
      .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
      .run();
    createTinvestSource(db, 'u1', 't.broker-secret-token');
    const { token } = issueToken(
      db,
      'u1',
      { name: 'Claude', ttl: '30d', scopes: ['read:logs'], localOnly: true },
      now,
    );
    db.insert(logs)
      .values(
        Array.from({ length: 520 }, (_, i) => ({
          ts: new Date(now.getTime() + i),
          level: 'info' as const,
          source: 'jobs',
          message: `line ${i}`,
          context: i === 519 ? { token: 't.broker-secret-token' } : null,
        })),
      )
      .run();
    const report = await buildReport(db, 'u1', probes, now);
    expect(report.version).toMatch(/\d+\.\d+\.\d+/);
    expect(report.logs).toHaveLength(500);
    expect(report.logs[0]!.message).toBe('line 519');
    expect(report.sources[0]).toMatchObject({ kind: 'tinvest', status: 'ok' });
    expect(report.settings.logging.retentionDays).toBe(14);
    const text = JSON.stringify(report);
    for (const secret of ['t.broker-secret-token', token, 'secretEncrypted', 'tokenHash'])
      expect(text).not.toContain(secret);
  });
});
