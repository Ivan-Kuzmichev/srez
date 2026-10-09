import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  MOCK_BLOCKSCOUT_KEY,
  MOCK_BTC_ADDRESS,
  MOCK_EVM_ADDRESS,
  startChainsMock,
  type ChainsMock,
} from '../../../tests/mock/chains';
import { bitcoinProvider } from './bitcoin';
import { evmProvider, readRate } from './evm';

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
