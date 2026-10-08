import { and, eq, isNotNull, ne } from 'drizzle-orm';
import type { Db, Executor } from '@/db/client';
import { setLastPrice, upsertPrices, type InstrumentInUse } from '@/db/mutations/market';
import { instruments, sources } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import { quotation, type Bond, type TinvestClient } from '@/integrations/tinvest/client';
import { tinvestToken } from './source-token';
import { tinvestClient } from './tinvest-client';

/** A client on the first working T-Invest token, or null: prices then come from ISS. */
export function tinvestForPrices(db: Executor): TinvestClient | null {
  const source = db
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(eq(sources.kind, 'tinvest'), ne(sources.status, 'disabled'), isNotNull(sources.secretEncrypted)),
    )
    .get();
  return source ? tinvestClient(tinvestToken(db, source.id)) : null;
}

/** instruments.meta of a bond (docs/03-data-model.md, section 3). */
export function bondMeta(b: Bond): Record<string, unknown> {
  return {
    nominal: quotation(b.nominal).toString(),
    couponType: b.floatingCouponFlag ? 'floating' : 'fixed',
    maturityDate:
      b.maturityDate && b.maturityDate.getTime() > 0 ? b.maturityDate.toISOString().slice(0, 10) : null,
    amortization: b.amortizationFlag,
    couponsPerYear: b.couponQuantityPerYear,
  };
}

/** Bond prices are in percent of the current nominal; the rest are money per unit. */
export function priceInMoney(price: Decimal, inst: Pick<InstrumentInUse, 'kind' | 'meta'>): Decimal | null {
  if (inst.kind !== 'bond') return price;
  const nominal = inst.meta?.nominal;
  if (typeof nominal !== 'string' || new Decimal(nominal).lte(0)) return null;
  return price.times(nominal).div(100);
}

/** Fills bond data the instrument does not have yet (one call per bond, ever). */
export async function ensureBondMeta(
  db: Executor,
  client: TinvestClient,
  inst: Pick<InstrumentInUse, 'id' | 'kind' | 'externalUid' | 'meta'>,
) {
  if (inst.kind !== 'bond' || !inst.externalUid || typeof inst.meta?.nominal === 'string') return inst.meta;
  const meta = { ...inst.meta, ...bondMeta(await client.getBond(inst.externalUid)) };
  db.update(instruments).set({ meta }).where(eq(instruments.id, inst.id)).run();
  return meta;
}

/** Latest broker prices for instruments with a T-Invest uid; returns the ids that got a price. */
export async function refreshTinvestPrices(
  db: Db,
  client: TinvestClient,
  used: InstrumentInUse[],
  now: Date,
  today: string,
): Promise<Set<string>> {
  const priced = new Set<string>();
  const byUid = new Map(
    used.filter((i) => i.externalUid && i.kind !== 'currency').map((i) => [i.externalUid!, i]),
  );
  if (byUid.size === 0) return priced;
  for (const inst of byUid.values()) inst.meta = await ensureBondMeta(db, client, inst);
  for (const last of await client.getLastPrices([...byUid.keys()])) {
    const inst = byUid.get(last.instrumentUid);
    if (!inst || !last.price) continue;
    const price = priceInMoney(quotation(last.price), inst);
    if (!price || price.lte(0)) continue;
    setLastPrice(db, inst.id, price.toString(), inst.currency, 'tinvest', now);
    upsertPrices(db, inst.id, inst.currency, 'tinvest', [{ date: today, close: price.toString() }]);
    priced.add(inst.id);
  }
  return priced;
}

const SIX_YEARS_MS = 6 * 365 * 86_400_000;

/** Daily closes from candles, in chunks the API accepts (up to six years per request). */
export async function tinvestHistory(
  db: Db,
  client: TinvestClient,
  inst: InstrumentInUse,
  from: string,
  to: string,
): Promise<number> {
  const meta = await ensureBondMeta(db, client, inst);
  const rows: { date: string; close: string }[] = [];
  const end = new Date(`${to}T23:59:59Z`);
  for (
    let start = new Date(`${from}T00:00:00Z`);
    start < end;
    start = new Date(start.getTime() + SIX_YEARS_MS)
  ) {
    const chunkEnd = new Date(Math.min(start.getTime() + SIX_YEARS_MS - 1, end.getTime()));
    for (const c of await client.getDailyCandles(inst.externalUid!, start, chunkEnd)) {
      const close = priceInMoney(quotation(c.close), { kind: inst.kind, meta });
      if (close && close.gt(0))
        rows.push({ date: c.time.toISOString().slice(0, 10), close: close.toString() });
    }
  }
  upsertPrices(db, inst.id, inst.currency, 'tinvest', rows);
  return rows.length;
}
