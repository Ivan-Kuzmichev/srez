import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { discrepancies, finAccounts, instruments, operations, sources } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import type { OperationType } from '@/domain/ledger-types';
import type { ReconcileGuess } from '@/domain/reconcile';
import { reconcileSummary, type ReconcileSummary } from './sources';

export type FixKind = 'transfer' | 'trade' | 'split' | 'cash' | 'redemption' | 'exclude';

export interface DiscrepancyItem {
  id: number;
  accountName: string;
  instrumentId: string;
  kind: string;
  ticker: string | null;
  name: string;
  currency: string;
  ledgerQty: Decimal;
  brokerQty: Decimal;
  /** Broker minus journal: what the journal lacks (positive) or has too much (negative). */
  diff: Decimal;
  guess: ReconcileGuess;
  snoozed: boolean;
}

export interface DiscrepancyDetail extends DiscrepancyItem {
  operations: {
    id: string;
    at: Date;
    type: OperationType;
    quantity: Decimal;
    price: Decimal;
    currency: string;
    amount: Decimal;
  }[];
  lastBrokerOperationAt: Date | null;
  nominal: string | null;
  /** The fixes that fit this difference, the most likely first. */
  fixes: FixKind[];
}

export interface FixedItem {
  id: number;
  name: string;
  accountName: string;
  resolvedAt: Date;
  operationType: OperationType;
}

export interface ReconcileView {
  sourceId: string;
  summary: ReconcileSummary;
  items: DiscrepancyItem[];
  selected: DiscrepancyDetail | null;
  fixed: FixedItem[];
}

/** Fixes in the order the screen offers them (Reconcile mockup: transfer, trade, split, exclude). */
export function fixesFor(item: Pick<DiscrepancyItem, 'kind' | 'guess' | 'diff'>): FixKind[] {
  if (item.kind === 'currency') return ['cash', 'exclude'];
  const base: FixKind[] = ['transfer', 'trade', 'split', 'exclude'];
  if (item.guess === 'redemption') return ['redemption', 'transfer', 'exclude'];
  if (item.guess === 'split') return ['split', 'transfer', 'trade', 'exclude'];
  return base;
}

/** «Разбор расхождений» (FR-REC-3) for one T-Invest source; null when it is not the user's. */
export function reconcileView(
  db: Db,
  userId: string,
  sourceId: string,
  selectedId?: number,
): ReconcileView | null {
  const source = db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.userId, userId), eq(sources.kind, 'tinvest')))
    .get();
  if (!source) return null;
  const accounts = db
    .select({ id: finAccounts.id, name: finAccounts.name })
    .from(finAccounts)
    .where(eq(finAccounts.sourceId, sourceId))
    .all();
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const ids = accounts.map((a) => a.id);
  if (ids.length === 0)
    return { sourceId, summary: { matched: 0, open: 0 }, items: [], selected: null, fixed: [] };

  const rows = db
    .select({ d: discrepancies, i: instruments })
    .from(discrepancies)
    .innerJoin(instruments, eq(instruments.id, discrepancies.instrumentId))
    .where(and(inArray(discrepancies.accountId, ids), inArray(discrepancies.status, ['open', 'snoozed'])))
    .orderBy(asc(discrepancies.status), asc(discrepancies.detectedAt), asc(discrepancies.id))
    .all();
  const items: (DiscrepancyItem & { accountId: string; meta: Record<string, unknown> | null })[] = rows.map(
    ({ d, i }) => {
      const ledgerQty = new Decimal(d.ledgerQty);
      const brokerQty = new Decimal(d.brokerQty);
      return {
        id: d.id,
        accountId: d.accountId,
        accountName: names.get(d.accountId) ?? '',
        instrumentId: i.id,
        kind: i.kind,
        ticker: i.ticker,
        name: i.name,
        currency: i.currency,
        ledgerQty,
        brokerQty,
        diff: brokerQty.minus(ledgerQty),
        guess: d.guess,
        snoozed: d.status === 'snoozed',
        meta: i.meta,
      };
    },
  );

  const chosen = items.find((x) => x.id === selectedId) ?? items.find((x) => !x.snoozed) ?? items[0];
  let selected: DiscrepancyDetail | null = null;
  if (chosen) {
    const ops = db
      .select()
      .from(operations)
      .where(
        and(eq(operations.accountId, chosen.accountId), eq(operations.instrumentId, chosen.instrumentId)),
      )
      .orderBy(asc(operations.executedAt))
      .all();
    const lastBroker = db
      .select({ at: operations.executedAt })
      .from(operations)
      .where(
        and(
          eq(operations.accountId, chosen.accountId),
          eq(operations.sourceId, sourceId),
          isNotNull(operations.externalId),
        ),
      )
      .orderBy(desc(operations.executedAt))
      .get();
    const { meta: _meta, accountId: _account, ...item } = chosen;
    selected = {
      ...item,
      operations: ops.map((o) => ({
        id: o.id,
        at: o.executedAt,
        type: o.type,
        quantity: new Decimal(o.quantity),
        price: new Decimal(o.price),
        currency: o.currency,
        amount: new Decimal(o.amount),
      })),
      lastBrokerOperationAt: lastBroker?.at ?? null,
      nominal: typeof chosen.meta?.nominal === 'string' ? chosen.meta.nominal : null,
      fixes: fixesFor(chosen),
    };
  }

  const fixed = db
    .select({ d: discrepancies, name: instruments.name, type: operations.type })
    .from(discrepancies)
    .innerJoin(instruments, eq(instruments.id, discrepancies.instrumentId))
    .innerJoin(operations, eq(operations.id, discrepancies.resolutionOperationId))
    .where(and(inArray(discrepancies.accountId, ids), eq(discrepancies.status, 'resolved')))
    .orderBy(desc(discrepancies.resolvedAt))
    .limit(10)
    .all()
    .map(({ d, name, type }) => ({
      id: d.id,
      name,
      accountName: names.get(d.accountId) ?? '',
      resolvedAt: d.resolvedAt!,
      operationType: type,
    }));

  return {
    sourceId,
    summary: reconcileSummary(db, sourceId),
    items: items.map(({ meta: _meta, accountId: _account, ...rest }) => rest),
    selected,
    fixed,
  };
}
