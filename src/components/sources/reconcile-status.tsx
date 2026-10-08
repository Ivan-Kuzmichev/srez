import Link from 'next/link';
import { IconAlert, IconCheck, IconChevronRight } from '@/components/icons';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';
import type { ReconcileSummary } from '@/server/sources';

/** «Сверка с брокером» inside the T-Invest card: a note on wide screens, a link row on phones. */
export function ReconcileStatus({ summary, href }: { summary: ReconcileSummary; href: string }) {
  const ok = summary.open === 0;
  return (
    <>
      <div
        className="hidden items-start gap-3 rounded-control bg-surface-2 px-4 py-3.5 wide:flex"
        data-testid="reconcile-status"
      >
        <span className={cn('flex pt-0.5', ok ? 'text-gain' : 'text-loss')}>
          {ok ? <IconCheck size={18} /> : <IconAlert size={18} />}
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">
            {ok ? ru.sources.reconcileOk : ru.sources.reconcileOpen(summary.open)}
          </span>
          <span className="text-caption text-pretty text-muted">
            {ok ? ru.sources.reconcileOkText(summary.matched) : ru.sources.reconcileOpenText}{' '}
            <Link href={href} className="no-underline">
              {ok ? ru.sources.openReconcile : ru.sources.reviewReconcile}
            </Link>
          </span>
        </div>
      </div>
      <Link
        href={href}
        className="flex min-h-12 items-center justify-between gap-3 rounded-control bg-surface-2 px-3.5 text-text no-underline wide:hidden"
      >
        <span className="flex items-center gap-2">
          <span className={cn('size-2 rounded-full', ok ? 'bg-gain' : 'bg-loss')} aria-hidden="true" />
          <span>{ok ? ru.sources.reconcileOkShort : ru.sources.reconcileOpenShort(summary.open)}</span>
        </span>
        <IconChevronRight className="text-muted" />
      </Link>
    </>
  );
}
