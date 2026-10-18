'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { DEPOSIT_PERIODS } from '@/db/schema';
import {
  deletePortfolio as removePortfolio,
  PortfolioError,
  savePortfolio as storePortfolio,
} from '@/db/mutations/portfolios';
import { ASSET_CLASS_ORDER, type AssetClass } from '@/domain/allocation';
import { Decimal, toDbDecimal } from '@/domain/decimal';
import { scopeOf } from '@/domain/scope';
import { sectorAllocation } from '@/domain/sectors';
import { parseDecimalInput } from '@/lib/parse';
import { authedAction, type ActionResult } from '../action';
import { loadFx, loadUserLedger, loadValuedCells, summarizeArea } from '../portfolio-data';
import { getSettings } from '../settings';

const percent = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? '0' : parseDecimalInput(v)) : v),
  z.string().regex(/^\d{1,3}(\.\d+)?$/),
);

const Rule = z.object({
  accountId: z.string().max(64),
  mode: z.enum(['all', 'tag']),
  tagId: z.string().max(64).nullable(),
});

const PortfolioInput = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1).max(64),
  rules: z.array(Rule).max(100),
  targetsEnabled: z.boolean(),
  targets: z.partialRecord(z.enum(ASSET_CLASS_ORDER), percent).default({}),
  deviationThreshold: percent,
  /** Empty: the default benchmark from the settings. */
  benchmarkId: z.string().max(64).default(''),
  /** Percent of shares and funds by sector code (FR-PRT-10). */
  sectorTargets: z.record(z.string().regex(/^[a-z_]{1,32}$/), percent).default({}),
  /** «Цель пополнений» (FR-PRT-12); amount '' — no goal. */
  depositGoal: z
    .object({
      amount: z.preprocess(
        (v) => (typeof v === 'string' ? (v.trim() === '' ? '' : (parseDecimalInput(v) ?? v)) : v),
        z.union([z.literal(''), z.string().regex(/^\d{1,12}(\.\d{1,2})?$/)]),
      ),
      period: z.enum(DEPOSIT_PERIODS),
      yearStart: z.number().int().min(1).max(12),
    })
    .optional(),
});

function refused(err: unknown): ActionResult<never> {
  if (err instanceof PortfolioError) return { ok: false, code: err.code };
  throw err;
}

export const savePortfolio = authedAction(PortfolioInput, async (input, session) => {
  try {
    const id = storePortfolio(
      db(),
      session.user.id,
      {
        name: input.name,
        rules: input.rules,
        targetsEnabled: input.targetsEnabled,
        targets: Object.fromEntries(
          Object.entries(input.targets).map(([k, v]) => [k, new Decimal(v)]),
        ) as Partial<Record<AssetClass, Decimal>>,
        deviationThreshold: new Decimal(input.deviationThreshold),
        benchmarkId: input.benchmarkId || null,
        sectorTargets: Object.fromEntries(
          Object.entries(input.sectorTargets).map(([k, v]) => [k, new Decimal(v)]),
        ),
        ...(input.depositGoal
          ? {
              depositGoal: {
                amount: input.depositGoal.amount ? new Decimal(input.depositGoal.amount) : null,
                period: input.depositGoal.period,
                yearStart: input.depositGoal.yearStart,
              },
            }
          : {}),
      },
      input.id,
    );
    revalidatePath('/portfolios');
    revalidatePath('/');
    return { ok: true, data: { id } };
  } catch (err) {
    return refused(err);
  }
});

export const deletePortfolio = authedAction(z.object({ id: z.string().max(64) }), async ({ id }, session) => {
  try {
    removePortfolio(db(), session.user.id, id);
    revalidatePath('/portfolios');
    revalidatePath('/');
    return { ok: true, data: null };
  } catch (err) {
    return refused(err);
  }
});

/** «Что попадёт в портфель» while the composition is being edited. */
export const previewPortfolio = authedAction(
  z.object({
    rules: z.array(Rule).max(100),
    targets: z.partialRecord(z.enum(ASSET_CLASS_ORDER), percent).default({}),
    sectorTargets: z.record(z.string().regex(/^[a-z_]{1,32}$/), percent).default({}),
    threshold: percent.default('5'),
  }),
  async ({ rules, targets, sectorTargets, threshold }, session) => {
    const userId = session.user.id;
    const fx = loadFx(db());
    const cells = loadValuedCells(db(), userId, fx);
    const s = summarizeArea(
      db(),
      userId,
      scopeOf(rules),
      cells,
      loadUserLedger(db(), userId),
      fx,
      getSettings(db(), userId).display.timezone,
      {
        values: new Map(Object.entries(targets).map(([k, v]) => [k as AssetClass, new Decimal(v)])),
        threshold: new Decimal(threshold),
      },
    );
    const sectors = sectorAllocation(
      s.cells
        .filter((c) => c.assetClass === 'stocks' || c.assetClass === 'funds')
        .map((c) => ({ sector: c.sector ?? '', value: c.valueRub })),
      new Map(
        Object.entries(sectorTargets)
          .filter(([, v]) => new Decimal(v).gt(0))
          .map(([k, v]) => [k, new Decimal(v)]),
      ),
      new Decimal(threshold),
    ).rows;
    return {
      ok: true,
      data: {
        value: toDbDecimal(s.value),
        approx: s.approx,
        positions: s.cells.filter((c) => !c.isCash).length,
        classes: s.classes.map((c) => ({
          assetClass: c.assetClass,
          share: toDbDecimal(c.share),
          target: c.target ? toDbDecimal(c.target) : null,
          offTarget: c.offTarget,
        })),
        sectors: sectors.map((r) => ({
          sector: r.sector,
          share: toDbDecimal(r.share),
          target: r.target ? toDbDecimal(r.target) : null,
          offTarget: r.offTarget,
        })),
      },
    };
  },
);
