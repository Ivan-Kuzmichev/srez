import { z } from 'zod';
import { getJson, IntegrationError, type Fetch } from '../errors';

/** Public CoinGecko API, no key needed for search (docs/05-integrations.md). */
// COINGECKO_API_URL points tests at a local stand-in.
const base = () => process.env.COINGECKO_API_URL ?? 'https://api.coingecko.com/api/v3';

const SearchBody = z.object({
  coins: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      symbol: z.string(),
      market_cap_rank: z.number().nullable().optional(),
    }),
  ),
});

export interface CoinHit {
  coingeckoId: string;
  symbol: string;
  name: string;
  rank: number | null;
}

export async function searchCoins(query: string, fetchFn: Fetch = fetch): Promise<CoinHit[]> {
  const data = await getJson('coingecko', `${base()}/search?query=${encodeURIComponent(query)}`, fetchFn);
  const parsed = SearchBody.safeParse(data);
  if (!parsed.success) throw new IntegrationError('coingecko', 'BAD_RESPONSE', z.prettifyError(parsed.error));
  return parsed.data.coins.slice(0, 10).map((c) => ({
    coingeckoId: c.id,
    symbol: c.symbol.toUpperCase(),
    name: c.name,
    rank: c.market_cap_rank ?? null,
  }));
}

/** Current prices for many coins in one request, in `vs` (e.g. usd). Unknown ids are left out. */
export async function getCoinPrices(
  ids: string[],
  vs = 'usd',
  fetchFn: Fetch = fetch,
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const url = `${base()}/simple/price?ids=${ids.map(encodeURIComponent).join(',')}&vs_currencies=${vs}`;
  const parsed = z
    .record(z.string(), z.record(z.string(), z.number()))
    .safeParse(await getJson('coingecko', url, fetchFn));
  if (!parsed.success) throw new IntegrationError('coingecko', 'BAD_RESPONSE', z.prettifyError(parsed.error));
  const out = new Map<string, string>();
  for (const [id, quotes] of Object.entries(parsed.data)) {
    const price = quotes[vs];
    // Prices arrive as JSON numbers; keep the decimal text as sent, no float arithmetic.
    if (price !== undefined) out.set(id, String(price));
  }
  return out;
}

/** Daily closes for the last `days` days (the free API reaches back one year). */
export async function getCoinHistory(
  id: string,
  days: number,
  vs = 'usd',
  fetchFn: Fetch = fetch,
): Promise<{ date: string; close: string }[]> {
  const url = `${base()}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=${vs}&days=${days}&interval=daily`;
  const parsed = z
    .object({ prices: z.array(z.tuple([z.number(), z.number()])) })
    .safeParse(await getJson('coingecko', url, fetchFn));
  if (!parsed.success) throw new IntegrationError('coingecko', 'BAD_RESPONSE', z.prettifyError(parsed.error));
  // One point per UTC day; the last point of a day wins (today's point is the live price).
  const byDay = new Map<string, string>();
  for (const [ms, price] of parsed.data.prices)
    byDay.set(new Date(ms).toISOString().slice(0, 10), String(price));
  return [...byDay].map(([date, close]) => ({ date, close }));
}
