// A local stand-in for public blockchain APIs, serving tests/fixtures/chains:
// Esplora at /bitcoin/api, JSON-RPC at /rpc/<network>, Blockscout (Etherscan-compatible) at /blockscout.
// Used by unit tests (startChainsMock) and by e2e (`tsx tests/mock/chains.ts <port>`).
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'fixtures', 'chains');
const read = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8'));
export const MOCK_BLOCKSCOUT_KEY = 'proapi_mock_key';
export const MOCK_BTC_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
export const MOCK_EVM_ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const COIN_PRICES: Record<string, number> = {
  bitcoin: 60000,
  ethereum: 2500,
  'staked-ether': 2500,
  'wrapped-steth': 3000,
  'rocket-pool-eth': 2800,
  tether: 1,
  'usd-coin': 1,
  dai: 1,
  weth: 2500,
  'wrapped-bitcoin': 60000,
  binancecoin: 600,
  'polygon-ecosystem-token': 0.2,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
export interface ChainsState {
  bitcoin: Record<string, Json>;
  evm: Record<string, Json>;
  blockscout: Record<string, Record<string, Record<string, Json[]>>>;
}

export function chainsFixtures(): ChainsState {
  return { bitcoin: read('bitcoin.json'), evm: read('evm.json'), blockscout: read('blockscout.json') };
}

export interface ChainsMock {
  url: string;
  state: ChainsState;
  calls: string[];
  /** Answers the next requests to paths starting with `prefix` with this HTTP status. */
  failNext(prefix: string, status: number, times?: number): void;
  close(): Promise<void>;
}

const ZERO = '0x' + '0'.repeat(64);

function rpc(state: ChainsState, net: string, call: Json): Json {
  const n = state.evm[net];
  const base = { jsonrpc: '2.0', id: call.id };
  if (!n) return { ...base, error: { code: -32601, message: 'unknown network' } };
  switch (call.method) {
    case 'eth_chainId':
      return { ...base, result: '0x1' };
    case 'eth_blockNumber':
      return { ...base, result: '0x' + n.blockNumber.toString(16) };
    case 'eth_getBalance':
      return { ...base, result: n.balances[String(call.params[0]).toLowerCase()]?.native ?? '0x0' };
    case 'eth_call': {
      const to = String(call.params[0].to).toLowerCase();
      const data = String(call.params[0].data);
      if (data.startsWith('0x70a08231')) {
        const owner = '0x' + data.slice(-40);
        return { ...base, result: n.balances[owner]?.tokens?.[to] ?? ZERO };
      }
      return { ...base, result: n.rates[to] ?? ZERO };
    }
    default:
      return { ...base, error: { code: -32601, message: 'method not found' } };
  }
}

export async function startChainsMock(
  opts: { port?: number; state?: ChainsState } = {},
): Promise<ChainsMock> {
  const state = opts.state ?? chainsFixtures();
  const calls: string[] = [];
  const failures: { prefix: string; status: number }[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    calls.push(`${req.method} ${url.pathname}${url.search}`);
    const fail = failures.findIndex((f) => url.pathname.startsWith(f.prefix));
    if (fail >= 0) return json(failures.splice(fail, 1)[0]!.status, { error: 'mock failure' });
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const path = url.pathname;
      if (path.startsWith('/bitcoin/api')) {
        const rest = path.slice('/bitcoin/api'.length);
        if (rest === '/blocks/tip/height') return json(200, 860000);
        const m = /^\/address\/([^/]+)(\/txs\/chain(?:\/([0-9a-f]+))?)?$/.exec(rest);
        const a = m && state.bitcoin[m[1]!];
        if (!m) return json(404, 'not found');
        if (!m[2])
          return json(200, {
            address: m[1],
            chain_stats: a?.chain_stats ?? { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
          });
        const txs: Json[] = a?.txs ?? [];
        const from = m[3] ? txs.findIndex((t) => t.txid === m[3]) + 1 : 0;
        return json(200, txs.slice(from, from + 25));
      }
      if (path.startsWith('/rpc/')) {
        const body = JSON.parse(raw || '[]');
        const net = path.slice('/rpc/'.length);
        return json(200, Array.isArray(body) ? body.map((c) => rpc(state, net, c)) : rpc(state, net, body));
      }
      // CoinGecko: fixed dollar prices, a flat year of history, an empty search.
      if (path.startsWith('/coingecko/api/v3')) {
        const rest = path.slice('/coingecko/api/v3'.length);
        if (rest === '/simple/price') {
          const ids = String(url.searchParams.get('ids') ?? '').split(',');
          return json(
            200,
            Object.fromEntries(ids.filter((i) => COIN_PRICES[i]).map((i) => [i, { usd: COIN_PRICES[i] }])),
          );
        }
        const chart = /^\/coins\/([^/]+)\/market_chart$/.exec(rest);
        if (chart) {
          const price = COIN_PRICES[chart[1]!] ?? 1;
          const now = Date.now();
          return json(200, {
            prices: Array.from({ length: 366 }, (_, i) => [now - (365 - i) * 86_400_000, price]),
          });
        }
        if (rest === '/search') return json(200, { coins: [] });
        if (rest === '/ping') return json(200, { gecko_says: '(V3) To the Moon!' });
      }
      const bs = /^\/blockscout\/(\d+)\/api$/.exec(path);
      if (bs) {
        if (req.headers.authorization !== MOCK_BLOCKSCOUT_KEY) return json(401, { message: 'Unauthorized' });
        const address = String(url.searchParams.get('address')).toLowerCase();
        const since = Number(url.searchParams.get('startblock') ?? 0);
        const page = Number(url.searchParams.get('page') ?? 1);
        const offset = Number(url.searchParams.get('offset') ?? 1000);
        const rows = (state.blockscout[bs[1]!]?.[address]?.[String(url.searchParams.get('action'))] ?? [])
          .filter((r: Json) => Number(r.blockNumber) >= since)
          .slice((page - 1) * offset, page * offset);
        return json(
          200,
          rows.length
            ? { status: '1', message: 'OK', result: rows }
            : { status: '0', message: 'No transactions found', result: [] },
        );
      }
      json(404, { error: 'unknown route' });
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    calls,
    failNext: (prefix, status, times = 1) => {
      for (let i = 0; i < times; i++) failures.push({ prefix, status });
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const mock = await startChainsMock({ port: Number(process.argv[2] ?? 3198) });
  console.log(`Chains mock on ${mock.url}`);
}
