import type { Decimal } from '@/domain/decimal';

/** docs/05-integrations.md, section 5. */
export type ChainFamily = 'bitcoin' | 'evm';

export interface TokenMeta {
  /** null for the network's native coin. */
  contract: string | null;
  symbol: string;
  name: string;
  decimals: number;
}

export interface TokenBalance extends TokenMeta {
  network: string;
  amount: Decimal;
}

export interface Transfer {
  network: string;
  hash: string;
  /** Unique within the transaction: «native», «token:<contract>:<logIndex>», «internal:<n>». */
  part: string;
  block: number;
  at: Date;
  direction: 'in' | 'out';
  asset: TokenMeta;
  /** Positive, in units of the asset. */
  amount: Decimal;
  /** Native coin paid for the transaction, on the sender's native part only. */
  fee: Decimal;
  counterparty: string | null;
}

export interface ChainProvider {
  family: ChainFamily;
  validateAddress(address: string): boolean;
  getBalances(address: string, network: string, extra?: readonly TokenMeta[]): Promise<TokenBalance[]>;
  getTransfers(address: string, network: string, sinceBlock?: number): Promise<Transfer[]>;
  health(network: string): Promise<{ ok: boolean; latencyMs: number }>;
}
