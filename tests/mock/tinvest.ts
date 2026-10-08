// A local stand-in for the T-Invest REST gateway, serving tests/fixtures/tinvest.
// Used by unit tests (startTinvestMock) and by e2e (`tsx tests/mock/tinvest.ts <port>`).
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'fixtures', 'tinvest');
const read = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8'));
const PREFIX = '/rest/tinkoff.public.invest.api.contract.v1.';
export const MOCK_TOKEN = 't.mock-read-only-token';

// Fixture JSON is loosely typed on purpose: the mock mirrors the wire format, not our schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
export interface MockState {
  accounts: Json[];
  operations: Json[];
  portfolio: Record<string, Json>;
  instruments: Json[];
  coupons: Record<string, Json[]>;
  dividends: Record<string, Json[]>;
  lastPrices: Record<string, Json>;
  tariff: Json;
}

export function fixtureState(): MockState {
  return {
    accounts: read('accounts.json').accounts,
    operations: read('operations.json').operations,
    portfolio: read('portfolio.json'),
    instruments: read('instruments.json').instruments,
    coupons: read('coupons.json'),
    dividends: read('dividends.json'),
    lastPrices: read('last-prices.json'),
    tariff: read('tariff.json'),
  };
}

export interface TinvestMock {
  url: string;
  state: MockState;
  /** Every call: method name and request body. */
  calls: { method: string; body: Json }[];
  /** The next calls answer with these errors, in order (e.g. a 429, then a 503). */
  failNext(...errors: { status: number; code?: string; message?: string; resetSeconds?: number }[]): void;
  /** Drops failures a test queued but did not use. */
  clearFailures(): void;
  close(): Promise<void>;
}

const ERRORS: Record<number, number> = { 400: 3, 401: 16, 403: 7, 404: 5, 429: 8, 500: 13, 503: 14 };

function error(res: http.ServerResponse, status: number, description: string, message: string, reset = 0) {
  res.writeHead(status, { 'content-type': 'application/json', 'x-ratelimit-reset': String(reset) });
  res.end(JSON.stringify({ code: ERRORS[status] ?? 2, message, description }));
}

const ts = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : NaN);
const inRange = (date: string, from?: string, to?: string) =>
  (!from || Date.parse(date) >= ts(from)) && (!to || Date.parse(date) <= ts(to));

function candles(state: MockState, uid: string, from: string, to: string): Json[] | null {
  const price = state.lastPrices[uid];
  if (!price) return [];
  const start = ts(from);
  const end = ts(to);
  if (end - start > 6 * 366 * 86_400_000) return null;
  const out: Json[] = [];
  for (
    let t = Date.UTC(
      new Date(start).getUTCFullYear(),
      new Date(start).getUTCMonth(),
      new Date(start).getUTCDate(),
    );
    t <= end;
    t += 86_400_000
  ) {
    const day = new Date(t).getUTCDay();
    if (day === 0 || day === 6 || t < start) continue;
    out.push({
      open: price,
      high: price,
      low: price,
      close: price,
      volume: '1000',
      time: new Date(t + 7 * 3_600_000).toISOString(),
      isComplete: true,
    });
  }
  return out;
}

function handle(state: MockState, method: string, body: Json, res: http.ServerResponse) {
  const ok = (data: unknown) => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'x-ratelimit-limit': '200, 200;w=60',
      'x-ratelimit-remaining': '199',
    });
    res.end(JSON.stringify(data));
  };
  const account = (id: unknown) => state.accounts.find((a) => a.id === id);
  const instrument = (b: Json) =>
    state.instruments.find((i) =>
      b.idType === 'INSTRUMENT_ID_TYPE_FIGI'
        ? i.figi === b.id
        : b.idType === 'INSTRUMENT_ID_TYPE_TICKER'
          ? i.ticker === b.id && i.classCode === b.classCode
          : i.uid === b.id,
    );
  switch (method) {
    case 'UsersService/GetAccounts': {
      const all = body.status === 'ACCOUNT_STATUS_ALL';
      return ok({ accounts: state.accounts.filter((a) => all || a.status !== 'ACCOUNT_STATUS_CLOSED') });
    }
    case 'UsersService/GetUserTariff':
      return ok(state.tariff);
    case 'OperationsService/GetOperationsByCursor': {
      if (!account(body.accountId)) return error(res, 404, '50004', 'Account not found');
      const items = state.operations
        .filter((o) => o.brokerAccountId === body.accountId && inRange(o.date, body.from, body.to))
        .filter((o) => !body.state || o.state === body.state)
        .sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || b.id.localeCompare(a.id));
      const offset = Number(body.cursor || 0);
      const limit = Math.min(Number(body.limit || 100), 1000);
      const page = items
        .slice(offset, offset + limit)
        .map((o, k) => ({ ...o, cursor: String(offset + k + 1) }));
      const next = offset + limit;
      return ok({
        hasNext: next < items.length,
        nextCursor: next < items.length ? String(next) : '',
        items: page,
      });
    }
    case 'OperationsService/GetPortfolio':
    case 'OperationsService/GetPositions': {
      const a = account(body.accountId);
      if (!a || a.type === 'ACCOUNT_TYPE_DFA') return error(res, 404, '50004', 'Account not found');
      if (a.status === 'ACCOUNT_STATUS_CLOSED') return error(res, 400, '30081', 'Account status is closed');
      return ok(state.portfolio[a.id] ?? { accountId: a.id, positions: [] });
    }
    case 'InstrumentsService/GetInstrumentBy':
    case 'InstrumentsService/CurrencyBy':
    case 'InstrumentsService/BondBy': {
      const i = instrument(body);
      const wanted = method.endsWith('BondBy')
        ? 'INSTRUMENT_TYPE_BOND'
        : method.endsWith('CurrencyBy')
          ? 'INSTRUMENT_TYPE_CURRENCY'
          : null;
      if (!i || (wanted && i.instrumentKind !== wanted))
        return error(res, 404, '50002', 'Instrument not found');
      return ok({ instrument: i });
    }
    case 'InstrumentsService/FindInstrument': {
      const q = String(body.query ?? '').toLowerCase();
      return ok({
        instruments: state.instruments.filter((i) =>
          [i.ticker, i.name, i.isin, i.figi].some((v) => String(v).toLowerCase().includes(q)),
        ),
      });
    }
    case 'InstrumentsService/GetBondCoupons':
      return ok({
        events: (state.coupons[body.instrumentId] ?? []).filter((c) =>
          inRange(c.couponDate, body.from, body.to),
        ),
      });
    case 'InstrumentsService/GetDividends':
      if (!state.instruments.some((i) => i.uid === body.instrumentId))
        return error(res, 404, '50002', 'Instrument not found');
      return ok({
        dividends: (state.dividends[body.instrumentId] ?? []).filter((d) =>
          inRange(d.recordDate, body.from, body.to),
        ),
      });
    case 'MarketDataService/GetLastPrices':
      return ok({
        lastPrices: (body.instrumentId ?? [])
          .filter((uid: string) => state.lastPrices[uid])
          .map((uid: string) => ({
            instrumentUid: uid,
            figi: '',
            price: state.lastPrices[uid],
            time: new Date().toISOString(),
            lastPriceType: 'LAST_PRICE_EXCHANGE',
          })),
      });
    case 'MarketDataService/GetCandles': {
      const list = candles(state, body.instrumentId, body.from, body.to);
      if (!list)
        return error(
          res,
          400,
          '30014',
          'The maximum request period for the given candle interval has been exceeded',
        );
      return ok({ candles: list });
    }
    default:
      return error(res, 404, '40000', `Unknown method ${method}`);
  }
}

export async function startTinvestMock(
  opts: { port?: number; state?: MockState } = {},
): Promise<TinvestMock> {
  const state = opts.state ?? fixtureState();
  const calls: TinvestMock['calls'] = [];
  const failures: { status: number; code?: string; message?: string; resetSeconds?: number }[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const method = (req.url ?? '').startsWith(PREFIX) ? (req.url ?? '').slice(PREFIX.length) : '';
      if (req.method !== 'POST' || !method) return error(res, 404, '40000', 'Not found');
      if (!String(req.headers['content-type']).startsWith('application/json')) {
        res.writeHead(415);
        return res.end();
      }
      if (req.headers.authorization !== `Bearer ${MOCK_TOKEN}`)
        return error(res, 401, '40003', 'Authentication token is missing or invalid');
      let body: Json = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        return error(res, 400, '30001', 'Bad JSON');
      }
      calls.push({ method, body });
      const fail = failures.shift();
      if (fail)
        return error(
          res,
          fail.status,
          fail.code ?? '70001',
          fail.message ?? 'Mock failure',
          fail.resetSeconds ?? 0,
        );
      handle(state, method, body, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/rest`,
    state,
    calls,
    failNext: (...errors) => void failures.push(...errors),
    clearFailures: () => void failures.splice(0),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const mock = await startTinvestMock({ port: Number(process.argv[2] ?? 3199) });
  console.log(`T-Invest mock on ${mock.url}`);
}
