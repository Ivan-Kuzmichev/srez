'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { IconPayouts } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The quick choices of the picker, each a past day; those before the first snapshot are left out. */
function presets(today: string, min: string | null): { label: string; date: string }[] {
  const t = ru.snapshot.presets;
  const year = Number(today.slice(0, 4));
  const monthStart = `${today.slice(0, 7)}-01`;
  const list = [
    { label: t.yesterday, date: shift(today, -1) },
    { label: t.monthEnd, date: shift(monthStart, -1) },
    { label: t.yearEnd(year - 1), date: `${year - 1}-12-31` },
    { label: t.yearAgo, date: `${year - 1}${today.slice(4)}` },
    ...(min ? [{ label: t.start, date: min }] : []),
  ];
  return list.filter(
    (p, i) => p.date < today && (!min || p.date >= min) && list.findIndex((q) => q.date === p.date) === i,
  );
}

/**
 * «Срез на дату» (FR-PRT-7): a button among the page actions; its popover takes a day, typed or one
 * of the quick ones, and the page then shows the area at the end of that day.
 */
export function SnapshotPicker({
  date,
  today,
  min,
  dateShort,
}: {
  date: string | null;
  today: string;
  min: string | null;
  /** «1 янв» for the button while a day is chosen. */
  dateShort: string | null;
}) {
  const go = useDateHref();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const t = ru.snapshot;
  const label = date ? t.buttonOn(dateShort ?? date) : t.button;
  const pick = (d: string | null) => {
    setOpen(false);
    router.push(go(d && d < today ? d : null), { scroll: false });
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="secondary"
          aria-label={label}
          className={cn('max-wide:size-11 max-wide:px-0', date && 'border-accent text-accent-text')}
        >
          <IconPayouts size={18} />
          <span className="hidden wide:inline">{label}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="z-40 flex w-[min(20rem,calc(100vw-32px))] flex-col gap-3 rounded-card border border-border bg-surface-2 p-4"
        >
          <div className="flex flex-col gap-1">
            <span className="font-medium">{t.title}</span>
            <span className="text-small text-pretty text-muted">{t.hint}</span>
          </div>
          <Input
            type="date"
            mono
            className="[color-scheme:dark]"
            value={date ?? ''}
            min={min ?? undefined}
            max={shift(today, -1)}
            aria-label={t.field}
            onChange={(e) => e.target.value && pick(e.target.value)}
          />
          <div className="flex flex-col">
            {presets(today, min).map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => pick(p.date)}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center rounded-nav border-0 bg-transparent px-2 text-left text-row text-text hover:bg-pressed',
                  p.date === date && 'bg-pressed',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {date ? (
            <Button variant="secondary-raised" onClick={() => pick(null)}>
              {t.back}
            </Button>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
