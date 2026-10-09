import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RebalanceCalculator } from '@/components/rebalance/calculator';
import { db } from '@/db/client';
import { formatDateYear } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { rebalanceBase } from '@/server/rebalance-data';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.rebalance };

/** «Ребаланс» (Rebalance, MRebalance; FR-RBL-1…4). A calculation against the portfolio targets, not advice. */
export default async function RebalancePage({ params }: PageProps<'/portfolios/[id]/rebalance'>) {
  const session = await requireSession();
  const { id } = await params;
  const base = rebalanceBase(db(), session.user.id, id);
  if (!base) notFound();
  const tz = getSettings(db(), session.user.id).display.timezone;
  const hasTargets = base.portfolio.targetsEnabled && base.targets.size > 0;

  return (
    <>
      <header className="flex flex-col gap-3 wide:mb-2">
        <div className="hidden items-center gap-2 text-caption text-muted wide:flex">
          <Link href="/portfolios" className="no-underline">
            {ru.pages.portfolios}
          </Link>
          <span>/</span>
          <Link href={`/portfolios/${id}`} className="no-underline">
            {base.portfolio.name}
          </Link>
          <span>/</span>
          <span>{ru.rebalance.breadcrumb}</span>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/portfolios/${id}`}
            aria-label={ru.rebalance.back}
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
            {ru.rebalance.title}
          </h1>
        </div>
      </header>
      {hasTargets ? (
        <RebalanceCalculator
          portfolioId={id}
          values={[...base.values].map(([c, v]) => [c, v.toString()])}
          targets={[...base.targets].map(([c, v]) => [c, v.toString()])}
          candidates={[...base.candidates].map(([c, x]) => [
            c,
            {
              instrumentId: x.instrumentId,
              ticker: x.ticker,
              name: x.name,
              kind: x.kind,
              price: x.price.toString(),
              lot: x.lot.toString(),
              quantity: x.quantity.toString(),
            },
          ])}
          lastPlan={base.lastPlanAt ? formatDateYear(base.lastPlanAt, tz) : null}
        />
      ) : (
        <section className="rounded-card border border-border bg-surface p-4 text-caption text-muted wide:p-6">
          {ru.rebalance.noTargets}
        </section>
      )}
    </>
  );
}
