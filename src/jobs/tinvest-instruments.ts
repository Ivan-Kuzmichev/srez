import { eq, or, sql } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { ensureCurrencyInstruments } from '@/db/mutations/positions';
import { instruments } from '@/db/schema';
import { TinvestClient, TinvestError, type Instrument } from '@/integrations/tinvest/client';
import type { InstrumentRef } from '@/integrations/tinvest/map';
import { uuidv7 } from '@/lib/uuid';

type Row = typeof instruments.$inferSelect;

/** What the T-Invest client contributes to an instrument row. */
export interface TinvestMeta {
  classCode?: string;
  positionUid?: string;
  /** Every T-Invest uid of this security: trading modes (TRUR, TRUR@) and stale ids in old operations. */
  uids?: string[];
}

const tinvestMeta = (row: Pick<Row, 'meta'>): TinvestMeta =>
  (row.meta?.tinvest as TinvestMeta | undefined) ?? {};

const KIND: Record<string, { kind: Row['kind']; assetClass: Row['assetClass'] }> = {
  share: { kind: 'share', assetClass: 'stocks' },
  bond: { kind: 'bond', assetClass: 'bonds' },
  etf: { kind: 'etf', assetClass: 'funds' },
  INSTRUMENT_TYPE_SHARE: { kind: 'share', assetClass: 'stocks' },
  INSTRUMENT_TYPE_BOND: { kind: 'bond', assetClass: 'bonds' },
  INSTRUMENT_TYPE_ETF: { kind: 'etf', assetClass: 'funds' },
};
// Structured notes, futures and the rest: kept, but outside the known classes.
const OTHER = { kind: 'share', assetClass: 'other' } as const;

const isCurrency = (r: { kind: string; type: string }) =>
  r.kind === 'INSTRUMENT_TYPE_CURRENCY' || r.type === 'currency';

/** A known row by any of the T-Invest ids we have seen for it, or by FIGI. */
function findLocal(db: Executor, ref: InstrumentRef): Row | undefined {
  if (ref.uid) {
    const byUid = db
      .select()
      .from(instruments)
      .where(
        or(
          eq(instruments.externalUid, ref.uid),
          sql`exists (select 1 from json_each(${instruments.meta}, '$.tinvest.uids') where value = ${ref.uid})`,
        ),
      )
      .get();
    if (byUid) return byUid;
  }
  return ref.figi ? db.select().from(instruments).where(eq(instruments.figi, ref.figi)).get() : undefined;
}

function remember(db: Executor, row: Row, uid: string, extra: Partial<Row> = {}): void {
  const meta = tinvestMeta(row);
  const uids = [...new Set([...(meta.uids ?? []), ...(uid ? [uid] : [])])];
  db.update(instruments)
    .set({
      externalUid: row.externalUid ?? (uid || null),
      figi: row.figi ?? extra.figi ?? null,
      meta: { ...row.meta, tinvest: { ...meta, uids } },
    })
    .where(eq(instruments.id, row.id))
    .run();
}

/** The directory entry, trying the uid, then FIGI, then ticker and class code (old uids go stale). */
async function lookup(client: TinvestClient, ref: InstrumentRef): Promise<Instrument | null> {
  const attempts = [
    ref.uid ? { uid: ref.uid } : null,
    ref.figi ? { figi: ref.figi } : null,
    ref.ticker && ref.classCode ? { ticker: ref.ticker, classCode: ref.classCode } : null,
  ].filter((a) => a !== null);
  for (const id of attempts) {
    try {
      return await client.getInstrument(id);
    } catch (err) {
      if (!(err instanceof TinvestError) || err.code !== 'NOT_FOUND') throw err;
    }
  }
  return null;
}

/**
 * Resolves the instruments of a batch of operations to ids in `instruments`, creating rows on first
 * sight. Securities are one row per ISIN; currencies become our cash instruments by ISO code.
 */
export async function resolveInstruments(
  db: Executor,
  client: TinvestClient,
  refs: InstrumentRef[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const keyOf = (r: InstrumentRef) => r.uid || r.figi;
  for (const ref of refs) {
    const key = keyOf(ref);
    if (!key || out.has(key)) continue;

    if (isCurrency(ref)) {
      let iso = '';
      try {
        if (ref.uid) iso = (await client.getCurrency(ref.uid)).isoCurrencyName;
      } catch (err) {
        if (!(err instanceof TinvestError) || err.code !== 'NOT_FOUND') throw err;
      }
      // USD000UTSTOM, EUR_RUB__TOM, CNYRUB_TOM: the code leads the ticker.
      const code = (iso || ref.ticker.slice(0, 3)).toUpperCase();
      out.set(key, ensureCurrencyInstruments(db, [code]).get(code)!);
      continue;
    }

    const local = findLocal(db, ref);
    if (local) {
      out.set(key, local.id);
      continue;
    }

    const found = await lookup(client, ref);
    const isin = found?.isin || null;
    const sameIsin = isin ? db.select().from(instruments).where(eq(instruments.isin, isin)).get() : undefined;
    if (sameIsin) {
      remember(db, sameIsin, ref.uid, { figi: found?.figi || null });
      if (found && found.uid !== ref.uid)
        remember(db, db.select().from(instruments).where(eq(instruments.id, sameIsin.id)).get()!, found.uid);
      out.set(key, sameIsin.id);
      continue;
    }

    const kind = KIND[found?.instrumentType ?? ref.type] ?? KIND[found?.instrumentKind ?? ref.kind] ?? OTHER;
    const id = uuidv7();
    const uids = [...new Set([ref.uid, found?.uid].filter((u): u is string => Boolean(u)))];
    db.insert(instruments)
      .values({
        id,
        ...kind,
        ticker: found?.ticker || ref.ticker || null,
        name: found?.name || ref.name || ref.ticker || ref.figi,
        isin,
        figi: found?.figi || ref.figi || null,
        externalUid: found?.uid || ref.uid || null,
        currency: (found?.currency || 'rub').toUpperCase(),
        lot: String(found?.lot ?? 1),
        meta: {
          tinvest: {
            classCode: found?.classCode || ref.classCode,
            positionUid: found?.positionUid || ref.positionUid,
            uids,
          } satisfies TinvestMeta,
        },
      })
      .run();
    out.set(key, id);
  }
  return out;
}

export const instrumentKey = (ref: InstrumentRef) => ref.uid || ref.figi;
