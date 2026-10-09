'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Select } from '@/components/ui/select';
import { ru } from '@/lib/i18n/ru';

const ALL = 'all';

/** «Все портфели» in the analytics header, kept in the address bar. */
export function PortfolioFilter({
  portfolios,
  value,
}: {
  portfolios: { id: string; name: string }[];
  value: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  return (
    <div className="hidden min-w-44 wide:block">
      <Select
        aria-label={ru.analytics.portfolio}
        tone="page"
        value={value ?? ALL}
        onValueChange={(v) => {
          const next = new URLSearchParams(params);
          if (v === ALL) next.delete('portfolio');
          else next.set('portfolio', v);
          const q = next.toString();
          startTransition(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
        }}
        options={[
          { value: ALL, label: ru.analytics.allPortfolios },
          ...portfolios.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
    </div>
  );
}
