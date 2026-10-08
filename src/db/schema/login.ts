import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from '@/lib/uuid';
import { passkey } from './auth';

/** Every password sign-in attempt, for the per-username lockout (docs/07-auth-security.md, section 2). */
export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    username: text('username').notNull(),
    ip: text('ip'),
    success: integer('success', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('login_attempts_username_created_idx').on(t.username, t.createdAt)],
);

/**
 * Last sign-in per passkey. The Better Auth passkey table has no such column and its plugin
 * cannot be extended with fields, so it lives alongside.
 */
export const passkeyUsage = sqliteTable('passkey_usage', {
  passkeyId: text('passkey_id')
    .primaryKey()
    .references(() => passkey.id, { onDelete: 'cascade' }),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }).notNull(),
});
