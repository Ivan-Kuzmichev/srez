import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';

export interface SyncSummary {
  name: string;
  state: 'ok' | 'error' | 'running';
  /** «Синхронизировано 5 минут назад», formatted by the caller. */
  detail: string;
}

const dot = { ok: 'bg-gain', error: 'bg-loss', running: 'bg-accent', none: 'bg-border-strong' } as const;

/** Sidebar footer card: source status, then the user row passed as children. */
export function SyncCard({
  summary,
  variant = 'sidebar',
  children,
}: {
  summary: SyncSummary | null;
  variant?: 'sidebar' | 'card';
  children?: ReactNode;
}) {
  return (
    <div
      data-testid="sync-card"
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
      {children}
    </div>
  );
}
