import { eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { loadAccountLedger } from '@/db/mutations/positions';
import { finAccounts, instruments } from '@/db/schema';
import type { AssetClass } from '@/domain/allocation';
import { Decimal } from '@/domain/decimal';
import { buildLedger, resolveTag } from '@/domain/positions';
import {
  realizedSummary,
  tradeRows,
  type ClosedPiece,
  type RealizedMethod,
  type RealizedSummary,
  type SaleInfo,
  type SaleTotal,
  type TradeRow,
} from '@/domain/realized';
import { everything, type Scope } from '@/domain/scope';
import { localDate } from '@/lib/time';
import { memoByLedger } from './ledger-cache';
import { loadFx, portfolioScope, rubPer, type PortfolioRow } from './portfolio-data';

const ZERO = new Decimal(0);
const ONE = new Decimal(1);
const PAYOUTS = new Set(['dividend', 'coupon', 'interest']);

export interface RealizedRow extends TradeRow {
  ticker: string | null;
  name: string;
  kind: string;
  accountName: string;
}

export interface RealizedData {
  year: string;
  years: string[];
  method: RealizedMethod;
  rows: RealizedRow[];
  summary: RealizedSummary;
}

/**
 * «Прибыль за год» (FR-ANL-8…10). Trades are replayed without fees, so a trade's result is the price
 * difference and fees stand on their own line (reference 13.1). Payouts count before tax; the tax
 * withheld goes to taxes. Rubles: the cost at the purchase day's rate, everything else at its own day's.
 */
export function realizedData(
  db: Db,
  userId: string,
  portfolio: PortfolioRow | null,
  timeZone: string,
  year: string | null,
  method: RealizedMethod,
  now = new Date(),
): RealizedData {
  const fx = loadFx(db);
  const scope: Scope = portfolio ? portfolioScope(portfolio) : everything;
  const rub = (currency: string, at: Date) => rubPer(fx, currency, localDate(at, timeZone)) ?? ONE;
  const yearOf = (at: Date) => localDate(at, timeZone).slice(0, 4);
  const chosen = year ?? localDate(now, timeZone).slice(0, 4);
  const years = new Set<string>([localDate(now, timeZone).slice(0, 4)]);

  const pieces: ClosedPiece[] = [];
  const sales = new Map<string, SaleInfo & { accountName: string }>();
  const averages = new Map<string, SaleTotal>();
  let payouts = ZERO;
  let fees = ZERO;
  let taxes = ZERO;
  const accounts = db.select().from(finAccounts).where(eq(finAccounts.userId, userId)).all();
  const pendingIds = new Set<string>();
  const pendingSales: {
    saleId: string;
    instrumentId: string;
    accountId: string;
    accountName: string;
    at: Date;
  }[] = [];

  // The replay without fees is the same for every year, method and portfolio: once per journal change.
  const replays = memoByLedger(
    db,
    userId,
    'realizedReplay',
    () =>
      new Map(
        accounts.map((account) => {
          const { ops, ctx } = loadAccountLedger(db, account);
          return [account.id, { ops, ctx, ledger: buildLedger(ops, { ...ctx, deductFees: false }) }] as const;
        }),
      ),
  );
  for (const account of accounts) {
    const replay = replays.get(account.id);
    if (!replay) continue;
    const { ops, ctx, ledger } = replay;
    for (const c of ledger.closures) {
      years.add(yearOf(c.closedAt));
      if (yearOf(c.closedAt) !== chosen || !scope(account.id, c.lot.tagId)) continue;
      pieces.push({
        saleId: c.closeOperationId,
        openedAt: c.lot.openedAt,
        closedAt: c.closedAt,
        quantity: c.quantity,
        costRub: c.cost.times(rub(c.lot.currency, c.lot.openedAt)),
        proceedsRub: c.proceeds.times(rub(c.lot.currency, c.closedAt)),
      });
      if (!pendingIds.has(c.closeOperationId)) {
        pendingIds.add(c.closeOperationId);
        pendingSales.push({
          saleId: c.closeOperationId,
          instrumentId: c.lot.instrumentId,
          accountId: account.id,
          accountName: account.name,
          at: c.closedAt,
        });
      }
    }
    for (const s of ledger.sales) {
      const rate = rub(s.currency, s.at);
      averages.set(s.operationId, {
        saleId: s.operationId,
        quantity: s.quantity,
        proceedsRub: s.proceeds.times(rate),
        averageCostRub: s.averageCost.times(rate),
      });
    }
    for (const op of ops) {
      if (op.voided) continue;
      const y = yearOf(op.executedAt);
      if (PAYOUTS.has(op.type) || op.type === 'fee' || op.type === 'tax') years.add(y);
      if (y !== chosen) continue;
      const tag = op.instrumentId ? resolveTag(op.instrumentId, op.tagId, ctx) : ctx.accountDefaultTagId;
      if (!scope(account.id, tag)) continue;
      const rate = rub(op.currency, op.executedAt);
      if (PAYOUTS.has(op.type)) payouts = payouts.plus(op.amount.plus(op.tax).times(rate));
      const fee = op.type === 'fee' && op.fee.isZero() ? op.amount.abs() : op.fee;
      const tax = op.type === 'tax' && op.tax.isZero() ? op.amount.abs() : op.tax;
      fees = fees.plus(fee.times(rate));
      taxes = taxes.plus(tax.times(rate));
    }
  }

  const ids = [...new Set(pendingSales.map((s) => s.instrumentId))];
  const info = new Map(
    ids.length
      ? db
          .select({
            id: instruments.id,
            ticker: instruments.ticker,
            name: instruments.name,
            kind: instruments.kind,
            assetClass: instruments.assetClass,
          })
          .from(instruments)
          .where(inArray(instruments.id, ids))
          .all()
          .map((i) => [i.id, i])
      : [],
  );
  for (const s of pendingSales)
    sales.set(s.saleId, {
      saleId: s.saleId,
      instrumentId: s.instrumentId,
      accountId: s.accountId,
      accountName: s.accountName,
      assetClass: (info.get(s.instrumentId)?.assetClass ?? 'other') as AssetClass,
      closedAt: s.at,
    });

  const rows = tradeRows(pieces, [...sales.values()], method, averages).map((r) => {
    const i = info.get(r.instrumentId);
    return {
      ...r,
      ticker: i?.ticker ?? null,
      name: i?.name ?? '',
      kind: i?.kind ?? 'other',
      accountName: sales.get(r.saleId)!.accountName,
    };
  });
  return {
    year: chosen,
    years: [...years].sort(),
    method,
    rows,
    summary: realizedSummary(rows, payouts, fees, taxes),
  };
}
