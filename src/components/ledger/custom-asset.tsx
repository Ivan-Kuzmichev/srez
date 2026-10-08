'use client';

import { Dialog } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ChoiceGroup, Radio } from '@/components/ui/choice';
import { Field, Input } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { createCustomAsset } from '@/server/actions/instruments';
import type { InstrumentSummary } from '@/server/instruments';

/** Fields of «Свой актив» (FR-AST-4); the currency is the one chosen in the operation form. */
function CustomAssetFields({
  currency,
  onCreated,
}: {
  currency: string;
  onCreated: (i: InstrumentSummary) => void;
}) {
  const notify = useToast();
  const [assetClass, setAssetClass] = useState('cash');
  const [valuation, setValuation] = useState<'interest' | 'manual'>('interest');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    const result = await createCustomAsset(null, {
      name: form.get('name'),
      assetClass,
      currency,
      valuation,
      annualRate: form.get('annualRate'),
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      return;
    }
    setErrors({});
    notify({ tone: 'success', title: ru.customAsset.created });
    onCreated(result.data);
  }

  return (
    <form action={submit} className="flex flex-col gap-4">
      <Field label={ru.customAsset.name} error={errors.name ? ru.operation.errors.REQUIRED : undefined}>
        {(f) => (
          <Input
            id={f.id}
            name="name"
            required
            maxLength={80}
            placeholder={ru.customAsset.namePlaceholder}
            invalid={f.invalid}
            aria-describedby={f.describedBy}
          />
        )}
      </Field>
      <Field label={ru.customAsset.assetClass}>
        {(f) => (
          <Select
            id={f.id}
            value={assetClass}
            onValueChange={setAssetClass}
            options={['cash', 'other'].map((c) => ({ value: c, label: ru.customAsset.classes[c]! }))}
          />
        )}
      </Field>
      <ChoiceGroup legend={ru.customAsset.valuation}>
        <Radio
          name="valuation"
          label={ru.customAsset.interest}
          checked={valuation === 'interest'}
          onChange={() => setValuation('interest')}
        />
        <Radio
          name="valuation"
          label={ru.customAsset.manual}
          checked={valuation === 'manual'}
          onChange={() => setValuation('manual')}
        />
      </ChoiceGroup>
      {valuation === 'interest' ? (
        <Field
          label={ru.customAsset.rate}
          error={errors.annualRate ? ru.operation.errors.NOT_A_NUMBER : undefined}
        >
          {(f) => (
            <Input
              id={f.id}
              name="annualRate"
              inputMode="decimal"
              mono
              required
              invalid={f.invalid}
              aria-describedby={f.describedBy}
            />
          )}
        </Field>
      ) : null}
      <Button type="submit" variant="secondary-raised" disabled={busy} className="self-start">
        {ru.customAsset.create}
      </Button>
    </form>
  );
}

/** Wide screens: a card next to the form (OperationForm mockup). */
export function CustomAssetCard(props: { currency: string; onCreated: (i: InstrumentSummary) => void }) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6">
      <h2 className="m-0 text-card font-semibold">{ru.customAsset.title}</h2>
      <div className="text-caption text-muted">{ru.customAsset.text}</div>
      <CustomAssetFields {...props} />
    </section>
  );
}

/** Phones: the same fields in a dialog opened from under the asset search. */
export function CustomAssetDialog({
  currency,
  onCreated,
  trigger,
}: {
  currency: string;
  onCreated: (i: InstrumentSummary) => void;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg-nav/80" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-card border border-border bg-surface p-6">
          <Dialog.Title className="m-0 text-card font-semibold">{ru.customAsset.title}</Dialog.Title>
          <Dialog.Description className="m-0 text-caption text-muted">
            {ru.customAsset.text}
          </Dialog.Description>
          <CustomAssetFields
            currency={currency}
            onCreated={(i) => {
              setOpen(false);
              onCreated(i);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
