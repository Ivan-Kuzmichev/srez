import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/logs/auto-refresh';
import { LogFilters } from '@/components/logs/log-filters';
import { LogList } from '@/components/logs/log-list';
import { Button } from '@/components/ui/button';
import { db } from '@/db/client';
import { listLogs } from '@/db/queries/logs';
import { formatPlain } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { LogParams, toFilter, toLogItem } from '@/server/logs-view';
import { requireSession } from '@/server/session';
import { debugActive, getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.logs };

/** «Логи» (Logs, MLogs; FR-DEV-3). */
export default async function LogsPage({ searchParams }: PageProps<'/settings/dev/logs'>) {
  const session = await requireSession();
  const settings = getSettings(db(), session.user.id);
  const tz = settings.display.timezone;
  const raw = await searchParams;
  const p = LogParams.parse(
    Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])),
  );
  const { rows, total, nextCursor } = listLogs(db(), toFilter(p, tz), p.n);
  const items = rows.map((r) => toLogItem(r, tz));
  const query = new URLSearchParams(
    Object.entries({ q: p.q, level: p.level, source: p.source, period: p.period }).filter(
      (e): e is [string, string] => Boolean(e[1]),
    ),
  );
  const download = `/settings/dev/logs/download?${query}`;
  const more = new URLSearchParams(query);
  more.set('n', String(Math.min(1000, p.n + 100)));

  return (
    <>
      <header className="flex flex-col gap-3 wide:mb-2">
        <div className="hidden items-center gap-2 text-caption text-muted wide:flex">
          <Link href="/settings" className="no-underline">
            {ru.pages.settings}
          </Link>
          <span>/</span>
          <Link href="/settings/dev" className="no-underline">
            {ru.pages.dev}
          </Link>
          <span>/</span>
          <span>{ru.pages.logs}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 wide:gap-4">
          <div className="flex flex-wrap items-center gap-1 wide:gap-3">
            <Link
              href="/settings/dev"
              aria-label={ru.logs.backToDev}
              className="-ml-3 flex size-11 items-center justify-center text-text wide:hidden"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </Link>
            <h1 className="m-0 text-page-phone font-semibold tracking-[-0.01em] wide:text-page">
              {ru.pages.logs}
            </h1>
            {debugActive(settings) ? (
              <span className="rounded-pill bg-accent-bg px-2.5 py-1 text-small text-accent-text max-wide:hidden">
                {ru.logs.debugOn}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="max-wide:hidden">
              <AutoRefresh />
            </span>
            <Button asChild variant="secondary" className="max-wide:hidden">
              <a href={download}>{ru.logs.download}</a>
            </Button>
            <a
              href={download}
              aria-label={ru.logs.downloadLabel}
              className="flex size-11 items-center justify-center text-text wide:hidden"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
            </a>
          </div>
        </div>
      </header>

      <LogFilters q={p.q ?? ''} level={p.level} source={p.source} period={p.period} />

      <section
        className="flex flex-col gap-3 rounded-card border border-border bg-surface px-4 py-2 wide:p-6"
        data-testid="logs"
      >
        {items.length === 0 ? (
          <div className="py-4 text-caption text-muted">{ru.logs.empty}</div>
        ) : (
          <LogList items={items} />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 max-wide:pb-2">
          <span className="text-caption text-muted">
            {ru.logs.shown(
              formatPlain(items.length, 0),
              formatPlain(total, 0),
              ru.logs.periodsShown[p.period]!,
            )}
          </span>
          {nextCursor && p.n < 1000 ? (
            <Button asChild variant="secondary">
              <Link href={`?${more}`} scroll={false}>
                {ru.logs.earlier}
              </Link>
            </Button>
          ) : null}
        </div>
      </section>
    </>
  );
}
