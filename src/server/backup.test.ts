import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { finAccounts, operations, session, sources, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { backupDatabase, backupName } from './backup';
import { operationsCsv } from './operations-csv';

const dir = mkdtempSync(join(tmpdir(), 'srez-backup-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const now = new Date('2026-10-09T12:00:00Z');

function seeded() {
  const db = createTestDb();
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  db.insert(session)
    .values({
      id: 's1',
      token: 'secret-session-token',
      userId: 'u1',
      expiresAt: new Date(now.getTime() + 86_400_000),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const src = db.insert(sources).values({ userId: 'u1', kind: 'manual', name: 'Вручную' }).returning().get();
  const acc = db
    .insert(finAccounts)
    .values({ userId: 'u1', sourceId: src.id, name: 'Брокерский', kind: 'broker', currency: 'RUB' })
    .returning()
    .get();
  const base = {
    userId: 'u1',
    accountId: acc.id,
    sourceId: src.id,
    origin: 'manual' as const,
    currency: 'RUB',
  };
  db.insert(operations)
    .values([
      {
        ...base,
        type: 'deposit',
        amount: '1000.5',
        executedAt: new Date('2026-10-01T10:00:00Z'),
        note: 'зарплата; аванс',
      },
      {
        ...base,
        type: 'withdrawal',
        amount: '-100',
        executedAt: new Date('2026-10-02T10:00:00Z'),
        voidedAt: now,
      },
    ])
    .run();
  return db;
}

describe('backup and export', () => {
  it('the copy has the data but no signed-in sessions', async () => {
    const db = seeded();
    const file = join(dir, backupName(now));
    expect(file).toMatch(/srez-backup-2026-10-09-12-00\.db$/);
    await backupDatabase(db, file);
    const copy = new Database(file, { readonly: true });
    expect(copy.prepare('select count(*) n from user').get()).toEqual({ n: 1 });
    expect(copy.prepare('select count(*) n from operations').get()).toEqual({ n: 2 });
    expect(copy.prepare('select count(*) n from session').get()).toEqual({ n: 0 });
    copy.close();
  });

  it('operations CSV: the whole journal without voided entries, decimal commas, quoted text', () => {
    const csv = operationsCsv(seeded(), 'u1', 'Europe/Moscow');
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'Дата;Операция;Тикер;Актив;Количество;Цена;Валюта;Сумма;Комиссия;Налог;НКД;Счёт;Тег;Источник;Внешний номер;Заметка',
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      '2026-10-01;Пополнение;;;0;0;RUB;1000,5;0;0;0;Брокерский;;Вручную;;"зарплата; аванс"',
    );
  });
});
