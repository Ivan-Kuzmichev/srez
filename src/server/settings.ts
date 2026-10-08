import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '@/db/client';
import { settings } from '@/db/schema';
import { DEFAULT_TIME_ZONE } from '@/lib/app';

/**
 * User settings (docs/03-data-model.md, section 8). Every field has a default, so a missing row or an
 * older shape still parses; unknown keys are dropped.
 */
export const SettingsSchema = z.object({
  display: z
    .object({
      baseCurrency: z.enum(['RUB', 'USD', 'EUR']).default('RUB'),
      extraCurrencies: z.array(z.enum(['USD', 'EUR', 'BTC'])).default(['USD', 'EUR']),
      timezone: z.string().default(DEFAULT_TIME_ZONE),
    })
    .prefault({}),
  returns: z
    .object({
      primaryMetric: z.enum(['xirr', 'twr']).default('xirr'),
      includeCash: z.boolean().default(true),
      deductFees: z.boolean().default(true),
      defaultBenchmarkId: z.string().nullable().default(null),
    })
    .prefault({}),
  prices: z
    .object({
      refreshMinutes: z.union([z.literal(15), z.literal(60), z.literal(1440)]).default(15),
      snapshotTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .default('23:50'),
    })
    .prefault({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

export function getSettings(db: Executor, userId: string): Settings {
  const row = db.select({ data: settings.data }).from(settings).where(eq(settings.userId, userId)).get();
  const parsed = SettingsSchema.safeParse(row?.data ?? {});
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};

/** Merges a section-level change into the stored settings and validates the result. */
export function updateSettings(db: Executor, userId: string, patch: DeepPartial<Settings>): Settings {
  const current = getSettings(db, userId);
  const merged = SettingsSchema.parse({
    display: { ...current.display, ...patch.display },
    returns: { ...current.returns, ...patch.returns },
    prices: { ...current.prices, ...patch.prices },
  });
  const now = new Date();
  db.insert(settings)
    .values({ userId, data: merged, updatedAt: now })
    .onConflictDoUpdate({ target: settings.userId, set: { data: merged, updatedAt: now } })
    .run();
  return merged;
}
