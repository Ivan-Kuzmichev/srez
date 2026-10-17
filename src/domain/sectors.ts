import { Decimal } from './decimal';

/** docs/04-calculations.md, section 16: sectors of a portfolio's shares and funds. */
export interface SectorItem {
  /** The sector code; '' when unknown. */
  sector: string;
  /** Rubles. */
  value: Decimal;
}

export interface SectorShare {
  sector: string;
  value: Decimal;
  /** Percent of the base: the shares and funds of the area. */
  share: Decimal;
  target: Decimal | null;
  /** Farther from the target than the threshold. */
  offTarget: boolean;
  /** What reaches the target: + buy that much, − sell; null without a target. */
  move: Decimal | null;
}

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);

/**
 * Each sector's share of the base, against its target. Sectors held come first by value, then the ones
 * with a target and nothing held; the unknown sector goes last.
 */
export function sectorAllocation(
  items: readonly SectorItem[],
  targets: ReadonlyMap<string, Decimal>,
  threshold: Decimal,
): { base: Decimal; rows: SectorShare[] } {
  const values = new Map<string, Decimal>();
  for (const i of items)
    if (i.value.gt(0)) values.set(i.sector, (values.get(i.sector) ?? ZERO).plus(i.value));
  for (const s of targets.keys()) if (!values.has(s)) values.set(s, ZERO);
  const base = [...values.values()].reduce((s, v) => s.plus(v), ZERO);
  const rows = [...values].map(([sector, value]): SectorShare => {
    const share = base.isZero() ? ZERO : value.div(base).times(HUNDRED);
    const target = targets.get(sector) ?? null;
    return {
      sector,
      value,
      share,
      target,
      offTarget: target !== null && share.minus(target).abs().gt(threshold),
      move: target === null ? null : target.div(HUNDRED).times(base).minus(value),
    };
  });
  rows.sort((a, b) => {
    if ((a.sector === '') !== (b.sector === '')) return a.sector === '' ? 1 : -1;
    return b.value.comparedTo(a.value) || (b.target ?? ZERO).comparedTo(a.target ?? ZERO);
  });
  return { base, rows };
}

/** The largest sector's share of the base, for the one-sector limit; null with nothing held. */
export function largestSector(items: readonly SectorItem[]): { sector: string; share: Decimal } | null {
  const { rows } = sectorAllocation(
    items.filter((i) => i.sector !== ''),
    new Map(),
    ZERO,
  );
  const known = rows.filter((r) => r.value.gt(0));
  const total = items.reduce((s, i) => (i.value.gt(0) ? s.plus(i.value) : s), ZERO);
  if (known.length === 0 || total.isZero()) return null;
  return { sector: known[0]!.sector, share: known[0]!.value.div(total).times(HUNDRED) };
}
