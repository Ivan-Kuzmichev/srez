import { sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

/** Escapes LIKE wildcards in user input. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Case-insensitive «contains», Cyrillic included (ulower is registered in db/client). */
export function containsCi(column: SQLiteColumn, query: string): SQL {
  return sql`ulower(${column}) like ${`%${escapeLike(query.toLocaleLowerCase('ru'))}%`} escape '\\'`;
}

/** Case-insensitive «starts with» for tickers. */
export function startsWithCi(column: SQLiteColumn, query: string): SQL {
  return sql`upper(${column}) like ${`${escapeLike(query.toUpperCase())}%`} escape '\\'`;
}
