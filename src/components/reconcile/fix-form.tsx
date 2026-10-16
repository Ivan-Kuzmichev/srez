'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { formatQuantity } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { applyReconcileFix, snoozeReconcile } from '@/server/actions/reconcile';

export interface FixOption {
  fix: 'transfer' | 'trade' | 'split' | 'cash' | 'redemption' | 'exclude';
  label: string;
  /** Date and price fields under the option. */
  date: boolean;
  price: { label: string; required: boolean } | null;
  /** «Это сплит»: the first split's ratio, when the difference suggests one, and the broker figure. */
  split?: { from: string; to: string; broker: string };
}

interface SplitRow {
  key: number;
  date: string;
  from: string;
  to: string;
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
  const splitOption = options.find((o) => o.split)?.split;
  const [rows, setRows] = useState<SplitRow[]>([
    { key: 0, date: today, from: splitOption?.from ?? '', to: splitOption?.to ?? '' },
  ]);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [splitError, setSplitError] = useState<string | null>(null);
  const setRow = (key: number, patch: Partial<SplitRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows((rs) => [...rs, { key: Math.max(...rs.map((r) => r.key)) + 1, date: today, from: '', to: '' }]);
  const removeRow = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const [pending, start] = useTransition();
  const current = options.find((o) => o.fix === choice)!;

  const apply = (form: FormData) =>
    start(async () => {
      setPriceError(null);
      setRowErrors({});
      setSplitError(null);
      const price = String(form.get('price') ?? '');
      const isSplit = choice === 'split';
      if (isSplit) {
        const missing = rows.findIndex((r) => !r.from.trim() || !r.to.trim() || !r.date);
        if (missing >= 0) {
          setRowErrors({ [rows[missing]!.key]: ru.reconcile.splitRatioError });
          return;
        }
      }
      if (current.price?.required && !price.trim()) {
        setPriceError(ru.reconcile.priceRequired);
        return;
      }
      const r = await applyReconcileFix(null, {
        discrepancyId,
        fix: choice,
        date: String(form.get('date') ?? today),
        price,
        ...(isSplit ? { splits: rows.map(({ date, from, to }) => ({ date, from, to })) } : {}),
      });
      if (r.ok) {
        notify({ tone: 'success', title: ru.reconcile.applied });
        router.replace('?');
        router.refresh();
      } else if (r.code === 'PRICE') setPriceError(ru.reconcile.priceRequired);
      else if (r.code === 'SPLIT_RATIO' || r.code === 'SPLIT_DATE') {
        const row = rows[Number(r.details?.value)];
        if (row)
          setRowErrors({
            [row.key]: r.code === 'SPLIT_DATE' ? ru.reconcile.splitDateError : ru.reconcile.splitRatioError,
          });
      } else if (r.code === 'SPLIT_TOTAL' && splitOption)
        setSplitError(
          ru.reconcile.splitTotal(formatQuantity(String(r.details?.value ?? '0')), splitOption.broker),
        );
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
            {choice === o.fix && o.split ? (
              <div className="flex flex-col gap-3 pt-1 pb-2.5 pl-7">
                {rows.map((row, k) => (
                  <div
                    key={row.key}
                    className="grid grid-cols-2 items-start gap-3 wide:grid-cols-[minmax(150px,1.4fr)_1fr_1fr_auto]"
                  >
                    <Field label={ru.reconcile.date} className="col-span-2 wide:col-span-1">
                      {(f) => (
                        <Input
                          id={f.id}
                          type="date"
                          mono
                          value={row.date}
                          onChange={(e) => setRow(row.key, { date: e.target.value })}
                          required
                          className="[color-scheme:dark]"
                        />
                      )}
                    </Field>
                    <Field label={ru.reconcile.splitFrom} error={rowErrors[row.key]}>
                      {(f) => (
                        <Input
                          id={f.id}
                          aria-describedby={f.describedBy}
                          invalid={f.invalid}
                          inputMode="decimal"
                          mono
                          autoComplete="off"
                          value={row.from}
                          onChange={(e) => setRow(row.key, { from: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label={ru.reconcile.splitTo}>
                      {(f) => (
                        <Input
                          id={f.id}
                          inputMode="decimal"
                          mono
                          autoComplete="off"
                          value={row.to}
                          onChange={(e) => setRow(row.key, { to: e.target.value })}
                        />
                      )}
                    </Field>
                    {rows.length > 1 ? (
                      <Button
                        variant="danger-text"
                        className="col-span-2 justify-self-start wide:col-span-1 wide:mt-[26px]"
                        onClick={() => removeRow(row.key)}
                        aria-label={`${ru.reconcile.splitRemove} ${k + 1}`}
                      >
                        {ru.reconcile.splitRemove}
                      </Button>
                    ) : null}
                  </div>
                ))}
                {splitError ? (
                  <span role="alert" className="text-small text-loss">
                    {splitError}
                  </span>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Button variant="text" onClick={addRow}>
                    {ru.reconcile.splitAdd}
                  </Button>
                  <span className="text-caption text-pretty text-muted">{ru.reconcile.splitHint}</span>
                </div>
              </div>
            ) : choice === o.fix && (o.date || o.price) ? (
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
