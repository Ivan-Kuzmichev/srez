import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { openDb } from './client';

const dir = mkdtempSync(join(tmpdir(), 'srez-db-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('openDb', () => {
  it('opens transactions as IMMEDIATE, so another writer waits instead of breaking them', () => {
    const path = join(dir, 'lock.db');
    const db = openDb(path);
    db.$client.exec('create table t (n integer)');
    const other = new Database(path);
    other.pragma('busy_timeout = 0');
    db.transaction(() => {
      // Nothing written yet in this transaction, and still the lock is ours.
      db.$client.prepare('select count(*) from t').get();
      expect(() => other.exec('insert into t values (1)')).toThrow(/locked|busy/i);
    });
    other.exec('insert into t values (2)');
    expect(other.prepare('select count(*) as n from t').get()).toEqual({ n: 1 });
    other.close();
    db.$client.close();
  });
});
