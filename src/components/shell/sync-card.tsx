import Link from 'next/link';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';

export interface SyncSummary {
  name: string;
  state: 'ok' | 'error' | 'running';
  /** «Синхронизировано 5 минут назад», formatted by the caller. */
  detail: string;
}

const dot = { ok: 'bg-gain', error: 'bg-loss', running: 'bg-accent', none: 'bg-border-strong' } as const;

/** Sidebar footer card: source status now, user and «Выйти» from phase 1. */
export function SyncCard({
  summary,
  variant = 'sidebar',
}: {
  summary: SyncSummary | null;
  variant?: 'sidebar' | 'card';
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1',
        variant === 'sidebar'
          ? 'rounded-control border border-border-subtle p-3.5'
          : 'rounded-card border border-border bg-surface p-4',
      )}
    >
      <div className="flex items-center gap-2 text-caption font-medium">
        <span className={cn('size-2 rounded-full', dot[summary?.state ?? 'none'])} />
        <span>{summary?.name ?? ru.shell.noSources}</span>
      </div>
      {summary ? (
        <div className="text-small text-muted">{summary.detail}</div>
      ) : (
        <Link href="/sources" className="text-small">
          {ru.shell.connectSource}
        </Link>
      )}
    </div>
  );
}
