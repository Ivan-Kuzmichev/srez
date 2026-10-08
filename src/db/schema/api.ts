import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { createdAt, id, timestamp } from './columns';

export const API_SCOPES = ['read:data', 'read:logs', 'run:sync', 'write:data'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Tokens for the assistant (docs/03-data-model.md, section 1; docs/06-api.md). Only the hash is kept. */
export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** sha-256 of the token, hex. */
    tokenHash: text('token_hash').notNull(),
    last4: text('last4').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<ApiScope[]>().notNull(),
    localOnly: integer('local_only', { mode: 'boolean' }).notNull().default(true),
    expiresAt: timestamp('expires_at'),
    lastUsedAt: timestamp('last_used_at'),
    lastUsedIp: text('last_used_ip'),
    lastUsedPath: text('last_used_path'),
    revokedAt: timestamp('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('api_tokens_hash_idx').on(t.tokenHash), index('api_tokens_user_idx').on(t.userId)],
);
