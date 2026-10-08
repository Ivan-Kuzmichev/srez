import { and, eq, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { containsCi, startsWithCi } from '@/db/queries/search';
import type { Db } from '@/db/client';
import { instruments } from '@/db/schema';
import { searchCoins, type CoinHit } from '@/integrations/coingecko/client';
import type { Fetch } from '@/integrations/errors';
import { getSecurity, searchSecurities, type MoexKind } from '@/integrations/moex/client';
import { logger } from './logger';

export type InstrumentRow = typeof instruments.$inferSelect;

export interface InstrumentSummary {
  id: string;
  ticker: string | null;
  name: string;
  kind: InstrumentRow['kind'];
  assetClass: InstrumentRow['assetClass'];
  currency: string;
  lot: string;
}

export interface DirectoryHit {
  /** «local:<id>», «moex:<SECID>» or «cg:<coingecko id>». */
  key: string;
  ticker: string | null;
  name: string;
  kind: InstrumentRow['kind'];
  source: 'local' | 'moex' | 'coingecko';
}

const CLASS_BY_KIND: Record<MoexKind | 'crypto', InstrumentRow['assetClass']> = {
  share: 'stocks',
  bond: 'bonds',
  etf: 'funds',
  crypto: 'crypto',
};

export const summarize = (r: InstrumentRow): InstrumentSummary => ({
  id: r.id,
  ticker: r.ticker,
  name: r.name,
  kind: r.kind,
  assetClass: r.assetClass,
  currency: r.currency,
  lot: r.lot,
});

/** Instruments visible to the user: shared ones plus their own custom assets. */
const visibleTo = (userId: string) => or(isNull(instruments.userId), eq(instruments.userId, userId));

function searchLocal(db: Db, userId: string, q: string): InstrumentRow[] {
  return db
    .select()
    .from(instruments)
    .where(
      and(
        visibleTo(userId),
        notInArray(instruments.kind, ['index']),
        or(
          startsWithCi(instruments.ticker, q),
          containsCi(instruments.name, q),
          eq(instruments.isin, q.toUpperCase()),
        ),
      ),
    )
    .limit(10)
    .all();
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

/**
 * Directory search for the operation form: local instruments first, then the Moscow Exchange and
 * CoinGecko. A failing external service only shrinks the list; it never breaks the form.
 */
export async function searchDirectory(
  db: Db,
  userId: string,
  query: string,
  fetchFn: Fetch = fetch,
): Promise<DirectoryHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const local = searchLocal(db, userId, q);
  const hits: DirectoryHit[] = local.map((r) => ({
    key: `local:${r.id}`,
    ticker: r.ticker,
    name: r.name,
    kind: r.kind,
    source: 'local',
  }));

  const [moex, coins] = await Promise.allSettled([
    withTimeout(searchSecurities(q, fetchFn), 5000),
    withTimeout(searchCoins(q, fetchFn), 5000),
  ]);
  for (const [name, r] of [
    ['moex', moex],
    ['coingecko', coins],
  ] as const) {
    if (r.status === 'rejected')
      logger('prices').warn({ integration: name, err: r.reason }, 'Directory search failed');
  }

  const knownIsins = new Set(local.map((r) => r.isin).filter(Boolean));
  const knownCoins = new Set(
    local.map((r) => (r.meta as { coingeckoId?: string } | null)?.coingeckoId).filter(Boolean),
  );
  if (moex.status === 'fulfilled') {
    for (const h of moex.value.slice(0, 8)) {
      if (h.isin && knownIsins.has(h.isin)) continue;
      hits.push({ key: `moex:${h.secid}`, ticker: h.secid, name: h.shortName, kind: h.kind, source: 'moex' });
    }
  }
  if (coins.status === 'fulfilled') {
    for (const c of coins.value.slice(0, 5)) {
      if (knownCoins.has(c.coingeckoId)) continue;
      hits.push({
        key: `cg:${c.coingeckoId}`,
        ticker: c.symbol,
        name: c.name,
        kind: 'crypto',
        source: 'coingecko',
      });
    }
  }
  return hits;
}

function upsertMoex(db: Db, sec: Awaited<ReturnType<typeof getSecurity>>): InstrumentRow {
  const existing = sec.isin
    ? db.select().from(instruments).where(eq(instruments.isin, sec.isin)).get()
    : db
        .select()
        .from(instruments)
        .where(and(eq(instruments.ticker, sec.secid), ne(instruments.kind, 'custom')))
        .get();
  if (existing) return existing;
  return db
    .insert(instruments)
    .values({
      kind: sec.kind,
      assetClass: CLASS_BY_KIND[sec.kind],
      ticker: sec.secid,
      name: sec.shortName,
      isin: sec.isin,
      currency: sec.currency,
      lot: String(sec.lot),
      // secid and board are what the price jobs need to ask ISS for quotes.
      meta: { secid: sec.secid, ...(sec.board ?? {}), ...(sec.bond ? { ...sec.bond, amortization: false } : {}) },
    })
    .returning()
    .get();
}

function upsertCoin(db: Db, coin: Pick<CoinHit, 'coingeckoId' | 'symbol' | 'name'>): InstrumentRow {
  const existing = db
    .select()
    .from(instruments)
    .where(
      and(
        eq(instruments.kind, 'crypto'),
        sql`json_extract(${instruments.meta}, '$.coingeckoId') = ${coin.coingeckoId}`,
      ),
    )
    .get();
  if (existing) return existing;
  return db
    .insert(instruments)
    .values({
      kind: 'crypto',
      assetClass: 'crypto',
      ticker: coin.symbol,
      name: coin.name,
      currency: 'USD',
      lot: '1',
      meta: { coingeckoId: coin.coingeckoId, yieldKind: 'none' },
    })
    .returning()
    .get();
}

/** Turns a search hit into a stored instrument and returns it. */
export async function pickDirectoryHit(
  db: Db,
  userId: string,
  key: string,
  fetchFn: Fetch = fetch,
): Promise<InstrumentSummary | null> {
  const [source, ...rest] = key.split(':');
  const ref = rest.join(':');
  if (!ref) return null;
  if (source === 'local') {
    const row = db
      .select()
      .from(instruments)
      .where(and(eq(instruments.id, ref), visibleTo(userId)))
      .get();
    return row ? summarize(row) : null;
  }
  if (source === 'moex') return summarize(upsertMoex(db, await getSecurity(ref, fetchFn)));
  if (source === 'cg') {
    const coins = await searchCoins(ref, fetchFn);
    const coin = coins.find((c) => c.coingeckoId === ref);
    return coin ? summarize(upsertCoin(db, coin)) : null;
  }
  return null;
}

export interface NewCustomAsset {
  name: string;
  assetClass: 'cash' | 'other';
  currency: string;
  valuation: 'manual' | 'interest';
  annualRate: string | null;
}

/** «Свой актив»: a deposit, a loan, anything not traded (FR-AST-4). Visible only to its owner. */
export function createCustomAsset(db: Db, userId: string, input: NewCustomAsset): InstrumentSummary {
  const row = db
    .insert(instruments)
    .values({
      kind: 'custom',
      assetClass: input.assetClass,
      name: input.name,
      currency: input.currency,
      lot: '1',
      userId,
      meta: {
        valuation: input.valuation,
        annualRate: input.valuation === 'interest' ? input.annualRate : null,
      },
    })
    .returning()
    .get();
  return summarize(row);
}

export function getInstrument(db: Db, userId: string, id: string): InstrumentSummary | null {
  const row = db
    .select()
    .from(instruments)
    .where(and(eq(instruments.id, id), visibleTo(userId)))
    .get();
  return row ? summarize(row) : null;
}
