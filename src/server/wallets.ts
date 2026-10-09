import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { finAccounts, instruments, operations, positions, sources } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import { getCoinPrices } from '@/integrations/coingecko/client';
import type { Fetch } from '@/integrations/errors';
import { toChecksumAddress } from '@/integrations/chains/address';
import { bitcoinProvider } from '@/integrations/chains/bitcoin';
import { evmProvider } from '@/integrations/chains/evm';
import { network } from '@/integrations/chains/networks';
import type { ChainFamily, TokenBalance } from '@/integrations/chains/types';
import { enqueueRecalc } from '@/jobs/positions';
import { knownAsset } from './chain-instruments';
import { loadFx, rubPer } from './portfolio-data';
import { getSettings } from './settings';

export interface WalletTarget {
  family: ChainFamily;
  address: string;
  /** EVM networks to look in; ['bitcoin'] for Bitcoin. */
  networks: string[];
}

/** What a wallet account remembers (fin_accounts.meta). */
export interface WalletMeta {
  wallet: {
    family: ChainFamily;
    address: string;
    networks: string[];
    mode: 'history' | 'balances';
    hideSpam: boolean;
    /** Next block to read per network, after the last sync. */
    nextBlock?: Record<string, number>;
  };
}

export interface PreviewCoin {
  network: string;
  networkName: string;
  symbol: string;
  name: string;
  amount: string;
  valueRub: string | null;
  coingeckoId: string | null;
  hidden: 'spam' | 'dust' | null;
}

export interface Duplicate {
  accountId: string;
  accountName: string;
  coingeckoId: string;
  symbol: string;
  quantity: string;
}

export interface WalletPreview {
  coins: PreviewCoin[];
  /** Known now for Bitcoin; for EVM history needs the worker (the explorer key is decrypted only there). */
  txCount: number | null;
  firstAt: string | null;
  /** Manual holdings of the same coins in accounts not tied to a chain. */
  duplicates: Duplicate[];
}

export function normalizeAddress(family: ChainFamily, address: string): string {
  return family === 'evm' ? toChecksumAddress(address) : address;
}

const sameAddress = (family: ChainFamily, a: string, b: string) =>
  family === 'evm' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** The account that already watches this address, if any. */
export function walletAccountOf(db: Db, userId: string, family: ChainFamily, address: string) {
  return db
    .select({ id: finAccounts.id, name: finAccounts.name, externalId: finAccounts.externalId })
    .from(finAccounts)
    .innerJoin(sources, eq(sources.id, finAccounts.sourceId))
    .where(and(eq(finAccounts.userId, userId), eq(sources.kind, 'wallet')))
    .all()
    .find((a) => a.externalId !== null && sameAddress(family, a.externalId, address));
}

/**
 * FR-CRY-2, 4, 5: what the address holds now, valued in rubles, with spam and dust marked, plus manual
 * entries of the same coins. Balances come straight from public nodes; nothing is stored.
 */
export async function previewWallet(
  db: Db,
  userId: string,
  target: WalletTarget,
  fetchFn?: Fetch,
): Promise<WalletPreview> {
  const settings = getSettings(db, userId);
  const balances: TokenBalance[] = [];
  let txCount: number | null = null;
  let firstAt: string | null = null;
  if (target.family === 'bitcoin') {
    const p = bitcoinProvider(fetchFn);
    balances.push(...(await p.getBalances(target.address, 'bitcoin')));
    const transfers = await p.getTransfers(target.address, 'bitcoin');
    txCount = transfers.length;
    firstAt = transfers[0]?.at.toISOString() ?? null;
  } else {
    const p = evmProvider({ fetchFn });
    const found = await Promise.all(target.networks.map((n) => p.getBalances(target.address, n)));
    balances.push(...found.flat());
  }

  const known = balances.map((b) => ({ b, k: knownAsset(b.network, b) }));
  const ids = [...new Set(known.flatMap(({ k }) => (k ? [k.coingeckoId] : [])))];
  const prices = await getCoinPrices(ids, 'usd', fetchFn).catch(() => new Map<string, string>());
  const usd = rubPer(loadFx(db), 'USD');
  const coins: PreviewCoin[] = known.map(({ b, k }) => {
    const price = k ? prices.get(k.coingeckoId) : undefined;
    const valueRub = price && usd ? b.amount.times(price).times(usd) : null;
    const hidden =
      !k || (settings.crypto.hideUnpriced && !price)
        ? 'spam'
        : valueRub && valueRub.lt(settings.crypto.dustThresholdRub)
          ? 'dust'
          : null;
    return {
      network: b.network,
      networkName: network(b.network).name,
      symbol: b.symbol,
      name: k?.name ?? b.name,
      amount: b.amount.toString(),
      valueRub: valueRub?.round().toString() ?? null,
      coingeckoId: k?.coingeckoId ?? null,
      hidden,
    };
  });
  return {
    coins: coins.sort((a, b) => Number(b.valueRub ?? 0) - Number(a.valueRub ?? 0)),
    txCount,
    firstAt,
    duplicates: duplicatesOf(
      db,
      userId,
      coins.flatMap((c) => (c.coingeckoId && !c.hidden ? [c.coingeckoId] : [])),
    ),
  };
}

/** Manual holdings of these coins in accounts that are not watched on a chain. */
function duplicatesOf(db: Db, userId: string, coinIds: string[]): Duplicate[] {
  if (coinIds.length === 0) return [];
  const rows = db
    .select({
      accountId: finAccounts.id,
      accountName: finAccounts.name,
      quantity: positions.quantity,
      symbol: instruments.ticker,
      coingeckoId: sql<string>`json_extract(${instruments.meta}, '$.coingeckoId')`,
    })
    .from(positions)
    .innerJoin(finAccounts, eq(finAccounts.id, positions.accountId))
    .innerJoin(sources, eq(sources.id, finAccounts.sourceId))
    .innerJoin(instruments, eq(instruments.id, positions.instrumentId))
    .where(
      and(
        eq(positions.userId, userId),
        ne(sources.kind, 'wallet'),
        ne(sources.kind, 'tinvest'),
        eq(instruments.kind, 'crypto'),
        inArray(sql`json_extract(${instruments.meta}, '$.coingeckoId')`, coinIds),
      ),
    )
    .all();
  const byKey = new Map<string, Duplicate>();
  for (const r of rows) {
    const q = new Decimal(r.quantity);
    if (q.lte(0)) continue;
    const key = `${r.accountId}|${r.coingeckoId}`;
    const d = byKey.get(key);
    byKey.set(key, {
      accountId: r.accountId,
      accountName: r.accountName,
      coingeckoId: r.coingeckoId,
      symbol: r.symbol ?? '',
      quantity: d ? new Decimal(d.quantity).plus(q).toString() : q.toString(),
    });
  }
  return [...byKey.values()];
}

/** Accounts a wallet can join: the user's own manual ones, not a broker's and not another wallet. */
export function walletAccountChoices(db: Db, userId: string) {
  return db
    .select({ id: finAccounts.id, name: finAccounts.name })
    .from(finAccounts)
    .innerJoin(sources, eq(sources.id, finAccounts.sourceId))
    .where(
      and(
        eq(finAccounts.userId, userId),
        eq(sources.kind, 'manual'),
        inArray(finAccounts.kind, ['wallet', 'other']),
      ),
    )
    .all();
}

export interface AddWalletInput extends WalletTarget {
  name: string;
  /** An existing manual account to turn into this wallet, or null for a new one. */
  accountId: string | null;
  mode: 'history' | 'balances';
  hideSpam: boolean;
  /** FR-CRY-5: void the manual entries of these coins in these accounts. */
  replace: { accountId: string; coingeckoId: string }[];
}

export type AddWalletResult =
  { ok: true; accountId: string; sourceId: string } | { ok: false; code: 'DUPLICATE_ADDRESS' | 'NOT_FOUND' };

/**
 * Saves the wallet: its own source, the account (new or an existing manual one), and the voided
 * manual entries it replaces. The first sync is the caller's to queue.
 */
export function addWallet(db: Db, userId: string, input: AddWalletInput, now = new Date()): AddWalletResult {
  const address = normalizeAddress(input.family, input.address);
  if (walletAccountOf(db, userId, input.family, address)) return { ok: false, code: 'DUPLICATE_ADDRESS' };
  const choices = new Set(walletAccountChoices(db, userId).map((a) => a.id));
  if (input.accountId && !choices.has(input.accountId)) return { ok: false, code: 'NOT_FOUND' };
  const meta: WalletMeta = {
    wallet: {
      family: input.family,
      address,
      networks: input.family === 'bitcoin' ? ['bitcoin'] : input.networks,
      mode: input.mode,
      hideSpam: input.hideSpam,
    },
  };
  return db.transaction((tx) => {
    const sourceId = tx
      .insert(sources)
      .values({ userId, kind: 'wallet', name: input.name, scheduleMinutes: 60 })
      .returning({ id: sources.id })
      .get().id;
    let accountId: string;
    if (input.accountId) {
      const current = tx
        .select({ meta: finAccounts.meta })
        .from(finAccounts)
        .where(eq(finAccounts.id, input.accountId))
        .get();
      tx.update(finAccounts)
        .set({ sourceId, externalId: address, kind: 'wallet', meta: { ...current?.meta, ...meta } })
        .where(eq(finAccounts.id, input.accountId))
        .run();
      accountId = input.accountId;
    } else {
      accountId = tx
        .insert(finAccounts)
        .values({
          userId,
          sourceId,
          externalId: address,
          name: input.name,
          kind: 'wallet',
          currency: 'USD',
          meta: { ...meta },
        })
        .returning({ id: finAccounts.id })
        .get().id;
    }
    const touched = new Set<string>();
    for (const r of input.replace) {
      if (!choices.has(r.accountId) && r.accountId !== accountId) continue;
      const ids = tx
        .select({ id: instruments.id })
        .from(instruments)
        .where(
          and(
            eq(instruments.kind, 'crypto'),
            sql`json_extract(${instruments.meta}, '$.coingeckoId') = ${r.coingeckoId}`,
          ),
        )
        .all()
        .map((i) => i.id);
      if (ids.length === 0) continue;
      tx.update(operations)
        .set({ voidedAt: now, updatedAt: now })
        .where(
          and(
            eq(operations.userId, userId),
            eq(operations.accountId, r.accountId),
            eq(operations.origin, 'manual'),
            inArray(operations.instrumentId, ids),
            isNull(operations.voidedAt),
          ),
        )
        .run();
      touched.add(r.accountId);
    }
    for (const id of touched) enqueueRecalc(tx, id);
    return { ok: true as const, accountId, sourceId };
  });
}
