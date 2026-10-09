import type { ReactNode } from 'react';
import { TabLinks } from '@/components/ui/tab-links';
import { ru } from '@/lib/i18n/ru';
import { PortfolioFilter } from './portfolio-filter';

/** «Аналитика»: the portfolio filter and the three section tabs that keep it (Risk, Bonds, Realized). */
export function AnalyticsHeader({
  portfolios,
  portfolioId,
  actions,
}: {
  portfolios: { id: string; name: string }[];
  portfolioId: string | null;
  actions?: ReactNode;
}) {
  const q = portfolioId ? `?portfolio=${encodeURIComponent(portfolioId)}` : '';
  return (
    <>
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-3 wide:gap-4">
        <h1 className="m-0 text-page-phone font-semibold tracking-[-0.01em] wide:text-page">
          {ru.pages.analytics}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          {actions}
          {portfolios.length > 0 ? <PortfolioFilter portfolios={portfolios} value={portfolioId} /> : null}
        </div>
      </header>
      <div className="wide:mb-2">
        <TabLinks
          aria-label={ru.analytics.tabsLabel}
          items={[
            { href: `/analytics/risk${q}`, label: ru.analytics.tabs.risk },
            { href: `/analytics/bonds${q}`, label: ru.analytics.tabs.bonds },
            {
              href: `/analytics/realized${q}`,
              label: (
                <>
                  <span className="wide:hidden">{ru.analytics.tabs.realizedShort}</span>
                  <span className="max-wide:hidden">{ru.analytics.tabs.realized}</span>
                </>
              ),
            },
          ]}
        />
      </div>
    </>
  );
}
