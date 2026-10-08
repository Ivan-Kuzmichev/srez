// Config entry for the Better Auth CLI schema generator only: `pnpm auth:generate`.
import { openDb } from '../src/db/client';
import { createAuth } from '../src/server/auth';

export const auth = createAuth({
  db: openDb(':memory:'),
  baseURL: 'http://localhost:3000',
  secret: 'schema-generation-only-not-a-real-secret-000000',
  trustedProxies: [],
});
