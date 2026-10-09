import { db } from '@/db/client';
import { listPortfolios } from '@/server/portfolio-data';
import { realizedCsv } from '@/server/realized-csv';
import { realizedData } from '@/server/realized-data';
import { RealizedParams } from '@/server/realized-params';
import { getSession } from '@/server/session';
import { getSettings } from '@/server/settings';

/** «Выгрузить в CSV»: the closed trades of the chosen year, portfolio and method. */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const userId = session.user.id;
  const p = RealizedParams.parse(Object.fromEntries(new URL(request.url).searchParams));
  const tz = getSettings(db(), userId).display.timezone;
  const portfolio = listPortfolios(db(), userId).find((x) => x.id === p.portfolio) ?? null;
  const r = realizedData(db(), userId, portfolio, tz, p.year ?? null, p.method);
  return new Response(realizedCsv(r.rows, tz), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="srez-realized-${r.year}-${r.method}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
