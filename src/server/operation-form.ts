import { z } from 'zod';
import { Decimal } from '@/domain/decimal';
import { draftToFields, type OperationDraft, type OperationFields } from '@/domain/operation-input';
import { DEFAULT_TIME_ZONE } from '@/lib/app';
import { parseDecimalInput } from '@/lib/parse';
import { zonedLocalToUtc } from '@/lib/time';

/** Field error codes; the form turns them into Russian text from i18n. */
export type FieldError =
  'REQUIRED' | 'NOT_A_NUMBER' | 'MUST_BE_POSITIVE' | 'NOT_NEGATIVE' | 'BAD_DATE' | 'FUTURE_DATE';

const text = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() : v),
  z.string().max(500).optional().default(''),
);

export const OperationFormSchema = z.object({
  kind: z.enum(['buy', 'sell', 'payout', 'cashflow', 'charge']),
  subtype: text,
  accountId: z.string().min(1).max(64),
  executedAt: text,
  instrumentId: text,
  quantity: text,
  price: text,
  currency: z.string().regex(/^[A-Z]{3}$/),
  fee: text,
  total: text,
  tax: text,
  tagId: text,
  note: text,
});
export type OperationFormInput = z.infer<typeof OperationFormSchema>;

export interface ParsedOperation {
  accountId: string;
  instrumentId: string | null;
  executedAt: Date;
  currency: string;
  fields: OperationFields;
  tagId: string | null;
  note: string | null;
}

/** Validates the form beyond types: numbers, signs, required fields per kind. */
export function parseOperationForm(
  input: OperationFormInput,
  now = new Date(),
): { ok: true; value: ParsedOperation } | { ok: false; fieldErrors: Record<string, FieldError> } {
  const errors: Record<string, FieldError> = {};
  const num = (
    field: keyof OperationFormInput,
    rule: 'positive' | 'nonNegative',
    optional = false,
  ): Decimal => {
    const raw = input[field] as string;
    if (!raw) {
      if (optional) return new Decimal(0);
      errors[field] = 'REQUIRED';
      return new Decimal(0);
    }
    const parsed = parseDecimalInput(raw);
    if (parsed === null) {
      errors[field] = 'NOT_A_NUMBER';
      return new Decimal(0);
    }
    const d = new Decimal(parsed);
    if (rule === 'positive' && d.lte(0)) errors[field] = 'MUST_BE_POSITIVE';
    if (rule === 'nonNegative' && d.lt(0)) errors[field] = 'NOT_NEGATIVE';
    return d;
  };

  const executedAt = input.executedAt ? zonedLocalToUtc(input.executedAt, DEFAULT_TIME_ZONE) : null;
  if (!input.executedAt) errors.executedAt = 'REQUIRED';
  else if (!executedAt) errors.executedAt = 'BAD_DATE';
  else if (executedAt.getTime() > now.getTime() + 24 * 3600_000) errors.executedAt = 'FUTURE_DATE';

  let draft: OperationDraft;
  switch (input.kind) {
    case 'buy':
    case 'sell':
      if (!input.instrumentId) errors.instrumentId = 'REQUIRED';
      draft = {
        kind: 'trade',
        side: input.kind,
        quantity: num('quantity', 'positive'),
        price: num('price', 'positive'),
        fee: num('fee', 'nonNegative', true),
      };
      break;
    case 'payout':
      draft = {
        kind: 'payout',
        type: input.subtype === 'coupon' || input.subtype === 'interest' ? input.subtype : 'dividend',
        gross: num('total', 'positive'),
        tax: num('tax', 'nonNegative', true),
      };
      break;
    case 'cashflow':
      draft = {
        kind: 'cashflow',
        type: input.subtype === 'withdrawal' ? 'withdrawal' : 'deposit',
        total: num('total', 'positive'),
      };
      break;
    case 'charge':
      draft = {
        kind: 'charge',
        type: input.subtype === 'tax' ? 'tax' : 'fee',
        total: num('total', 'positive'),
      };
      break;
  }

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  const instrumentId = input.kind === 'cashflow' ? null : input.instrumentId || null;
  return {
    ok: true,
    value: {
      accountId: input.accountId,
      instrumentId,
      executedAt: executedAt!,
      currency: input.currency,
      fields: draftToFields(draft),
      tagId: input.tagId || null,
      note: input.note || null,
    },
  };
}
