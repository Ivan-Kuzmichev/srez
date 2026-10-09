import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { instruments } from '@/db/schema';
import { uuidv7 } from '@/lib/uuid';

/** Benchmarks (docs/05-integrations.md, section 2): Moscow Exchange total return indices from ISS. */
export const BENCHMARKS = [
  { ticker: 'MCFTR', name: 'Индекс МосБиржи полной доходности', board: 'RTSI' },
  { ticker: 'RGBITR', name: 'Индекс гособлигаций полной доходности', board: 'SNDX' },
] as const;
export const DEFAULT_BENCHMARK = 'MCFTR';

/** The index instruments, created on first need; returns ticker → id. */
export function ensureBenchmarks(db: Executor): Map<string, string> {
  const tickers = BENCHMARKS.map((b) => b.ticker);
  const found = new Map(
    db
      .select({ id: instruments.id, ticker: instruments.ticker })
      .from(instruments)
      .where(and(eq(instruments.kind, 'index'), inArray(instruments.ticker, tickers)))
      .all()
      .map((r) => [r.ticker!, r.id]),
  );
  for (const b of BENCHMARKS) {
    if (found.has(b.ticker)) continue;
    const id = uuidv7();
    db.insert(instruments)
      .values({
        id,
        kind: 'index',
        assetClass: 'other',
        ticker: b.ticker,
        name: b.name,
        currency: 'RUB',
        meta: { secid: b.ticker, engine: 'stock', market: 'index', board: b.board },
      })
      .run();
    found.set(b.ticker, id);
  }
  return found;
}

export function benchmarkOptions(db: Executor): { id: string; ticker: string; name: string }[] {
  const ids = ensureBenchmarks(db);
  return BENCHMARKS.map((b) => ({ id: ids.get(b.ticker)!, ticker: b.ticker, name: b.name }));
}

/** The benchmark of an area: the portfolio's own, else the settings default, else MCFTR. */
export function benchmarkFor(
  db: Executor,
  portfolioBenchmarkId: string | null,
  defaultId: string | null,
): string {
  const ids = ensureBenchmarks(db);
  const known = new Set(ids.values());
  if (portfolioBenchmarkId && known.has(portfolioBenchmarkId)) return portfolioBenchmarkId;
  if (defaultId && known.has(defaultId)) return defaultId;
  return ids.get(DEFAULT_BENCHMARK)!;
}
