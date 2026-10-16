import { Decimal } from './decimal';
import { heldQuantity } from './holdings';
import type { OperationType } from './ledger-types';

export interface SplitStep {
  at: Date;
  /** «1 → 4»: every `from` shares become `to`; a consolidation has `from` > `to`. */
  from: Decimal;
  to: Decimal;
}

export type SplitPlan =
  { ok: true; deltas: Decimal[]; final: Decimal } | { ok: false; code: 'NO_POSITION'; index: number };

/**
 * Several splits of one security in one account, each applied to what is held on its date
 * (docs/04-calculations.md, section 2: a split adds the difference). Splits are taken in date order;
 * `deltas` follow the order given. `final` is the holding after the journal and every split.
 */
export function planSplits(
  ops: readonly { at: Date; type: OperationType; quantity: Decimal }[],
  splits: readonly SplitStep[],
): SplitPlan {
  const timeline = [...ops].sort((a, b) => a.at.getTime() - b.at.getTime());
  const order = splits.map((s, index) => ({ ...s, index })).sort((a, b) => a.at.getTime() - b.at.getTime());
  const deltas: Decimal[] = splits.map(() => new Decimal(0));
  const added: { at: Date; type: OperationType; quantity: Decimal }[] = [];
  for (const s of order) {
    const before = [...timeline, ...added]
      .filter((o) => o.at.getTime() <= s.at.getTime())
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const held = heldQuantity(before);
    if (held.lte(0)) return { ok: false, code: 'NO_POSITION', index: s.index };
    const delta = held.times(s.to).div(s.from).minus(held);
    deltas[s.index] = delta;
    added.push({ at: s.at, type: 'split', quantity: delta });
  }
  const all = [...timeline, ...added].sort((a, b) => a.at.getTime() - b.at.getTime());
  return { ok: true, deltas, final: heldQuantity(all) };
}
