'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { ru } from '@/lib/i18n/ru';

const ALL = 'all';

/** Portfolio and year of «Выплаты», kept in the address. */
export function PayoutsControls({
  portfolios,
  portfolioId,
  years,
  year,
}: {
  portfolios: { id: string; name: string }[];
  portfolioId: string | null;
  years: number[];
  year: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, start] = useTransition();
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    const q = next.toString();
    start(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
  };
  return (
    <>
      {portfolios.length ? (
        <div className="min-w-44">
          <Select
            aria-label={ru.payoutsPage.portfolio}
            tone="page"
            value={portfolioId ?? ALL}
            onValueChange={(v) => set('portfolio', v === ALL ? null : v)}
            options={[
              { value: ALL, label: ru.payoutsPage.allPortfolios },
              ...portfolios.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </div>
      ) : null}
      {years.length > 1 ? (
        <Segmented
          aria-label={ru.payoutsPage.year}
          mono
          value={String(year)}
          onValueChange={(v) => set('year', v === String(years[0]) ? null : v)}
          options={[...years]
            .reverse()
            .slice(-4)
            .map((y) => ({ value: String(y), label: String(y) }))}
        />
      ) : null}
    </>
  );
}
