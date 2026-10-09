import { and, eq, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { finAccounts, fxRates, instruments, operations, positions, sources, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { recalcAccount } from '@/db/mutations/positions';
import {
  MOCK_BTC_ADDRESS,
  MOCK_EVM_ADDRESS,
  startChainsMock,
  type ChainsMock,
} from '../../tests/mock/chains';
import { addWallet, previewWallet } from './wallets';

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

// Chains answer from the mock; CoinGecko from here: ETH 2 500 $, USDT 1 $, stETH and wstETH known, no BTC price on purpose.
const fetchFn = async (url: string, init?: RequestInit) =>
  url.includes('coingecko')
    ? new Response(
        JSON.stringify({
          ethereum: { usd: 2500 },
          tether: { usd: 1 },
          'staked-ether': { usd: 2500 },
          'wrapped-steth': { usd: 3000 },
        }),
      )
    : fetch(url, init);

function seeded() {
  const db = createTestDb();
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  db.insert(fxRates)
    .values({ date: '2026-10-09', base: 'RUB', quote: 'USD', rate: '90', source: 'cbr' })
    .run();
  const manual = db
    .insert(sources)
    .values({ userId: 'u1', kind: 'manual', name: 'Вручную' })
    .returning()
    .get();
  const account = db
    .insert(finAccounts)
    .values({ userId: 'u1', sourceId: manual.id, name: 'Кошелёк', kind: 'wallet', currency: 'USD' })
    .returning()
    .get();
  const eth = db
    .insert(instruments)
    .values({
      kind: 'crypto',
      assetClass: 'crypto',
      ticker: 'ETH',
      name: 'Ethereum',
      currency: 'USD',
      meta: { coingeckoId: 'ethereum', yieldKind: 'none' },
    })
    .returning()
    .get();
  db.insert(operations)
    .values({
      userId: 'u1',
      accountId: account.id,
      sourceId: manual.id,
      origin: 'manual',
      type: 'transfer_in',
      instrumentId: eth.id,
      quantity: '0.95',
      price: '2000',
      currency: 'USD',
      amount: '0',
      executedAt: new Date('2024-03-14T10:00:00Z'),
    })
    .run();
  recalcAccount(db, account.id);
  return { db, account, eth };
}

describe('wallet preview', () => {
  it('EVM: balances by network in rubles, unknown and unpriced coins hidden, the manual ETH found as a duplicate', async () => {
    const { db, account } = seeded();
    const p = await previewWallet(
      db,
      'u1',
      { family: 'evm', address: MOCK_EVM_ADDRESS, networks: ['ethereum', 'arbitrum'] },
      fetchFn,
    );
    expect(p.coins.map((c) => [c.symbol, c.network, c.amount, c.valueRub, c.hidden])).toEqual([
      ['stETH', 'ethereum', '2.0123', '452768', null],
      ['wstETH', 'ethereum', '1.5', '405000', null],
      ['ETH', 'ethereum', '0.94958', '213656', null],
      ['USDT', 'arbitrum', '1250', '112500', null],
    ]);
    expect(p.txCount).toBeNull();
    expect(p.duplicates).toEqual([
      {
        accountId: account.id,
        accountName: 'Кошелёк',
        coingeckoId: 'ethereum',
        symbol: 'ETH',
        quantity: '0.95',
      },
    ]);
  });

  it('Bitcoin: transactions and the first date come with the preview; no price hides the coin', async () => {
    const { db } = seeded();
    const p = await previewWallet(
      db,
      'u1',
      { family: 'bitcoin', address: MOCK_BTC_ADDRESS, networks: ['bitcoin'] },
      fetchFn,
    );
    expect(p.coins.map((c) => [c.symbol, c.amount, c.hidden])).toEqual([['BTC', '0.05998', 'spam']]);
    expect(p.txCount).toBe(3);
    expect(p.firstAt?.slice(0, 10)).toBe('2023-07-24');
  });
});

describe('adding a wallet', () => {
  it('joins an existing manual account, voids the replaced manual entries, refuses the same address twice', () => {
    const { db, account } = seeded();
    const input = {
      family: 'evm' as const,
      address: MOCK_EVM_ADDRESS.toLowerCase(),
      networks: ['ethereum', 'arbitrum'],
      name: 'Ledger, основной',
      accountId: account.id,
      mode: 'history' as const,
      hideSpam: true,
      replace: [{ accountId: account.id, coingeckoId: 'ethereum' }],
    };
    const r = addWallet(db, 'u1', input, now);
    expect(r).toMatchObject({ ok: true, accountId: account.id });
    const acc = db.select().from(finAccounts).where(eq(finAccounts.id, account.id)).get()!;
    expect(acc.externalId).toBe(MOCK_EVM_ADDRESS);
    expect(acc.meta).toMatchObject({
      wallet: { family: 'evm', networks: ['ethereum', 'arbitrum'], mode: 'history' },
    });
    expect(db.select().from(sources).where(eq(sources.id, acc.sourceId)).get()!.kind).toBe('wallet');
    expect(
      db
        .select()
        .from(operations)
        .where(and(eq(operations.accountId, account.id), isNotNull(operations.voidedAt)))
        .all(),
    ).toHaveLength(1);
    recalcAccount(db, account.id);
    expect(
      db
        .select()
        .from(positions)
        .where(eq(positions.accountId, account.id))
        .all()
        .filter((p) => p.quantity !== '0'),
    ).toHaveLength(0);

    expect(addWallet(db, 'u1', { ...input, accountId: null, replace: [] }, now)).toEqual({
      ok: false,
      code: 'DUPLICATE_ADDRESS',
    });
  });

  it('a new account keeps the manual entries when told so', () => {
    const { db, account } = seeded();
    const r = addWallet(
      db,
      'u1',
      {
        family: 'bitcoin',
        address: MOCK_BTC_ADDRESS,
        networks: [],
        name: 'Холодный',
        accountId: null,
        mode: 'balances',
        hideSpam: true,
        replace: [],
      },
      now,
    );
    expect(r.ok).toBe(true);
    expect(
      db
        .select()
        .from(operations)
        .where(and(eq(operations.accountId, account.id), isNotNull(operations.voidedAt)))
        .all(),
    ).toHaveLength(0);
    const acc = db.select().from(finAccounts).where(eq(finAccounts.name, 'Холодный')).get()!;
    expect(acc.meta).toMatchObject({ wallet: { networks: ['bitcoin'], mode: 'balances' } });
  });
});
