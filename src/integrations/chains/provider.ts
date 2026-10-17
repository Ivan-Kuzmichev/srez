import type { Fetch } from '../errors';
import { bitcoinProvider } from './bitcoin';
import { evmProvider, type HistoryKeys } from './evm';
import { tronProvider } from './tron';
import type { ChainFamily, ChainProvider } from './types';

/** The provider of a network family. The explorer keys matter only for EVM history. */
export function chainProvider(
  family: ChainFamily,
  options: HistoryKeys & { fetchFn?: Fetch } = {},
): ChainProvider {
  if (family === 'bitcoin') return bitcoinProvider(options.fetchFn);
  if (family === 'tron') return tronProvider(options.fetchFn);
  return evmProvider(options);
}
