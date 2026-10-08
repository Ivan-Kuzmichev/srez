import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OperationForm, type FormKind, type OperationFormValues } from '@/components/ledger/operation-form';
import { FormHeader } from '@/components/shell/form-header';
import { db } from '@/db/client';
import { getOwnOperation } from '@/db/mutations/operations';
import { Decimal } from '@/domain/decimal';
import { DEFAULT_TIME_ZONE } from '@/lib/app';
import { ru } from '@/lib/i18n/ru';
import { utcToZonedLocal } from '@/lib/time';
import { getInstrument } from '@/server/instruments';
import { formChoices } from '@/server/operation-page';
import { requireSession } from '@/server/session';

export const metadata: Metadata = { title: ru.pages.operationEdit };

type Row = NonNullable<ReturnType<typeof getOwnOperation>>;

/** Stored operation → the form's five kinds and plain-text fields. */
function toFormValues(op: Row): OperationFormValues {
  const decimalText = (v: string) =>
    new Decimal(v).isZero() ? '' : new Decimal(v).toFixed().replace('.', ',');
  const kind: FormKind =
    op.type === 'buy' || op.type === 'sell'
      ? op.type
      : ['dividend', 'coupon', 'interest'].includes(op.type)
        ? 'payout'
        : op.type === 'deposit' || op.type === 'withdrawal'
          ? 'cashflow'
          : 'charge';
  const amount = new Decimal(op.amount).abs();
  const total = kind === 'payout' ? amount.plus(op.tax) : amount;
  return {
    kind,
    subtype: kind === 'buy' || kind === 'sell' ? '' : op.type,
    accountId: op.accountId,
    executedAt: utcToZonedLocal(op.executedAt, DEFAULT_TIME_ZONE),
    quantity: decimalText(op.quantity),
    price: decimalText(op.price),
    currency: op.currency,
    fee: decimalText(op.fee),
    total: kind === 'buy' || kind === 'sell' ? '' : total.toFixed().replace('.', ','),
    tax: decimalText(op.tax),
    tagId: op.tagId ?? '',
    note: op.note ?? '',
  };
}

export default async function EditOperationPage({ params }: PageProps<'/operations/[id]/edit'>) {
  const session = await requireSession();
  const { id } = await params;
  const op = getOwnOperation(db(), session.user.id, id);
  if (!op) notFound();
  const { accounts, tags } = formChoices(db(), session.user.id);
  return (
    <>
      <FormHeader
        title={ru.operation.editTitle}
        parent={{ href: '/operations', label: ru.pages.operations }}
        current={ru.operation.breadcrumbEdit}
        backLabel={ru.operation.back}
      />
      <OperationForm
        operationId={op.id}
        accounts={accounts}
        tags={tags}
        instrument={op.instrumentId ? getInstrument(db(), session.user.id, op.instrumentId) : null}
        initial={toFormValues(op)}
        imported={op.origin !== 'manual'}
      />
    </>
  );
}
