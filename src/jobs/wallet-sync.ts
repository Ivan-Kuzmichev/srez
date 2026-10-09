import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Executor } from '@/db/client';
import { loadPriceSeries, upsertPrices } from '@/db/mutations/market';
import { recalcAccount } from '@/db/mutations/positions';
import { finAccounts, operations, positions, sources, syncRuns, SYNC_TRIGGERS } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import { bitcoinProvider } from '@/integrations/chains/bitcoin';
import { evmProvider } from '@/integrations/chains/evm';
import { network } from '@/integrations/chains/networks';
import type { ChainProvider, TokenBalance, Transfer } from '@/integrations/chains/types';
import { getCoinHistory } from '@/integrations/coingecko/client';
import type { Fetch } from '@/integrations/errors';
import { ru } from '@/lib/i18n/ru';
import { ensureChainInstrument, knownAsset } from '@/server/chain-instruments';
import type { Logger } from '@/server/logger';
import type { WalletMeta } from '@/server/wallets';
import { enqueue } from './queue';
import { defineJob } from './runner';
import { serviceKey } from './source-token';
import { accrueWallet } from './wallet-accrue';

export const WALLET_SYNC_JOB = 'sync.wallet';
type Trigger = (typeof SYNC_TRIGGERS)[number];

export function enqueueWalletSync(db: Executor, sourceId: string, trigger: Trigger): number | null {
  return enqueue(
    db,
    WALLET_SYNC_JOB,
    { sourceId, trigger },
    { singletonKey: `${WALLET_SYNC_JOB}:${sourceId}` },
  );
}

interface Deps {
  fetchFn?: Fetch;
  blockscoutKey?: string | null;
  now?: Date;
  log?: Logger;
}

/** Daily USD closes of a coin, from what is stored, else one year from CoinGecko (the free limit). */
async function closesFor(db: Db, instrumentId: string, coingeckoId: string, fetchFn?: Fetch) {
  let rows = loadPriceSeries(db, [instrumentId]).get(instrumentId) ?? [];
  if (rows.length === 0) {
    const history = await getCoinHistory(coingeckoId, 365, 'usd', fetchFn).catch(() => []);
    if (history.length) upsertPrices(db, instrumentId, 'USD', 'coingecko', history);
    rows = loadPriceSeries(db, [instrumentId]).get(instrumentId) ?? [];
  }
  return (date: string) => {
    let price: string | null = null;
    for (const r of rows) {
      if (r.date > date) break;
      price = r.close;
    }
    return price ?? rows[0]?.close ?? '0';
  };
}

/**
 * FR-CRY-3, FR-SRC: one wallet, every network it watches. With history, chain transfers become
 * operations (origin `chain`, external id `<network>:<hash>:<part>`, so a repeat adds nothing); then
 * every known coin is squared with its balance on the chain. Rebasing tokens are squared only when
 * they first appear: their growth is an accrual, booked by the daily snapshot (section 10).
 */
export async function syncWallet(db: Db, sourceId: string, trigger: Trigger, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const source = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!source || source.kind !== 'wallet') throw new Error(`Source ${sourceId} is not a wallet`);
  const account = db.select().from(finAccounts).where(eq(finAccounts.sourceId, sourceId)).get();
  const wallet = (account?.meta as WalletMeta | null)?.wallet;
  if (!account || !wallet) throw new Error(`Wallet source ${sourceId} has no account`);
  const run = db
    .insert(syncRuns)
    .values({ sourceId, trigger, startedAt: now })
    .returning({ id: syncRuns.id })
    .get();

  try {
    const provider: ChainProvider =
      wallet.family === 'bitcoin'
        ? bitcoinProvider(deps.fetchFn)
        : evmProvider({ blockscoutKey: deps.blockscoutKey ?? null, fetchFn: deps.fetchFn });
    const nextBlock = { ...wallet.nextBlock };
    const balances: TokenBalance[] = [];
    let added = 0;
    for (const netId of wallet.networks) {
      const net = network(netId);
      balances.push(...(await provider.getBalances(wallet.address, netId)));
      const withHistory =
        wallet.mode === 'history' && net.history && (wallet.family === 'bitcoin' || !!deps.blockscoutKey);
      if (!withHistory) continue;
      const transfers = await provider.getTransfers(wallet.address, netId, nextBlock[netId] ?? 0);
      added += await importTransfers(db, account, transfers, deps.fetchFn);
      const last = transfers.at(-1);
      if (last) nextBlock[netId] = last.block + 1;
    }
    recalcAccount(db, account.id, now);
    added += await squareBalances(db, account, balances, now, deps.fetchFn);
    if (added) recalcAccount(db, account.id, now);

    db.update(finAccounts)
      .set({ meta: { ...account.meta, wallet: { ...wallet, nextBlock } } })
      .where(eq(finAccounts.id, account.id))
      .run();
    db.update(sources)
      .set({ status: 'ok', lastSyncAt: now, lastError: null })
      .where(eq(sources.id, sourceId))
      .run();
    db.update(syncRuns)
      .set({ status: 'ok', finishedAt: new Date(), newOperations: added })
      .where(eq(syncRuns.id, run.id))
      .run();
    return { newOperations: added };
  } catch (err) {
    const status = (err as { status?: number }).status;
    const message = status === 401 || status === 403 ? ru.walletSync.keyRefused : ru.walletSync.nodes;
    db.update(sources).set({ status: 'error', lastError: message }).where(eq(sources.id, sourceId)).run();
    db.update(syncRuns)
      .set({ status: 'error', finishedAt: new Date(), error: message })
      .where(eq(syncRuns.id, run.id))
      .run();
    throw err;
  }
}

type Account = typeof finAccounts.$inferSelect;

async function importTransfers(
  db: Db,
  account: Account,
  transfers: Transfer[],
  fetchFn?: Fetch,
): Promise<number> {
  let added = 0;
  const priceOf = new Map<string, (date: string) => string>();
  for (const t of transfers) {
    const known = knownAsset(t.network, t.asset);
    // Unknown tokens are spam until proven otherwise (FR-CRY-4): they never enter the journal.
    if (!known) continue;
    const inst = ensureChainInstrument(db, t.network, known);
    if (!priceOf.has(inst.id)) priceOf.set(inst.id, await closesFor(db, inst.id, known.coingeckoId, fetchFn));
    const day = t.at.toISOString().slice(0, 10);
    const base = {
      userId: account.userId,
      accountId: account.id,
      sourceId: account.sourceId,
      origin: 'chain' as const,
      instrumentId: inst.id,
      currency: 'USD',
      amount: '0',
      executedAt: t.at,
    };
    const rows = [];
    if (!t.amount.isZero())
      rows.push({
        ...base,
        type: t.direction === 'in' ? ('transfer_in' as const) : ('transfer_out' as const),
        quantity: t.amount.toString(),
        // A coin arriving is valued at that day's close (docs/04, section 1).
        price: priceOf.get(inst.id)!(day),
        externalId: `${t.network}:${t.hash}:${t.part}`,
      });
    if (t.fee.gt(0)) {
      const coin = knownAsset(t.network, { contract: null, symbol: '', name: '', decimals: 0 })!;
      const native = ensureChainInstrument(db, t.network, coin);
      rows.push({
        ...base,
        instrumentId: native.id,
        type: 'transfer_out' as const,
        quantity: t.fee.toString(),
        price: '0',
        externalId: `${t.network}:${t.hash}:fee`,
        note: ru.walletSync.feeNote,
      });
    }
    for (const r of rows) {
      const res = db.insert(operations).values(r).onConflictDoNothing().run();
      added += res.changes;
    }
  }
  return added;
}

/** Brings the journal to the chain's balance for every known coin; returns the operations added. */
async function squareBalances(
  db: Db,
  account: Account,
  balances: TokenBalance[],
  now: Date,
  fetchFn?: Fetch,
) {
  const wanted = new Map<
    string,
    { amount: Decimal; coingeckoId: string; rebasing: boolean; network: string }
  >();
  for (const b of balances) {
    const known = knownAsset(b.network, b);
    if (!known) continue;
    const inst = ensureChainInstrument(db, b.network, known);
    const w = wanted.get(inst.id);
    wanted.set(inst.id, {
      amount: (w?.amount ?? new Decimal(0)).plus(b.amount),
      coingeckoId: known.coingeckoId,
      rebasing: known.yieldKind === 'rebasing',
      network: b.network,
    });
  }
  const held = new Map(
    db
      .select({ instrumentId: positions.instrumentId, quantity: positions.quantity })
      .from(positions)
      .where(eq(positions.accountId, account.id))
      .all()
      .map((p) => [p.instrumentId, new Decimal(p.quantity)] as const),
  );
  // Coins the journal holds but the chain no longer shows count as balance zero.
  const chainIds = await chainInstrumentIds(db, account.id);
  for (const id of chainIds)
    if (!wanted.has(id) && held.get(id)?.gt(0))
      wanted.set(id, { amount: new Decimal(0), coingeckoId: '', rebasing: false, network: '' });

  let added = 0;
  const day = now.toISOString().slice(0, 10);
  for (const [instrumentId, w] of wanted) {
    const have = held.get(instrumentId) ?? new Decimal(0);
    if (w.rebasing && have.gt(0)) continue;
    const diff = w.amount.minus(have);
    if (diff.isZero()) continue;
    const price = w.coingeckoId ? (await closesFor(db, instrumentId, w.coingeckoId, fetchFn))(day) : '0';
    const res = db
      .insert(operations)
      .values({
        userId: account.userId,
        accountId: account.id,
        sourceId: account.sourceId,
        origin: 'chain',
        instrumentId,
        type: diff.gt(0) ? 'transfer_in' : 'transfer_out',
        quantity: diff.abs().toString(),
        price,
        currency: 'USD',
        amount: '0',
        executedAt: now,
        externalId: `balance:${instrumentId}:${now.getTime()}`,
        note: ru.walletSync.balanceNote,
      })
      .onConflictDoNothing()
      .run();
    added += res.changes;
  }
  return added;
}

async function chainInstrumentIds(db: Db, accountId: string): Promise<string[]> {
  return [
    ...new Set(
      db
        .select({ id: operations.instrumentId })
        .from(operations)
        .where(and(eq(operations.accountId, accountId), inArray(operations.origin, ['chain'])))
        .all()
        .flatMap((r) => (r.id ? [r.id] : [])),
    ),
  ];
}

export const syncWalletJob = defineJob({
  name: WALLET_SYNC_JOB,
  lane: 'slow',
  payload: z.object({ sourceId: z.string().min(1), trigger: z.enum(SYNC_TRIGGERS) }),
  async handler({ db, payload, log }) {
    const result = await syncWallet(db, payload.sourceId, payload.trigger, {
      blockscoutKey: serviceKey(db, 'blockscout'),
      log,
    });
    log.info({ sourceId: payload.sourceId, ...result }, 'Wallet sync done');
    // Today's accruals right away: the first sync books «начислено до подключения» (idempotent per day).
    const account = db
      .select({ id: finAccounts.id })
      .from(finAccounts)
      .where(eq(finAccounts.sourceId, payload.sourceId))
      .get();
    if (account)
      await accrueWallet(db, account.id).catch((err) => log.warn({ err }, 'Wallet accruals failed'));
  },
});
