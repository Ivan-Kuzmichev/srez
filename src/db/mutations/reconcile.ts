import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { discrepancies, finAccounts, instruments, operations, reconcileExclusions } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import type { OperationType } from '@/domain/ledger-types';
import { enqueueRecalc } from '@/jobs/positions';
import { uuidv7 } from '@/lib/uuid';
import type { FixKind } from '@/server/reconcile';

export class ReconcileError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'NOT_OPEN' | 'PRICE' | 'FIX' | 'NO_FIX') {
    super(code);
  }
}

function own(db: Executor, userId: string, id: number) {
  const row = db
    .select({ d: discrepancies, sourceId: finAccounts.sourceId, i: instruments })
    .from(discrepancies)
    .innerJoin(finAccounts, eq(finAccounts.id, discrepancies.accountId))
    .innerJoin(instruments, eq(instruments.id, discrepancies.instrumentId))
    .where(and(eq(discrepancies.id, id), eq(finAccounts.userId, userId)))
    .get();
  if (!row) throw new ReconcileError('NOT_FOUND');
  return row;
}

export interface FixInput {
  fix: FixKind;
  executedAt: Date;
  /** Per unit, in the instrument's currency: required for a missing trade, optional for a transfer. */
  price: Decimal | null;
}

/**
 * FR-REC-4: the fix becomes an operation with origin `reconcile` and closes the discrepancy;
 * «Не сверять» excludes the security instead (FR-REC-5).
 */
export function applyFix(db: Executor, userId: string, id: number, input: FixInput): string | null {
  return db.transaction((tx) => {
    const { d, sourceId, i } = own(tx, userId, id);
    if (d.status !== 'open' && d.status !== 'snoozed') throw new ReconcileError('NOT_OPEN');
    const now = new Date();
    if (input.fix === 'exclude') {
      tx.insert(reconcileExclusions)
        .values({ accountId: d.accountId, instrumentId: d.instrumentId })
        .onConflictDoNothing()
        .run();
      tx.update(discrepancies)
        .set({ status: 'ignored', resolvedAt: now })
        .where(eq(discrepancies.id, id))
        .run();
      return null;
    }
    const diff = new Decimal(d.brokerQty).minus(d.ledgerQty);
    const qty = diff.abs();
    const more = diff.gt(0);
    const price = input.price ?? new Decimal(0);
    let op: {
      type: OperationType;
      instrumentId: string | null;
      quantity: Decimal;
      price: Decimal;
      amount: Decimal;
      currency: string;
    };
    switch (input.fix) {
      case 'transfer':
        op = {
          type: more ? 'transfer_in' : 'transfer_out',
          instrumentId: i.id,
          quantity: qty,
          price,
          amount: new Decimal(0),
          currency: i.currency,
        };
        break;
      case 'trade':
        if (price.lte(0)) throw new ReconcileError('PRICE');
        op = {
          type: more ? 'buy' : 'sell',
          instrumentId: i.id,
          quantity: qty,
          price,
          amount: more ? qty.times(price).neg() : qty.times(price),
          currency: i.currency,
        };
        break;
      case 'split':
        // The difference, signed: a reverse split takes away.
        op = {
          type: 'split',
          instrumentId: i.id,
          quantity: diff,
          price: new Decimal(0),
          amount: new Decimal(0),
          currency: i.currency,
        };
        break;
      case 'cash':
        if (i.kind !== 'currency') throw new ReconcileError('FIX');
        op = {
          type: more ? 'deposit' : 'withdrawal',
          instrumentId: null,
          quantity: new Decimal(0),
          price: new Decimal(0),
          amount: diff,
          currency: i.ticker ?? i.currency,
        };
        break;
      case 'redemption': {
        if (i.kind !== 'bond' || more) throw new ReconcileError('FIX');
        const nominal =
          typeof i.meta?.nominal === 'string' && new Decimal(i.meta.nominal).gt(0)
            ? new Decimal(i.meta.nominal)
            : price;
        if (nominal.lte(0)) throw new ReconcileError('PRICE');
        op = {
          type: 'redemption',
          instrumentId: i.id,
          quantity: qty,
          price: nominal,
          amount: qty.times(nominal),
          currency: i.currency,
        };
        break;
      }
      default:
        throw new ReconcileError('FIX');
    }
    const opId = uuidv7();
    tx.insert(operations)
      .values({
        id: opId,
        userId,
        accountId: d.accountId,
        instrumentId: op.instrumentId,
        type: op.type,
        executedAt: input.executedAt,
        quantity: op.quantity.toString(),
        price: op.price.toString(),
        currency: op.currency,
        amount: op.amount.toString(),
        origin: 'reconcile',
        sourceId,
      })
      .run();
    tx.update(discrepancies)
      .set({ status: 'resolved', resolutionOperationId: opId, resolvedAt: now })
      .where(eq(discrepancies.id, id))
      .run();
    enqueueRecalc(tx, d.accountId);
    return opId;
  });
}

/** Undo: the fix operation goes, the discrepancy is open again (unless a newer one took its place). */
export function undoFix(db: Executor, userId: string, id: number): void {
  db.transaction((tx) => {
    const { d } = own(tx, userId, id);
    if (d.status !== 'resolved' || !d.resolutionOperationId) throw new ReconcileError('NO_FIX');
    tx.delete(operations).where(eq(operations.id, d.resolutionOperationId)).run();
    const newer = tx
      .select({ id: discrepancies.id })
      .from(discrepancies)
      .where(
        and(
          eq(discrepancies.accountId, d.accountId),
          eq(discrepancies.instrumentId, d.instrumentId),
          inArray(discrepancies.status, ['open', 'snoozed']),
        ),
      )
      .get();
    tx.update(discrepancies)
      .set(
        newer
          ? { resolutionOperationId: null }
          : { status: 'open', resolutionOperationId: null, resolvedAt: null },
      )
      .where(eq(discrepancies.id, id))
      .run();
    enqueueRecalc(tx, d.accountId);
  });
}

/** «Отложить» and back (FR-REC-5). */
export function snoozeDiscrepancy(db: Executor, userId: string, id: number, snoozed: boolean): void {
  const { d } = own(db, userId, id);
  if (d.status !== 'open' && d.status !== 'snoozed') throw new ReconcileError('NOT_OPEN');
  db.update(discrepancies)
    .set({ status: snoozed ? 'snoozed' : 'open' })
    .where(eq(discrepancies.id, id))
    .run();
}
