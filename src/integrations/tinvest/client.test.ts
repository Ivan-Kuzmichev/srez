import { X509Certificate } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MOCK_TOKEN, startTinvestMock, type TinvestMock } from '../../../tests/mock/tinvest';
import { RUSSIAN_TRUSTED_ROOT_CA, RUSSIAN_TRUSTED_ROOT_CA_SHA256 } from './ca';
import { quotation, TinvestClient, TinvestError } from './client';
import { nodeTransport } from './transport';

let mock: TinvestMock;
let client: TinvestClient;
beforeAll(async () => {
  mock = await startTinvestMock();
  client = new TinvestClient(MOCK_TOKEN, { baseUrl: mock.url });
});
afterAll(() => mock.close());
afterEach(() => mock.clearFailures());

describe('T-Invest client', () => {
  it('ships the genuine Russian Trusted Root CA', () => {
    const cert = new X509Certificate(RUSSIAN_TRUSTED_ROOT_CA);
    expect(cert.fingerprint256).toBe(RUSSIAN_TRUSTED_ROOT_CA_SHA256);
    expect(cert.subject).toContain('CN=Russian Trusted Root CA');
  });

  it('turns units and nano into an exact decimal, negatives included', () => {
    expect(quotation({ units: '114', nano: 250000000 }).toString()).toBe('114.25');
    expect(quotation({ units: '-1', nano: -500000000 }).toString()).toBe('-1.5');
    expect(quotation({ units: '0', nano: 1 }).toString()).toBe('0.000000001');
    expect(quotation(undefined).toString()).toBe('0');
  });

  it('lists open accounts with their access level', async () => {
    const accounts = await client.getAccounts();
    expect(accounts.map((a) => a.type)).toEqual([
      'ACCOUNT_TYPE_TINKOFF',
      'ACCOUNT_TYPE_TINKOFF_IIS',
      'ACCOUNT_TYPE_DFA',
    ]);
    expect(accounts.every((a) => a.accessLevel === 'ACCOUNT_ACCESS_LEVEL_READ_ONLY')).toBe(true);
    expect(accounts[0]!.openedDate).toEqual(new Date('2023-07-04T00:00:00Z'));
    expect(await client.getAccounts({ includeClosed: true })).toHaveLength(4);
  });

  it('reads the per-method limits', async () => {
    const limits = await client.getLimits();
    expect(limits.get('tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts')).toBe(50);
  });

  it('follows the cursor through every page of executed operations', async () => {
    const pages: number[] = [];
    const ids: string[] = [];
    for await (const items of client.operations({
      accountId: '2000000001',
      from: new Date('2015-01-01'),
      to: new Date('2030-01-01'),
      limit: 5,
    })) {
      pages.push(items.length);
      ids.push(...items.map((o) => o.id));
    }
    const executed = mock.state.operations.filter(
      (o) => o.brokerAccountId === '2000000001' && o.state === 'OPERATION_STATE_EXECUTED',
    );
    expect(ids.sort()).toEqual(executed.map((o) => o.id).sort());
    expect(pages.length).toBeGreaterThan(1);
    expect(
      mock.calls
        .filter((c) => c.method === 'OperationsService/GetOperationsByCursor')
        .every((c) => c.body.state === 'OPERATION_STATE_EXECUTED'),
    ).toBe(true);
  });

  it('parses money, quantities and fee links of an operation', async () => {
    const { items } = await client.getOperationsPage({
      accountId: '2000000001',
      from: new Date('2023-08-03'),
      to: new Date('2023-08-03T23:59:59Z'),
    });
    const buy = items.find((o) => o.type === 'OPERATION_TYPE_BUY')!;
    const fee = items.find((o) => o.type === 'OPERATION_TYPE_BROKER_FEE')!;
    expect(buy.quantity).toBe('2');
    expect(buy.quantityRest).toBe('1');
    expect(quotation(buy.payment).toString()).toBe('-5400');
    expect(buy.payment?.currency).toBe('rub');
    expect(fee.parentOperationId).toBe(buy.id);
  });

  it('finds instruments by uid and by FIGI, and bonds with their nominal', async () => {
    await expect(client.getInstrument({ uid: '4f8a1b2c-0000-4000-8000-0000000000aa' })).rejects.toMatchObject(
      { code: 'NOT_FOUND', apiCode: '50002' },
    );
    const usd = await client.getInstrument({ figi: 'BBG0013HGFT4' });
    expect(usd.uid).toBe('a22a1263-8e1b-4546-a1aa-416463f104d3');
    const bond = await client.getBond('3d9cc8b6-4a6c-4d5b-9f7c-1f6a2b5e7c01');
    expect(quotation(bond.nominal).toString()).toBe('1000');
    expect(bond.maturityDate).toEqual(new Date('2041-05-15T00:00:00Z'));
  });

  it('reads portfolio, payouts, last prices and daily candles', async () => {
    const positions = await client.getPortfolio('2000000001');
    expect(positions.find((p) => p.ticker === 'SBER')?.quantity).toEqual({ units: '80', nano: 0 });
    await expect(client.getPortfolio('2000000003')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      apiCode: '30081',
    });
    const coupons = await client.getBondCoupons(
      '3d9cc8b6-4a6c-4d5b-9f7c-1f6a2b5e7c01',
      new Date('2026-01-01'),
      new Date('2027-01-01'),
    );
    expect(coupons.map((c) => c.couponDate.toISOString().slice(0, 10))).toEqual(['2026-01-14', '2026-07-15']);
    const dividends = await client.getDividends(
      'e6123145-9665-43e0-8413-cd61b8aa9b13',
      new Date('2026-01-01'),
      new Date('2027-01-01'),
    );
    expect(quotation(dividends[0]!.dividendNet).toString()).toBe('36.5');
    const prices = await client.getLastPrices(['e6123145-9665-43e0-8413-cd61b8aa9b13']);
    expect(quotation(prices[0]!.price).toString()).toBe('300');
    const candles = await client.getDailyCandles(
      'e6123145-9665-43e0-8413-cd61b8aa9b13',
      new Date('2026-09-28'),
      new Date('2026-10-04'),
    );
    expect(candles).toHaveLength(5);
  });

  it('maps gateway errors to codes, with the rate-limit reset and without the token', async () => {
    const bad = new TinvestClient('t.wrong-token-value', { baseUrl: mock.url });
    const err = await bad.getAccounts().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TinvestError);
    expect(err).toMatchObject({ code: 'UNAUTHENTICATED', status: 401, apiCode: '40003', retryable: false });
    expect(String((err as Error).message)).not.toContain('wrong-token');

    // Without waiting out the limit, to see the error itself.
    const impatient = new TinvestClient(MOCK_TOKEN, { baseUrl: mock.url, rateLimitRetries: 0 });
    mock.failNext(
      { status: 429, code: '80002', resetSeconds: 17 },
      { status: 403, code: '40002' },
      { status: 503 },
    );
    await expect(impatient.getAccounts()).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      retryAfter: 17,
      retryable: true,
    });
    await expect(client.getAccounts()).rejects.toMatchObject({ code: 'PERMISSION', apiCode: '40002' });
    await expect(client.getAccounts()).rejects.toMatchObject({ code: 'UNAVAILABLE', retryable: true });
  });

  it('reports an unreachable gateway as unavailable', async () => {
    const down = new TinvestClient(MOCK_TOKEN, { baseUrl: 'http://127.0.0.1:9/rest', timeoutMs: 2000 });
    await expect(down.getAccounts()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('rejects a malformed response', async () => {
    const odd = new TinvestClient(MOCK_TOKEN, {
      transport: async () => ({ status: 200, headers: {}, body: '{"accounts":[{"name":1}]}' }),
    });
    await expect(odd.getAccounts()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('never exposes the token through the client object', () => {
    const c = new TinvestClient('t.secret-value', { baseUrl: mock.url });
    expect(JSON.stringify(c)).not.toContain('secret-value');
    expect(Object.keys(c)).not.toContain('token');
  });

  it('accepts only http proxies', () => {
    expect(() => nodeTransport('socks5://127.0.0.1:1080')).toThrow(/http/);
    expect(() => nodeTransport('http://user:pass@127.0.0.1:3128')).not.toThrow();
  });
});
