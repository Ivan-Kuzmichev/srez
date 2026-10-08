import { and, eq, isNull, or } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { finAccounts, instruments, operations, tagRules, tags } from '@/db/schema';
import { Decimal, toDbDecimal } from '@/domain/decimal';
import type { LedgerOperation } from '@/domain/ledger-types';
import { previewChange, type CellPreview } from '@/domain/operation-input';
import { enqueueRecalc } from '@/jobs/positions';
import type { ParsedOperation } from '@/server/operation-form';
import { uuidv7 } from '@/lib/uuid';
import { loadAccountLedger } from './positions';

export class OperationError extends Error {
  override name = 'OperationError';
  constructor(readonly code: 'NOT_FOUND' | 'ACCOUNT' | 'INSTRUMENT' | 'TAG' | 'IMPORTED') {
    super(code);
  }
}

type OperationRow = typeof operations.$inferSelect;

function ownAccount(db: Db, userId: string, accountId: string) {
  const account = db
    .select()
    .from(finAccounts)
    .where(and(eq(finAccounts.id, accountId), eq(finAccounts.userId, userId)))
    .get();
  if (!account) throw new OperationError('ACCOUNT');
  return account;
}

function checkRefs(db: Db, userId: string, input: Pick<ParsedOperation, 'instrumentId' | 'tagId'>) {
  if (input.instrumentId) {
    const visible = db
      .select({ id: instruments.id })
      .from(instruments)
      .where(
        and(
          eq(instruments.id, input.instrumentId),
          or(isNull(instruments.userId), eq(instruments.userId, userId)),
        ),
      )
      .get();
    if (!visible) throw new OperationError('INSTRUMENT');
  }
  if (input.tagId) {
    const own = db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.id, input.tagId), eq(tags.userId, userId)))
      .get();
    if (!own) throw new OperationError('TAG');
  }
}

const columns = (input: ParsedOperation) => ({
  accountId: input.accountId,
  instrumentId: input.instrumentId,
  type: input.fields.type,
  executedAt: input.executedAt,
  quantity: toDbDecimal(input.fields.quantity),
  price: toDbDecimal(input.fields.price),
  currency: input.currency,
  amount: toDbDecimal(input.fields.amount),
  fee: toDbDecimal(input.fields.fee),
  tax: toDbDecimal(input.fields.tax),
  tagId: input.tagId,
  note: input.note,
});

/** A manual operation; positions follow through the recalc job. */
export function createOperation(db: Db, userId: string, input: ParsedOperation): string {
  return db.transaction(() => {
    const account = ownAccount(db, userId, input.accountId);
    checkRefs(db, userId, input);
    const id = uuidv7();
    db.insert(operations)
      .values({ id, userId, sourceId: account.sourceId, origin: 'manual', ...columns(input) })
      .run();
    enqueueRecalc(db, account.id);
    return id;
  });
}

export function getOwnOperation(db: Db, userId: string, id: string): OperationRow | null {
  return (
    db
      .select()
      .from(operations)
      .where(and(eq(operations.id, id), eq(operations.userId, userId)))
      .get() ?? null
  );
}

/**
 * Manual operations change entirely; imported ones (Т-Инвестиции, chain) only their tag and note
 * (docs/03-data-model.md, operations invariants).
 */
export function updateOperation(
  db: Db,
  userId: string,
  id: string,
  input: ParsedOperation | { tagId: string | null; note: string | null },
): void {
  db.transaction(() => {
    const existing = getOwnOperation(db, userId, id);
    if (!existing) throw new OperationError('NOT_FOUND');
    if ('fields' in input) {
      if (existing.origin !== 'manual') throw new OperationError('IMPORTED');
      ownAccount(db, userId, input.accountId);
      checkRefs(db, userId, input);
      db.update(operations).set(columns(input)).where(eq(operations.id, id)).run();
      enqueueRecalc(db, existing.accountId);
      if (input.accountId !== existing.accountId) enqueueRecalc(db, input.accountId);
    } else {
      checkRefs(db, userId, { instrumentId: null, tagId: input.tagId });
      db.update(operations).set({ tagId: input.tagId, note: input.note }).where(eq(operations.id, id)).run();
      enqueueRecalc(db, existing.accountId);
    }
  });
}

/** Only manual operations can be deleted; imported ones would come back with the next sync anyway. */
export function deleteOperation(db: Db, userId: string, id: string): void {
  db.transaction(() => {
    const existing = getOwnOperation(db, userId, id);
    if (!existing) throw new OperationError('NOT_FOUND');
    if (existing.origin !== 'manual') throw new OperationError('IMPORTED');
    db.delete(operations).where(eq(operations.id, id)).run();
    enqueueRecalc(db, existing.accountId);
  });
}

/** «Что изменится» for a draft, against the account's current journal (minus the edited operation). */
export function previewOperation(
  db: Db,
  userId: string,
  input: ParsedOperation,
  editingId?: string,
): CellPreview | null {
  if (!input.instrumentId) return null;
  const account = ownAccount(db, userId, input.accountId);
  checkRefs(db, userId, input);
  const { ops, ctx } = loadAccountLedger(db, account, [input.currency]);
  const candidate: LedgerOperation = {
    id: editingId ?? 'draft',
    type: input.fields.type,
    executedAt: input.executedAt,
    createdAt: new Date(),
    instrumentId: input.instrumentId,
    quantity: input.fields.quantity,
    price: input.fields.price,
    currency: input.currency,
    amount: input.fields.amount,
    fee: input.fields.fee,
    tax: input.fields.tax,
    accruedInterest: new Decimal(0),
    tagId: input.tagId,
    voided: false,
  };
  return previewChange(
    ops.filter((o) => o.id !== editingId),
    candidate,
    ctx,
  );
}

/**
 * FR-AST-5: a new tag for a position applies to every operation of this instrument on the account
 * and is remembered as a rule, so future imports get it too. `null` removes the tag and the rule.
 */
export function setPositionTag(
  db: Db,
  userId: string,
  accountId: string,
  instrumentId: string,
  tagId: string | null,
): number {
  return db.transaction(() => {
    ownAccount(db, userId, accountId);
    checkRefs(db, userId, { instrumentId, tagId });
    const changed = db
      .update(operations)
      .set({ tagId })
      .where(and(eq(operations.accountId, accountId), eq(operations.instrumentId, instrumentId)))
      .run().changes;
    db.delete(tagRules)
      .where(and(eq(tagRules.accountId, accountId), eq(tagRules.instrumentId, instrumentId)))
      .run();
    if (tagId) db.insert(tagRules).values({ accountId, instrumentId, tagId }).run();
    enqueueRecalc(db, accountId);
    return changed;
  });
}
