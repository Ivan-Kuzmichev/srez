import { z } from 'zod';
import { getJson, IntegrationError, type Fetch } from '../errors';

/**
 * Public ISS of the Moscow Exchange (https://iss.moex.com/iss/reference/), no key.
 * Used for the instrument directory until T-Invest arrives (phase 4) and for index history later.
 */
const BASE = 'https://iss.moex.com/iss';

/** ISS tables come as { columns: [...], data: [[...]] }. */
const Table = z.object({ columns: z.array(z.string()), data: z.array(z.array(z.unknown())) });

function rows(table: z.infer<typeof Table>): Record<string, unknown>[] {
  return table.data.map((row) => Object.fromEntries(table.columns.map((c, i) => [c.toLowerCase(), row[i]])));
}

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw new IntegrationError('moex', 'BAD_RESPONSE', z.prettifyError(result.error));
  return result.data;
}

export type MoexKind = 'share' | 'bond' | 'etf';

const GROUPS: Record<string, MoexKind> = {
  stock_shares: 'share',
  stock_dr: 'share',
  stock_bonds: 'bond',
  stock_ppif: 'etf',
  stock_etf: 'etf',
  stock_mpif: 'etf',
};

/** ISS says SUR for the ruble. */
export const issCurrency = (code: unknown) =>
  code === 'SUR' || code === 'RUR' ? 'RUB' : String(code ?? 'RUB');

export interface MoexSearchHit {
  secid: string;
  shortName: string;
  name: string;
  isin: string | null;
  kind: MoexKind;
}

const SearchRow = z.object({
  secid: z.string(),
  shortname: z.string().nullable(),
  name: z.string().nullable(),
  isin: z.string().nullable(),
  group: z.string().nullable(),
  is_traded: z.union([z.number(), z.null()]),
});

export async function searchSecurities(query: string, fetchFn: Fetch = fetch): Promise<MoexSearchHit[]> {
  const url = `${BASE}/securities.json?q=${encodeURIComponent(query)}&limit=30&iss.meta=off&securities.columns=secid,shortname,name,isin,group,is_traded`;
  const body = parse(z.object({ securities: Table }), await getJson('moex', url, fetchFn));
  return rows(body.securities)
    .map((r) => parse(SearchRow, r))
    .filter((r) => r.is_traded === 1 && r.group && GROUPS[r.group])
    .map((r) => ({
      secid: r.secid,
      shortName: r.shortname ?? r.secid,
      name: r.name ?? r.shortname ?? r.secid,
      isin: r.isin,
      kind: GROUPS[r.group!]!,
    }));
}

/** Where a security trades: needed for prices and history. */
export interface MoexBoard {
  engine: string;
  market: string;
  board: string;
}

export interface MoexSecurity {
  secid: string;
  board: MoexBoard | null;
  isin: string | null;
  shortName: string;
  name: string;
  kind: MoexKind;
  currency: string;
  lot: number;
  bond?: {
    nominal: number;
    couponType: 'fixed' | 'floating';
    couponRate: number | null;
    maturityDate: string | null;
  };
}

/** Full card of one security: description, primary board currency, lot and bond terms. */
export async function getSecurity(secid: string, fetchFn: Fetch = fetch): Promise<MoexSecurity> {
  const id = encodeURIComponent(secid);
  const card = parse(
    z.object({ description: Table, boards: Table }),
    await getJson(
      'moex',
      `${BASE}/securities/${id}.json?iss.meta=off&iss.only=description,boards&description.columns=name,value&boards.columns=boardid,market,engine,is_primary,currencyid`,
      fetchFn,
    ),
  );
  const d = Object.fromEntries(rows(card.description).map((r) => [String(r.name), r.value]));
  const group = String(d.GROUP ?? '');
  const kind = GROUPS[group];
  if (!kind) throw new IntegrationError('moex', 'BAD_RESPONSE', `Unsupported group ${group}`);

  const board = rows(card.boards).find((b) => b.is_primary === 1);
  let lot = 1;
  let faceValue: number | null = d.FACEVALUE ? Number(d.FACEVALUE) : null;
  let faceUnit = d.FACEUNIT;
  if (board) {
    const market = parse(
      z.object({ securities: Table }),
      await getJson(
        'moex',
        `${BASE}/engines/${board.engine}/markets/${board.market}/boards/${board.boardid}/securities/${id}.json?iss.meta=off&iss.only=securities&securities.columns=SECID,LOTSIZE,FACEVALUE,FACEUNIT`,
        fetchFn,
      ),
    );
    const m = rows(market.securities)[0];
    if (m) {
      lot = Number(m.lotsize ?? 1) || 1;
      faceValue = m.facevalue != null ? Number(m.facevalue) : faceValue;
      faceUnit = m.faceunit ?? faceUnit;
    }
  }
  const currency = issCurrency(kind === 'bond' ? faceUnit : (board?.currencyid ?? faceUnit));

  return {
    secid,
    board: board
      ? { engine: String(board.engine), market: String(board.market), board: String(board.boardid) }
      : null,
    isin: d.ISIN ? String(d.ISIN) : null,
    shortName: String(d.SHORTNAME ?? secid),
    name: String(d.NAME ?? d.SHORTNAME ?? secid),
    kind,
    currency,
    lot,
    bond:
      kind === 'bond'
        ? {
            nominal: faceValue ?? 1000,
            couponType: /плавающ|переменн/i.test(String(d.BOND_TYPE ?? '')) ? 'floating' : 'fixed',
            couponRate: d.COUPONPERCENT != null ? Number(d.COUPONPERCENT) : null,
            maturityDate: d.MATDATE ? String(d.MATDATE) : null,
          }
        : undefined,
  };
}

export interface MoexPriceRef extends MoexBoard {
  secid: string;
  kind: MoexKind;
}

/** Bond prices on the exchange are percent of face value; the ledger keeps money. */
function toMoney(kind: MoexKind, price: unknown, face: unknown): string | null {
  if (price === null || price === undefined || price === '') return null;
  const p = String(price);
  if (!/^\d+(\.\d+)?$/.test(p)) return null;
  if (kind !== 'bond') return p;
  const f = Number(face);
  if (!Number.isFinite(f) || f <= 0) return null;
  // percent × face / 100, exactly: multiply as integers, then move the point two places left.
  return shiftLeft2(decimalTimes(p, String(face)));
}

/** Exact product of two non-negative decimal strings. */
function decimalTimes(a: string, b: string): string {
  const [ai = '0', af = ''] = a.split('.');
  const [bi = '0', bf = ''] = b.split('.');
  const product = (BigInt(ai + af) * BigInt(bi + bf)).toString();
  const scale = af.length + bf.length;
  const padded = product.padStart(scale + 1, '0');
  const int = padded.slice(0, padded.length - scale);
  const frac = padded.slice(padded.length - scale).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

function shiftLeft2(value: string): string {
  const [int = '0', frac = ''] = value.split('.');
  const padded = int.padStart(3, '0');
  const newInt = padded.slice(0, -2).replace(/^0+(?=\d)/, '');
  const newFrac = (padded.slice(-2) + frac).replace(/0+$/, '');
  return newFrac ? `${newInt}.${newFrac}` : newInt;
}

/** Last trade price in money (LAST, else the market price, else yesterday's). Null outside trading history. */
export async function getLastPrice(ref: MoexPriceRef, fetchFn: Fetch = fetch): Promise<string | null> {
  const url = `${BASE}/engines/${ref.engine}/markets/${ref.market}/boards/${ref.board}/securities/${encodeURIComponent(ref.secid)}.json?iss.meta=off&iss.only=marketdata,securities&marketdata.columns=SECID,LAST,MARKETPRICE,LCURRENTPRICE&securities.columns=SECID,FACEVALUE,PREVPRICE`;
  const body = parse(z.object({ marketdata: Table, securities: Table }), await getJson('moex', url, fetchFn));
  const md = rows(body.marketdata)[0];
  const sec = rows(body.securities)[0];
  const raw = md?.last ?? md?.lcurrentprice ?? md?.marketprice ?? sec?.prevprice;
  return toMoney(ref.kind, raw, sec?.facevalue);
}

/** Daily closes between two dates, following ISS pages of 100 rows. */
export async function getPriceHistory(
  ref: MoexPriceRef,
  from: string,
  till: string,
  fetchFn: Fetch = fetch,
): Promise<{ date: string; close: string }[]> {
  const out: { date: string; close: string }[] = [];
  for (let start = 0, guard = 0; guard < 200; guard++) {
    const url = `${BASE}/history/engines/${ref.engine}/markets/${ref.market}/boards/${ref.board}/securities/${encodeURIComponent(ref.secid)}.json?iss.meta=off&from=${from}&till=${till}&start=${start}&history.columns=TRADEDATE,CLOSE,LEGALCLOSEPRICE,FACEVALUE`;
    const body = parse(
      z.object({ history: Table, 'history.cursor': Table.optional() }),
      await getJson('moex', url, fetchFn),
    );
    const page = rows(body.history);
    for (const r of page) {
      const close = toMoney(ref.kind, r.close ?? r.legalcloseprice, r.facevalue);
      if (close && typeof r.tradedate === 'string') out.push({ date: r.tradedate, close });
    }
    const cursor = body['history.cursor'] ? rows(body['history.cursor'])[0] : undefined;
    const total = Number(cursor?.total ?? 0);
    const size = Number(cursor?.pagesize ?? 100);
    start += size;
    if (page.length === 0 || start >= total) break;
  }
  return out;
}

export const _test = { toMoney, decimalTimes };
