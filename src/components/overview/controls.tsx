'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { ru } from '@/lib/i18n/ru';

const ALL = 'all';

function useSetParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  return (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    const q = next.toString();
    startTransition(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
  };
}

/** Phones: the portfolio filter as a full-width row under the header. */
export function PhonePortfolioFilter({
  portfolios,
  portfolioId,
}: {
  portfolios: { id: string; name: string }[];
  portfolioId: string | null;
}) {
  const set = useSetParam();
  if (portfolios.length === 0) return null;
  return (
    <div className="wide:hidden">
      <Select
        aria-label={ru.overview.portfolioFilter}
        tone="page"
        value={portfolioId ?? ALL}
        onValueChange={(v) => set('portfolio', v === ALL ? null : v)}
        options={[
          { value: ALL, label: ru.overview.allPortfolios },
          ...portfolios.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
    </div>
  );
}

const SIGNS: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€', BTC: '₿' };

/** Portfolio filter and display currency, kept in the address bar (FR-OVR-5, 6). */
export function OverviewControls({
  portfolios,
  currency,
  base,
  currencies,
  portfolioId,
}: {
  portfolios: { id: string; name: string }[];
  currency: string;
  base: string;
  currencies: string[];
  portfolioId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    const q = next.toString();
    startTransition(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
  };
  return (
    <>
      {portfolios.length > 0 ? (
        <div className="hidden min-w-44 wide:block">
          <Select
            aria-label={ru.overview.portfolioFilter}
            tone="page"
            value={portfolioId ?? ALL}
            onValueChange={(v) => set('portfolio', v === ALL ? null : v)}
            options={[
              { value: ALL, label: ru.overview.allPortfolios },
              ...portfolios.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </div>
      ) : null}
      {currencies.length > 1 ? (
        <Segmented
          aria-label={ru.overview.currency}
          mono
          value={currency}
          onValueChange={(c) => set('cur', c === base ? null : c)}
          options={currencies.map((c) => ({
            value: c,
            label: SIGNS[c] ?? c,
            ariaLabel: ru.overview.currencies[c],
          }))}
        />
      ) : null}
    </>
  );
}
