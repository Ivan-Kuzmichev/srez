import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { instruments, operations, positions, user, walletBalances } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { invested } from '@/domain/flows';
import { everything } from '@/domain/scope';
import { flowsFor, loadFx, loadUserLedger } from '@/server/portfolio-data';
import { addWallet } from '@/server/wallets';
import {
  MOCK_BLOCKSCOUT_KEY,
  MOCK_EVM_ADDRESS,
  startChainsMock,
  type ChainsMock,
} from '../../tests/mock/chains';
import { accrueWallet } from './wallet-accrue';
import { syncWallet } from './wallet-sync';

const STETH = '0xae7ab96520de3a18e5e111b5eaab095312d7fe84';
const WSTETH = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0';
const uint = (v: string) => {
  const [w, f = ''] = v.split('.');
  return (
    '0x' +
    BigInt(w + (f + '0'.repeat(18)).slice(0, 18))
      .toString(16)
      .padStart(64, '0')
  );
};
const day1 = new Date('2026-10-08T21:00:00Z');
const day2 = new Date('2026-10-09T21:00:00Z');
let mock: ChainsMock;
beforeAll(async () => {
  mock = await startChainsMock();
  vi.stubEnv('CHAIN_MOCK_URL', mock.url);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await mock.close();
});
const fetchFn = async (url: string, init?: RequestInit) =>
  url.includes('coingecko')
    ? new Response(
        JSON.stringify({
          prices: [
            [day1.getTime() - 86_400_000, 2500],
            [day1.getTime(), 2500],
          ],
        }),
      )
    : fetch(url, init);

describe('accruals of yield tokens', () => {
  it('books «before connection» once, then the daily growth; a wrapper only as accrued interest; invested stays', async () => {
    const db = createTestDb();
    db.insert(user)
      .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: day1, updatedAt: day1 })
      .run();
    const r = addWallet(db, 'u1', {
      family: 'evm',
      address: MOCK_EVM_ADDRESS,
      networks: ['ethereum'],
      name: 'W',
      accountId: null,
      mode: 'history',
      hideSpam: true,
      replace: [],
    });
    if (!r.ok) throw new Error();
    await syncWallet(db, r.sourceId, 'manual', { fetchFn, blockscoutKey: MOCK_BLOCKSCOUT_KEY, now: day1 });
    const investedNow = () =>
      invested(flowsFor(loadUserLedger(db, 'u1'), everything, loadFx(db), 'Europe/Moscow')).toFixed();
    const before = investedNow();

    expect(await accrueWallet(db, r.accountId, day1, fetchFn)).toBe(1);
    expect(await accrueWallet(db, r.accountId, day1, fetchFn)).toBe(0);
    const qty = (ticker: string) =>
      db
        .select({ q: positions.quantity })
        .from(positions)
        .innerJoin(instruments, eq(instruments.id, positions.instrumentId))
        .where(eq(instruments.ticker, ticker))
        .get()?.q;
    // stETH: 2,0123 on chain, 2 arrived — 0,0123 accrued before the wallet was connected.
    expect(qty('stETH')).toBe('2.0123');

    // Next day: stETH grows by 0,0002, the wstETH rate by 0,0002.
    const eth = mock.state.evm.ethereum.balances[MOCK_EVM_ADDRESS.toLowerCase()];
    eth.tokens[STETH] = uint('2.0125');
    mock.state.evm.ethereum.rates[WSTETH] = uint('1.2002');
    expect(await accrueWallet(db, r.accountId, day2, fetchFn)).toBe(2);
    expect(qty('stETH')).toBe('2.0125');
    expect(qty('wstETH')).toBe('1.5');
    const accruals = db.select().from(operations).where(eq(operations.type, 'accrual')).all();
    expect(accruals.map((o) => [o.quantity, o.accruedInterest, o.note ?? '']).sort()).toEqual(
      [
        ['0.0123', '0', 'Начислено до подключения'],
        ['0.0002', '0', ''],
        ['0', '0.0003', ''],
      ].sort(),
    );
    expect(db.select().from(walletBalances).all()).toHaveLength(4);
    expect(investedNow()).toBe(before);
  });
});
