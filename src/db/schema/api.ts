import { blob, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
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

/** Keys of outside services shared by the whole app (docs/03-data-model.md, section 1): Blockscout for EVM history. */
export const serviceKeys = sqliteTable('service_keys', {
  name: text('name').primaryKey(),
  secretEncrypted: blob('secret_encrypted', { mode: 'buffer' }).notNull(),
  last4: text('last4').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/** What was already said (docs/03-data-model.md, section 8): an event is sent again only after its condition cleared. */
export const notificationsState = sqliteTable(
  'notifications_state',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull(),
    lastSentAt: timestamp('last_sent_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);
