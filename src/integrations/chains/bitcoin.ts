import { z } from 'zod';
import { Decimal } from '@/domain/decimal';
import type { Fetch } from '../errors';
import { isBitcoinAddress } from './address';
import { requestJson } from './http';
import { endpointsOf, network } from './networks';
import type { ChainProvider, TokenBalance, Transfer } from './types';

/** Esplora API (mempool.space, blockstream.info): balance and transactions of an address. */
const Stats = z.object({ funded_txo_sum: z.number(), spent_txo_sum: z.number(), tx_count: z.number() });
const AddressInfo = z.object({ chain_stats: Stats });
const Tx = z.object({
  txid: z.string(),
  status: z.object({
    confirmed: z.boolean(),
    block_height: z.number().optional(),
    block_time: z.number().optional(),
  }),
  fee: z.number(),
  vin: z.array(
    z.object({
      prevout: z.object({ scriptpubkey_address: z.string().optional(), value: z.number() }).nullable(),
    }),
  ),
  vout: z.array(z.object({ scriptpubkey_address: z.string().optional(), value: z.number() })),
});
const SATS = new Decimal(100_000_000);
/** A wallet with more history than this is loaded in part: a cap keeps one sync from running for hours. */
export const BITCOIN_TX_LIMIT = 2000;

const parse =
  <T>(schema: z.ZodType<T>) =>
  (body: unknown) =>
    schema.parse(body);

export function bitcoinProvider(fetchFn?: Fetch): ChainProvider {
  const btc = network('bitcoin');
  const endpoints = () => endpointsOf(btc);
  const asset = { contract: null, symbol: 'BTC', name: 'Bitcoin', decimals: 8 };
  return {
    family: 'bitcoin',
    validateAddress: isBitcoinAddress,

    async getBalances(address): Promise<TokenBalance[]> {
      const info = await requestJson('bitcoin', endpoints(), `/address/${address}`, {
        method: 'GET /address/{address}',
        fetchFn,
        parse: parse(AddressInfo),
      });
      const sats = info.chain_stats.funded_txo_sum - info.chain_stats.spent_txo_sum;
      return [{ ...asset, network: 'bitcoin', amount: new Decimal(sats).div(SATS) }];
    },

    /** Confirmed transactions, oldest first, from `sinceBlock` on; each is the net change of the address. */
    async getTransfers(address, _network, sinceBlock = 0): Promise<Transfer[]> {
      const txs: z.infer<typeof Tx>[] = [];
      let path = `/address/${address}/txs/chain`;
      for (;;) {
        const page = await requestJson('bitcoin', endpoints(), path, {
          method: 'GET /address/{address}/txs/chain',
          fetchFn,
          parse: parse(z.array(Tx)),
        });
        const confirmed = page.filter((t) => t.status.confirmed);
        txs.push(...confirmed.filter((t) => (t.status.block_height ?? 0) >= sinceBlock));
        const last = confirmed.at(-1);
        // Pages run newest to oldest, 25 a page.
        if (
          page.length < 25 ||
          !last ||
          (last.status.block_height ?? 0) < sinceBlock ||
          txs.length >= BITCOIN_TX_LIMIT
        )
          break;
        path = `/address/${address}/txs/chain/${last.txid}`;
      }
      const out: Transfer[] = [];
      for (const t of txs.reverse()) {
        const received = t.vout
          .filter((o) => o.scriptpubkey_address === address)
          .reduce((s, o) => s + o.value, 0);
        const spent = t.vin
          .filter((i) => i.prevout?.scriptpubkey_address === address)
          .reduce((s, i) => s + (i.prevout?.value ?? 0), 0);
        const net = received - spent;
        if (net === 0) continue;
        const ours = spent > 0;
        // A spend pays the fee: what left the address is the amount sent plus the fee.
        const amount = new Decimal(Math.abs(net) - (ours && net < 0 ? t.fee : 0)).div(SATS);
        out.push({
          network: 'bitcoin',
          hash: t.txid,
          part: 'native',
          block: t.status.block_height ?? 0,
          at: new Date((t.status.block_time ?? 0) * 1000),
          direction: net > 0 ? 'in' : 'out',
          asset,
          amount,
          fee: ours && net < 0 ? new Decimal(t.fee).div(SATS) : new Decimal(0),
          counterparty: null,
        });
      }
      return out;
    },

    async health() {
      const started = Date.now();
      try {
        await requestJson('bitcoin', endpoints(), '/blocks/tip/height', {
          method: 'GET /blocks/tip/height',
          fetchFn,
          timeoutMs: 5000,
          parse: (b) => z.number().parse(b),
        });
        return { ok: true, latencyMs: Date.now() - started };
      } catch {
        return { ok: false, latencyMs: Date.now() - started };
      }
    },
  };
}
