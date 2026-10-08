'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { setManualPrice } from '@/server/actions/prices';

/** «Указать стоимость» in a position row: today's price for one unit. */
export function PriceButton({
  instrumentId,
  asset,
  currency,
}: {
  instrumentId: string;
  asset: string;
  currency: string;
}) {
  const router = useRouter();
  const notify = useToast();
  return (
    <FormDialog
      trigger={
        <Button variant="text" className="min-h-11 px-0 text-caption">
          {ru.portfolio.setPrice}
        </Button>
      }
      title={ru.portfolio.setPriceTitle(asset)}
      description={ru.portfolio.setPriceText}
      submitLabel={ru.common.save}
      onSubmit={async (form) => {
        const result = await setManualPrice(null, { instrumentId, price: form.get('price') });
        if (!result.ok) return ru.portfolio.priceFailed;
        notify({ tone: 'success', title: ru.portfolio.priceSaved });
        router.refresh();
        return null;
      }}
    >
      <Field label={ru.portfolio.priceLabel(currency)}>
        {(f) => <Input id={f.id} name="price" inputMode="decimal" mono required />}
      </Field>
    </FormDialog>
  );
}
