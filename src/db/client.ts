import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { env } from '@/server/env';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** A connection or a transaction: anything queries can run against. */
export type Executor = BaseSQLiteDatabase<'sync', Database.RunResult, typeof schema>;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  // WAL lets web and worker read while one of them writes; busy_timeout waits out short write locks.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  return drizzle({ client: sqlite, schema });
}

const globalForDb = globalThis as unknown as { srezDb?: Db };

/** Process-wide connection. Survives Next.js dev reloads. */
export function db(): Db {
  globalForDb.srezDb ??= openDb(env().DATABASE_PATH);
  return globalForDb.srezDb;
}
