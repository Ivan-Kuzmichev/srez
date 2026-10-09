import type { ChainFamily } from './types';

/**
 * Networks, their public endpoints (first that answers wins) and the tokens looked up by RPC
 * (docs/05-integrations.md, section 5). Contracts were checked on-chain (symbol and decimals).
 */
export type YieldKind = 'none' | 'rebasing' | 'wrapped';

export interface KnownToken {
  contract: string;
  symbol: string;
  name: string;
  decimals: number;
  coingeckoId: string;
  yieldKind?: YieldKind;
  /** CoinGecko id of the coin a yield token accrues in. */
  underlyingId?: string;
  /** Yield tokens: who pays and how it shows (the payouts screen). */
  protocol?: string;
  /** The coin a yield token is shown as: «USDT» for aEthUSDT. */
  displaySymbol?: string;
  /** «continuous» — the balance grows every second (Aave), «daily» — once a day (Lido), «rate» — a wrapper. */
  accrues?: 'continuous' | 'daily' | 'rate';
  /** Wrapped tokens: where the rate to the underlying coin is read (an 18-decimal uint from eth_call). */
  rate?: { network: string; contract: string; selector: string };
}

export interface Network {
  id: string;
  name: string;
  family: ChainFamily;
  /** EVM chain id, also Blockscout's. */
  chainId?: number;
  native: { symbol: string; name: string; decimals: number; coingeckoId: string };
  endpoints: string[];
  /** History via Blockscout PRO (with a key). */
  history: boolean;
  /** Shown but switched off until a provider exists. */
  disabled?: boolean;
  tokens: KnownToken[];
}

const STETH_RATE = {
  network: 'ethereum',
  contract: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
  selector: '0x035faf82',
};
const WSTETH = {
  symbol: 'wstETH',
  name: 'Wrapped stETH',
  decimals: 18,
  coingeckoId: 'wrapped-steth',
  yieldKind: 'wrapped' as const,
  underlyingId: 'ethereum',
  rate: STETH_RATE,
  protocol: 'Lido',
  accrues: 'rate' as const,
};
const stable = (contract: string, symbol: 'USDT' | 'USDC', decimals: number): KnownToken => ({
  contract,
  symbol,
  name: symbol === 'USDT' ? 'Tether' : 'USD Coin',
  decimals,
  coingeckoId: symbol === 'USDT' ? 'tether' : 'usd-coin',
});
const weth = (contract: string): KnownToken => ({
  contract,
  symbol: 'WETH',
  name: 'Wrapped Ether',
  decimals: 18,
  coingeckoId: 'weth',
});

export const NETWORKS: Network[] = [
  {
    id: 'bitcoin',
    name: 'Bitcoin',
    family: 'bitcoin',
    native: { symbol: 'BTC', name: 'Bitcoin', decimals: 8, coingeckoId: 'bitcoin' },
    endpoints: ['https://mempool.space/api', 'https://blockstream.info/api'],
    history: true,
    tokens: [],
  },
  {
    id: 'ethereum',
    name: 'Ethereum',
    family: 'evm',
    chainId: 1,
    native: { symbol: 'ETH', name: 'Ethereum', decimals: 18, coingeckoId: 'ethereum' },
    endpoints: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
    history: true,
    tokens: [
      stable('0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT', 6),
      stable('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USDC', 6),
      {
        contract: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        symbol: 'DAI',
        name: 'Dai',
        decimals: 18,
        coingeckoId: 'dai',
      },
      {
        contract: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        symbol: 'WBTC',
        name: 'Wrapped Bitcoin',
        decimals: 8,
        coingeckoId: 'wrapped-bitcoin',
      },
      weth('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
      {
        contract: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
        symbol: 'stETH',
        name: 'Lido Staked Ether',
        decimals: 18,
        coingeckoId: 'staked-ether',
        yieldKind: 'rebasing',
        underlyingId: 'ethereum',
        protocol: 'Lido',
        accrues: 'daily',
      },
      { contract: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', ...WSTETH },
      {
        contract: '0xae78736Cd615f374D3085123A210448E74Fc6393',
        symbol: 'rETH',
        name: 'Rocket Pool ETH',
        decimals: 18,
        coingeckoId: 'rocket-pool-eth',
        yieldKind: 'wrapped',
        underlyingId: 'ethereum',
        rate: {
          network: 'ethereum',
          contract: '0xae78736Cd615f374D3085123A210448E74Fc6393',
          selector: '0xe6aa216c',
        },
        protocol: 'Rocket Pool',
        accrues: 'rate',
      },
      {
        contract: '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c',
        symbol: 'aEthUSDC',
        name: 'Aave Ethereum USDC',
        decimals: 6,
        coingeckoId: 'usd-coin',
        yieldKind: 'rebasing',
        underlyingId: 'usd-coin',
        protocol: 'Aave',
        displaySymbol: 'USDC',
        accrues: 'continuous',
      },
      {
        contract: '0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a',
        symbol: 'aEthUSDT',
        name: 'Aave Ethereum USDT',
        decimals: 6,
        coingeckoId: 'tether',
        yieldKind: 'rebasing',
        underlyingId: 'tether',
        protocol: 'Aave',
        displaySymbol: 'USDT',
        accrues: 'continuous',
      },
      {
        contract: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8',
        symbol: 'aEthWETH',
        name: 'Aave Ethereum WETH',
        decimals: 18,
        coingeckoId: 'ethereum',
        yieldKind: 'rebasing',
        underlyingId: 'ethereum',
        protocol: 'Aave',
        displaySymbol: 'ETH',
        accrues: 'continuous',
      },
    ],
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    family: 'evm',
    chainId: 42161,
    native: { symbol: 'ETH', name: 'Ethereum', decimals: 18, coingeckoId: 'ethereum' },
    endpoints: [
      'https://arbitrum-one-rpc.publicnode.com',
      'https://arb1.arbitrum.io/rpc',
      'https://arbitrum.drpc.org',
    ],
    history: true,
    tokens: [
      stable('0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 'USDT', 6),
      stable('0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'USDC', 6),
      weth('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'),
      { contract: '0x5979D7b546E38E414F7E9822514be443A4800529', ...WSTETH },
      {
        contract: '0x724dc807b04555b71ed48a6896b6F41593b8C637',
        symbol: 'aArbUSDCn',
        name: 'Aave Arbitrum USDC',
        decimals: 6,
        coingeckoId: 'usd-coin',
        yieldKind: 'rebasing',
        underlyingId: 'usd-coin',
        protocol: 'Aave',
        displaySymbol: 'USDC',
        accrues: 'continuous',
      },
    ],
  },
  {
    id: 'base',
    name: 'Base',
    family: 'evm',
    chainId: 8453,
    native: { symbol: 'ETH', name: 'Ethereum', decimals: 18, coingeckoId: 'ethereum' },
    endpoints: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org', 'https://base.drpc.org'],
    history: true,
    tokens: [
      stable('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USDC', 6),
      weth('0x4200000000000000000000000000000000000006'),
      { contract: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', ...WSTETH },
    ],
  },
  {
    id: 'polygon',
    name: 'Polygon',
    family: 'evm',
    chainId: 137,
    native: { symbol: 'POL', name: 'Polygon', decimals: 18, coingeckoId: 'polygon-ecosystem-token' },
    endpoints: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'],
    history: true,
    tokens: [
      stable('0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 'USDT', 6),
      stable('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 'USDC', 6),
      weth('0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'),
    ],
  },
  {
    id: 'bnb',
    name: 'BNB Chain',
    family: 'evm',
    chainId: 56,
    native: { symbol: 'BNB', name: 'BNB', decimals: 18, coingeckoId: 'binancecoin' },
    endpoints: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'],
    // Blockscout does not cover BNB Chain; Etherscan has it only paid.
    history: false,
    tokens: [
      stable('0x55d398326f99059fF775485246999027B3197955', 'USDT', 18),
      stable('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 'USDC', 18),
      {
        contract: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
        symbol: 'ETH',
        name: 'Ethereum (BNB Chain)',
        decimals: 18,
        coingeckoId: 'ethereum',
      },
    ],
  },
  ...(['solana', 'ton', 'tron'] as const).map((id): Network => ({
    id,
    name: { solana: 'Solana', ton: 'TON', tron: 'Tron' }[id],
    family: 'evm',
    native: { symbol: '', name: '', decimals: 0, coingeckoId: '' },
    endpoints: [],
    history: false,
    disabled: true,
    tokens: [],
  })),
];

export const BLOCKSCOUT_URL = 'https://api.blockscout.com';

export function network(id: string): Network {
  const n = NETWORKS.find((x) => x.id === id);
  if (!n || n.disabled) throw new Error(`Unknown network ${id}`);
  return n;
}

export const EVM_NETWORKS = NETWORKS.filter((n) => n.family === 'evm' && !n.disabled);

/**
 * Endpoints of a network. CHAIN_MOCK_URL (tests, e2e) points every network at one mock server:
 * <mock>/bitcoin/api, <mock>/rpc/<network>, <mock>/blockscout.
 */
export function endpointsOf(n: Network): string[] {
  const mock = process.env.CHAIN_MOCK_URL;
  if (!mock) return n.endpoints;
  return [n.family === 'bitcoin' ? `${mock}/bitcoin/api` : `${mock}/rpc/${n.id}`];
}

export function blockscoutUrl(): string {
  const mock = process.env.CHAIN_MOCK_URL;
  return mock ? `${mock}/blockscout` : BLOCKSCOUT_URL;
}

/** A yield token by its symbol (instruments keep it as meta.yieldKey), with the networks it lives on. */
export function yieldToken(symbol: string): { token: KnownToken; networks: string[] } | null {
  const hits = NETWORKS.flatMap((n) =>
    n.tokens.filter((t) => t.symbol === symbol).map((t) => ({ t, n: n.id })),
  );
  return hits[0] ? { token: hits[0].t, networks: hits.map((h) => h.n) } : null;
}
