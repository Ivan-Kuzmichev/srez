import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/client';
import {
  currenciesInUse,
  fxRange,
  instrumentsInUse,
  priceRange,
  setLastPrice,
  upsertFxRates,
  upsertPrices,
  type InstrumentInUse,
} from '@/db/mutations/market';
import { lastSnapshotDates, rebuildAccountSnapshots } from '@/db/mutations/snapshots';
import { finAccounts, instruments } from '@/db/schema';
import { getDailyRates, getRateHistory, CBR_IDS } from '@/integrations/cbr/client';
import { getCoinHistory, getCoinPrices } from '@/integrations/coingecko/client';
import type { Fetch } from '@/integrations/errors';
import { getLastPrice, getPriceHistory, getSecurity, type MoexPriceRef } from '@/integrations/moex/client';
import { addDays, localDate, utcToZonedLocal } from '@/lib/time';
import type { Logger } from '@/server/logger';
import { ownerSettings } from '@/server/settings';
import { enqueue } from './queue';
import type { TinvestClient } from '@/integrations/tinvest/client';
import { refreshTinvestPrices, tinvestForPrices, tinvestHistory } from './tinvest-market';
import { defineJob } from './runner';

/** Display currencies are always kept, so the ₽ / $ / € switch works from the first day. */
const DISPLAY_CURRENCIES = ['USD', 'EUR'];
const MOEX_KINDS = new Set(['share', 'bond', 'etf']);

export const SNAPSHOT_JOB = 'snapshot.daily';
export const PRICES_JOB = 'prices.refresh';

export function enqueueSnapshots(db: Db): void {
  enqueue(db, SNAPSHOT_JOB, null, { singletonKey: SNAPSHOT_JOB });
}

/** ISS coordinates of a security; looked up once and remembered in instruments.meta. */
async function moexRef(db: Db, inst: InstrumentInUse, fetchFn: Fetch): Promise<MoexPriceRef | null> {
  const meta = (inst.meta ?? {}) as Record<string, unknown>;
  const kind = inst.kind as MoexPriceRef['kind'];
  if (typeof meta.board === 'string' && typeof meta.market === 'string' && typeof meta.engine === 'string') {
    return {
      secid: String(meta.secid ?? inst.ticker),
      engine: meta.engine,
      market: meta.market,
      board: meta.board,
      kind,
    };
  }
  const secid = String(meta.secid ?? inst.ticker ?? '');
  if (!secid) return null;
  const sec = await getSecurity(secid, fetchFn);
  if (!sec.board) return null;
  db.update(instruments)
    .set({ meta: { ...meta, secid, ...sec.board } })
    .where(eq(instruments.id, inst.id))
    .run();
  return { secid, ...sec.board, kind };
}

const coinId = (inst: InstrumentInUse) => (inst.meta as { coingeckoId?: string } | null)?.coingeckoId ?? null;

/** Latest prices and today's rates (job prices.refresh). Failures are logged per item, never fatal. */
export async function refreshPrices(
  db: Db,
  log: Logger,
  fetchFn: Fetch = fetch,
  now = new Date(),
  tinvest: TinvestClient | null = null,
): Promise<void> {
  const tz = ownerSettings(db).display.timezone;
  const today = localDate(now, tz);
  const used = instrumentsInUse(db);

  // The broker first; ISS for what it did not price (no token, an error, a security without a uid).
  let fromBroker = new Set<string>();
  if (tinvest) {
    try {
      fromBroker = await refreshTinvestPrices(db, tinvest, used, now, today);
    } catch (err) {
      log.warn({ err }, 'T-Invest price refresh failed, falling back to ISS');
    }
  }

  for (const inst of used.filter((i) => MOEX_KINDS.has(i.kind) && !fromBroker.has(i.id))) {
    try {
      const ref = await moexRef(db, inst, fetchFn);
      const price = ref && (await getLastPrice(ref, fetchFn));
      if (!price) continue;
      setLastPrice(db, inst.id, price, inst.currency, 'moex', now);
      upsertPrices(db, inst.id, inst.currency, 'moex', [{ date: today, close: price }]);
    } catch (err) {
      log.warn({ instrument: inst.ticker, err }, 'Price refresh failed');
    }
  }

  const coins = used.filter((i) => i.kind === 'crypto' && coinId(i));
  if (coins.length > 0) {
    try {
      const quotes = await getCoinPrices(
        coins.map((c) => coinId(c)!),
        'usd',
        fetchFn,
      );
      for (const c of coins) {
        const price = quotes.get(coinId(c)!);
        if (!price) continue;
        setLastPrice(db, c.id, price, 'USD', 'coingecko', now);
        upsertPrices(db, c.id, 'USD', 'coingecko', [{ date: today, close: price }]);
      }
    } catch (err) {
      log.warn({ err }, 'Crypto price refresh failed');
    }
  }

  try {
    const wanted = new Set([...DISPLAY_CURRENCIES, ...currenciesInUse(db).map((c) => c.code)]);
    const rates = (await getDailyRates(today, fetchFn)).filter((r) => wanted.has(r.code));
    upsertFxRates(db, rates);
  } catch (err) {
    log.warn({ err }, 'FX refresh failed');
  }
}

/** Fills price and rate history back to the first operation (FR: «догрузка пропущенных дней»). */
export async function backfillHistory(
  db: Db,
  log: Logger,
  fetchFn: Fetch = fetch,
  now = new Date(),
  tinvest: TinvestClient | null = null,
): Promise<number> {
  const tz = ownerSettings(db).display.timezone;
  const today = localDate(now, tz);
  const yesterday = addDays(today, -1);
  let added = 0;

  const gaps = (have: { from: string | null; to: string | null }, since: string): [string, string][] => {
    if (!have.from || !have.to) return since <= today ? [[since, today]] : [];
    const out: [string, string][] = [];
    if (since < have.from) out.push([since, addDays(have.from, -1)]);
    if (have.to < yesterday) out.push([addDays(have.to, 1), today]);
    return out;
  };

  for (const inst of instrumentsInUse(db)) {
    const since = localDate(inst.firstOperationAt, tz);
    for (const [from, to] of gaps(priceRange(db, inst.id), since)) {
      try {
        if (tinvest && inst.externalUid && MOEX_KINDS.has(inst.kind)) {
          try {
            const n = await tinvestHistory(db, tinvest, inst, from, to);
            added += n;
            if (n > 0) continue;
          } catch (err) {
            log.warn({ instrument: inst.ticker, from, to, err }, 'T-Invest history failed, trying ISS');
          }
        }
        if (MOEX_KINDS.has(inst.kind)) {
          const ref = await moexRef(db, inst, fetchFn);
          if (!ref) continue;
          const rows = await getPriceHistory(ref, from, to, fetchFn);
          upsertPrices(db, inst.id, inst.currency, 'moex', rows);
          added += rows.length;
        } else if (inst.kind === 'crypto' && coinId(inst)) {
          const days = Math.min(365, Math.ceil((Date.parse(today) - Date.parse(from)) / 86_400_000) + 1);
          const rows = (await getCoinHistory(coinId(inst)!, days, 'usd', fetchFn)).filter(
            (r) => r.date >= from && r.date <= to,
          );
          upsertPrices(db, inst.id, 'USD', 'coingecko', rows);
          added += rows.length;
        }
      } catch (err) {
        log.warn({ instrument: inst.ticker, from, to, err }, 'Price history failed');
      }
    }
  }

  const earliest = currenciesInUse(db).reduce<string | null>((m, c) => {
    const d = localDate(c.since, tz);
    return !m || d < m ? d : m;
  }, null);
  const codes = new Set([...DISPLAY_CURRENCIES, ...currenciesInUse(db).map((c) => c.code)]);
  for (const code of codes) {
    if (code === 'RUB' || !CBR_IDS[code] || !earliest) continue;
    for (const [from, to] of gaps(fxRange(db, code), earliest)) {
      try {
        const rows = await getRateHistory(code, from, to, fetchFn);
        upsertFxRates(db, rows);
        added += rows.length;
      } catch (err) {
        log.warn({ currency: code, from, to, err }, 'FX history failed');
      }
    }
  }
  return added;
}

/** The last complete day: today after the snapshot time in the display zone, otherwise yesterday. */
export function snapshotThrough(now: Date, timeZone: string, snapshotTime: string): string {
  const local = utcToZonedLocal(now, timeZone);
  const today = local.slice(0, 10);
  return local.slice(11, 16) >= snapshotTime ? today : addDays(today, -1);
}

/** Rebuilds the accounts that are behind, or all of them when history changed. */
export function updateSnapshots(db: Db, now = new Date(), force = false): number {
  const s = ownerSettings(db);
  const through = snapshotThrough(now, s.display.timezone, s.prices.snapshotTime);
  const accounts = db
    .select({ id: finAccounts.id })
    .from(finAccounts)
    .all()
    .map((a) => a.id);
  const last = lastSnapshotDates(db, accounts);
  let rebuilt = 0;
  for (const id of accounts) {
    if (!force && last.get(id) === through) continue;
    rebuildAccountSnapshots(db, id, through, s.display.timezone);
    rebuilt += 1;
  }
  return rebuilt;
}

export const refreshPricesJob = defineJob({
  name: PRICES_JOB,
  lane: 'slow',
  payload: z.null(),
  lockMs: 10 * 60_000,
  async handler({ db, log }) {
    const s = ownerSettings(db);
    // The schedule ticks every 15 minutes; hourly and daily settings skip the extra ticks.
    const minute = new Date().getUTCMinutes() + new Date().getUTCHours() * 60;
    if (s.prices.refreshMinutes > 15 && minute % s.prices.refreshMinutes >= 15) return;
    await refreshPrices(db, log, fetch, new Date(), tinvestForPrices(db));
  },
});

export const snapshotJob = defineJob({
  name: SNAPSHOT_JOB,
  lane: 'slow',
  payload: z.null(),
  lockMs: 30 * 60_000,
  async handler({ db, log }) {
    const added = await backfillHistory(db, log, fetch, new Date(), tinvestForPrices(db));
    const rebuilt = updateSnapshots(db, new Date(), added > 0);
    if (added > 0 || rebuilt > 0)
      log.info({ pricesAdded: added, accountsRebuilt: rebuilt }, 'Snapshots updated');
  },
});
