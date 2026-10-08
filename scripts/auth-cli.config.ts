// Config entry for the Better Auth CLI schema generator only: `pnpm auth:generate`.
import { openDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { createAuth } from '../src/server/auth';

export const auth = createAuth({
  db: (() => {
    const db = openDb(':memory:');
    runMigrations(db); // so the generator compares against the current schema
    return db;
  })(),
  baseURL: 'http://localhost:3000',
  secret: 'schema-generation-only-not-a-real-secret-000000',
  trustedProxies: [],
});
