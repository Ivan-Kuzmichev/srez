import { z } from 'zod';
import { Decimal } from '@/domain/decimal';
import { nodeTransport, type RawResponse, type Transport } from './transport';

/**
 * T-Invest REST gateway (https://developer.tbank.ru/invest/intro/intro/, contracts in
 * github.com/RussianInvestments/investAPI). Read-only by construction: no trading method exists here.
 */
export const TINVEST_API_URL = 'https://invest-public-api.tbank.ru/rest';
const PREFIX = 'tinkoff.public.invest.api.contract.v1';

export type TinvestErrorCode =
  | 'UNAUTHENTICATED'
  | 'PERMISSION'
  | 'RATE_LIMIT'
  | 'UNAVAILABLE'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'BAD_RESPONSE';

/** A failed call; the message never contains the token. `apiCode` is the T-Invest code from `description`. */
export class TinvestError extends Error {
  override name = 'TinvestError';
  constructor(
    readonly code: TinvestErrorCode,
    message: string,
    readonly status?: number,
    readonly apiCode?: string,
    /** Seconds until the rate limit window resets. */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
  get retryable(): boolean {
    return this.code === 'RATE_LIMIT' || this.code === 'UNAVAILABLE';
  }
}

// Wire format: int64 as strings, Quotation {units, nano}, MoneyValue {currency, units, nano}, enums as strings.
const Int64 = z.union([z.string(), z.number()]).transform((v) => String(v));
const Quotation = z.object({ units: Int64.default('0'), nano: z.number().int().default(0) });
const MoneyValue = Quotation.extend({ currency: z.string().default('') });

/** units + nano / 1e9, exact; units and nano always share the sign. */
export function quotation(q: { units: string; nano: number } | undefined | null): Decimal {
  if (!q) return new Decimal(0);
  return new Decimal(q.units).plus(new Decimal(q.nano).div(1e9));
}

/** The API writes currencies in lower case; ours are ISO upper case. */
export const currencyOf = (m: { currency: string } | undefined | null) => (m?.currency ?? '').toUpperCase();

const Timestamp = z.string().transform((s) => new Date(s));

export const Account = z.object({
  id: z.string(),
  type: z.string().default('ACCOUNT_TYPE_UNSPECIFIED'),
  name: z.string().default(''),
  status: z.string().default('ACCOUNT_STATUS_UNSPECIFIED'),
  openedDate: Timestamp.optional(),
  closedDate: Timestamp.optional(),
  accessLevel: z.string().default('ACCOUNT_ACCESS_LEVEL_UNSPECIFIED'),
});
export type Account = z.infer<typeof Account>;

const UnaryLimit = z.object({ limitPerMinute: z.number().int(), methods: z.array(z.string()).default([]) });
const Tariff = z.object({ unaryLimits: z.array(UnaryLimit).default([]) });

export const OperationItem = z.object({
  cursor: z.string().default(''),
  brokerAccountId: z.string().default(''),
  id: z.string(),
  parentOperationId: z.string().default(''),
  name: z.string().default(''),
  date: Timestamp,
  type: z.string().default('OPERATION_TYPE_UNSPECIFIED'),
  description: z.string().default(''),
  state: z.string().default('OPERATION_STATE_UNSPECIFIED'),
  instrumentUid: z.string().default(''),
  figi: z.string().default(''),
  instrumentType: z.string().default(''),
  instrumentKind: z.string().default('INSTRUMENT_TYPE_UNSPECIFIED'),
  positionUid: z.string().default(''),
  ticker: z.string().default(''),
  classCode: z.string().default(''),
  payment: MoneyValue.optional(),
  price: MoneyValue.optional(),
  commission: MoneyValue.optional(),
  accruedInt: MoneyValue.optional(),
  quantity: Int64.default('0'),
  quantityRest: Int64.default('0'),
  quantityDone: Int64.default('0'),
  assetUid: z.string().default(''),
  childOperations: z
    .array(z.object({ instrumentUid: z.string().default(''), payment: MoneyValue.optional() }))
    .default([]),
});
export type OperationItem = z.infer<typeof OperationItem>;

const OperationsPage = z.object({
  hasNext: z.boolean().default(false),
  nextCursor: z.string().default(''),
  items: z.array(OperationItem).default([]),
});

const PortfolioPosition = z.object({
  figi: z.string().default(''),
  instrumentType: z.string().default(''),
  quantity: Quotation.optional(),
  instrumentUid: z.string().default(''),
  positionUid: z.string().default(''),
  ticker: z.string().default(''),
  classCode: z.string().default(''),
  currentPrice: MoneyValue.optional(),
});
export type PortfolioPosition = z.infer<typeof PortfolioPosition>;
const Portfolio = z.object({
  accountId: z.string().default(''),
  positions: z.array(PortfolioPosition).default([]),
});

export const Instrument = z.object({
  uid: z.string(),
  figi: z.string().default(''),
  ticker: z.string().default(''),
  classCode: z.string().default(''),
  isin: z.string().default(''),
  lot: z.number().int().default(1),
  currency: z.string().default(''),
  name: z.string().default(''),
  instrumentType: z.string().default(''),
  instrumentKind: z.string().default('INSTRUMENT_TYPE_UNSPECIFIED'),
  positionUid: z.string().default(''),
});
export type Instrument = z.infer<typeof Instrument>;

export const Bond = Instrument.extend({
  nominal: MoneyValue.optional(),
  initialNominal: MoneyValue.optional(),
  maturityDate: Timestamp.optional(),
  couponQuantityPerYear: z.number().int().default(0),
  floatingCouponFlag: z.boolean().default(false),
  amortizationFlag: z.boolean().default(false),
  perpetualFlag: z.boolean().default(false),
});
export type Bond = z.infer<typeof Bond>;

const InstrumentShort = z.object({
  uid: z.string(),
  figi: z.string().default(''),
  ticker: z.string().default(''),
  classCode: z.string().default(''),
  isin: z.string().default(''),
  name: z.string().default(''),
  instrumentType: z.string().default(''),
  instrumentKind: z.string().default('INSTRUMENT_TYPE_UNSPECIFIED'),
  lot: z.number().int().default(1),
});
export type InstrumentShort = z.infer<typeof InstrumentShort>;

export const Coupon = z.object({
  couponDate: Timestamp,
  couponNumber: Int64.default('0'),
  fixDate: Timestamp.optional(),
  payOneBond: MoneyValue.optional(),
  couponType: z.string().default('COUPON_TYPE_UNSPECIFIED'),
});
export type Coupon = z.infer<typeof Coupon>;

export const Dividend = z.object({
  dividendNet: MoneyValue.optional(),
  paymentDate: Timestamp.optional(),
  declaredDate: Timestamp.optional(),
  lastBuyDate: Timestamp.optional(),
  recordDate: Timestamp.optional(),
  dividendType: z.string().default(''),
});
export type Dividend = z.infer<typeof Dividend>;

const LastPrice = z.object({
  instrumentUid: z.string().default(''),
  figi: z.string().default(''),
  price: Quotation.optional(),
  time: Timestamp.optional(),
});
export type LastPrice = z.infer<typeof LastPrice>;

const Candle = z.object({ close: Quotation, time: Timestamp, isComplete: z.boolean().default(false) });
export type Candle = z.infer<typeof Candle>;

const ErrorBody = z.object({
  code: z.number().optional(),
  message: z.string().optional(),
  description: z.string().optional(),
});

/** Readable error for the interface (docs/05-integrations.md, «Ошибки для интерфейса»). */
function toError(res: RawResponse): TinvestError {
  let body: z.infer<typeof ErrorBody> = {};
  try {
    body = ErrorBody.parse(JSON.parse(res.body));
  } catch {
    // Not JSON: a proxy or a gateway page.
  }
  const apiCode = body.description || undefined;
  const reset = Number(res.headers['x-ratelimit-reset']);
  const retryAfter = Number.isFinite(reset) && reset > 0 ? reset : undefined;
  const text = `HTTP ${res.status}${apiCode ? ` (${apiCode})` : ''}${body.message ? `: ${body.message}` : ''}`;
  if (res.status === 401) return new TinvestError('UNAUTHENTICATED', text, res.status, apiCode);
  if (res.status === 403) return new TinvestError('PERMISSION', text, res.status, apiCode);
  if (res.status === 429) return new TinvestError('RATE_LIMIT', text, res.status, apiCode, retryAfter);
  if (res.status === 404) return new TinvestError('NOT_FOUND', text, res.status, apiCode);
  if (res.status >= 500 || res.status === 0)
    return new TinvestError('UNAVAILABLE', text, res.status, apiCode);
  return new TinvestError('BAD_REQUEST', text, res.status, apiCode);
}

const iso = (d: Date) => d.toISOString();

export interface TinvestClientOptions {
  baseUrl?: string;
  transport?: Transport;
  timeoutMs?: number;
}

export class TinvestClient {
  private readonly baseUrl: string;
  private readonly transport: Transport;
  private readonly timeoutMs: number;

  constructor(
    // Kept out of enumerable fields so that logging the client never prints the token.
    token: string,
    opts: TinvestClientOptions = {},
  ) {
    Object.defineProperty(this, 'token', { value: token, enumerable: false });
    this.baseUrl = (opts.baseUrl ?? TINVEST_API_URL).replace(/\/$/, '');
    this.transport = opts.transport ?? nodeTransport();
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  declare private readonly token: string;

  private async call<T extends z.ZodType>(
    service: string,
    method: string,
    body: object,
    schema: T,
  ): Promise<z.infer<T>> {
    let res: RawResponse;
    try {
      res = await this.transport(
        `${this.baseUrl}/${PREFIX}.${service}/${method}`,
        JSON.stringify(body),
        {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${this.token}`,
        },
        this.timeoutMs,
      );
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new TinvestError('UNAVAILABLE', `${service}/${method}: ${message}`);
    }
    if (res.status !== 200) throw toError(res);
    let json: unknown;
    try {
      json = JSON.parse(res.body);
    } catch {
      throw new TinvestError('BAD_RESPONSE', `${service}/${method}: not JSON`, res.status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new TinvestError(
        'BAD_RESPONSE',
        `${service}/${method}: ${z.prettifyError(parsed.error)}`,
        res.status,
      );
    return parsed.data;
  }

  /** Open accounts; closed ones too on request (their history is still served). */
  async getAccounts(opts: { includeClosed?: boolean } = {}): Promise<Account[]> {
    const body = opts.includeClosed ? { status: 'ACCOUNT_STATUS_ALL' } : {};
    return (
      await this.call(
        'UsersService',
        'GetAccounts',
        body,
        z.object({ accounts: z.array(Account).default([]) }),
      )
    ).accounts;
  }

  /** Requests per minute by full method name, for pacing (live limits are lower than the docs say). */
  async getLimits(): Promise<Map<string, number>> {
    const t = await this.call('UsersService', 'GetUserTariff', {}, Tariff);
    return new Map(t.unaryLimits.flatMap((l) => l.methods.map((m) => [m, l.limitPerMinute] as const)));
  }

  /** One page of executed operations; follow `nextCursor` while `hasNext`. */
  async getOperationsPage(req: { accountId: string; from: Date; to: Date; cursor?: string; limit?: number }) {
    return this.call(
      'OperationsService',
      'GetOperationsByCursor',
      {
        accountId: req.accountId,
        from: iso(req.from),
        to: iso(req.to),
        cursor: req.cursor ?? '',
        // The docs warn that limits of 1–2 break the cursor.
        limit: req.limit ?? 1000,
        state: 'OPERATION_STATE_EXECUTED',
        withoutCommissions: false,
        withoutTrades: true,
        withoutOvernights: false,
      },
      OperationsPage,
    );
  }

  async *operations(req: {
    accountId: string;
    from: Date;
    to: Date;
    limit?: number;
  }): AsyncGenerator<OperationItem[]> {
    let cursor = '';
    for (;;) {
      const page = await this.getOperationsPage({ ...req, cursor });
      yield page.items;
      if (!page.hasNext || !page.nextCursor || page.nextCursor === cursor) return;
      cursor = page.nextCursor;
    }
  }

  async getPortfolio(accountId: string): Promise<PortfolioPosition[]> {
    return (await this.call('OperationsService', 'GetPortfolio', { accountId, currency: 'RUB' }, Portfolio))
      .positions;
  }

  /** By uid, or by FIGI when an operation's uid is stale (seen in real data), or by ticker and class code. */
  async getInstrument(
    id: { uid: string } | { figi: string } | { ticker: string; classCode: string },
  ): Promise<Instrument> {
    const body =
      'uid' in id
        ? { idType: 'INSTRUMENT_ID_TYPE_UID', id: id.uid }
        : 'figi' in id
          ? { idType: 'INSTRUMENT_ID_TYPE_FIGI', id: id.figi }
          : { idType: 'INSTRUMENT_ID_TYPE_TICKER', id: id.ticker, classCode: id.classCode };
    return (
      await this.call('InstrumentsService', 'GetInstrumentBy', body, z.object({ instrument: Instrument }))
    ).instrument;
  }

  async getBond(uid: string): Promise<Bond> {
    const body = { idType: 'INSTRUMENT_ID_TYPE_UID', id: uid };
    return (await this.call('InstrumentsService', 'BondBy', body, z.object({ instrument: Bond }))).instrument;
  }

  async findInstrument(query: string): Promise<InstrumentShort[]> {
    const res = await this.call(
      'InstrumentsService',
      'FindInstrument',
      { query },
      z.object({ instruments: z.array(InstrumentShort).default([]) }),
    );
    return res.instruments;
  }

  async getBondCoupons(uid: string, from: Date, to: Date): Promise<Coupon[]> {
    const res = await this.call(
      'InstrumentsService',
      'GetBondCoupons',
      { instrumentId: uid, from: iso(from), to: iso(to) },
      z.object({ events: z.array(Coupon).default([]) }),
    );
    return res.events;
  }

  async getDividends(uid: string, from: Date, to: Date): Promise<Dividend[]> {
    const res = await this.call(
      'InstrumentsService',
      'GetDividends',
      { instrumentId: uid, from: iso(from), to: iso(to) },
      z.object({ dividends: z.array(Dividend).default([]) }),
    );
    return res.dividends;
  }

  async getLastPrices(uids: string[]): Promise<LastPrice[]> {
    if (uids.length === 0) return [];
    const res = await this.call(
      'MarketDataService',
      'GetLastPrices',
      { instrumentId: uids },
      z.object({ lastPrices: z.array(LastPrice).default([]) }),
    );
    return res.lastPrices;
  }

  /** Daily candles; one request covers up to 6 years. */
  async getDailyCandles(uid: string, from: Date, to: Date): Promise<Candle[]> {
    const body = { instrumentId: uid, from: iso(from), to: iso(to), interval: 'CANDLE_INTERVAL_DAY' };
    return (
      await this.call(
        'MarketDataService',
        'GetCandles',
        body,
        z.object({ candles: z.array(Candle).default([]) }),
      )
    ).candles;
  }
}
