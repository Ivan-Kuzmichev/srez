'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { IconMore } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { ru } from '@/lib/i18n/ru';
import { parseDecimalInput } from '@/lib/parse';

/** «А если бы»: what to compare with, and the rate of «свой процент»; kept in the address. */
export function WhatIfControls({ choice, rate }: { choice: string; rate: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [text, setText] = useState(rate.replace('.', ','));
  const t = ru.whatIf;
  const go = (next: Record<string, string>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) q.set(k, v);
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const applyRate = () => {
    const parsed = parseDecimalInput(text);
    if (parsed && Number(parsed) >= 0 && Number(parsed) <= 100) go({ rate: parsed });
  };
  return (
    <div className="flex w-full items-center gap-2 wide:w-auto">
      <div className="min-w-0 flex-1 wide:w-72 wide:flex-none">
        <Select
          aria-label={t.choiceLabel}
          value={choice}
          onValueChange={(v) => go({ whatif: v })}
          options={Object.entries(t.choices).map(([value, label]) => ({ value, label }))}
        />
      </div>
      {choice === 'deposit' ? (
        <label className="flex shrink-0 items-center gap-2 text-caption text-muted">
          <span className="block w-20 shrink-0">
            <Input
              mono
              inputMode="decimal"
              aria-label={t.rateLabel}
              className="text-right"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={applyRate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyRate();
              }}
            />
          </span>
          <span className="whitespace-nowrap">{t.rateUnit}</span>
        </label>
      ) : null}
    </div>
  );
}

/**
 * «⋯» of «А если бы»: payouts sent to a card as the portfolio's, a deposit's capitalization, and an
 * adjustment of the alternative a year. Kept in the address with the rest of the comparison.
 */
export function WhatIfOptionsMenu({
  choice,
  payoutsToCard,
  compound,
  adjust,
}: {
  choice: string;
  payoutsToCard: boolean;
  compound: boolean;
  /** Percent a year as typed: «2». */
  adjust: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [text, setText] = useState(adjust.replace('.', ','));
  // The boxes answer at once; the page follows from the address.
  const [cardKept, setCardKept] = useState(payoutsToCard);
  const [capitalized, setCapitalized] = useState(compound);
  const t = ru.whatIf.options;
  const go = (next: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const applyAdjust = () => {
    const parsed = text.trim() === '' ? '0' : parseDecimalInput(text);
    if (parsed && Number(parsed) >= 0 && Number(parsed) <= 20) go({ wa: parsed === '0' ? null : parsed });
  };
  const deposit = choice === 'key' || choice === 'deposit';
  const adjustable = choice !== 'deposit';
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        {/* A bordered button, as the other actions inside a card. */}
        <Button
          variant="secondary-raised"
          aria-label={t.open}
          className="size-11 shrink-0 px-0 max-wide:size-12 data-[state=open]:bg-pressed"
        >
          <IconMore size={18} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="z-40 flex w-[min(22rem,calc(100vw-32px))] flex-col gap-3 rounded-card border border-border bg-surface-2 p-4 text-row"
        >
          <span className="font-medium">{t.title}</span>
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 size-[18px] shrink-0 accent-accent"
              checked={cardKept}
              onChange={(e) => {
                setCardKept(e.target.checked);
                go({ wd: e.target.checked ? '1' : null });
              }}
            />
            <span className="flex flex-col gap-0.5">
              <span>{t.payoutsToCard}</span>
              <span className="text-small text-pretty text-muted">{t.payoutsToCardHint}</span>
            </span>
          </label>
          {deposit ? (
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-0.5 size-[18px] shrink-0 accent-accent"
                checked={capitalized}
                onChange={(e) => {
                  setCapitalized(e.target.checked);
                  go({ wc: e.target.checked ? null : '0' });
                }}
              />
              <span className="flex flex-col gap-0.5">
                <span>{t.compound}</span>
                <span className="text-small text-pretty text-muted">{t.compoundHint}</span>
              </span>
            </label>
          ) : null}
          {adjustable ? (
            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              <label className="flex items-center justify-between gap-3">
                <span>{choice === 'key' ? t.adjustKey : t.adjustIndex}</span>
                <span className="flex shrink-0 items-center gap-2 text-caption whitespace-nowrap text-muted">
                  <span className="block w-20">
                    <Input
                      mono
                      inputMode="decimal"
                      aria-label={choice === 'key' ? t.adjustKey : t.adjustIndex}
                      className="text-right"
                      value={text}
                      placeholder="0"
                      onChange={(e) => setText(e.target.value)}
                      onBlur={applyAdjust}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') applyAdjust();
                      }}
                    />
                  </span>
                  {t.adjustUnit}
                </span>
              </label>
              <span className="text-small text-pretty text-muted">
                {choice === 'key' ? t.adjustKeyHint : t.adjustIndexHint}
              </span>
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
