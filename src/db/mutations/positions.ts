import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { finAccounts, instruments, lotClosures, lots, operations, positions, tagRules } from '@/db/schema';
import { Decimal, toDbDecimal } from '@/domain/decimal';
import { buildLedger, type LedgerIssue, type LedgerOperation, type Lot } from '@/domain/positions';
import { uuidv7 } from '@/lib/uuid';

const CURRENCY_NAMES: Record<string, string> = { RUB: 'Рубли', USD: 'Доллары США', EUR: 'Евро', CNY: 'Юани' };

/** Cash instruments for the given codes, created on first sight (built-ins come from the migration). */
export function ensureCurrencyInstruments(db: Executor, codes: Iterable<string>): Map<string, string> {
  const wanted = [...new Set(codes)];
  const found = new Map<string, string>();
  if (wanted.length === 0) return found;
  const rows = db
    .select({ id: instruments.id, ticker: instruments.ticker })
    .from(instruments)
    .where(and(eq(instruments.kind, 'currency'), inArray(instruments.ticker, wanted)))
    .all();
  for (const r of rows) found.set(r.ticker!, r.id);
  for (const code of wanted) {
    if (found.has(code)) continue;
    const id = uuidv7();
    db.insert(instruments)
      .values({
        id,
        kind: 'currency',
        assetClass: 'cash',
        ticker: code,
        name: CURRENCY_NAMES[code] ?? code,
        currency: code,
      })
      .run();
    found.set(code, id);
  }
  return found;
}

function toLedgerOperation(row: typeof operations.$inferSelect): LedgerOperation {
  return {
    id: row.id,
    type: row.type,
    executedAt: row.executedAt,
    createdAt: row.createdAt,
    instrumentId: row.instrumentId,
    quantity: new Decimal(row.quantity),
    price: new Decimal(row.price),
    currency: row.currency,
    amount: new Decimal(row.amount),
    fee: new Decimal(row.fee),
    tax: new Decimal(row.tax),
    accruedInterest: new Decimal(row.accruedInterest),
    tagId: row.tagId,
    voided: row.voidedAt !== null,
  };
}

/**
 * Rebuilds positions, lots and closures of one account from its operations, in one transaction.
 * The journal is the source of truth: this can run any number of times with the same result.
 */
export function recalcAccount(db: Executor, accountId: string, now = new Date()): { issues: LedgerIssue[] } {
  return db.transaction((tx) => {
    const account = tx.select().from(finAccounts).where(eq(finAccounts.id, accountId)).get();
    if (!account) return { issues: [] };

    const rows = tx.select().from(operations).where(eq(operations.accountId, accountId)).all();
    const ops = rows.map(toLedgerOperation);
    const cash = ensureCurrencyInstruments(tx, [account.currency, ...ops.map((o) => o.currency)]);
    const rules = tx
      .select({ instrumentId: tagRules.instrumentId, tagId: tagRules.tagId })
      .from(tagRules)
      .where(eq(tagRules.accountId, accountId))
      .all();

    const ledger = buildLedger(ops, {
      tagRules: new Map(rules.filter((r) => r.instrumentId).map((r) => [r.instrumentId!, r.tagId])),
      accountDefaultTagId: account.defaultTagId,
      cashInstrumentId: (code) => cash.get(code) ?? ensureCurrencyInstruments(tx, [code]).get(code)!,
      deductFees: true,
    });

    // Closures go with their lots (on delete cascade).
    tx.delete(lots).where(eq(lots.accountId, accountId)).run();
    tx.delete(positions).where(eq(positions.accountId, accountId)).run();

    if (ledger.positions.length > 0) {
      tx.insert(positions)
        .values(
          ledger.positions.map((p) => ({
            userId: account.userId,
            accountId,
            instrumentId: p.instrumentId,
            tagId: p.tagId,
            quantity: toDbDecimal(p.quantity),
            costBasis: toDbDecimal(p.costBasis),
            avgPrice: toDbDecimal(p.avgPrice),
            realizedPnl: toDbDecimal(p.realizedPnl),
            payoutsTotal: toDbDecimal(p.payoutsTotal),
            firstBuyAt: p.firstBuyAt,
            updatedAt: now,
          })),
        )
        .run();
    }

    const lotIds = new Map<Lot, string>();
    for (const lot of ledger.lots) {
      const id = uuidv7();
      lotIds.set(lot, id);
      tx.insert(lots)
        .values({
          id,
          accountId,
          instrumentId: lot.instrumentId,
          tagId: lot.tagId,
          openOperationId: lot.openOperationId,
          openedAt: lot.openedAt,
          quantity: toDbDecimal(lot.quantity),
          remaining: toDbDecimal(lot.remaining),
          unitCost: toDbDecimal(lot.unitCost),
        })
        .run();
    }
    for (const c of ledger.closures) {
      tx.insert(lotClosures)
        .values({
          lotId: lotIds.get(c.lot)!,
          closeOperationId: c.closeOperationId,
          closedAt: c.closedAt,
          quantity: toDbDecimal(c.quantity),
          cost: toDbDecimal(c.cost),
          proceeds: toDbDecimal(c.proceeds),
          pnl: toDbDecimal(c.pnl),
          holdingDays: c.holdingDays,
        })
        .run();
    }
    return { issues: ledger.issues };
  });
}
