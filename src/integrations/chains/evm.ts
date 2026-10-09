import { z } from 'zod';
import { Decimal } from '@/domain/decimal';
import { IntegrationError, type Fetch } from '../errors';
import { isEvmAddress } from './address';
import { requestJson } from './http';
import { blockscoutUrl, endpointsOf, network, type Network } from './networks';
import type { ChainProvider, TokenBalance, TokenMeta, Transfer } from './types';

const RpcResult = z.object({ id: z.number(), result: z.string().optional(), error: z.unknown().optional() });
const pow10 = (n: number) => new Decimal(10).pow(n);
const hexToDecimal = (h: string) =>
  h === '0x' || h === '' ? new Decimal(0) : new Decimal(BigInt(h).toString());
const pad = (address: string) => address.toLowerCase().replace(/^0x/, '').padStart(64, '0');

/** A JSON-RPC batch; a call that errors fails the whole batch, so the next endpoint is tried. */
export async function rpcBatch(
  net: Network,
  calls: { method: string; params: unknown[] }[],
  fetchFn?: Fetch,
): Promise<string[]> {
  if (calls.length === 0) return [];
  const methods = [...new Set(calls.map((c) => c.method))].join(',');
  return requestJson('evm', endpointsOf(net), '', {
    method: `${net.id} ${methods}×${calls.length}`,
    body: calls.map((c, id) => ({ jsonrpc: '2.0', id, ...c })),
    fetchFn,
    parse: (body) => {
      const rows = z.array(RpcResult).parse(body);
      const byId = new Map(rows.map((r) => [r.id, r]));
      return calls.map((_, i) => {
        const r = byId.get(i);
        if (!r || r.error !== undefined || r.result === undefined)
          throw new IntegrationError('evm', 'BAD_RESPONSE', `RPC error in ${net.id}`);
        return r.result;
      });
    },
  });
}

/** An 18-decimal rate read from a contract (wstETH → stETH, rETH → ETH). */
export async function readRate(
  netId: string,
  contract: string,
  selector: string,
  fetchFn?: Fetch,
): Promise<Decimal> {
  const [raw] = await rpcBatch(
    network(netId),
    [{ method: 'eth_call', params: [{ to: contract, data: selector }, 'latest'] }],
    fetchFn,
  );
  return hexToDecimal(raw!).div(pow10(18));
}

// Blockscout's Etherscan-compatible routes: { status, message, result }.
const Envelope = z.object({ status: z.string(), message: z.string(), result: z.unknown() });
const NativeTx = z.object({
  hash: z.string(),
  blockNumber: z.string(),
  timeStamp: z.string(),
  from: z.string(),
  to: z.string().nullable().optional(),
  value: z.string(),
  gasUsed: z.string().optional(),
  gasPrice: z.string().optional(),
  isError: z.string().optional(),
});
const TokenTx = NativeTx.extend({
  contractAddress: z.string(),
  tokenSymbol: z.string(),
  tokenName: z.string(),
  tokenDecimal: z.string(),
  logIndex: z.string().optional(),
});
const PAGE = 1000;
const MAX_PAGES = 10;

async function blockscoutList<T>(
  net: Network,
  action: 'txlist' | 'tokentx' | 'txlistinternal',
  address: string,
  sinceBlock: number,
  key: string,
  schema: z.ZodType<T>,
  fetchFn?: Fetch,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const rows = await requestJson(
      'blockscout',
      [blockscoutUrl()],
      `/${net.chainId}/api?module=account&action=${action}&address=${address}&startblock=${sinceBlock}&sort=asc&page=${page}&offset=${PAGE}`,
      {
        method: `${net.id} account/${action}`,
        // The key goes in a header, so it never shows up in a URL.
        headers: { authorization: key },
        fetchFn,
        timeoutMs: 20_000,
        parse: (body) => {
          const env = Envelope.parse(body);
          // «No transactions found» comes as status 0 with an empty list.
          if (env.status !== '1' && !(Array.isArray(env.result) && env.result.length === 0))
            throw new IntegrationError('blockscout', 'BAD_RESPONSE', env.message);
          return z.array(schema).parse(env.result);
        },
      },
    );
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export function evmProvider(options: { blockscoutKey?: string | null; fetchFn?: Fetch } = {}): ChainProvider {
  const { fetchFn } = options;
  return {
    family: 'evm',
    validateAddress: isEvmAddress,

    /** The native coin and every known (or `extra`) token, in one RPC batch. Zero balances are left out. */
    async getBalances(address, netId, extra = []): Promise<TokenBalance[]> {
      const net = network(netId);
      const tokens: TokenMeta[] = [...net.tokens];
      for (const t of extra)
        if (t.contract && !tokens.some((k) => k.contract?.toLowerCase() === t.contract!.toLowerCase()))
          tokens.push(t);
      const results = await rpcBatch(
        net,
        [
          { method: 'eth_getBalance', params: [address, 'latest'] },
          ...tokens.map((t) => ({
            method: 'eth_call',
            params: [{ to: t.contract, data: `0x70a08231${pad(address)}` }, 'latest'],
          })),
        ],
        fetchFn,
      );
      const native = {
        contract: null,
        symbol: net.native.symbol,
        name: net.native.name,
        decimals: net.native.decimals,
      };
      return [native, ...tokens]
        .map((t, i) => ({ ...t, network: net.id, amount: hexToDecimal(results[i]!).div(pow10(t.decimals)) }))
        .filter((b) => b.amount.gt(0));
    },

    /** Native, internal and token transfers from `sinceBlock`, oldest first. Needs the Blockscout key. */
    async getTransfers(address, netId, sinceBlock = 0): Promise<Transfer[]> {
      const net = network(netId);
      if (!net.history) return [];
      if (!options.blockscoutKey) throw new IntegrationError('blockscout', 'HTTP', 'No Blockscout key', 401);
      const key = options.blockscoutKey;
      const me = address.toLowerCase();
      const [native, internal, tokens] = await Promise.all([
        blockscoutList(net, 'txlist', address, sinceBlock, key, NativeTx, fetchFn),
        blockscoutList(net, 'txlistinternal', address, sinceBlock, key, NativeTx, fetchFn),
        blockscoutList(net, 'tokentx', address, sinceBlock, key, TokenTx, fetchFn),
      ]);
      const coin = {
        contract: null,
        symbol: net.native.symbol,
        name: net.native.name,
        decimals: net.native.decimals,
      };
      const out: Transfer[] = [];
      const base = (t: z.infer<typeof NativeTx>) => ({
        network: net.id,
        hash: t.hash,
        block: Number(t.blockNumber),
        at: new Date(Number(t.timeStamp) * 1000),
      });
      for (const t of native) {
        const outgoing = t.from.toLowerCase() === me;
        const fee =
          outgoing && t.gasUsed && t.gasPrice
            ? new Decimal(t.gasUsed).times(t.gasPrice).div(pow10(18))
            : new Decimal(0);
        // A failed transaction still burns gas but moves no value.
        const amount = t.isError === '1' ? new Decimal(0) : new Decimal(t.value).div(pow10(18));
        if (amount.isZero() && fee.isZero()) continue;
        if (!outgoing && t.to?.toLowerCase() !== me) continue;
        out.push({
          ...base(t),
          part: 'native',
          direction: outgoing ? 'out' : 'in',
          asset: coin,
          amount,
          fee,
          counterparty: outgoing ? (t.to ?? null) : t.from,
        });
      }
      internal.forEach((t, i) => {
        if (t.isError === '1' || new Decimal(t.value).isZero()) return;
        const outgoing = t.from.toLowerCase() === me;
        out.push({
          ...base(t),
          part: `internal:${i}`,
          direction: outgoing ? 'out' : 'in',
          asset: coin,
          amount: new Decimal(t.value).div(pow10(18)),
          fee: new Decimal(0),
          counterparty: outgoing ? (t.to ?? null) : t.from,
        });
      });
      tokens.forEach((t, i) => {
        const decimals = Number(t.tokenDecimal) || 0;
        const amount = new Decimal(t.value).div(pow10(decimals));
        if (amount.isZero()) return;
        const outgoing = t.from.toLowerCase() === me;
        out.push({
          ...base(t),
          part: `token:${t.contractAddress.toLowerCase()}:${t.logIndex ?? i}`,
          direction: outgoing ? 'out' : 'in',
          asset: { contract: t.contractAddress, symbol: t.tokenSymbol, name: t.tokenName, decimals },
          amount,
          fee: new Decimal(0),
          counterparty: outgoing ? (t.to ?? null) : t.from,
        });
      });
      return out.sort(
        (a, b) => a.block - b.block || a.hash.localeCompare(b.hash) || a.part.localeCompare(b.part),
      );
    },

    async health(netId) {
      const started = Date.now();
      try {
        await rpcBatch(network(netId), [{ method: 'eth_blockNumber', params: [] }], fetchFn);
        return { ok: true, latencyMs: Date.now() - started };
      } catch {
        return { ok: false, latencyMs: Date.now() - started };
      }
    },
  };
}

export async function blockNumber(netId: string, fetchFn?: Fetch): Promise<number> {
  const [h] = await rpcBatch(network(netId), [{ method: 'eth_blockNumber', params: [] }], fetchFn);
  return Number(BigInt(h!));
}
