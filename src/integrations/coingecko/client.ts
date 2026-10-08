import { z } from 'zod';
import { getJson, IntegrationError, type Fetch } from '../errors';

/** Public CoinGecko API, no key needed for search (docs/05-integrations.md). */
const BASE = 'https://api.coingecko.com/api/v3';

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
  const data = await getJson('coingecko', `${BASE}/search?query=${encodeURIComponent(query)}`, fetchFn);
  const parsed = SearchBody.safeParse(data);
  if (!parsed.success) throw new IntegrationError('coingecko', 'BAD_RESPONSE', z.prettifyError(parsed.error));
  return parsed.data.coins.slice(0, 10).map((c) => ({
    coingeckoId: c.id,
    symbol: c.symbol.toUpperCase(),
    name: c.name,
    rank: c.market_cap_rank ?? null,
  }));
}
