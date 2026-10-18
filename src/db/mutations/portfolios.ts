import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import {
  finAccounts,
  instruments,
  portfolioRules,
  portfolios,
  portfolioSectorTargets,
  portfolioTargets,
  tags,
} from '@/db/schema';
import { ASSET_CLASS_ORDER, targetsValid, type AssetClass } from '@/domain/allocation';
import { Decimal, toDbDecimal } from '@/domain/decimal';
import type { DepositPeriod } from '@/domain/deposit-goal';

export class PortfolioError extends Error {
  override name = 'PortfolioError';
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'ACCOUNT'
      | 'TAG'
      | 'TARGETS'
      | 'SECTOR_TARGETS'
      | 'NO_ACCOUNTS'
      | 'BENCHMARK'
      | 'DEPOSIT_GOAL',
  ) {
    super(code);
  }
}

export interface PortfolioInput {
  name: string;
  rules: { accountId: string; mode: 'all' | 'tag'; tagId: string | null }[];
  targetsEnabled: boolean;
  targets: Partial<Record<AssetClass, Decimal>>;
  deviationThreshold: Decimal;
  /** An index instrument; null takes the settings default. */
  benchmarkId?: string | null;
  /** Target shares by sector, percent of shares and funds; absent sectors have none (FR-PRT-10). */
  sectorTargets?: Record<string, Decimal>;
  /** «Цель пополнений» (FR-PRT-12): rubles a period, null — none; absent keeps what is stored. */
  depositGoal?: { amount: Decimal | null; period: DepositPeriod; yearStart: number };
}

function check(db: Db, userId: string, input: PortfolioInput) {
  if (input.rules.length === 0) throw new PortfolioError('NO_ACCOUNTS');
  if (input.benchmarkId) {
    const index = db
      .select({ kind: instruments.kind })
      .from(instruments)
      .where(eq(instruments.id, input.benchmarkId))
      .get();
    if (index?.kind !== 'index') throw new PortfolioError('BENCHMARK');
  }
  const accountIds = input.rules.map((r) => r.accountId);
  const own = db
    .select({ id: finAccounts.id })
    .from(finAccounts)
    .where(and(eq(finAccounts.userId, userId), inArray(finAccounts.id, accountIds)))
    .all();
  if (own.length !== new Set(accountIds).size) throw new PortfolioError('ACCOUNT');
  const tagIds = input.rules.filter((r) => r.mode === 'tag').map((r) => r.tagId);
  if (tagIds.some((t) => !t)) throw new PortfolioError('TAG');
  if (tagIds.length > 0) {
    const ownTags = db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.userId, userId), inArray(tags.id, tagIds as string[])))
      .all();
    if (ownTags.length !== new Set(tagIds).size) throw new PortfolioError('TAG');
  }
  if (input.targetsEnabled) {
    const values = ASSET_CLASS_ORDER.map((c) => input.targets[c] ?? new Decimal(0));
    if (!targetsValid(values)) throw new PortfolioError('TARGETS');
  }
  // Sector targets need not cover every sector, but together they cannot pass 100 %.
  const sectors = Object.values(input.sectorTargets ?? {});
  if (
    sectors.some((v) => v.lt(0) || v.gt(100)) ||
    sectors.reduce((s, v) => s.plus(v), new Decimal(0)).gt(100)
  )
    throw new PortfolioError('SECTOR_TARGETS');
  const goal = input.depositGoal;
  if (
    goal &&
    ((goal.amount !== null && !goal.amount.gt(0)) ||
      !Number.isInteger(goal.yearStart) ||
      goal.yearStart < 1 ||
      goal.yearStart > 12)
  )
    throw new PortfolioError('DEPOSIT_GOAL');
}

/** Creates or updates a portfolio with its rules and targets, all or nothing (FR-PRT-2, 4). */
export function savePortfolio(db: Db, userId: string, input: PortfolioInput, id?: string): string {
  return db.transaction(() => {
    check(db, userId, input);
    let portfolioId = id;
    const fields = {
      name: input.name,
      targetsEnabled: input.targetsEnabled,
      deviationThreshold: toDbDecimal(input.deviationThreshold),
      benchmarkInstrumentId: input.benchmarkId ?? null,
      ...(input.depositGoal
        ? {
            depositGoal: input.depositGoal.amount ? toDbDecimal(input.depositGoal.amount) : null,
            depositPeriod: input.depositGoal.period,
            depositYearStart: input.depositGoal.yearStart,
          }
        : {}),
    };
    if (portfolioId) {
      const updated = db
        .update(portfolios)
        .set(fields)
        .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)))
        .run();
      if (updated.changes === 0) throw new PortfolioError('NOT_FOUND');
    } else {
      portfolioId = db
        .insert(portfolios)
        .values({ userId, ...fields })
        .returning({ id: portfolios.id })
        .get().id;
    }
    db.delete(portfolioRules).where(eq(portfolioRules.portfolioId, portfolioId)).run();
    db.insert(portfolioRules)
      .values(
        input.rules.map((r) => ({
          portfolioId: portfolioId!,
          accountId: r.accountId,
          mode: r.mode,
          tagId: r.mode === 'tag' ? r.tagId : null,
        })),
      )
      .run();
    db.delete(portfolioTargets).where(eq(portfolioTargets.portfolioId, portfolioId)).run();
    if (input.targetsEnabled) {
      const rows = ASSET_CLASS_ORDER.flatMap((c) => {
        const t = input.targets[c];
        return t && t.gt(0) ? [{ portfolioId: portfolioId!, assetClass: c, targetPct: toDbDecimal(t) }] : [];
      });
      if (rows.length > 0) db.insert(portfolioTargets).values(rows).run();
    }
    db.delete(portfolioSectorTargets).where(eq(portfolioSectorTargets.portfolioId, portfolioId)).run();
    const sectorRows = Object.entries(input.sectorTargets ?? {})
      .filter(([, v]) => v.gt(0))
      .map(([sector, v]) => ({ portfolioId: portfolioId!, sector, targetPct: toDbDecimal(v) }));
    if (sectorRows.length > 0) db.insert(portfolioSectorTargets).values(sectorRows).run();
    return portfolioId;
  });
}

/** Removes the portfolio and its rules; operations and accounts stay (FR-PRT-9). */
export function deletePortfolio(db: Db, userId: string, id: string): void {
  const removed = db
    .delete(portfolios)
    .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)))
    .run();
  if (removed.changes === 0) throw new PortfolioError('NOT_FOUND');
}
