import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  finAccounts,
  fxRates,
  instruments,
  operations,
  positions,
  sources,
  syncRuns,
  user,
} from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { loadFx, loadValuedCells } from '@/server/portfolio-data';
import { updateSettings } from '@/server/settings';
import { addWallet, deleteWallet, rebuildWalletHistory, renameWallet } from '@/server/wallets';
import { accrueWallet } from './wallet-accrue';
import {
  MOCK_BLOCKSCOUT_KEY,
  MOCK_BTC_ADDRESS,
  MOCK_EVM_ADDRESS,
  MOCK_TANGEM_OWNER,
  MOCK_TRON_ADDRESS,
  startChainsMock,
  type ChainsMock,
} from '../../tests/mock/chains';
import { syncWallet } from './wallet-sync';

const now = new Date('2026-10-09T12:00:00Z');
let mock: ChainsMock;
beforeAll(async () => {
  mock = await startChainsMock();
  vi.stubEnv('CHAIN_MOCK_URL', mock.url);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await mock.close();
});

// CoinGecko history: a flat 2 000 $ for every coin over the last year.
const fetchFn = async (url: string, init?: RequestInit) => {
  if (!url.includes('coingecko')) return fetch(url, init);
  const day = 86_400_000;
  const prices = Array.from({ length: 400 }, (_, i) => [now.getTime() - (399 - i) * day, 2000]);
  return new Response(JSON.stringify({ prices }));
};

function wallet(family: 'evm' | 'bitcoin' | 'tron', mode: 'history' | 'balances', address?: string) {
  const db = createTestDb();
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  const r = addWallet(db, 'u1', {
    family,
    address: address ?? { evm: MOCK_EVM_ADDRESS, bitcoin: MOCK_BTC_ADDRESS, tron: MOCK_TRON_ADDRESS }[family],
    networks: family === 'evm' ? ['ethereum', 'arbitrum', 'bnb'] : [],
    name: 'Кошелёк',
    accountId: null,
    mode,
    hideSpam: true,
    replace: [],
  });
  if (!r.ok) throw new Error('not added');
  const held = () =>
    Object.fromEntries(
      db
        .select({ ticker: instruments.ticker, quantity: positions.quantity })
        .from(positions)
        .innerJoin(instruments, eq(instruments.id, positions.instrumentId))
        .where(eq(positions.accountId, r.accountId))
        .all()
        .filter((p) => p.quantity !== '0')
        .map((p) => [p.ticker, p.quantity]),
    );
  return { db, ...r, held };
}

describe('wallet sync', () => {
  it('EVM with history: transfers become operations, gas apart, spam left out, a repeat adds nothing', async () => {
    const { db, sourceId, accountId, held } = wallet('evm', 'history');
    const first = await syncWallet(db, sourceId, 'manual', {
      fetchFn,
      blockscoutKey: MOCK_BLOCKSCOUT_KEY,
      now,
    });
    const ops = db.select().from(operations).where(eq(operations.accountId, accountId)).all();
    expect(ops.map((o) => [o.type, o.quantity, o.note ?? '']).sort()).toEqual(
      [
        ['transfer_in', '1', ''],
        ['transfer_out', '0.05', ''],
        ['transfer_out', '0.00042', 'Комиссия сети'],
        ['transfer_in', '2', ''],
        ['transfer_in', '1.5', ''],
        ['transfer_in', '1250', ''],
      ].sort(),
    );
    expect(first.newOperations).toBe(6);
    expect(ops.every((o) => (o.origin === 'chain' && o.price !== '0') || o.note === 'Комиссия сети')).toBe(
      true,
    );
    // stETH grew by rebasing to 2,0123: that is an accrual, not a transfer.
    expect(held()).toEqual({ ETH: '0.94958', stETH: '2', wstETH: '1.5', USDT: '1250' });
    expect(
      await syncWallet(db, sourceId, 'schedule', { fetchFn, blockscoutKey: MOCK_BLOCKSCOUT_KEY, now }),
    ).toEqual({ newOperations: 0 });
    const acc = db.select().from(finAccounts).where(eq(finAccounts.id, accountId)).get()!;
    expect(acc.meta).toMatchObject({
      wallet: { nextBlock: { ethereum: 20_000_001, arbitrum: 200_000_001 } },
    });
    expect(db.select().from(sources).where(eq(sources.id, sourceId)).get()).toMatchObject({
      status: 'ok',
      lastError: null,
    });
    expect(
      db
        .select()
        .from(syncRuns)
        .where(eq(syncRuns.sourceId, sourceId))
        .all()
        .map((r) => r.status),
    ).toEqual(['ok', 'ok']);
  });

  it('balances only (or no key): one squaring operation per coin, rebasing ones included at the start', async () => {
    const { db, sourceId, held } = wallet('evm', 'balances');
    expect((await syncWallet(db, sourceId, 'manual', { fetchFn, now })).newOperations).toBe(4);
    expect(held()).toEqual({ ETH: '0.94958', stETH: '2.0123', wstETH: '1.5', USDT: '1250' });
    expect((await syncWallet(db, sourceId, 'manual', { fetchFn, now })).newOperations).toBe(0);

    const noKey = wallet('evm', 'history');
    await syncWallet(noKey.db, noKey.sourceId, 'manual', { fetchFn, now });
    expect(noKey.held()).toEqual({ ETH: '0.94958', stETH: '2.0123', wstETH: '1.5', USDT: '1250' });
  });

  it('hidden coins stay out of the value: under the threshold, when the settings say so', async () => {
    const { db, sourceId } = wallet('evm', 'balances');
    await syncWallet(db, sourceId, 'manual', { fetchFn, now });
    db.insert(fxRates)
      .values({ date: '2026-10-09', base: 'RUB', quote: 'USD', rate: '90', source: 'cbr' })
      .run();
    const tickers = () =>
      loadValuedCells(db, 'u1', loadFx(db))
        .map((c) => c.ticker)
        .sort();
    expect(tickers()).toEqual(['ETH', 'USDT', 'stETH', 'wstETH']);
    // 2 000 $ × 90: ETH ≈ 171 000 ₽, wstETH ≈ 270 000 ₽, stETH ≈ 362 000 ₽, USDT ≈ 225 000 000 ₽ at this flat price.
    updateSettings(db, 'u1', { crypto: { dustThresholdRub: 200_000 } });
    expect(tickers()).toEqual(['USDT', 'stETH', 'wstETH']);
    updateSettings(db, 'u1', { crypto: { excludeHidden: false } });
    expect(tickers()).toHaveLength(4);
  });

  it('Bitcoin: receipts, a spend and its fee; balance matches the chain', async () => {
    const { db, sourceId, accountId, held } = wallet('bitcoin', 'history');
    await syncWallet(db, sourceId, 'manual', { fetchFn, now });
    expect(held()).toEqual({ BTC: '0.05998' });
    const squared = db
      .select()
      .from(operations)
      .where(and(eq(operations.accountId, accountId), eq(operations.note, 'Сверка с балансом в сети')))
      .all();
    expect(squared).toHaveLength(0);
  });

  it('a refused key marks the source with a readable error', async () => {
    const { db, sourceId } = wallet('evm', 'history');
    await expect(
      syncWallet(db, sourceId, 'manual', { fetchFn, blockscoutKey: 'wrong', now }),
    ).rejects.toBeTruthy();
    expect(db.select().from(sources).where(eq(sources.id, sourceId)).get()).toMatchObject({
      status: 'error',
      lastError: 'Blockscout не принял ключ. Проверьте его в «Настройки → Крипта».',
    });
  });

  it('Tangem yield mode: deposits into the module move USDT into aUSDT, the yield after the fee is an accrual', async () => {
    const { db, sourceId, accountId, held } = wallet('evm', 'history', MOCK_TANGEM_OWNER);
    const deps = { fetchFn, blockscoutKey: MOCK_BLOCKSCOUT_KEY, now };
    await syncWallet(db, sourceId, 'manual', deps);
    // 500 straight to Aave and back, 505 and 170 into the module, 200 out of it: 475 deposited.
    expect(held()).toEqual({ ETH: '0.1', aEthUSDT: '475' });
    await accrueWallet(db, accountId, now, fetchFn);
    // The module shows 480,12 after Tangem's fee: 5,12 earned before the wallet was connected.
    expect(held()).toEqual({ ETH: '0.1', aEthUSDT: '480.12' });
    const accrual = db
      .select({ q: operations.quantity })
      .from(operations)
      .where(and(eq(operations.accountId, accountId), eq(operations.type, 'accrual')))
      .all();
    expect(accrual.map((a) => a.q)).toEqual(['5.12']);
    expect(await syncWallet(db, sourceId, 'schedule', deps)).toEqual({ newOperations: 0 });
  });

  it('Tron: TRX with the burned fees, USDT, the look-alike token left out; balances match', async () => {
    const { db, sourceId, accountId, held } = wallet('tron', 'history');
    // No Blockscout key: Tron history does not need one.
    const first = await syncWallet(db, sourceId, 'manual', { fetchFn, now });
    expect(held()).toEqual({ TRX: '85.5', USDT: '266.75' });
    const fees = db
      .select({ q: operations.quantity })
      .from(operations)
      .where(and(eq(operations.accountId, accountId), eq(operations.note, 'Комиссия сети')))
      .all();
    expect(fees.map((f) => f.q).sort()).toEqual(['1.1', '13.4']);
    expect(first.newOperations).toBe(6);
    expect(await syncWallet(db, sourceId, 'schedule', { fetchFn, now })).toEqual({ newOperations: 0 });
  });

  it('a coin gone from the chain leaves at the day\'s close, not at zero', async () => {
    const { db, sourceId, accountId, held } = wallet('tron', 'balances');
    await syncWallet(db, sourceId, 'manual', { fetchFn, now });
    const account = mock.state.tron[MOCK_TRON_ADDRESS].account;
    const trc20 = account.trc20;
    account.trc20 = [];
    try {
      await syncWallet(db, sourceId, 'schedule', { fetchFn, now: new Date(now.getTime() + 60_000) });
    } finally {
      account.trc20 = trc20;
    }
    expect(held()).toEqual({ TRX: '85.5' });
    const out = db
      .select({ quantity: operations.quantity, price: operations.price })
      .from(operations)
      .where(and(eq(operations.accountId, accountId), eq(operations.type, 'transfer_out')))
      .all();
    expect(out).toEqual([{ quantity: '266.75', price: '2000' }]);
  });

  it('rebuilding a wallet drops what the chain gave, keeps manual entries, and the next sync brings it back', async () => {
    const { db, sourceId, accountId, held } = wallet('tron', 'history');
    await syncWallet(db, sourceId, 'manual', { fetchFn, now });
    const trx = db.select().from(operations).where(eq(operations.accountId, accountId)).get()!;
    db.insert(operations)
      .values({ ...trx, id: undefined, origin: 'manual', externalId: null, note: 'вручную' })
      .run();
    expect(rebuildWalletHistory(db, 'someone-else', sourceId)).toBe(false);
    expect(rebuildWalletHistory(db, 'u1', sourceId)).toBe(true);
    const left = db.select().from(operations).where(eq(operations.accountId, accountId)).all();
    expect(left.map((o) => o.note)).toEqual(['вручную']);
    expect(db.select().from(finAccounts).where(eq(finAccounts.id, accountId)).get()!.meta).toMatchObject({
      wallet: { nextBlock: {} },
    });
    expect(db.select().from(sources).where(eq(sources.id, sourceId)).get()!.lastSyncAt).toBeNull();
    const again = await syncWallet(db, sourceId, 'manual', { fetchFn, now });
    expect(again.newOperations).toBe(7);
    expect(held().USDT).toBe('266.75');
  });

  it('renames a wallet with its account; deleting drops the chain, keeps an account with manual entries', async () => {
    const { db, sourceId, accountId } = wallet('tron', 'history');
    await syncWallet(db, sourceId, 'manual', { fetchFn, now });
    expect(renameWallet(db, 'someone-else', sourceId, 'Чужой')).toBe(false);
    expect(renameWallet(db, 'u1', sourceId, 'Tangem, Tron')).toBe(true);
    expect(db.select().from(sources).where(eq(sources.id, sourceId)).get()!.name).toBe('Tangem, Tron');
    expect(db.select().from(finAccounts).where(eq(finAccounts.id, accountId)).get()!.name).toBe(
      'Tangem, Tron',
    );

    // An entry of the owner's own: the account stays as a manual one, without the address.
    const trx = db.select().from(operations).where(eq(operations.accountId, accountId)).get()!;
    const manualSource = db
      .insert(sources)
      .values({ userId: 'u1', kind: 'manual', name: 'Вручную' })
      .returning()
      .get();
    db.insert(operations)
      .values({ ...trx, id: undefined, origin: 'manual', sourceId: manualSource.id, externalId: null })
      .run();
    expect(deleteWallet(db, 'someone-else', sourceId)).toBeNull();
    expect(deleteWallet(db, 'u1', sourceId)).toBe('kept');
    const kept = db.select().from(finAccounts).where(eq(finAccounts.id, accountId)).get()!;
    expect(kept).toMatchObject({ sourceId: manualSource.id, externalId: null });
    expect((kept.meta as Record<string, unknown> | null)?.wallet).toBeUndefined();
    expect(db.select().from(operations).where(eq(operations.accountId, accountId)).all()).toHaveLength(1);
    expect(db.select().from(sources).where(eq(sources.id, sourceId)).get()).toBeUndefined();

    // Nothing of the owner's: the account goes with the wallet.
    const other = wallet('tron', 'history');
    await syncWallet(other.db, other.sourceId, 'manual', { fetchFn, now });
    expect(deleteWallet(other.db, 'u1', other.sourceId)).toBe('deleted');
    expect(
      other.db.select().from(finAccounts).where(eq(finAccounts.id, other.accountId)).get(),
    ).toBeUndefined();
    expect(other.db.select().from(positions).where(eq(positions.accountId, other.accountId)).all()).toEqual(
      [],
    );
  });
});
