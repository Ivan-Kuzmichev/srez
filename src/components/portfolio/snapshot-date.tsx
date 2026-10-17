'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/field';
import { ru } from '@/lib/i18n/ru';

/**
 * «Срез на дату» (FR-PRT-7): a date field next to the title; the page then shows the area at the end
 * of that day. Today and an empty field go back to the live view.
 */
export function SnapshotDate({
  date,
  today,
  min,
}: {
  date: string | null;
  today: string;
  min: string | null;
}) {
  const go = useDateHref();
  const router = useRouter();
  const t = ru.snapshot;
  return (
    <label className="flex items-center gap-2 text-caption text-muted">
      <span className="whitespace-nowrap">{t.label}</span>
      <Input
        type="date"
        mono
        className="w-[11.5rem] [color-scheme:dark]"
        value={date ?? ''}
        min={min ?? undefined}
        max={today}
        aria-label={t.field}
        onChange={(e) => {
          const v = e.target.value;
          router.push(go(v && v < today ? v : null), { scroll: false });
        }}
      />
    </label>
  );
}

/** The strip above a past day's view: which day it is and the way back. */
export function SnapshotBanner({ dateText }: { dateText: string }) {
  const go = useDateHref();
  const t = ru.snapshot;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface-2 px-4 py-3 text-caption"
      data-testid="snapshot-banner"
      role="status"
    >
      <span>{t.banner(dateText)}</span>
      <Link href={go(null)} scroll={false} className="font-medium">
        {t.back}
      </Link>
    </div>
  );
}

/** The current address with `date` set or dropped: the portfolio and currency choices stay. */
export function useDateHref(): (date: string | null) => string {
  const pathname = usePathname();
  const params = useSearchParams();
  return (date) => {
    const next = new URLSearchParams(params.toString());
    if (date) next.set('date', date);
    else next.delete('date');
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };
}
