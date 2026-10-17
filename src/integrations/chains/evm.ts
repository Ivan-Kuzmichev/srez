import { z } from 'zod';
import { Decimal } from '@/domain/decimal';
import { IntegrationError, type Fetch } from '../errors';
import { isEvmAddress } from './address';
import { requestJson } from './http';
import { blockscoutUrl, endpointsOf, network, type Network } from './networks';
import type { ChainProvider, TokenBalance, TokenMeta, Transfer } from './types';

const RpcResult = z.object({ id: z.number(), result: z.string().optional(), error: z.unknown().optional() });
const reverted = (error: unknown) => /revert/i.test(JSON.stringify(error ?? ''));
const pow10 = (n: number) => new Decimal(10).pow(n);
const hexToDecimal = (h: string) =>
  h === '0x' || h === '' ? new Decimal(0) : new Decimal(BigInt(h).toString());
const pad = (address: string) => address.toLowerCase().replace(/^0x/, '').padStart(64, '0');

/**
 * A JSON-RPC batch; a call that errors fails the whole batch, so the next endpoint is tried. With
 * `revertIsEmpty` a contract that refuses the call (a revert) answers «0x» instead: an endpoint's own failure still fails.
 */
export async function rpcBatch(
  net: Network,
  calls: { method: string; params: unknown[] }[],
  fetchFn?: Fetch,
  options: { revertIsEmpty?: boolean } = {},
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
        if (r && r.error !== undefined && options.revertIsEmpty && reverted(r.error)) return '0x';
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
// Internal transactions name the hash `transactionHash` and number the calls of one transaction.
const InternalTx = NativeTx.omit({ hash: true })
  .extend({ transactionHash: z.string(), index: z.string().optional() })
  .transform(({ transactionHash, ...t }) => ({ ...t, hash: transactionHash }));
const TokenTx = NativeTx.extend({
  contractAddress: z.string(),
  tokenSymbol: z.string(),
  tokenName: z.string(),
  tokenDecimal: z.string(),
  logIndex: z.string().optional(),
});
const PAGE = 1000;
const INTERNAL_PENDING = /internal transactions .* not yet been processed/i;
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
        // A token list over years of an address can take Blockscout well over 20 s on Ethereum.
        timeoutMs: 60_000,
        parse: (body) => {
          const env = Envelope.parse(body);
          // Blockscout indexes internal transactions behind the chain and says so with status 0;
          // what it has is still good. An internal receipt it has not reached yet cannot hide value:
          // the balance check books the difference.
          if (action === 'txlistinternal' && INTERNAL_PENDING.test(env.message))
            return z.array(schema).parse(Array.isArray(env.result) ? env.result : []);
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

const YIELD_MODULES = '0x36571e2c'; // yieldModules(address owner) → address
const EFFECTIVE_BALANCE = '0x16a398f7'; // effectiveBalance(address token) → uint256, after Tangem's fee

/**
 * The owner's Tangem yield module on this network, or null: a contract the factory deployed for them
 * that keeps their Aave deposits (docs/05-integrations.md, section 5).
 */
export async function tangemModule(net: Network, owner: string, fetchFn?: Fetch): Promise<string | null> {
  if (!net.tangemFactory) return null;
  const [raw] = await rpcBatch(
    net,
    [
      {
        method: 'eth_call',
        params: [{ to: net.tangemFactory, data: `${YIELD_MODULES}${pad(owner)}` }, 'latest'],
      },
    ],
    fetchFn,
    { revertIsEmpty: true },
  );
  const address = `0x${(raw ?? '').replace(/^0x/, '').slice(-40)}`;
  return address.length === 42 && /[1-9a-f]/.test(address.slice(2)) ? address : null;
}

/**
 * What a Tangem module holds, as balances of the Aave aTokens it keeps: `effectiveBalance` of each
 * underlying coin, the deposit with interest less the service fee Tangem has yet to collect, the same
 * figure the Tangem app shows. A coin the module never enabled reverts and counts as nothing.
 */
async function tangemBalances(net: Network, module: string, fetchFn?: Fetch): Promise<TokenBalance[]> {
  const aTokens = net.tokens.filter((t) => t.underlying);
  const raw = await rpcBatch(
    net,
    aTokens.map((t) => ({
      method: 'eth_call',
      params: [{ to: module, data: `${EFFECTIVE_BALANCE}${pad(t.underlying!)}` }, 'latest'],
    })),
    fetchFn,
    { revertIsEmpty: true },
  );
  return aTokens.map((t, i) => ({
    contract: t.contract,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    network: net.id,
    amount: hexToDecimal(raw[i]!).div(pow10(t.decimals)),
  }));
}

/**
 * Tangem moves coins between the wallet and its module, and the module's aTokens never show in the
 * wallet's history. So a coin sent to the module is also an aToken arriving, and a coin the aToken pays
 * out with no aToken leaving the wallet in that transaction came out of the module: an aToken leaving.
 */
function tangemLegs(net: Network, module: string, transfers: Transfer[]): Transfer[] {
  const aTokenOf = new Map(
    net.tokens.filter((t) => t.underlying).map((t) => [t.underlying!.toLowerCase(), t] as const),
  );
  const out: Transfer[] = [];
  for (const t of transfers) {
    const a = t.asset.contract ? aTokenOf.get(t.asset.contract.toLowerCase()) : undefined;
    if (!a) continue;
    const peer = t.counterparty?.toLowerCase();
    const intoModule = t.direction === 'out' && peer === module;
    const fromModule =
      t.direction === 'in' &&
      peer === a.contract.toLowerCase() &&
      !transfers.some(
        (o) =>
          o.hash === t.hash &&
          o.direction === 'out' &&
          o.asset.contract?.toLowerCase() === a.contract.toLowerCase(),
      );
    if (!intoModule && !fromModule) continue;
    out.push({
      ...t,
      part: `${t.part}:tangem`,
      direction: intoModule ? 'in' : 'out',
      asset: { contract: a.contract, symbol: a.symbol, name: a.name, decimals: a.decimals },
      fee: new Decimal(0),
      counterparty: module,
    });
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
      const own = [native, ...tokens].map((t, i) => ({
        ...t,
        network: net.id,
        amount: hexToDecimal(results[i]!).div(pow10(t.decimals)),
      }));
      // Coins in Tangem's yield mode belong to the wallet: added to its own aTokens.
      const tangem = await tangemModule(net, address, fetchFn);
      if (tangem)
        for (const m of await tangemBalances(net, tangem, fetchFn)) {
          const same = own.find((b) => b.contract?.toLowerCase() === m.contract!.toLowerCase());
          if (same) same.amount = same.amount.plus(m.amount);
          else own.push(m);
        }
      return own.filter((b) => b.amount.gt(0));
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
        blockscoutList(net, 'txlistinternal', address, sinceBlock, key, InternalTx, fetchFn),
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
      // The part is the call's number inside its transaction, not its place in this answer: a later
      // sync starts from another block, and the same call must get the same external id.
      const calls = new Map<string, number>();
      for (const t of internal) {
        const n = calls.get(t.hash) ?? 0;
        calls.set(t.hash, n + 1);
        if (t.isError === '1' || new Decimal(t.value).isZero()) continue;
        const outgoing = t.from.toLowerCase() === me;
        out.push({
          ...base(t),
          part: `internal:${t.index ?? n}`,
          direction: outgoing ? 'out' : 'in',
          asset: coin,
          amount: new Decimal(t.value).div(pow10(18)),
          fee: new Decimal(0),
          counterparty: outgoing ? (t.to ?? null) : t.from,
        });
      }
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
      const tangem = await tangemModule(net, address, fetchFn);
      if (tangem) out.push(...tangemLegs(net, tangem, out));
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

/** Whether Blockscout accepts a key: one cheap list call on Ethereum. A refused key is false; a network failure throws. */
export async function checkBlockscoutKey(key: string, fetchFn?: Fetch): Promise<boolean> {
  try {
    await blockscoutList(
      network('ethereum'),
      'txlist',
      '0x' + '0'.repeat(40),
      99_999_999,
      key,
      NativeTx,
      fetchFn,
    );
    return true;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) return false;
    throw err;
  }
}
