import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { finAccounts, operations } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import type { DayDeposit } from '@/domain/deposit-goal';
import type { Scope } from '@/domain/scope';
import { localDate } from '@/lib/time';
import { rubPer, type FxSeries, type UserLedger } from './portfolio-data';

/** The broker's id of an imported operation: both sides of a transfer between own accounts share it. */
const brokerId = (externalId: string | null) => externalId?.split(':')[1] ?? null;

/**
 * «Цель пополнений» (FR-PRT-12, docs/04 section 18): money put into the portfolio's cash, in rubles
 * at the CBR rate of its day. A transfer from another own account counts unless that account's cash
 * is in the portfolio too: then the money only moved inside it.
 */
export function portfolioDeposits(
  db: Db,
  userId: string,
  scope: Scope,
  ledger: UserLedger,
  fx: FxSeries,
  timeZone: string,
): DayDeposit[] {
  const cashIn = (accountId: string) => {
    const ctx = ledger.ctxByAccount.get(accountId);
    return ctx ? scope(accountId, ctx.accountDefaultTagId) : false;
  };
  const rows = db
    .select({
      accountId: operations.accountId,
      type: operations.type,
      amount: operations.amount,
      currency: operations.currency,
      executedAt: operations.executedAt,
      externalId: operations.externalId,
    })
    .from(operations)
    .where(
      and(
        eq(operations.userId, userId),
        inArray(operations.type, ['deposit', 'withdrawal']),
        isNull(operations.voidedAt),
      ),
    )
    .all();
  // Withdrawals from the portfolio's own cash, by the broker's id: the other side of a transfer.
  const movedOut = new Set(
    rows
      .filter((r) => r.type === 'withdrawal' && cashIn(r.accountId))
      .map((r) => brokerId(r.externalId))
      .filter((id): id is string => id !== null),
  );
  return rows
    .filter((r) => r.type === 'deposit' && cashIn(r.accountId))
    .filter((r) => {
      const id = brokerId(r.externalId);
      return id === null || !movedOut.has(id);
    })
    .map((r) => {
      const date = localDate(r.executedAt, timeZone);
      return { date, amount: new Decimal(r.amount).times(rubPer(fx, r.currency, date) ?? 1) };
    })
    .filter((d) => d.amount.gt(0));
}

/** The portfolio holds an individual investment account: the year goal names the tax deduction. */
export function holdsIis(db: Db, userId: string, accountIds: readonly string[]): boolean {
  if (accountIds.length === 0) return false;
  return (
    db
      .select({ id: finAccounts.id })
      .from(finAccounts)
      .where(
        and(
          eq(finAccounts.userId, userId),
          eq(finAccounts.kind, 'iis'),
          inArray(finAccounts.id, [...accountIds]),
        ),
      )
      .get() !== undefined
  );
}
