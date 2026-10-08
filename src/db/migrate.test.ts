import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDb } from './client';
import { runMigrations } from './migrate';
import { instruments, logs, positions } from './schema';

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

describe('ledger schema', () => {
  it('seeds the cash instruments', () => {
    const database = openDb(':memory:');
    runMigrations(database);
    const cash = database.select({ ticker: instruments.ticker }).from(instruments).all();
    expect(cash.map((c) => c.ticker).sort()).toEqual(['CNY', 'EUR', 'RUB', 'USD']);
  });

  it('keeps one position per cell even when the tag is empty', () => {
    const database = openDb(':memory:');
    runMigrations(database);
    database.$client.exec(`
      insert into user (id, name, email, created_at, updated_at) values ('u', 'u', 'u@local.invalid', 0, 0);
      insert into sources (id, user_id, kind, name, status, created_at) values ('s', 'u', 'manual', 'm', 'ok', 0);
      insert into fin_accounts (id, user_id, source_id, name, kind, currency, sync_enabled) values ('a', 'u', 's', 'a', 'other', 'RUB', 1);
    `);
    const rub = database
      .select()
      .from(instruments)
      .all()
      .find((i) => i.ticker === 'RUB')!;
    const row = {
      userId: 'u',
      accountId: 'a',
      instrumentId: rub.id,
      tagId: null,
      quantity: '1',
      costBasis: '1',
      avgPrice: '1',
      realizedPnl: '0',
      payoutsTotal: '0',
      updatedAt: new Date(),
    };
    database.insert(positions).values(row).run();
    expect(() => database.insert(positions).values(row).run()).toThrow(/UNIQUE/);
  });
});
