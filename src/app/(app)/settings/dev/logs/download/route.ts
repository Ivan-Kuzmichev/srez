import { db } from '@/db/client';
import { listLogs } from '@/db/queries/logs';
import { LogParams, toFilter } from '@/server/logs-view';
import { getSession } from '@/server/session';
import { getSettings } from '@/server/settings';

/** «Скачать»: the filtered records as NDJSON, newest first, up to 10 000 (FR-DEV-3). */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const url = new URL(request.url);
  const p = LogParams.parse(Object.fromEntries(url.searchParams));
  const tz = getSettings(db(), session.user.id).display.timezone;
  const { rows } = listLogs(db(), toFilter(p, tz), 10_000);
  const body = rows
    .map((r) =>
      JSON.stringify({
        ts: r.ts.toISOString(),
        level: r.level,
        source: r.source,
        message: r.message,
        requestId: r.requestId,
        jobId: r.jobId,
        context: r.context,
      }),
    )
    .join('\n');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return new Response(body + (body ? '\n' : ''), {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'content-disposition': `attachment; filename="srez-logs-${stamp}.ndjson"`,
      'cache-control': 'no-store',
    },
  });
}
