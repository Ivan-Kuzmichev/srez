'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { applyReconcileFix, snoozeReconcile } from '@/server/actions/reconcile';

export interface FixOption {
  fix: 'transfer' | 'trade' | 'split' | 'cash' | 'redemption' | 'exclude';
  label: string;
  /** Date and price fields under the option. */
  date: boolean;
  price: { label: string; required: boolean } | null;
}

/** «Как исправить» with «Отложить» and «Применить» (Reconcile, MReconcile). */
export function FixForm({
  discrepancyId,
  options,
  today,
  snoozed,
}: {
  discrepancyId: number;
  options: FixOption[];
  today: string;
  snoozed: boolean;
}) {
  const router = useRouter();
  const notify = useToast();
  const [choice, setChoice] = useState(options[0]!.fix);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const current = options.find((o) => o.fix === choice)!;

  const apply = (form: FormData) =>
    start(async () => {
      setPriceError(null);
      const price = String(form.get('price') ?? '');
      if (current.price?.required && !price.trim()) {
        setPriceError(ru.reconcile.priceRequired);
        return;
      }
      const r = await applyReconcileFix(null, {
        discrepancyId,
        fix: choice,
        date: String(form.get('date') ?? today),
        price,
      });
      if (r.ok) {
        notify({ tone: 'success', title: ru.reconcile.applied });
        router.replace('?');
        router.refresh();
      } else if (r.code === 'PRICE') setPriceError(ru.reconcile.priceRequired);
      else notify({ tone: 'error', title: ru.reconcile.failed });
    });

  const snooze = () =>
    start(async () => {
      const r = await snoozeReconcile(null, { discrepancyId, snoozed: !snoozed });
      if (!r.ok) notify({ tone: 'error', title: ru.reconcile.failed });
      router.refresh();
    });

  return (
    <form action={apply} className="flex flex-col gap-[22px]" key={discrepancyId}>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="mb-1.5 p-0 text-small text-muted">{ru.reconcile.howToFix}</legend>
        {options.map((o) => (
          <div key={o.fix} className="flex flex-col">
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5">
              <input
                type="radio"
                name="fix"
                value={o.fix}
                checked={choice === o.fix}
                onChange={() => setChoice(o.fix)}
                className="m-0 size-[18px] shrink-0 accent-accent"
              />
              <span className={choice === o.fix ? 'font-medium' : undefined}>{o.label}</span>
            </label>
            {choice === o.fix && (o.date || o.price) ? (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] gap-3 pt-1 pb-2.5 pl-7">
                {o.date ? (
                  <Field label={ru.reconcile.date}>
                    {(f) => (
                      <Input
                        id={f.id}
                        name="date"
                        type="date"
                        mono
                        defaultValue={today}
                        required
                        className="[color-scheme:dark]"
                      />
                    )}
                  </Field>
                ) : null}
                {o.price ? (
                  <Field label={o.price.label} error={priceError}>
                    {(f) => (
                      <Input
                        id={f.id}
                        aria-describedby={f.describedBy}
                        invalid={Boolean(priceError)}
                        name="price"
                        inputMode="decimal"
                        mono
                        autoComplete="off"
                        placeholder={o.price!.required ? undefined : ru.reconcile.pricePlaceholder}
                      />
                    )}
                  </Field>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-[18px]">
        <span className="flex-[1_1_240px] text-caption text-pretty text-muted">{ru.reconcile.note}</span>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={snooze} disabled={pending}>
            {snoozed ? ru.reconcile.unsnooze : ru.reconcile.snooze}
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {ru.reconcile.apply}
          </Button>
        </div>
      </div>
    </form>
  );
}
