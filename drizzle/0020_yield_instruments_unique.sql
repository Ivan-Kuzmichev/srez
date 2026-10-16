-- Crypto was unique by coingeckoId alone, so a yield token priced as its coin (aEthUSDT as tether,
-- aEthWETH as ethereum) could not live next to the coin itself: a wallet holding both failed to sync.
-- Plain coins stay unique by coingeckoId, yield tokens by their registry key (meta.yieldKey).
DROP INDEX IF EXISTS `instruments_coingecko_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `instruments_coingecko_idx` ON `instruments` (json_extract(`meta`, '$.coingeckoId'))
  WHERE `kind` = 'crypto' AND json_extract(`meta`, '$.coingeckoId') IS NOT NULL
    AND coalesce(json_extract(`meta`, '$.yieldKind'), 'none') = 'none';
--> statement-breakpoint
CREATE UNIQUE INDEX `instruments_yield_key_idx` ON `instruments` (json_extract(`meta`, '$.yieldKey'))
  WHERE `kind` = 'crypto' AND json_extract(`meta`, '$.yieldKey') IS NOT NULL;
