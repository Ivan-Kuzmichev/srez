import { openDb, type Db } from './client';
import { runMigrations } from './migrate';

/** Fresh in-memory database with all migrations applied. */
export function createTestDb(): Db {
  const database = openDb(':memory:');
  runMigrations(database);
  return database;
}
