import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { _test as cbrTest, getDailyRates, getRateHistory } from './cbr/client';
import { getCoinHistory, getCoinPrices } from './coingecko/client';
import type { Fetch } from './errors';
import { _test as moexTest, getLastPrice, getPriceHistory } from './moex/client';

const raw = (path: string) => readFileSync(`tests/fixtures/${path}`);
const json = (path: string) => JSON.parse(raw(path).toString('utf8'));

function fake(routes: Record<string, () => Response>): Fetch {
  return async (url) => {
    const hit = Object.entries(routes)
      .filter(([p]) => url.includes(p))
      .sort((a, b) => b[0].length - a[0].length)[0];
    return hit ? hit[1]() : new Response('', { status: 404 });
  };
}

describe('cbr', () => {
  it('reads daily rates in windows-1251 and divides by the nominal', async () => {
    const rates = await getDailyRates(
      '2026-10-04',
      fake({ XML_daily: () => new Response(raw('cbr/daily-2026-10-03.xml')) }),
    );
    const byCode = new Map(rates.map((r) => [r.code, r]));
    expect(byCode.get('AUD')).toEqual({ date: '2026-10-03', code: 'AUD', rate: '57.8794' });
    expect(byCode.get('DZD')!.rate).toBe('0.62466');
    expect(byCode.has('USD')).toBe(true);
  });

  it('reads a currency history', async () => {
    const h = await getRateHistory(
      'USD',
      '2026-09-01',
      '2026-09-10',
      fake({ XML_dynamic: () => new Response(raw('cbr/dynamic-usd.xml')) }),
    );
    expect(h[0]).toEqual({ date: '2026-09-01', code: 'USD', rate: '86.3793' });
    expect(h.length).toBeGreaterThan(3);
  });

  it('shifts by nominals exactly', () => {
    expect(cbrTest.perUnit('62,4660', '100')).toBe('0.62466');
    expect(cbrTest.perUnit('11,5', '10')).toBe('1.15');
    expect(cbrTest.perUnit('86,3793', '1')).toBe('86.3793');
  });
});

describe('coingecko prices', () => {
  it('reads current prices for several coins', async () => {
    const prices = await getCoinPrices(
      ['bitcoin', 'ethereum'],
      'usd',
      fake({ '/simple/price': () => Response.json(json('coingecko/simple-price.json')) }),
    );
    expect([...prices.keys()].sort()).toEqual(['bitcoin', 'ethereum']);
    expect(Number(prices.get('bitcoin'))).toBeGreaterThan(0);
  });

  it('keeps one close per day', async () => {
    const h = await getCoinHistory(
      'bitcoin',
      5,
      'usd',
      fake({ market_chart: () => Response.json(json('coingecko/market-chart-bitcoin.json')) }),
    );
    expect(new Set(h.map((p) => p.date)).size).toBe(h.length);
    expect(h[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('moex prices', () => {
  const share = { secid: 'SBER', engine: 'stock', market: 'shares', board: 'TQBR', kind: 'share' as const };
  const bond = {
    secid: 'SU26238RMFS4',
    engine: 'stock',
    market: 'bonds',
    board: 'TQOB',
    kind: 'bond' as const,
  };

  it('gives the last price of a share as is and of a bond in money', async () => {
    const md = json('moex/marketdata-SBER.json');
    const last = String(md.marketdata.data[0][md.marketdata.columns.indexOf('LAST')]);
    expect(await getLastPrice(share, fake({ '/securities/SBER.json': () => Response.json(md) }))).toBe(last);
    const bmd = json('moex/marketdata-SU26238RMFS4.json');
    const pct = Number(bmd.marketdata.data[0][bmd.marketdata.columns.indexOf('LAST')]);
    const b = await getLastPrice(bond, fake({ '/securities/SU26238RMFS4.json': () => Response.json(bmd) }));
    expect(Number(b)).toBeCloseTo(pct * 10, 6); // percent of 1 000 face value
  });

  it('reads history, bonds converted to money', async () => {
    const s = await getPriceHistory(
      share,
      '2026-09-28',
      '2026-10-03',
      fake({ '/history/': () => Response.json(json('moex/history-SBER.json')) }),
    );
    expect(s[0]).toEqual({ date: '2026-09-28', close: '272.45' });
    const b = await getPriceHistory(
      bond,
      '2026-09-28',
      '2026-10-03',
      fake({ '/history/': () => Response.json(json('moex/history-SU26238RMFS4.json')) }),
    );
    expect(b[0]).toEqual({ date: '2026-09-28', close: '511.52' });
  });

  it('multiplies decimals exactly', () => {
    expect(moexTest.decimalTimes('50.366', '1000')).toBe('50366');
    expect(moexTest.toMoney('bond', 99.5, 819.27)).toBe('815.17365');
    expect(moexTest.toMoney('share', null, null)).toBeNull();
  });
});
