import { getBytes, IntegrationError, type Fetch } from '../errors';

/** Official rates of the Bank of Russia (https://www.cbr.ru/development/SXML/), no key. */
const BASE = 'https://www.cbr.ru/scripts';

/** CBR internal ids for the dynamic (history) endpoint. */
export const CBR_IDS: Record<string, string> = { USD: 'R01235', EUR: 'R01239', CNY: 'R01375', GBP: 'R01035' };

export interface CbrRate {
  /** «YYYY-MM-DD», the date the rate is set for. */
  date: string;
  code: string;
  /** Rubles for one unit, as a decimal string. */
  rate: string;
}

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const isoFromDots = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;

/** «92,1234» per «Nominal» units → rubles per one unit, without floats. */
function perUnit(value: string, nominal: string): string {
  const v = value.replace(',', '.');
  const n = Number(nominal);
  if (!/^\d+(\.\d+)?$/.test(v) || !Number.isInteger(n) || n <= 0) {
    throw new IntegrationError('cbr', 'BAD_RESPONSE', `Bad rate ${value}/${nominal}`);
  }
  if (n === 1) return v;
  // Shift the decimal point: nominals are powers of ten (1, 10, 100, 1000, 10000).
  const zeros = Math.log10(n);
  if (!Number.isInteger(zeros)) throw new IntegrationError('cbr', 'BAD_RESPONSE', `Nominal ${nominal}`);
  const [int = '0', frac = ''] = v.split('.');
  const digits = int.padStart(zeros + 1, '0') + frac;
  const point = digits.length - frac.length - zeros;
  return (
    `${digits.slice(0, point).replace(/^0+(?=\d)/, '')}.${digits.slice(point)}`.replace(/\.?0+$/, '') || '0'
  );
}

const decode = (bytes: Uint8Array) => new TextDecoder('windows-1251').decode(bytes);
const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];

/** All rates set for `date` (the CBR answers with the nearest earlier date on weekends). */
export async function getDailyRates(date: string, fetchFn: Fetch = fetch): Promise<CbrRate[]> {
  const xml = decode(await getBytes('cbr', `${BASE}/XML_daily.asp?date_req=${ddmmyyyy(date)}`, fetchFn));
  const actual = /<ValCurs Date="(\d\d\.\d\d\.\d{4})"/.exec(xml)?.[1];
  if (!actual) throw new IntegrationError('cbr', 'BAD_RESPONSE', 'No ValCurs date');
  return [...xml.matchAll(/<Valute [^>]*>(.*?)<\/Valute>/g)].map((m) => {
    const body = m[1]!;
    const code = tag(body, 'CharCode');
    const value = tag(body, 'Value');
    const nominal = tag(body, 'Nominal');
    if (!code || !value || !nominal) throw new IntegrationError('cbr', 'BAD_RESPONSE', 'Incomplete Valute');
    return { date: isoFromDots(actual), code, rate: perUnit(value, nominal) };
  });
}

/** History of one currency, one entry per date the CBR set a rate. */
export async function getRateHistory(
  code: string,
  from: string,
  to: string,
  fetchFn: Fetch = fetch,
): Promise<CbrRate[]> {
  const id = CBR_IDS[code];
  if (!id) throw new IntegrationError('cbr', 'BAD_RESPONSE', `No CBR id for ${code}`);
  const url = `${BASE}/XML_dynamic.asp?date_req1=${ddmmyyyy(from)}&date_req2=${ddmmyyyy(to)}&VAL_NM_RQ=${id}`;
  const xml = decode(await getBytes('cbr', url, fetchFn));
  return [...xml.matchAll(/<Record Date="(\d\d\.\d\d\.\d{4})"[^>]*>(.*?)<\/Record>/g)].map((m) => {
    const value = tag(m[2]!, 'Value');
    const nominal = tag(m[2]!, 'Nominal');
    if (!value || !nominal) throw new IntegrationError('cbr', 'BAD_RESPONSE', 'Incomplete Record');
    return { date: isoFromDots(m[1]!), code, rate: perUnit(value, nominal) };
  });
}

export interface KeyRate {
  /** «YYYY-MM-DD», the day the rate applies to. */
  date: string;
  /** Percent a year, as a decimal string. */
  rate: string;
}

/**
 * The Bank of Russia key rate by day (DailyInfo web service, `KeyRateXML`; SOAP 1.2, no key). The
 * service lists working days only: a day without an entry keeps the rate of the last one before.
 */
export async function getKeyRates(from: string, to: string, fetchFn: Fetch = fetch): Promise<KeyRate[]> {
  const body = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><KeyRateXML xmlns="http://web.cbr.ru/"><fromDate>${from}</fromDate><ToDate>${to}</ToDate></KeyRateXML></soap12:Body></soap12:Envelope>`;
  const xml = new TextDecoder('utf-8').decode(
    await getBytes('cbr', 'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx', fetchFn, 15_000, {
      body,
      contentType: 'application/soap+xml; charset=utf-8',
    }),
  );
  const out = [...xml.matchAll(/<KR><DT>(\d{4}-\d{2}-\d{2})T[^<]*<\/DT><Rate>([\d.]+)<\/Rate><\/KR>/g)].map(
    (m) => ({ date: m[1]!, rate: m[2]! }),
  );
  if (out.length === 0 && !/<KeyRateXMLResult/.test(xml))
    throw new IntegrationError('cbr', 'BAD_RESPONSE', 'No KeyRateXMLResult');
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export const _test = { perUnit };
