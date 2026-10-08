import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { searchCoins } from './coingecko/client';
import { IntegrationError, type Fetch } from './errors';
import { getSecurity, searchSecurities } from './moex/client';

const fixture = (path: string) => JSON.parse(readFileSync(`tests/fixtures/${path}`, 'utf8'));

/** Answers by URL substring with recorded responses; no network in tests. */
function fakeFetch(routes: Record<string, unknown>): Fetch {
  return async (url) => {
    // The longest matching route wins: «/securities/X.json» is also a substring of the board URL.
    const hit = Object.entries(routes)
      .filter(([part]) => url.includes(part))
      .sort((a, b) => b[0].length - a[0].length)[0];
    if (!hit) return new Response('not found', { status: 404 });
    return Response.json(hit[1]);
  };
}

describe('moex', () => {
  it('search keeps traded shares, bonds and funds, drops indices', async () => {
    const hits = await searchSecurities(
      'SBER',
      fakeFetch({ '/securities.json': fixture('moex/search-sber.json') }),
    );
    expect(hits.find((h) => h.secid === 'SBER')).toMatchObject({
      kind: 'share',
      isin: 'RU0009029540',
      shortName: 'Сбербанк',
    });
    expect(hits.some((h) => h.secid.startsWith('FIX'))).toBe(false);
    expect(hits.some((h) => h.kind === 'bond')).toBe(true);
  });

  it('reads a share card with currency and lot', async () => {
    const sec = await getSecurity(
      'SBER',
      fakeFetch({
        '/securities/SBER.json': fixture('moex/security-SBER.json'),
        '/boards/TQBR/securities/SBER.json': fixture('moex/board-SBER.json'),
      }),
    );
    expect(sec).toMatchObject({ kind: 'share', currency: 'RUB', lot: 1, isin: 'RU0009029540' });
    expect(sec.bond).toBeUndefined();
  });

  it('reads bond terms', async () => {
    const sec = await getSecurity(
      'SU26238RMFS4',
      fakeFetch({
        '/securities/SU26238RMFS4.json': fixture('moex/security-SU26238RMFS4.json'),
        '/boards/TQOB/securities/SU26238RMFS4.json': fixture('moex/board-SU26238RMFS4.json'),
      }),
    );
    expect(sec).toMatchObject({ kind: 'bond', currency: 'RUB', shortName: 'ОФЗ 26238' });
    expect(sec.bond).toMatchObject({
      nominal: 1000,
      couponType: 'fixed',
      couponRate: 7.1,
      maturityDate: '2041-05-15',
    });
  });

  it('turns HTTP errors and malformed bodies into IntegrationError', async () => {
    await expect(searchSecurities('x', fakeFetch({}))).rejects.toBeInstanceOf(IntegrationError);
    await expect(searchSecurities('x', fakeFetch({ '/securities.json': { nope: 1 } }))).rejects.toMatchObject(
      {
        code: 'BAD_RESPONSE',
      },
    );
  });
});

describe('coingecko', () => {
  it('search returns coins with upper-case symbols', async () => {
    const hits = await searchCoins(
      'bitcoin',
      fakeFetch({ '/search': fixture('coingecko/search-bitcoin.json') }),
    );
    expect(hits[0]).toEqual({ coingeckoId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1 });
  });
});
