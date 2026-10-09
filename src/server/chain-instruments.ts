import { and, eq, sql } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { instruments } from '@/db/schema';
import { network, type KnownToken } from '@/integrations/chains/networks';
import type { TokenMeta } from '@/integrations/chains/types';

export type InstrumentRow = typeof instruments.$inferSelect;

/** The registry entry of a token or a native coin, or null for a token we do not know. */
export function knownAsset(netId: string, asset: TokenMeta): (KnownToken & { native: boolean }) | null {
  const net = network(netId);
  if (asset.contract === null)
    return { ...net.native, contract: '', coingeckoId: net.native.coingeckoId, native: true };
  const t = net.tokens.find((k) => k.contract.toLowerCase() === asset.contract!.toLowerCase());
  return t ? { ...t, native: false } : null;
}

/**
 * The instrument of a coin seen on a chain (docs/03-data-model.md, section 3). Plain coins are shared
 * by CoinGecko id, so ETH from Ethereum, Arbitrum and a manual entry are one instrument. Yield tokens
 * get their own: aEthUSDC is priced as USDC but accrues interest, stETH grows by rebasing.
 */
export function ensureChainInstrument(
  db: Executor,
  netId: string,
  known: KnownToken & { native: boolean },
): InstrumentRow {
  const yieldKind = known.yieldKind ?? 'none';
  const found =
    yieldKind === 'none'
      ? db
          .select()
          .from(instruments)
          .where(
            and(
              eq(instruments.kind, 'crypto'),
              sql`json_extract(${instruments.meta}, '$.coingeckoId') = ${known.coingeckoId}`,
              sql`coalesce(json_extract(${instruments.meta}, '$.yieldKind'), 'none') = 'none'`,
            ),
          )
          .get()
      : db
          .select()
          .from(instruments)
          .where(
            and(
              eq(instruments.kind, 'crypto'),
              sql`json_extract(${instruments.meta}, '$.yieldKey') = ${known.symbol}`,
            ),
          )
          .get();
  if (found) return found;
  return db
    .insert(instruments)
    .values({
      kind: 'crypto',
      assetClass: 'crypto',
      ticker: known.symbol,
      name: known.name,
      currency: 'USD',
      lot: '1',
      meta: {
        coingeckoId: known.coingeckoId,
        yieldKind,
        ...(yieldKind === 'none'
          ? {}
          : {
              yieldKey: known.symbol,
              underlyingId: known.underlyingId,
              ...(known.rate ? { rate: known.rate } : {}),
            }),
        ...(known.native
          ? {}
          : { chain: netId, contract: known.contract.toLowerCase(), decimals: known.decimals }),
      },
    })
    .returning()
    .get();
}
