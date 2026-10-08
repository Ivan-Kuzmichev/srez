import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { recalcAccount } from '@/db/mutations/positions';
import { discrepancies, instruments, positions, reconcileExclusions } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import { reconcile, type ReconcileInstrument } from '@/domain/reconcile';
import { quotation, type TinvestClient } from '@/integrations/tinvest/client';
import type { InstrumentRef } from '@/integrations/tinvest/map';
import { instrumentKey, resolveInstruments } from './tinvest-instruments';

export interface ReconcileResult {
  /** Securities (not cash) present on either side. */
  securities: number;
  open: number;
}

/**
 * FR-REC-1, 2: the account's positions from the journal against the broker's portfolio. New
 * differences open a discrepancy; one that went away is resolved; open and snoozed ones get fresh numbers.
 */
export async function reconcileAccount(
  db: Db,
  client: TinvestClient,
  account: { id: string; externalId: string },
  now: Date,
  today: string,
): Promise<ReconcileResult> {
  recalcAccount(db, account.id, now);
  const portfolio = await client.getPortfolio(account.externalId);
  const refs: InstrumentRef[] = portfolio.map((p) => ({
    uid: p.instrumentUid,
    positionUid: p.positionUid,
    figi: p.figi,
    ticker: p.ticker,
    classCode: p.classCode,
    kind: '',
    type: p.instrumentType,
    name: p.ticker,
  }));
  const ids = await resolveInstruments(db, client, refs);
  const broker = portfolio.map((p, i) => ({
    instrumentId: ids.get(instrumentKey(refs[i]!))!,
    quantity: quotation(p.quantity),
  }));
  const ledger = db
    .select({ instrumentId: positions.instrumentId, quantity: positions.quantity })
    .from(positions)
    .where(eq(positions.accountId, account.id))
    .all()
    .map((p) => ({ instrumentId: p.instrumentId, quantity: new Decimal(p.quantity) }));

  const involved = [...new Set([...broker, ...ledger].map((h) => h.instrumentId))];
  const info = new Map<string, ReconcileInstrument>(
    involved.length
      ? db
          .select({ id: instruments.id, kind: instruments.kind, meta: instruments.meta })
          .from(instruments)
          .where(inArray(instruments.id, involved))
          .all()
          .map((i) => [
            i.id,
            {
              kind: i.kind,
              maturityDate: typeof i.meta?.maturityDate === 'string' ? i.meta.maturityDate : null,
            },
          ])
      : [],
  );
  const excluded = new Set(
    db
      .select({ id: reconcileExclusions.instrumentId })
      .from(reconcileExclusions)
      .where(eq(reconcileExclusions.accountId, account.id))
      .all()
      .map((r) => r.id),
  );
  const found = reconcile(ledger, broker, info, excluded, today);

  db.transaction((tx) => {
    const active = tx
      .select()
      .from(discrepancies)
      .where(and(eq(discrepancies.accountId, account.id), inArray(discrepancies.status, ['open', 'snoozed'])))
      .all();
    const byInstrument = new Map(active.map((d) => [d.instrumentId, d]));
    for (const d of found) {
      const values = { ledgerQty: d.ledgerQty.toString(), brokerQty: d.brokerQty.toString(), guess: d.guess };
      const existing = byInstrument.get(d.instrumentId);
      if (existing) {
        tx.update(discrepancies).set(values).where(eq(discrepancies.id, existing.id)).run();
        byInstrument.delete(d.instrumentId);
      } else {
        tx.insert(discrepancies)
          .values({ accountId: account.id, instrumentId: d.instrumentId, ...values, detectedAt: now })
          .run();
      }
    }
    // Whatever is left now matches the broker, or was taken out of reconciliation.
    for (const gone of byInstrument.values())
      tx.update(discrepancies)
        .set({ status: excluded.has(gone.instrumentId) ? 'ignored' : 'resolved', resolvedAt: now })
        .where(eq(discrepancies.id, gone.id))
        .run();
  });

  const securities = involved.filter((id) => info.get(id)?.kind !== 'currency' && !excluded.has(id));
  return { securities: securities.length, open: found.length };
}
