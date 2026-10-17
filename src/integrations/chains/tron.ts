import { z } from 'zod';
import { Decimal } from '@/domain/decimal';
import { IntegrationError, type Fetch } from '../errors';
import { isTronAddress, tronHex } from './address';
import { requestJson } from './http';
import { endpointsOf, network } from './networks';
import type { ChainProvider, TokenBalance, TokenMeta, Transfer } from './types';

/**
 * TronGrid (docs/05-integrations.md, section 5): the TRX balance and TRC-20 balances of an account,
 * TRX transfers with the fee burned, TRC-20 transfers. No key: the public limit is enough for one wallet.
 */
const Account = z.object({
  data: z.array(
    z.object({
      balance: z.number().optional(),
      trc20: z.array(z.record(z.string(), z.string())).optional(),
    }),
  ),
});
const Meta = z.object({ fingerprint: z.string().optional() }).optional();
const Constant = z.object({ constant_result: z.array(z.string()).optional() });
const Trc20Tx = z.object({
  transaction_id: z.string(),
  token_info: z.object({ symbol: z.string(), address: z.string(), decimals: z.number(), name: z.string() }),
  block_timestamp: z.number(),
  from: z.string(),
  to: z.string(),
  type: z.string(),
  value: z.string(),
});
const Tx = z.object({
  txID: z.string().optional(),
  block_timestamp: z.number().optional(),
  ret: z.array(z.object({ contractRet: z.string().optional(), fee: z.number().optional() })).optional(),
  raw_data: z
    .object({
      contract: z.array(
        z.object({
          type: z.string(),
          parameter: z.object({
            value: z.object({
              amount: z.number().optional(),
              owner_address: z.string().optional(),
              to_address: z.string().optional(),
            }),
          }),
        }),
      ),
    })
    .optional(),
});
const page = <T extends z.ZodType>(row: T) => z.object({ data: z.array(row), meta: Meta });

const SUN = new Decimal(1_000_000);
const LIMIT = 200;
/** As for Bitcoin: a cap keeps a very busy address from holding one sync for hours. */
export const TRON_PAGE_LIMIT = 25;

/** Pauses before the next try after HTTP 429: TronGrid without a key allows a few requests a second. */
const BACKOFF_MS = [1000, 3000, 8000];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function tronProvider(
  fetchFn?: Fetch,
  options: { sleep?: (ms: number) => Promise<unknown> } = {},
): ChainProvider {
  const net = network('tron');
  const sleep = options.sleep ?? wait;
  const coin: TokenMeta = { contract: null, symbol: 'TRX', name: 'Tron', decimals: 6 };
  const get = async <T>(path: string, method: string, schema: z.ZodType<T>, body?: unknown): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await requestJson('tron', endpointsOf(net), path, {
          method,
          body,
          fetchFn,
          timeoutMs: 20_000,
          parse: (body) => schema.parse(body),
        });
      } catch (err) {
        const pause = BACKOFF_MS[attempt];
        if ((err as { status?: number }).status !== 429 || pause === undefined) throw err;
        await sleep(pause);
      }
    }
  };

  /** Every page of a list from `since` (milliseconds), oldest first. */
  async function list<T>(address: string, route: string, schema: z.ZodType<T>, since: number): Promise<T[]> {
    const out: T[] = [];
    let fingerprint: string | undefined;
    for (let n = 0; n < TRON_PAGE_LIMIT; n++) {
      const query = new URLSearchParams({
        only_confirmed: 'true',
        limit: String(LIMIT),
        order_by: 'block_timestamp,asc',
        min_timestamp: String(since),
        ...(fingerprint ? { fingerprint } : {}),
      });
      const body = await get(
        `/v1/accounts/${address}${route}?${query}`,
        `GET /v1/accounts/{address}${route}`,
        page(schema),
      );
      out.push(...(body.data as T[]));
      fingerprint = body.meta?.fingerprint;
      if (!fingerprint || body.data.length < LIMIT) break;
    }
    return out;
  }

  return {
    family: 'tron',
    validateAddress: isTronAddress,

    async getBalances(address): Promise<TokenBalance[]> {
      const body = await get(`/v1/accounts/${address}`, 'GET /v1/accounts/{address}', Account);
      // An address that never received TRX has no account yet, though it may hold tokens.
      const account = body.data[0];
      const out: TokenBalance[] = [
        { ...coin, network: 'tron', amount: new Decimal(account?.balance ?? 0).div(SUN) },
      ];
      // Known tokens from their contracts: `trc20` of the account is missing for such an address, so
      // USDT received there read as zero and the balance check booked it as sent away.
      const owner = tronHex(address)!;
      for (const t of net.tokens) {
        const r = await get(
          '/wallet/triggerconstantcontract',
          'POST /wallet/triggerconstantcontract balanceOf',
          Constant,
          {
            owner_address: address,
            contract_address: t.contract,
            function_selector: 'balanceOf(address)',
            parameter: owner.slice(2).padStart(64, '0'),
            visible: true,
          },
        );
        const raw = r.constant_result?.[0];
        if (!raw) throw new IntegrationError('tron', 'BAD_RESPONSE', 'No balanceOf result');
        const amount = new Decimal(BigInt(`0x${raw}`).toString()).div(new Decimal(10).pow(t.decimals));
        out.push({ ...t, network: 'tron', amount });
      }
      return out.filter((b) => b.amount.gt(0));
    },

    /** TRX and TRC-20 transfers from `sinceBlock` (a time in milliseconds on Tron), oldest first. */
    async getTransfers(address, _network, sinceBlock = 0): Promise<Transfer[]> {
      const me = tronHex(address)!;
      // One after the other: TronGrid without a key counts requests per second.
      const txs = await list(address, '/transactions', Tx, sinceBlock);
      const tokens = await list(address, '/transactions/trc20', Trc20Tx, sinceBlock);
      const out: Transfer[] = [];
      for (const t of txs) {
        const c = t.raw_data?.contract[0];
        if (!t.txID || !t.block_timestamp || !c) continue;
        const v = c.parameter.value;
        const outgoing = v.owner_address?.toLowerCase() === me;
        // The fee is burned from the sender, whatever the transaction did (a TRC-20 send too).
        const fee = outgoing ? new Decimal(t.ret?.[0]?.fee ?? 0).div(SUN) : new Decimal(0);
        const ok = (t.ret?.[0]?.contractRet ?? 'SUCCESS') === 'SUCCESS';
        const moved =
          c.type === 'TransferContract' && ok && (outgoing || v.to_address?.toLowerCase() === me)
            ? new Decimal(v.amount ?? 0).div(SUN)
            : new Decimal(0);
        if (moved.isZero() && fee.isZero()) continue;
        out.push({
          network: 'tron',
          hash: t.txID,
          part: 'native',
          block: t.block_timestamp,
          at: new Date(t.block_timestamp),
          direction: outgoing ? 'out' : 'in',
          asset: coin,
          amount: moved,
          fee,
          counterparty: null,
        });
      }
      const seen = new Map<string, number>();
      for (const t of tokens) {
        if (t.type !== 'Transfer') continue;
        const decimals = t.token_info.decimals;
        const amount = new Decimal(t.value).div(new Decimal(10).pow(decimals));
        if (amount.isZero()) continue;
        const outgoing = t.from === address;
        if (!outgoing && t.to !== address) continue;
        const key = `${t.transaction_id}:${t.token_info.address}`;
        const n = seen.get(key) ?? 0;
        seen.set(key, n + 1);
        out.push({
          network: 'tron',
          hash: t.transaction_id,
          part: `token:${t.token_info.address}:${n}`,
          block: t.block_timestamp,
          at: new Date(t.block_timestamp),
          direction: outgoing ? 'out' : 'in',
          asset: {
            contract: t.token_info.address,
            symbol: t.token_info.symbol,
            name: t.token_info.name,
            decimals,
          },
          amount,
          fee: new Decimal(0),
          counterparty: outgoing ? t.to : t.from,
        });
      }
      return out.sort(
        (a, b) => a.block - b.block || a.hash.localeCompare(b.hash) || a.part.localeCompare(b.part),
      );
    },

    async health() {
      const started = Date.now();
      try {
        await requestJson('tron', endpointsOf(net), '/wallet/getblock', {
          method: 'POST /wallet/getblock',
          // The latest block's header only: getnowblock sends every transaction in it (~600 KB).
          body: { detail: false },
          fetchFn,
          timeoutMs: 5000,
          parse: (b) => z.object({ blockID: z.string() }).parse(b),
        });
        return { ok: true, latencyMs: Date.now() - started };
      } catch {
        return { ok: false, latencyMs: Date.now() - started };
      }
    },
  };
}
