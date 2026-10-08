import { and, count, desc, eq, gte, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { logs, type LogLevel } from '@/db/schema';

export type LogRow = typeof logs.$inferSelect;

export interface LogFilter {
  /** Text, a request id or a job id (FR-DEV-3). */
  q?: string;
  /** This level and above. */
  minLevel?: LogLevel;
  source?: string;
  from?: Date;
  to?: Date;
  requestId?: string;
  jobId?: string;
}

const ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** FTS5 query from free text: every word quoted, so «sync:tinvest» or «"» cannot break the syntax. */
export function ftsQuery(text: string): string | null {
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/"/g, ''))
    .filter(Boolean);
  return words.length ? words.map((w) => `"${w}"`).join(' ') : null;
}

function where(filter: LogFilter): SQL | undefined {
  const parts: SQL[] = [];
  if (filter.minLevel && filter.minLevel !== 'debug')
    parts.push(inArray(logs.level, ORDER.slice(ORDER.indexOf(filter.minLevel))));
  if (filter.source) parts.push(eq(logs.source, filter.source));
  if (filter.from) parts.push(gte(logs.ts, filter.from));
  if (filter.to) parts.push(lte(logs.ts, filter.to));
  if (filter.requestId) parts.push(eq(logs.requestId, filter.requestId));
  if (filter.jobId) parts.push(eq(logs.jobId, filter.jobId));
  const q = filter.q?.trim();
  if (q) {
    const fts = ftsQuery(q);
    const any: SQL[] = [
      eq(logs.requestId, q),
      eq(logs.jobId, q),
      sql`${logs.context} like ${`%${q.replace(/[%_]/g, '')}%`}`,
    ];
    if (fts) any.push(sql`${logs.id} in (select rowid from logs_fts where logs_fts match ${fts})`);
    parts.push(or(...any)!);
  }
  return parts.length ? and(...parts) : undefined;
}

/** Newest first; `before` is the id of the last row already shown («Раньше», API cursor). */
export function listLogs(
  db: Executor,
  filter: LogFilter,
  limit = 100,
  before?: number,
): { rows: LogRow[]; total: number; nextCursor: number | null } {
  const base = where(filter);
  const rows = db
    .select()
    .from(logs)
    .where(before ? and(base, lt(logs.id, before)) : base)
    .orderBy(desc(logs.id))
    .limit(limit + 1)
    .all();
  const total = db.select({ n: count() }).from(logs).where(base).get()?.n ?? 0;
  const page = rows.slice(0, limit);
  return { rows: page, total, nextCursor: rows.length > limit ? page.at(-1)!.id : null };
}
