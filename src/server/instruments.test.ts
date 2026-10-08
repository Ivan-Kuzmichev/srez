import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { instruments, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import type { Fetch } from '@/integrations/errors';
import { createCustomAsset, getInstrument, pickDirectoryHit, searchDirectory } from './instruments';

const fixture = (path: string) => JSON.parse(readFileSync(`tests/fixtures/${path}`, 'utf8'));
const routes: Record<string, unknown> = {
  '/securities.json': fixture('moex/search-sber.json'),
  '/securities/SBER.json': fixture('moex/security-SBER.json'),
  '/boards/TQBR/securities/SBER.json': fixture('moex/board-SBER.json'),
  '/search?query=': fixture('coingecko/search-bitcoin.json'),
};
const online: Fetch = async (url) => {
  const hit = Object.entries(routes)
    .filter(([p]) => url.includes(p))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? Response.json(hit[1]) : new Response('', { status: 404 });
};
const offline: Fetch = async () => {
  throw new TypeError('fetch failed');
};

function setup() {
  const db = createTestDb();
  const now = new Date();
  for (const id of ['u1', 'u2']) {
    db.insert(user)
      .values({ id, name: id, email: `${id}@local.invalid`, createdAt: now, updatedAt: now })
      .run();
  }
  return db;
}

describe('directory', () => {
  it('finds exchange and crypto hits, and a picked share is stored once', async () => {
    const db = setup();
    const hits = await searchDirectory(db, 'u1', 'SBER', online);
    expect(hits.find((h) => h.key === 'moex:SBER')).toMatchObject({ kind: 'share', source: 'moex' });
    expect(hits.some((h) => h.source === 'coingecko')).toBe(true);

    const sber = await pickDirectoryHit(db, 'u1', 'moex:SBER', online);
    expect(sber).toMatchObject({
      ticker: 'SBER',
      kind: 'share',
      assetClass: 'stocks',
      currency: 'RUB',
      lot: '1',
    });
    expect(db.select().from(instruments).get()!.meta).toMatchObject({
      secid: 'SBER',
      engine: 'stock',
      market: 'shares',
      board: 'TQBR',
    });
    const again = await pickDirectoryHit(db, 'u1', 'moex:SBER', online);
    expect(again!.id).toBe(sber!.id);

    // Now it is local, and the exchange copy is not offered twice.
    const next = await searchDirectory(db, 'u1', 'SBER', online);
    expect(next[0]).toMatchObject({ key: `local:${sber!.id}`, source: 'local' });
    expect(next.some((h) => h.key === 'moex:SBER')).toBe(false);
  });

  it('stores a coin by its CoinGecko id', async () => {
    const db = setup();
    const btc = await pickDirectoryHit(db, 'u1', 'cg:bitcoin', online);
    expect(btc).toMatchObject({ ticker: 'BTC', kind: 'crypto', assetClass: 'crypto' });
    expect((await pickDirectoryHit(db, 'u1', 'cg:bitcoin', online))!.id).toBe(btc!.id);
  });

  it('still answers from the local directory when the outside is down', async () => {
    const db = setup();
    db.insert(instruments)
      .values({ kind: 'share', assetClass: 'stocks', ticker: 'LKOH', name: 'Лукойл', currency: 'RUB' })
      .run();
    const hits = await searchDirectory(db, 'u1', 'лук', offline);
    expect(hits.map((h) => h.ticker)).toEqual(['LKOH']);
    expect(await searchDirectory(db, 'u1', '%%', offline)).toEqual([]);
  });

  it('keeps custom assets private', async () => {
    const db = setup();
    const own = createCustomAsset(db, 'u1', {
      name: 'Вклад «Подушка»',
      assetClass: 'cash',
      currency: 'RUB',
      valuation: 'interest',
      annualRate: '16',
    });
    expect(getInstrument(db, 'u1', own.id)).toMatchObject({ kind: 'custom', assetClass: 'cash' });
    expect(getInstrument(db, 'u2', own.id)).toBeNull();
    expect(await searchDirectory(db, 'u2', 'подушка', offline)).toEqual([]);
    expect(await pickDirectoryHit(db, 'u2', `local:${own.id}`, offline)).toBeNull();
  });
});
