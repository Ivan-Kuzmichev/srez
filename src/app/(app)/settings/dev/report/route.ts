import { db } from '@/db/client';
import { toJson } from '@/server/api/core';
import { logger } from '@/server/logger';
import { buildReport } from '@/server/report';
import { getSession } from '@/server/session';

/** «Собрать отчёт о проблеме» (FR-DEV-7): one JSON file to save or hand to an assistant. */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const report = await buildReport(db(), session.user.id);
  logger('web').info({ logs: report.logs.length }, 'Problem report built');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return new Response(JSON.stringify(toJson(report), null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="srez-report-${stamp}.json"`,
      'cache-control': 'no-store',
    },
  });
}
