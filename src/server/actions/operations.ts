'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import {
  createOperation,
  deleteOperation as removeOperation,
  OperationError,
  previewOperation as preview,
  updateOperation,
  setPositionTag as retagPosition,
} from '@/db/mutations/operations';
import { Decimal, toDbDecimal } from '@/domain/decimal';
import { parseDecimalInput } from '@/lib/parse';
import { authedAction, type ActionResult } from '../action';
import { OperationFormSchema, parseOperationForm } from '../operation-form';
import { getSettings } from '../settings';

function refused(err: unknown): ActionResult<never> {
  if (err instanceof OperationError) return { ok: false, code: err.code };
  throw err;
}

const SaveInput = OperationFormSchema.extend({ id: z.string().max(64).optional() });

/** Creates or updates a manual operation. Field errors come back keyed by field name. */
export const saveOperation = authedAction(SaveInput, async (input, session) => {
  const parsed = parseOperationForm(input, new Date(), getSettings(db(), session.user.id).display.timezone);
  if (!parsed.ok) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: Object.fromEntries(Object.entries(parsed.fieldErrors).map(([k, v]) => [k, [v]])),
    };
  }
  try {
    const id = input.id ?? createOperation(db(), session.user.id, parsed.value);
    if (input.id) updateOperation(db(), session.user.id, input.id, parsed.value);
    revalidatePath('/operations');
    revalidatePath('/sources');
    return { ok: true, data: { id } };
  } catch (err) {
    return refused(err);
  }
});

/** Imported operations: the tag and the note; a coin that arrived from the chain, also its price. */
export const saveTagAndNote = authedAction(
  z.object({
    id: z.string().max(64),
    tagId: z.preprocess((v) => (v === '' ? null : v), z.string().max(64).nullable()),
    note: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() ? v.trim() : null),
      z.string().max(500).nullable(),
    ),
    /** Only for a coin that arrived from the chain: what it really cost, per unit. */
    price: z.string().max(40).optional(),
  }),
  async ({ id, tagId, note, price }, session) => {
    let arrival: string | undefined;
    if (price !== undefined) {
      const parsed = parseDecimalInput(price);
      if (parsed === null || !new Decimal(parsed).gt(0))
        return {
          ok: false,
          code: 'INVALID_INPUT',
          fieldErrors: { price: [parsed === null ? 'NOT_A_NUMBER' : 'MUST_BE_POSITIVE'] },
        };
      arrival = toDbDecimal(new Decimal(parsed));
    }
    try {
      updateOperation(db(), session.user.id, id, { tagId, note, price: arrival });
      revalidatePath('/operations');
      return { ok: true, data: null };
    } catch (err) {
      return refused(err);
    }
  },
);

export const deleteOperation = authedAction(z.object({ id: z.string().max(64) }), async ({ id }, session) => {
  try {
    removeOperation(db(), session.user.id, id);
    revalidatePath('/operations');
    revalidatePath('/sources');
    return { ok: true, data: null };
  } catch (err) {
    return refused(err);
  }
});

/** «Что изменится» while the form is being filled. Silent about incomplete input. */
export const previewOperation = authedAction(SaveInput, async (input, session) => {
  const parsed = parseOperationForm(input, new Date(), getSettings(db(), session.user.id).display.timezone);
  if (!parsed.ok) return { ok: true, data: null };
  try {
    const p = preview(db(), session.user.id, parsed.value, input.id);
    return {
      ok: true,
      data: p && {
        quantityBefore: toDbDecimal(p.quantityBefore),
        quantityAfter: toDbDecimal(p.quantityAfter),
        avgPriceBefore: p.avgPriceBefore && toDbDecimal(p.avgPriceBefore),
        avgPriceAfter: p.avgPriceAfter && toDbDecimal(p.avgPriceAfter),
      },
    };
  } catch (err) {
    return refused(err);
  }
});

/** FR-AST-5: one tag for every operation of the instrument on the account, remembered as a rule. */
export const setPositionTag = authedAction(
  z.object({
    accountId: z.string().max(64),
    instrumentId: z.string().max(64),
    tagId: z.preprocess((v) => (v === '' ? null : v), z.string().max(64).nullable()),
  }),
  async ({ accountId, instrumentId, tagId }, session) => {
    try {
      const changed = retagPosition(db(), session.user.id, accountId, instrumentId, tagId);
      revalidatePath('/operations');
      return { ok: true, data: { changed } };
    } catch (err) {
      return refused(err);
    }
  },
);
