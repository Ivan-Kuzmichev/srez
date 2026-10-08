import { integer, text } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from '@/lib/uuid';

/** uuid v7 primary key, generated in code (docs/03-data-model.md). */
export const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

/** Decimal stored as a plain string; arithmetic only through decimal.js. */
export const decimal = (name: string) => text(name);

/** UTC instant, Unix milliseconds. */
export const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

/** Calendar date without time, «YYYY-MM-DD». */
export const date = (name: string) => text(name);

export const createdAt = () =>
  timestamp('created_at')
    .notNull()
    .$defaultFn(() => new Date());

export const updatedAt = () =>
  timestamp('updated_at')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date());
