'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { instruments } from '@/db/schema';
import { IntegrationError } from '@/integrations/errors';
import { authedAction } from '../action';
import { logger } from '../logger';
import { createCustomAsset as insertCustomAsset, pickDirectoryHit, searchDirectory } from '../instruments';

export const searchInstruments = authedAction(z.object({ q: z.string().max(64) }), async ({ q }, session) => {
  return { ok: true, data: await searchDirectory(db(), session.user.id, q) };
});

/** Saves the chosen hit into the directory (if it came from outside) and returns it. */
export const pickInstrument = authedAction(
  z.object({ key: z.string().min(3).max(120) }),
  async ({ key }, session) => {
    try {
      const instrument = await pickDirectoryHit(db(), session.user.id, key);
      return instrument ? { ok: true, data: instrument } : { ok: false, code: 'NOT_FOUND' };
    } catch (err) {
      if (err instanceof IntegrationError) {
        logger('prices').warn(
          { integration: err.integration, code: err.code, key },
          'Instrument lookup failed',
        );
        return { ok: false, code: 'DIRECTORY_UNAVAILABLE' };
      }
      throw err;
    }
  },
);

export const createCustomAsset = authedAction(
  z
    .object({
      name: z.string().trim().min(1).max(80),
      assetClass: z.enum(['cash', 'other']),
      currency: z.string().regex(/^[A-Z]{3}$/),
      valuation: z.enum(['manual', 'interest']),
      annualRate: z.preprocess(
        (v) => (typeof v === 'string' ? v.replace(',', '.').trim() || null : v),
        z
          .string()
          .regex(/^\d{1,3}(\.\d{1,4})?$/)
          .nullable()
          .optional()
          .default(null),
      ),
    })
    .refine((v) => v.valuation !== 'interest' || v.annualRate !== null, {
      path: ['annualRate'],
      message: 'REQUIRED',
    }),
  async (input, session) => ({ ok: true, data: insertCustomAsset(db(), session.user.id, input) }),
);

/**
 * The owner's sector for a share or a fund (FR-PRT-10): kept over the broker's. 'auto' goes back to the
 * broker's, asked again on the next price refresh.
 */
export const setInstrumentSector = authedAction(
  z.object({ instrumentId: z.string().max(64), sector: z.string().regex(/^[a-z_]{1,32}$/) }),
  async ({ instrumentId, sector }, session) => {
    const row = db().select().from(instruments).where(eq(instruments.id, instrumentId)).get();
    // Custom assets belong to their owner; exchange instruments are shared by the one-owner app.
    if (!row || (row.userId && row.userId !== session.user.id)) return { ok: false, code: 'NOT_FOUND' };
    const { sector: _old, sectorManual: _manual, ...rest } = (row.meta ?? {}) as Record<string, unknown>;
    const meta = sector === 'auto' ? rest : { ...rest, sector, sectorManual: true };
    db().update(instruments).set({ meta }).where(eq(instruments.id, instrumentId)).run();
    revalidatePath(`/assets/${instrumentId}`);
    return { ok: true, data: null };
  },
);
