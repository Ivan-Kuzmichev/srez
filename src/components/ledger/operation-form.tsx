'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ChoiceGroup, Radio } from '@/components/ui/choice';
import { Field, Input } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { Decimal } from '@/domain/decimal';
import { draftTotal, type OperationDraft } from '@/domain/operation-input';
import { cn } from '@/lib/cn';
import { formatCrypto, formatQuantity, formatTradeAmount, currencySymbol } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { parseDecimalInput } from '@/lib/parse';
import {
  deleteOperation,
  previewOperation,
  saveOperation,
  saveTagAndNote,
} from '@/server/actions/operations';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { InstrumentSummary } from '@/server/instruments';
import { CustomAssetCard, CustomAssetDialog } from './custom-asset';
import { InstrumentPicker, instrumentLabel } from './instrument-picker';
import { TagSelect, type TagOption } from './tag-select';

export type FormKind = 'buy' | 'sell' | 'payout' | 'cashflow' | 'charge';
const KINDS: FormKind[] = ['buy', 'sell', 'payout', 'cashflow', 'charge'];
const CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY'];
const DEFAULT_SUBTYPE: Record<FormKind, string> = {
  buy: '',
  sell: '',
  payout: 'dividend',
  cashflow: 'deposit',
  charge: 'fee',
};

export interface OperationFormValues {
  kind: FormKind;
  subtype: string;
  accountId: string;
  executedAt: string;
  quantity: string;
  price: string;
  currency: string;
  fee: string;
  total: string;
  tax: string;
  tagId: string;
  note: string;
}

export interface AccountChoice {
  id: string;
  name: string;
  manual: boolean;
  currency: string;
}

interface Preview {
  quantityBefore: string;
  quantityAfter: string;
  avgPriceBefore: string | null;
  avgPriceAfter: string | null;
}

const num = (v: string) => {
  const parsed = parseDecimalInput(v);
  return parsed === null ? null : new Decimal(parsed);
};

function draftOf(v: OperationFormValues): OperationDraft | null {
  const zero = new Decimal(0);
  switch (v.kind) {
    case 'buy':
    case 'sell': {
      const quantity = num(v.quantity);
      const price = num(v.price);
      if (!quantity || !price) return null;
      return { kind: 'trade', side: v.kind, quantity, price, fee: num(v.fee) ?? zero };
    }
    case 'payout': {
      const gross = num(v.total);
      return gross ? { kind: 'payout', type: v.subtype as 'dividend', gross, tax: num(v.tax) ?? zero } : null;
    }
    case 'cashflow': {
      const total = num(v.total);
      return total ? { kind: 'cashflow', type: v.subtype as 'deposit', total } : null;
    }
    case 'charge': {
      const total = num(v.total);
      return total ? { kind: 'charge', type: v.subtype as 'fee', total } : null;
    }
  }
}

/** Quantities: crypto keeps its digits, securities are counted in pieces. */
const quantityText = (value: string, kind: InstrumentSummary['kind'] | undefined) =>
  kind === 'crypto' ? formatCrypto(value) : formatQuantity(value);

export function OperationForm({
  operationId,
  initial,
  instrument: initialInstrument,
  accounts,
  tags,
  imported,
}: {
  operationId?: string;
  initial: OperationFormValues;
  instrument: InstrumentSummary | null;
  accounts: AccountChoice[];
  tags: TagOption[];
  /** Loaded from a source: only the tag and the note can change. */
  imported?: boolean;
}) {
  const router = useRouter();
  const notify = useToast();
  const [values, setValues] = useState(initial);
  const [instrument, setInstrument] = useState<InstrumentSummary | null>(initialInstrument);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const tagRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof OperationFormValues>(key: K, value: OperationFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const isTrade = values.kind === 'buy' || values.kind === 'sell';
  const needsAsset = values.kind !== 'cashflow';
  const draft = draftOf(values);
  const total = draft ? draftTotal(draft) : null;
  const totalText = `${formatTradeAmount(total ?? 0)}\u00a0${currencySymbol(values.currency)}`;

  const tagValue = () =>
    tagRef.current?.querySelector<HTMLInputElement>('input[name="tagId"]')?.value ?? values.tagId;
  const payload = () => ({
    ...values,
    tagId: tagValue(),
    instrumentId: needsAsset ? (instrument?.id ?? '') : '',
    ...(operationId ? { id: operationId } : {}),
  });

  // «Что изменится»: recomputed on the server a moment after typing stops.
  useEffect(() => {
    if (!isTrade || !instrument || !draft || imported) return;
    const timer = setTimeout(async () => {
      const result = await previewOperation(null, payload());
      setPreview(result.ok ? result.data : null);
    }, 400);
    return () => clearTimeout(timer);
    // payload() reads the same state listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, instrument, isTrade, imported]);

  async function submit(more: boolean) {
    setBusy(true);
    setRefusal(null);
    const result = imported
      ? await saveTagAndNote(null, { id: operationId!, tagId: tagValue(), note: values.note })
      : await saveOperation(null, payload());
    setBusy(false);
    if (!result.ok) {
      setErrors(
        Object.fromEntries(
          Object.entries(result.fieldErrors ?? {}).map(([k, [code]]) => [
            k,
            ru.operation.errors[code ?? ''] ?? ru.operation.errors.REQUIRED!,
          ]),
        ),
      );
      setRefusal(
        result.fieldErrors ? ru.operation.failed : (ru.operation.refused[result.code] ?? ru.operation.failed),
      );
      return;
    }
    setErrors({});
    if (more) {
      notify({ tone: 'success', title: ru.operation.savedMore });
      setValues((v) => ({ ...v, quantity: '', price: '', fee: '', total: '', tax: '', note: '' }));
      setInstrument(null);
      setPreview(null);
      setFormKey((k) => k + 1);
      return;
    }
    notify({ tone: 'success', title: ru.operation.saved });
    router.push('/operations');
    router.refresh();
  }

  const fieldError = (name: string) => errors[name];
  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: ru.operation.accountOption(a.name, a.manual),
  }));
  const currencyOptions = CURRENCIES.map((c) => ({ value: c, label: ru.currencies[c]! }));
  const subtypes = ru.operation.subtypes[values.kind];

  const textField = (name: 'quantity' | 'price' | 'fee' | 'total' | 'tax', label: string, mono = true) => (
    <Field label={label} error={fieldError(name)}>
      {(f) => (
        <Input
          id={f.id}
          name={name}
          inputMode="decimal"
          mono={mono}
          disabled={imported}
          value={values[name]}
          onChange={(e) => set(name, e.target.value)}
          invalid={f.invalid}
          aria-describedby={f.describedBy}
        />
      )}
    </Field>
  );

  const ticker = instrument?.ticker ?? instrument?.name ?? '';

  return (
    <div className="flex flex-wrap items-start gap-4 pb-28 wide:pb-0">
      <section className="flex min-w-0 flex-[3_1_480px] flex-col gap-4 wide:gap-5 wide:rounded-card wide:border wide:border-border wide:bg-surface wide:p-7">
        {refusal ? <Alert>{refusal}</Alert> : null}
        {imported ? <Alert tone="warn">{ru.operation.importedNote}</Alert> : null}

        <div className="hidden wide:block">
          <ChoiceGroup legend={ru.operation.kindLabel}>
            <div className="flex flex-wrap gap-x-[22px] gap-y-1">
              {KINDS.map((k) => (
                <Radio
                  key={k}
                  name="kind"
                  disabled={imported}
                  label={
                    <span className={cn(values.kind === k && 'font-medium')}>{ru.operation.kinds[k]}</span>
                  }
                  checked={values.kind === k}
                  onChange={() => setValues((v) => ({ ...v, kind: k, subtype: DEFAULT_SUBTYPE[k] }))}
                />
              ))}
            </div>
          </ChoiceGroup>
        </div>
        <div className="wide:hidden">
          <Field label={ru.operation.kindLabel}>
            {(f) => (
              <Select
                id={f.id}
                disabled={imported}
                value={values.kind}
                onValueChange={(k) =>
                  setValues((v) => ({ ...v, kind: k as FormKind, subtype: DEFAULT_SUBTYPE[k as FormKind] }))
                }
                options={KINDS.map((k) => ({ value: k, label: ru.operation.kinds[k]! }))}
              />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
          <Field label={ru.operation.account} error={fieldError('accountId')}>
            {(f) => (
              <Select
                id={f.id}
                disabled={imported}
                value={values.accountId}
                onValueChange={(id) => {
                  const account = accounts.find((a) => a.id === id);
                  setValues((v) => ({ ...v, accountId: id, currency: account?.currency ?? v.currency }));
                }}
                options={accountOptions}
              />
            )}
          </Field>
          <Field label={ru.operation.executedAt} error={fieldError('executedAt')}>
            {(f) => (
              <Input
                id={f.id}
                type="datetime-local"
                mono
                disabled={imported}
                className="[color-scheme:dark]"
                value={values.executedAt}
                onChange={(e) => set('executedAt', e.target.value)}
                invalid={f.invalid}
                aria-describedby={f.describedBy}
              />
            )}
          </Field>
        </div>

        {subtypes ? (
          <Field label={ru.operation.subtypeLabel[values.kind]!}>
            {(f) => (
              <Select
                id={f.id}
                disabled={imported}
                value={values.subtype}
                onValueChange={(s) => set('subtype', s)}
                options={Object.entries(subtypes).map(([value, label]) => ({ value, label }))}
              />
            )}
          </Field>
        ) : null}

        {needsAsset ? (
          <div className="flex flex-col gap-1.5" key={formKey}>
            <Field
              label={values.kind === 'charge' ? ru.operation.assetOptional : ru.operation.asset}
              error={fieldError('instrumentId')}
            >
              {(f) =>
                imported ? (
                  <Input id={f.id} disabled value={instrument ? instrumentLabel(instrument) : ''} />
                ) : (
                  <InstrumentPicker
                    id={f.id}
                    value={instrument}
                    onChange={(i) => {
                      setInstrument(i);
                      if (i && CURRENCIES.includes(i.currency)) set('currency', i.currency);
                    }}
                    invalid={f.invalid}
                    describedBy={f.describedBy}
                  />
                )
              }
            </Field>
            {!imported ? (
              <>
                <span className="hidden text-caption text-muted wide:inline">{ru.operation.assetHint}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-caption text-muted wide:hidden">
                  {ru.operation.assetHintPhone}
                  <CustomAssetDialog
                    currency={values.currency}
                    onCreated={setInstrument}
                    trigger={
                      <Button variant="text" className="min-h-11 text-caption">
                        {ru.customAsset.open}
                      </Button>
                    }
                  />
                </span>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 wide:grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))]">
          {isTrade ? (
            <>
              {textField('quantity', ru.operation.quantity)}
              {textField('price', ru.operation.price)}
            </>
          ) : (
            <>
              {textField('total', values.kind === 'payout' ? ru.operation.payoutTotal : ru.operation.total)}
              {values.kind === 'payout' ? textField('tax', ru.operation.tax) : null}
            </>
          )}
          <Field label={ru.operation.currency}>
            {(f) => (
              <Select
                id={f.id}
                disabled={imported}
                value={values.currency}
                onValueChange={(c) => set('currency', c)}
                options={currencyOptions}
              />
            )}
          </Field>
          {isTrade ? textField('fee', ru.operation.fee) : null}
        </div>

        <div className="hidden items-center justify-between gap-3 rounded-control bg-surface-2 px-4 py-3.5 wide:flex">
          <span className="text-muted">{isTrade ? ru.operation.tradeTotal : ru.operation.total}</span>
          <span className="num text-[18px] whitespace-nowrap" data-testid="operation-total">
            {totalText}
          </span>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3" ref={tagRef}>
          <Field label={ru.operation.tag}>
            {(f) => <TagSelect id={f.id} name="tagId" tags={tags} defaultValue={values.tagId || null} />}
          </Field>
          <Field label={ru.operation.note}>
            {(f) => (
              <Input
                id={f.id}
                maxLength={500}
                placeholder={ru.operation.notePlaceholder}
                value={values.note}
                onChange={(e) => set('note', e.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="hidden flex-wrap justify-between gap-2 border-t border-border pt-[18px] wide:flex">
          <Button asChild variant="secondary">
            <Link href="/operations">{ru.operation.cancel}</Link>
          </Button>
          <div className="flex flex-wrap gap-2">
            {!operationId ? (
              <Button variant="secondary-raised" disabled={busy} onClick={() => void submit(true)}>
                {ru.operation.saveMore}
              </Button>
            ) : null}
            <Button variant="primary" disabled={busy} onClick={() => void submit(false)}>
              {ru.operation.save}
            </Button>
          </div>
        </div>
        {operationId && !imported ? (
          <ConfirmDialog
            trigger={
              <Button variant="danger-text" className="self-start px-0 text-row">
                {ru.journal.delete}
              </Button>
            }
            title={ru.journal.deleteTitle}
            description={ru.journal.deleteText}
            confirmLabel={ru.journal.delete}
            danger
            onConfirm={async () => {
              const result = await deleteOperation(null, { id: operationId });
              if (!result.ok) {
                notify({ tone: 'error', title: ru.journal.failed });
                return;
              }
              notify({ tone: 'success', title: ru.journal.deleted });
              router.push('/operations');
              router.refresh();
            }}
          />
        ) : null}
      </section>

      {!imported ? (
        <div className="flex min-w-0 flex-[2_1_340px] flex-col gap-4">
          {isTrade ? (
            <section
              className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
              data-testid="preview"
            >
              <h2 className="m-0 text-card font-semibold">{ru.operation.previewTitle}</h2>
              {preview && instrument ? (
                <div className="flex flex-col">
                  <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border-subtle">
                    <span className="text-muted">{ru.operation.previewPosition(ticker)}</span>
                    <span className="num text-caption whitespace-nowrap">
                      {quantityText(preview.quantityBefore, instrument.kind)} →{' '}
                      {quantityText(preview.quantityAfter, instrument.kind)}
                    </span>
                  </div>
                  <div className="flex min-h-12 items-center justify-between gap-3">
                    <span className="text-muted">{ru.operation.previewAvg}</span>
                    <span className="num text-caption whitespace-nowrap">
                      {preview.avgPriceBefore ? formatTradeAmount(preview.avgPriceBefore) : ''} →{' '}
                      {preview.avgPriceAfter ? formatTradeAmount(preview.avgPriceAfter) : ru.common.none}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-caption text-muted">{ru.operation.previewEmpty}</div>
              )}
              <div className="text-small text-muted">{ru.operation.previewLater}</div>
            </section>
          ) : null}
          {needsAsset ? (
            <div className="hidden wide:block">
              <CustomAssetCard currency={values.currency} onCreated={setInstrument} />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Phones: a pinned action bar instead of the tab bar (docs/08-ui.md, section 2). */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-border-subtle bg-bg-nav px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] wide:hidden">
        <div className="flex flex-col gap-0.5">
          <span className="text-small text-muted">
            {isTrade ? ru.operation.tradeTotal : ru.operation.total}
          </span>
          <span className="num text-[18px] whitespace-nowrap">{totalText}</span>
        </div>
        <Button
          variant="primary"
          size="lg"
          className="min-w-[150px]"
          disabled={busy}
          onClick={() => void submit(false)}
        >
          {ru.operation.save}
        </Button>
      </div>
    </div>
  );
}
