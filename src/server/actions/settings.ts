'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { finAccounts } from '@/db/schema';
import { enqueueRecalc } from '@/jobs/positions';
import { authedAction } from '../action';
import { benchmarkOptions, NO_BENCHMARK } from '../benchmarks';
import { getSettings, updateSettings } from '../settings';

/** «Общие» settings: returns, currencies, prices (FR-SET-1…3), saved by one button. */
export const saveGeneralSettings = authedAction(
  z.object({
    returns: z.object({
      primaryMetric: z.enum(['xirr', 'twr']),
      includeCash: z.boolean(),
      deductFees: z.boolean(),
      defaultBenchmarkId: z.string().min(1).max(64),
    }),
    display: z.object({
      baseCurrency: z.enum(['RUB', 'USD', 'EUR']),
      extraCurrencies: z.array(z.enum(['USD', 'EUR', 'BTC'])).max(3),
    }),
    prices: z.object({
      refreshMinutes: z.coerce.number().pipe(z.union([z.literal(15), z.literal(60), z.literal(1440)])),
      snapshotTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    }),
    notify: z.object({
      events: z.object({ payout: z.boolean(), syncError: z.boolean(), weekly: z.boolean() }),
      thresholds: z.object({
        deviationPp: z.coerce.number().min(0.1).max(100),
        dayMovePct: z.coerce.number().min(0.1).max(100),
      }),
    }),
    limits: z.object({
      issuerPct: z.coerce.number().min(1).max(100),
      singleStockPct: z.coerce.number().min(1).max(100),
      cryptoPct: z.coerce.number().min(1).max(100),
      notify: z.boolean(),
    }),
  }),
  async ({ returns, display, prices, notify, limits }, session) => {
    const userId = session.user.id;
    const known = new Set([NO_BENCHMARK, ...benchmarkOptions(db()).map((b) => b.id)]);
    if (!known.has(returns.defaultBenchmarkId)) return { ok: false, code: 'BENCHMARK' };
    const before = getSettings(db(), userId);
    updateSettings(db(), userId, {
      returns,
      display: { ...display, extraCurrencies: [...new Set(display.extraCurrencies)] },
      prices,
      limits,
      notify,
    });
    // Fees go into lot cost and sale proceeds: every account is replayed.
    if (before.returns.deductFees !== returns.deductFees)
      for (const a of db()
        .select({ id: finAccounts.id })
        .from(finAccounts)
        .where(eq(finAccounts.userId, userId))
        .all())
        enqueueRecalc(db(), a.id);
    revalidatePath('/', 'layout');
    return { ok: true, data: null };
  },
);
