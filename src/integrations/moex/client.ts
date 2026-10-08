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

export interface MoexSecurity {
  secid: string;
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
