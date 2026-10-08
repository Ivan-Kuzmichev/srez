import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTinvestSource } from '@/db/mutations/sources';
import { sources, syncRuns, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { enqueueSync } from '@/jobs/tinvest-sync';
import { syncLog, syncSummary, tinvestSourceView } from './sources';

const now = new Date('2026-10-08T12:00:00Z');

function setup() {
  const db = createTestDb();
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  return db;
}

describe('source status', () => {
  it('is empty without T-Invest, then follows the source', () => {
    const db = setup();
    expect(syncSummary(db, 'u1', 'Europe/Moscow', now)).toBeNull();
    const id = createTinvestSource(db, 'u1', 't.secret-token-value');
    expect(syncSummary(db, 'u1', 'Europe/Moscow', now)).toMatchObject({ state: 'ok', detail: 'ещё не было' });

    db.update(sources)
      .set({ lastSyncAt: new Date(now.getTime() - 5 * 60_000) })
      .run();
    expect(syncSummary(db, 'u1', 'Europe/Moscow', now)?.detail).toBe('Синхронизировано 5 минут назад');

    enqueueSync(db, id, 'manual');
    expect(syncSummary(db, 'u1', 'Europe/Moscow', now)).toMatchObject({ state: 'running' });
    expect(tinvestSourceView(db, 'u1')?.status).toBe('running');
  });

  it('shows the error text and the run log, never the token', () => {
    const db = setup();
    const id = createTinvestSource(db, 'u1', 't.secret-token-value');
    db.update(sources)
      .set({ status: 'error', lastError: 'Токен не найден или отозван. Выпустите новый' })
      .where(eq(sources.id, id))
      .run();
    db.insert(syncRuns)
      .values({
        sourceId: id,
        trigger: 'schedule',
        status: 'error',
        startedAt: now,
        error: 'Токен не найден или отозван. Выпустите новый',
      })
      .run();
    db.insert(syncRuns)
      .values({ sourceId: id, trigger: 'manual', status: 'ok', startedAt: now, newOperations: 3 })
      .run();
    expect(syncSummary(db, 'u1', 'Europe/Moscow', now)).toMatchObject({
      state: 'error',
      detail: 'Токен не найден или отозван. Выпустите новый',
    });
    expect(syncLog(db, 'u1').map((r) => [r.status, r.newOperations])).toEqual([
      ['ok', 3],
      ['error', 0],
    ]);
    const view = tinvestSourceView(db, 'u1');
    expect(JSON.stringify(view)).not.toContain('secret-token');
  });
});
