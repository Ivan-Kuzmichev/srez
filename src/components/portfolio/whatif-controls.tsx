'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
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
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label={t.choiceLabel}
        className="w-[min(18rem,100%)]"
        value={choice}
        onValueChange={(v) => go({ whatif: v })}
        options={Object.entries(t.choices).map(([value, label]) => ({ value, label }))}
      />
      {choice === 'deposit' ? (
        <label className="flex items-center gap-2 text-caption text-muted">
          <span className="block w-24 shrink-0">
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
