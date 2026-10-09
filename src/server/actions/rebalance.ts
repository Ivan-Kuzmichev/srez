'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { rebalancePlans } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import { toJson } from '../api/core';
import { authedAction } from '../action';
import { planFor, rebalanceBase } from '../rebalance-data';

/** «Сохранить как план» (FR-RBL-4): computed again here from the same input, never taken from the page. */
export const saveRebalancePlan = authedAction(
  z.object({
    portfolioId: z.string().min(1).max(64),
    contribution: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .max(20),
    mode: z.enum(['buy-only', 'buy-sell']),
    useExcessCash: z.boolean(),
  }),
  async ({ portfolioId, contribution, mode, useExcessCash }, session) => {
    const base = rebalanceBase(db(), session.user.id, portfolioId);
    if (!base) return { ok: false, code: 'NOT_FOUND' };
    const { plan, orders } = planFor(base, { contribution: new Decimal(contribution), mode, useExcessCash });
    db()
      .insert(rebalancePlans)
      .values({
        portfolioId,
        input: { contribution, mode, useExcessCash },
        result: toJson({ ...plan, orders }) as Record<string, unknown>,
      })
      .run();
    revalidatePath(`/portfolios/${portfolioId}/rebalance`);
    return { ok: true, data: null };
  },
);
