import { and, desc, eq, inArray, lt, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/client';
import { loadPriceSeries } from '@/db/mutations/market';
import { recalcAccount } from '@/db/mutations/positions';
import { finAccounts, instruments, operations, positions, sources, walletBalances } from '@/db/schema';
import {
  accrualKind,
  accruedBeforeConnection,
  rebasingAccrual,
  sumOf,
  wrappedAccrual,
} from '@/domain/accruals';
import { Decimal } from '@/domain/decimal';
import { evmProvider, readRate } from '@/integrations/chains/evm';
import type { TokenBalance } from '@/integrations/chains/types';
import type { Fetch } from '@/integrations/errors';
import { ru } from '@/lib/i18n/ru';
import { localDate } from '@/lib/time';
import { ensureChainInstrument, knownAsset } from '@/server/chain-instruments';
import type { Logger } from '@/server/logger';
import { getSettings } from '@/server/settings';
import type { WalletMeta } from '@/server/wallets';
import { defineJob } from './runner';

export const WALLET_ACCRUE_JOB = 'wallet.accrue';

interface YieldMeta {
  yieldKind?: 'none' | 'rebasing' | 'wrapped';
  rate?: { network: string; contract: string; selector: string };
}

/** The USD close of a day, or the latest before it. */
function closeOn(db: Db, instrumentId: string, date: string): string {
  let price = '0';
  for (const r of loadPriceSeries(db, [instrumentId]).get(instrumentId) ?? []) {
    if (r.date > date) break;
    price = r.close;
  }
  return price;
}

/**
 * Daily accruals of one wallet's yield tokens (FR-CRY-6, docs/04 section 10). Rebasing: the balance
 * change not explained by transfers becomes `accrual` (or `other` when it fell). Wrapped: quantity ×
 * the rate change, an `accrual` of quantity 0 with the base-coin amount in `accrued_interest`. The
 * first day books «начислено до подключения» once. Re-running the same day changes nothing.
 */
export async function accrueWallet(
  db: Db,
  accountId: string,
  now = new Date(),
  fetchFn?: Fetch,
): Promise<number> {
  const account = db.select().from(finAccounts).where(eq(finAccounts.id, accountId)).get();
  const wallet = (account?.meta as WalletMeta | null)?.wallet;
  if (!account || !wallet || wallet.family !== 'evm') return 0;
  const today = localDate(now, getSettings(db, account.userId).display.timezone);

  const provider = evmProvider({ fetchFn });
  const balances: TokenBalance[] = [];
  for (const n of wallet.networks) balances.push(...(await provider.getBalances(wallet.address, n)));
  // Today's balance of every yield token, summed over networks (wstETH lives on three).
  const today_ = new Map<string, { balance: Decimal; meta: YieldMeta }>();
  for (const b of balances) {
    const known = knownAsset(b.network, b);
    if (!known?.yieldKind || known.yieldKind === 'none') continue;
    const inst = ensureChainInstrument(db, b.network, known);
    const cur = today_.get(inst.id);
    today_.set(inst.id, {
      balance: (cur?.balance ?? new Decimal(0)).plus(b.amount),
      meta: inst.meta as YieldMeta,
    });
  }
  // A yield token sent away entirely still needs its last day.
  const held = db
    .select({ id: positions.instrumentId, quantity: positions.quantity, meta: instruments.meta })
    .from(positions)
    .innerJoin(instruments, eq(instruments.id, positions.instrumentId))
    .where(eq(positions.accountId, accountId))
    .all()
    .filter((h) => new Decimal(h.quantity).gt(0));
  for (const h of held)
    if (
      (h.meta as YieldMeta | null)?.yieldKind &&
      (h.meta as YieldMeta).yieldKind !== 'none' &&
      !today_.has(h.id)
    )
      today_.set(h.id, { balance: new Decimal(0), meta: h.meta as YieldMeta });

  let added = 0;
  for (const [instrumentId, { balance, meta }] of today_) {
    if (
      db
        .select()
        .from(walletBalances)
        .where(
          and(
            eq(walletBalances.date, today),
            eq(walletBalances.accountId, accountId),
            eq(walletBalances.instrumentId, instrumentId),
          ),
        )
        .get()
    )
      continue;
    const rate =
      meta.yieldKind === 'wrapped' && meta.rate
        ? await readRate(meta.rate.network, meta.rate.contract, meta.rate.selector, fetchFn)
        : null;
    const prev = db
      .select()
      .from(walletBalances)
      .where(
        and(
          eq(walletBalances.accountId, accountId),
          eq(walletBalances.instrumentId, instrumentId),
          lt(walletBalances.date, today),
        ),
      )
      .orderBy(desc(walletBalances.date))
      .get();
    const transfers = (from: string | null) =>
      db
        .select({ type: operations.type, quantity: operations.quantity, at: operations.executedAt })
        .from(operations)
        .where(
          and(
            eq(operations.accountId, accountId),
            eq(operations.instrumentId, instrumentId),
            inArray(operations.type, ['transfer_in', 'transfer_out']),
            lte(operations.executedAt, now),
          ),
        )
        .all()
        .filter((o) => from === null || localDate(o.at, 'UTC') > from);
    const side = (rows: ReturnType<typeof transfers>, type: string) =>
      sumOf(rows.filter((r) => r.type === type).map((r) => new Decimal(r.quantity)));

    let amount: Decimal | null = null;
    let externalId: string;
    if (meta.yieldKind === 'rebasing') {
      if (prev) {
        const t = transfers(prev.date);
        amount = rebasingAccrual({
          yesterday: new Decimal(prev.balance),
          today: balance,
          inflows: side(t, 'transfer_in'),
          outflows: side(t, 'transfer_out'),
        });
        externalId = `accrual:${instrumentId}:${today}`;
      } else {
        const t = transfers(null);
        amount = accruedBeforeConnection({
          current: balance,
          inflows: side(t, 'transfer_in'),
          outflows: side(t, 'transfer_out'),
        });
        externalId = `accrual:${instrumentId}:before`;
      }
    } else {
      externalId = `accrual:${instrumentId}:${today}`;
      if (prev?.rate && rate)
        amount = wrappedAccrual({
          quantity: new Decimal(prev.balance),
          rateYesterday: new Decimal(prev.rate),
          rateToday: rate,
        });
    }

    db.transaction((tx) => {
      tx.insert(walletBalances)
        .values({
          date: today,
          accountId,
          instrumentId,
          balance: balance.toString(),
          rate: rate?.toString() ?? null,
        })
        .onConflictDoNothing()
        .run();
      const kind = amount ? accrualKind(amount) : null;
      if (!amount || !kind) return;
      const wrapped = meta.yieldKind === 'wrapped';
      const res = tx
        .insert(operations)
        .values({
          userId: account.userId,
          accountId,
          sourceId: account.sourceId,
          origin: 'chain',
          instrumentId,
          type: kind,
          // A wrapper's count does not change: the base-coin amount goes to accrued_interest.
          quantity: wrapped || kind === 'other' ? '0' : amount.toString(),
          accruedInterest: wrapped || kind === 'other' ? amount.abs().toString() : '0',
          // A wrapper's accrual is in the base coin: its price is the wrapper's over the rate.
          price:
            wrapped && rate && rate.gt(0)
              ? new Decimal(closeOn(db, instrumentId, today)).div(rate).toString()
              : closeOn(db, instrumentId, today),
          currency: 'USD',
          amount: '0',
          executedAt: now,
          externalId,
          note: externalId.endsWith(':before')
            ? ru.accruals.before
            : kind === 'other'
              ? ru.accruals.penalty
              : null,
        })
        .onConflictDoNothing()
        .run();
      added += res.changes;
    });
  }
  if (added) recalcAccount(db, accountId, now);
  return added;
}

export const walletAccrueJob = defineJob({
  name: WALLET_ACCRUE_JOB,
  lane: 'slow',
  payload: z.null(),
  async handler({ db, log }: { db: Db; log: Logger }) {
    const wallets = db
      .select({ id: finAccounts.id })
      .from(finAccounts)
      .innerJoin(sources, eq(sources.id, finAccounts.sourceId))
      .where(and(eq(sources.kind, 'wallet'), inArray(sources.status, ['ok', 'error'])))
      .all();
    let total = 0;
    for (const w of wallets) {
      try {
        total += await accrueWallet(db, w.id);
      } catch (err) {
        log.warn({ accountId: w.id, err }, 'Wallet accruals failed');
      }
    }
    log.info({ wallets: wallets.length, accruals: total }, 'Wallet accruals done');
  },
});
