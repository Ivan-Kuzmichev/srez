import { z } from 'zod';
import type { LogFilter, LogRow } from '@/db/queries/logs';
import { formatTime } from '@/lib/format';
import { addDays, localDate, zonedLocalToUtc } from '@/lib/time';
import { ru } from '@/lib/i18n/ru';
import type { LogItem } from '@/components/logs/log-list';

export const LogParams = z.object({
  q: z.string().max(200).optional().catch(undefined),
  level: z.enum(['all', 'error', 'warn', 'info']).catch('all'),
  source: z.enum(['all', 'collector', 'prices', 'auth', 'api', 'jobs', 'web']).catch('all'),
  period: z.enum(['today', 'hour', 'week']).catch('today'),
  n: z.coerce.number().int().min(100).max(1000).catch(100),
});
export type LogParams = z.infer<typeof LogParams>;

/** Screen filters to a query: «сегодня» starts at midnight in the display zone. */
export function toFilter(p: LogParams, timeZone: string, now = new Date()): LogFilter {
  const from =
    p.period === 'hour'
      ? new Date(now.getTime() - 3_600_000)
      : (zonedLocalToUtc(
          `${p.period === 'week' ? addDays(localDate(now, timeZone), -6) : localDate(now, timeZone)}T00:00`,
          timeZone,
        ) ?? undefined);
  return {
    q: p.q,
    minLevel: p.level === 'all' ? undefined : p.level,
    source: p.source === 'all' ? undefined : p.source,
    from,
  };
}

const HIDDEN = new Set(['err']);

/** A row as the screen shows it: time in the display zone, ids first, then the context flat. */
export function toLogItem(r: LogRow, timeZone: string): LogItem {
  const details: [string, string][] = [];
  if (r.requestId) details.push([ru.logs.fields.requestId!, r.requestId]);
  if (r.jobId) details.push([ru.logs.fields.jobId!, r.jobId]);
  for (const [k, v] of Object.entries(r.context ?? {})) {
    if (HIDDEN.has(k)) {
      const err = v as { message?: string; type?: string } | null;
      if (err?.message) details.push(['error', `${err.type ?? 'Error'}: ${err.message}`]);
      continue;
    }
    details.push([k, typeof v === 'string' ? v : JSON.stringify(v)]);
  }
  const time = formatTime(r.ts, timeZone);
  const seconds = String(new Date(r.ts).getUTCSeconds()).padStart(2, '0');
  return {
    id: r.id,
    time: `${time}:${seconds}`,
    ts: r.ts.toISOString(),
    level: r.level,
    source: r.source,
    message: r.message,
    details,
    json: JSON.stringify(
      {
        id: r.id,
        ts: r.ts.toISOString(),
        level: r.level,
        source: r.source,
        message: r.message,
        requestId: r.requestId,
        jobId: r.jobId,
        context: r.context,
      },
      null,
      2,
    ),
  };
}
