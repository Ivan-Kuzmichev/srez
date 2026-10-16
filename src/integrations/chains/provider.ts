import type { Fetch } from '../errors';
import { bitcoinProvider } from './bitcoin';
import { evmProvider } from './evm';
import { tronProvider } from './tron';
import type { ChainFamily, ChainProvider } from './types';

/** The provider of a network family. The Blockscout key matters only for EVM history. */
export function chainProvider(
  family: ChainFamily,
  options: { blockscoutKey?: string | null; fetchFn?: Fetch } = {},
): ChainProvider {
  if (family === 'bitcoin') return bitcoinProvider(options.fetchFn);
  if (family === 'tron') return tronProvider(options.fetchFn);
  return evmProvider(options);
}
