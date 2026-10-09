import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { finAccounts, instruments, operations, tags } from '@/db/schema';
import { csvNumber, toCsv } from '@/lib/csv';
import { ru } from '@/lib/i18n/ru';
import { localDate } from '@/lib/time';

/**
 * «Выгрузить операции в CSV» (FR-SET-6): the whole journal, oldest first, without voided entries.
 * Nothing secret is in the journal; raw answers stay out.
 */
export function operationsCsv(db: Db, userId: string, timeZone: string): string {
  const rows = db
    .select({
      at: operations.executedAt,
      type: operations.type,
      ticker: instruments.ticker,
      name: instruments.name,
      quantity: operations.quantity,
      price: operations.price,
      currency: operations.currency,
      amount: operations.amount,
      fee: operations.fee,
      tax: operations.tax,
      accrued: operations.accruedInterest,
      account: finAccounts.name,
      tag: tags.name,
      origin: operations.origin,
      externalId: operations.externalId,
      note: operations.note,
    })
    .from(operations)
    .innerJoin(finAccounts, eq(finAccounts.id, operations.accountId))
    .leftJoin(instruments, eq(instruments.id, operations.instrumentId))
    .leftJoin(tags, eq(tags.id, operations.tagId))
    .where(and(eq(operations.userId, userId), isNull(operations.voidedAt)))
    .orderBy(asc(operations.executedAt), asc(operations.createdAt))
    .all();
  // Full precision: a spreadsheet should get the stored numbers, only with a decimal comma.
  const n = (v: string) => csvNumber(v.replace('.', ','));
  return toCsv(
    ru.journal.csvColumns,
    rows.map((r) => [
      localDate(r.at, timeZone),
      ru.journal.types[r.type] ?? r.type,
      r.ticker ?? '',
      r.name ?? '',
      n(r.quantity),
      n(r.price),
      r.currency,
      n(r.amount),
      n(r.fee),
      n(r.tax),
      n(r.accrued),
      r.account,
      r.tag ?? '',
      ru.journal.origins[r.origin] ?? r.origin,
      r.externalId ?? '',
      r.note ?? '',
    ]),
  );
}
