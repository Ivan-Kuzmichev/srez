import { z } from 'zod';
import type { FixInput } from '@/db/mutations/reconcile';
import { Decimal } from '@/domain/decimal';
import type { SplitStep } from '@/domain/splits';
import { parseDecimalInput } from '@/lib/parse';
import { zonedLocalToUtc } from '@/lib/time';

/** A fix as the screen and the API send it (FR-REC-4): dates are local days, numbers as typed. */
export const FixRequest = z.object({
  fix: z.enum(['transfer', 'trade', 'split', 'cash', 'redemption', 'exclude']),
  date: z.iso.date(),
  /** Per unit in the security's currency: needed for a trade, optional for a transfer. «1 234,5» works. */
  price: z.string().max(40).optional(),
  /** «Это сплит» as several splits, each «from → to» on its own day. */
  splits: z
    .array(z.object({ date: z.iso.date(), from: z.string().max(20), to: z.string().max(20) }))
    .min(1)
    .max(20)
    .optional(),
});
export type FixRequest = z.infer<typeof FixRequest>;

export type FixRequestError = { code: 'PRICE' | 'INVALID_INPUT' } | { code: 'SPLIT_RATIO'; index: number };

/** Turns a request into the mutation's input, days at noon in the display zone; or says what is wrong. */
export function fixInput(r: FixRequest, timeZone: string): FixInput | FixRequestError {
  const typed = r.price?.trim() ? parseDecimalInput(r.price) : null;
  if (r.price?.trim() && (!typed || new Decimal(typed).lte(0))) return { code: 'PRICE' };
  const executedAt = zonedLocalToUtc(`${r.date}T12:00`, timeZone);
  if (!executedAt) return { code: 'INVALID_INPUT' };
  const steps: SplitStep[] = [];
  for (const [index, s] of (r.fix === 'split' ? (r.splits ?? []) : []).entries()) {
    const from = parseDecimalInput(s.from);
    const to = parseDecimalInput(s.to);
    const at = zonedLocalToUtc(`${s.date}T12:00`, timeZone);
    if (!from || !to || !at || new Decimal(from).lte(0) || new Decimal(to).lte(0) || new Decimal(from).eq(to))
      return { code: 'SPLIT_RATIO', index };
    steps.push({ at, from: new Decimal(from), to: new Decimal(to) });
  }
  return {
    fix: r.fix,
    executedAt,
    price: typed ? new Decimal(typed) : null,
    ...(steps.length > 0 ? { splits: steps } : {}),
  };
}
