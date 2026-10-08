import { Decimal } from './decimal';

export const ASSET_CLASS_ORDER = ['stocks', 'bonds', 'funds', 'crypto', 'cash', 'other'] as const;
export type AssetClass = (typeof ASSET_CLASS_ORDER)[number];

export interface ClassShare {
  assetClass: AssetClass;
  value: Decimal;
  /** Percent of the area. */
  share: Decimal;
  target: Decimal | null;
  /** share − target, percentage points. */
  deviation: Decimal | null;
  offTarget: boolean;
}

/**
 * Structure by class and deviations from targets (docs/04-calculations.md, section 7). Classes keep the
 * fixed order of the interface; empty classes without a target are left out.
 */
export function allocation(
  values: ReadonlyMap<AssetClass, Decimal>,
  targets: ReadonlyMap<AssetClass, Decimal> | null,
  thresholdPp: Decimal,
): ClassShare[] {
  const total = [...values.values()].reduce((s, v) => s.plus(v), new Decimal(0));
  return ASSET_CLASS_ORDER.flatMap((assetClass) => {
    const value = values.get(assetClass) ?? new Decimal(0);
    const target = targets?.get(assetClass) ?? null;
    if (value.isZero() && !target) return [];
    const share = total.isZero() ? new Decimal(0) : value.div(total).times(100);
    const deviation = target ? share.minus(target) : null;
    return [
      {
        assetClass,
        value,
        share,
        target,
        deviation,
        offTarget: deviation ? deviation.abs().gt(thresholdPp) : false,
      },
    ];
  });
}

/** Targets must add up to 100 (portfolio_targets invariant). */
export function targetsValid(targets: readonly Decimal[]): boolean {
  return targets.reduce((s, t) => s.plus(t), new Decimal(0)).eq(100) && targets.every((t) => t.gte(0));
}
