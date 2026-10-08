import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDb } from './client';
import { runMigrations } from './migrate';
import { logs } from './schema';

describe('migrations', () => {
  it('apply to an empty database and are idempotent', () => {
    const database = openDb(':memory:');
    runMigrations(database);
    runMigrations(database);
    const tables = database.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`);
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(['logs', 'logs_fts']));
  });

  it('index log messages for full-text search', () => {
    const database = openDb(':memory:');
    runMigrations(database);
    database
      .insert(logs)
      .values([
        { ts: new Date(), level: 'info', source: 'jobs', message: 'Синхронизация завершена' },
        { ts: new Date(), level: 'error', source: 'jobs', message: 'Таймаут запроса' },
      ])
      .run();
    const hits = database.all<{ message: string }>(
      sql`select l.message from logs_fts f join logs l on l.id = f.rowid where logs_fts match ${'таймаут'}`,
    );
    expect(hits).toEqual([{ message: 'Таймаут запроса' }]);
  });
});
