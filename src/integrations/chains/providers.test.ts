import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  MOCK_BLOCKSCOUT_KEY,
  MOCK_BTC_ADDRESS,
  MOCK_ETHERSCAN_KEY,
  MOCK_EVM_ADDRESS,
  MOCK_TANGEM_MODULE,
  MOCK_TANGEM_OWNER,
  MOCK_TRON_ADDRESS,
  startChainsMock,
  type ChainsMock,
} from '../../../tests/mock/chains';
import { bitcoinProvider } from './bitcoin';
import { checkExplorerKey, evmProvider, explorerFor, readRate, tangemModule } from './evm';
import { network } from './networks';
import { tronProvider } from './tron';

let mock: ChainsMock;
beforeAll(async () => {
  mock = await startChainsMock();
  vi.stubEnv('CHAIN_MOCK_URL', mock.url);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await mock.close();
});

describe('bitcoin', () => {
  it('balance and net transfers, the spend split into amount and fee', async () => {
    const p = bitcoinProvider();
    const [b] = await p.getBalances(MOCK_BTC_ADDRESS, 'bitcoin');
    expect(b!.amount.toFixed()).toBe('0.05998');
    const t = await p.getTransfers(MOCK_BTC_ADDRESS, 'bitcoin');
    expect(
      t.map((x) => [x.direction, x.amount.toFixed(), x.fee.toFixed(), x.at.toISOString().slice(0, 10)]),
    ).toEqual([
      ['in', '0.05', '0', '2023-07-24'],
      ['in', '0.02', '0', '2023-12-10'],
      ['out', '0.01', '0.00002', '2024-02-20'],
    ]);
    expect(await p.getTransfers(MOCK_BTC_ADDRESS, 'bitcoin', 820001)).toHaveLength(1);
    expect((await p.health('bitcoin')).ok).toBe(true);
  });
});

describe('evm', () => {
  it('native and known token balances in one batch; unknown tokens only when asked', async () => {
    const p = evmProvider();
    const eth = await p.getBalances(MOCK_EVM_ADDRESS, 'ethereum');
    expect(eth.map((b) => [b.symbol, b.amount.toFixed()])).toEqual([
      ['ETH', '0.94958'],
      ['stETH', '2.0123'],
      ['wstETH', '1.5'],
    ]);
    const extra = await p.getBalances(MOCK_EVM_ADDRESS, 'ethereum', [
      { contract: '0x' + '99'.repeat(20), symbol: 'SPAM', name: 'Spam', decimals: 18 },
    ]);
    expect(extra.map((b) => b.symbol)).toContain('SPAM');
    const arb = await p.getBalances(MOCK_EVM_ADDRESS, 'arbitrum');
    expect(arb.map((b) => [b.symbol, b.amount.toFixed()])).toEqual([['USDT', '1250']]);
    expect(await readRate('ethereum', '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', '0x035faf82')).toEqual(
      expect.anything(),
    );
    expect(
      (await readRate('ethereum', '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', '0x035faf82')).toFixed(),
    ).toBe('1.2');
  });

  it('history from Blockscout with the key in a header; gas on outgoing transactions', async () => {
    const p = evmProvider({ blockscoutKey: MOCK_BLOCKSCOUT_KEY });
    const t = await p.getTransfers(MOCK_EVM_ADDRESS, 'ethereum');
    expect(t.map((x) => [x.direction, x.asset.symbol, x.amount.toFixed(), x.fee.toFixed()])).toEqual([
      ['in', 'ETH', '1', '0'],
      ['out', 'ETH', '0.05', '0.00042'],
      ['in', 'stETH', '2', '0'],
      ['in', 'wstETH', '1.5', '0'],
      ['in', 'Visit claim-rewards.example', '1000', '0'],
    ]);
    expect(
      mock.calls.filter((c) => c.includes('/blockscout/')).every((c) => !c.includes(MOCK_BLOCKSCOUT_KEY)),
    ).toBe(true);
    await expect(
      evmProvider({ blockscoutKey: 'wrong' }).getTransfers(MOCK_EVM_ADDRESS, 'ethereum'),
    ).rejects.toMatchObject({ status: 401 });
    await expect(evmProvider().getTransfers(MOCK_EVM_ADDRESS, 'ethereum')).rejects.toMatchObject({
      status: 401,
    });
    expect(await p.getTransfers(MOCK_EVM_ADDRESS, 'bnb')).toEqual([]);
  });

  it('internal transactions: the shape Blockscout gives, a stable id, and a list it has not finished indexing', async () => {
    // As Blockscout answers: the hash in `transactionHash`.
    const call = (tx: string, index: string, value: string) => ({
      blockNumber: '19750000',
      callType: 'call',
      contractAddress: '',
      errCode: '',
      from: '0x28c6c06298d514db089934071355e5743bf21d60',
      gas: '0',
      gasUsed: '0',
      index,
      input: '',
      isError: '0',
      timeStamp: String(Date.parse('2024-04-25T09:00:00Z') / 1000),
      to: MOCK_EVM_ADDRESS.toLowerCase(),
      transactionHash: '0x' + tx.repeat(32),
      type: 'call',
      value,
    });
    const answer =
      (status: string, message: string, result: unknown) => async (url: string, init?: RequestInit) =>
        url.includes('action=txlistinternal')
          ? new Response(JSON.stringify({ status, message, result }))
          : fetch(url, init);
    const internal = async (fetchFn: ReturnType<typeof answer>) =>
      (
        await evmProvider({ blockscoutKey: MOCK_BLOCKSCOUT_KEY, fetchFn }).getTransfers(
          MOCK_EVM_ADDRESS,
          'ethereum',
        )
      ).filter((t) => t.part.startsWith('internal'));

    const tx = [call('cd', '0', '0'), call('cd', '1', '300000000000000000')];
    const all = await internal(answer('1', 'OK', [call('ab', '0', '100000000000000000'), ...tx]));
    expect(all.map((t) => [t.hash.slice(0, 6), t.part, t.direction, t.amount.toFixed()])).toEqual([
      ['0xabab', 'internal:0', 'in', '0.1'],
      ['0xcdcd', 'internal:1', 'in', '0.3'],
    ]);
    // Later, from another block: the same call keeps its id.
    expect((await internal(answer('1', 'OK', tx)))[0]!.part).toBe('internal:1');
    // «Not yet processed»: what Blockscout has is taken, or nothing, and the sync goes on.
    const pending = 'Some internal transactions within this block range have not yet been processed';
    expect(await internal(answer('0', pending, null))).toEqual([]);
    expect(await internal(answer('0', pending, tx))).toHaveLength(1);
  });

  it('Etherscan: the same history with its key, before Blockscout where its free plan reaches', async () => {
    const both = { blockscoutKey: MOCK_BLOCKSCOUT_KEY, etherscanKey: MOCK_ETHERSCAN_KEY };
    expect(explorerFor(network('ethereum'), both)?.kind).toBe('etherscan');
    expect(explorerFor(network('base'), both)?.kind).toBe('blockscout');
    expect(explorerFor(network('base'), { etherscanKey: MOCK_ETHERSCAN_KEY })).toBeNull();
    expect(explorerFor(network('bnb'), both)).toBeNull();

    const before = mock.calls.length;
    const t = await evmProvider(both).getTransfers(MOCK_EVM_ADDRESS, 'ethereum');
    expect(t.map((x) => [x.direction, x.asset.symbol, x.amount.toFixed()])).toEqual([
      ['in', 'ETH', '1'],
      ['out', 'ETH', '0.05'],
      ['in', 'stETH', '2'],
      ['in', 'wstETH', '1.5'],
      ['in', 'Visit claim-rewards.example', '1000'],
    ]);
    // Etherscan gives no log index: a token transfer is numbered inside its transaction, so a later
    // sync from another block finds the same ids.
    const later = await evmProvider(both).getTransfers(MOCK_EVM_ADDRESS, 'ethereum', 19_850_000);
    const ids = (list: typeof t) => list.map((x) => `${x.hash}:${x.part}`);
    expect(ids(t)).toEqual(expect.arrayContaining(ids(later)));
    expect(later.length).toBeGreaterThan(0);
    const used = mock.calls
      .slice(before)
      .filter((c) => !c.includes('/rpc/') && !c.includes('startblock=19850000'));
    expect(used).toHaveLength(3);
    expect(used.every((c) => c.includes('/etherscan/v2/api?chainid=1&'))).toBe(true);
    // A refused key reads as HTTP 401, like Blockscout's, though Etherscan says it with status 0.
    await expect(
      evmProvider({ etherscanKey: 'wrong-key-1' }).getTransfers(MOCK_EVM_ADDRESS, 'ethereum'),
    ).rejects.toMatchObject({ status: 401, integration: 'etherscan' });
    expect(await checkExplorerKey('etherscan', MOCK_ETHERSCAN_KEY)).toBe(true);
    expect(await checkExplorerKey('etherscan', 'wrong-key-1')).toBe(false);
  });

  it('the rate limit of Etherscan: a pause, then the same page again', async () => {
    let limited = 2;
    const fetchFn = async (url: string, init?: RequestInit) =>
      url.includes('action=txlist&') && limited-- > 0
        ? new Response(
            JSON.stringify({
              status: '0',
              message: 'NOTOK',
              result: 'Max calls per sec rate limit reached (3/sec)',
            }),
          )
        : fetch(url, init);
    const pauses: number[] = [];
    const t = await evmProvider({
      etherscanKey: MOCK_ETHERSCAN_KEY,
      fetchFn,
      sleep: async (ms) => pauses.push(ms),
    }).getTransfers(MOCK_EVM_ADDRESS, 'ethereum');
    expect(pauses).toEqual([1000, 2000]);
    expect(t).toHaveLength(5);
  });

  it('falls back to the next endpoint when one fails', async () => {
    mock.failNext('/rpc/ethereum', 503);
    vi.stubEnv('CHAIN_MOCK_URL', mock.url);
    // One endpoint under the mock: a 503 surfaces after the retry list runs out.
    await expect(evmProvider().getBalances(MOCK_EVM_ADDRESS, 'ethereum')).rejects.toMatchObject({
      code: 'HTTP',
    });
    expect((await evmProvider().getBalances(MOCK_EVM_ADDRESS, 'ethereum')).length).toBe(3);
  });
});

describe('tangem yield mode', () => {
  it("finds the module and counts its deposit, after the fee, as the wallet's aToken", async () => {
    expect(await tangemModule(network('ethereum'), MOCK_TANGEM_OWNER)).toBe(MOCK_TANGEM_MODULE);
    expect(await tangemModule(network('ethereum'), MOCK_EVM_ADDRESS)).toBeNull();
    expect(await tangemModule(network('arbitrum'), MOCK_TANGEM_OWNER)).toBeNull();
    const b = await evmProvider().getBalances(MOCK_TANGEM_OWNER, 'ethereum');
    // USDC is enabled with nothing in it, WETH never was (the module reverts): neither shows.
    expect(b.map((x) => [x.symbol, x.amount.toFixed()])).toEqual([
      ['ETH', '0.1'],
      ['aEthUSDT', '480.12'],
    ]);
  });

  it('coins into the module arrive as aTokens, coins out of it leave as aTokens', async () => {
    const t = await evmProvider({ blockscoutKey: MOCK_BLOCKSCOUT_KEY }).getTransfers(
      MOCK_TANGEM_OWNER,
      'ethereum',
    );
    const legs = t.filter((x) => x.part.endsWith(':tangem'));
    expect(
      legs.map((x) => [x.direction, x.asset.symbol, x.amount.toFixed(), x.at.toISOString().slice(0, 10)]),
    ).toEqual([
      ['in', 'aEthUSDT', '505', '2025-11-30'],
      ['in', 'aEthUSDT', '170', '2026-03-01'],
      ['out', 'aEthUSDT', '200', '2026-06-26'],
    ]);
    // A withdrawal straight from Aave burns the wallet's own aToken: no leg for it.
    expect(
      t.filter((x) => x.asset.symbol === 'aEthUSDT' && !x.part.endsWith(':tangem')).map((x) => x.direction),
    ).toEqual(['in', 'out']);
  });
});

describe('tron', () => {
  it('TRX and known TRC-20 balances; a look-alike token is not USDT', async () => {
    const b = await tronProvider().getBalances(MOCK_TRON_ADDRESS, 'tron');
    expect(b.map((x) => [x.symbol, x.amount.toFixed(), x.contract])).toEqual([
      ['TRX', '85.5', null],
      ['USDT', '266.75', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'],
    ]);
    expect(await tronProvider().getBalances('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'tron')).toEqual([]);
  });

  it('transfers with the burned TRX fee, oldest first; the cursor is a time', async () => {
    const t = await tronProvider().getTransfers(MOCK_TRON_ADDRESS, 'tron');
    expect(t.map((x) => [x.direction, x.asset.symbol, x.amount.toFixed(), x.fee.toFixed()])).toEqual([
      ['in', 'TRX', '120', '0'],
      ['out', 'TRX', '20', '1.1'],
      ['in', 'USDT', '300', '0'],
      ['out', 'TRX', '0', '13.4'],
      ['out', 'USDT', '33.25', '0'],
      ['in', 'USDT', '1000', '0'],
    ]);
    const later = await tronProvider().getTransfers(MOCK_TRON_ADDRESS, 'tron', t[2]!.block + 1);
    expect(later.length).toBe(3);
    expect((await tronProvider().health('tron')).ok).toBe(true);
  });

  it('waits and retries when TronGrid says «too many requests»', async () => {
    const pauses: number[] = [];
    const p = tronProvider(undefined, { sleep: async (ms) => pauses.push(ms) });
    mock.failNext('/tron/v1/accounts', 429, 2);
    expect((await p.getBalances(MOCK_TRON_ADDRESS, 'tron')).length).toBe(2);
    expect(pauses).toEqual([1000, 3000]);
    mock.failNext('/tron/v1/accounts', 429, 4);
    await expect(p.getBalances(MOCK_TRON_ADDRESS, 'tron')).rejects.toMatchObject({ status: 429 });
  });
});
