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
import { addWallet } from '@/server/wallets';
import {
  MOCK_BLOCKSCOUT_KEY,
  MOCK_BTC_ADDRESS,
  MOCK_EVM_ADDRESS,
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

function wallet(family: 'evm' | 'bitcoin', mode: 'history' | 'balances') {
  const db = createTestDb();
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  const r = addWallet(db, 'u1', {
    family,
    address: family === 'evm' ? MOCK_EVM_ADDRESS : MOCK_BTC_ADDRESS,
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
});
