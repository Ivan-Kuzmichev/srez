import { Decimal } from './decimal';

/** docs/04-calculations.md, section 14. */
export type ReconcileGuess = 'transfer' | 'fx' | 'redemption' | 'split' | 'unknown';

export interface ReconcileInstrument {
  kind: string;
  /** «YYYY-MM-DD», bonds only. */
  maturityDate?: string | null;
}

export interface Holding {
  instrumentId: string;
  quantity: Decimal;
}

export interface Discrepancy {
  instrumentId: string;
  ledgerQty: Decimal;
  brokerQty: Decimal;
  guess: ReconcileGuess;
}

const EPSILON = new Decimal('1e-9');

/** Whether a / b, or b / a, is a whole number other than one: a split or a consolidation. */
function wholeRatio(a: Decimal, b: Decimal): boolean {
  if (a.lte(0) || b.lte(0)) return false;
  const [big, small] = a.gt(b) ? [a, b] : [b, a];
  const r = big.div(small);
  return r.gt(1) && r.isInteger();
}

/**
 * The likeliest reason, most specific first. Section 14 lists «broker shows more → transfer» first,
 * but a split also shows more: checking the whole ratio before it keeps splits recognisable.
 */
export function guessReason(
  ledger: Decimal,
  broker: Decimal,
  instrument: ReconcileInstrument,
  today: string,
): ReconcileGuess {
  if (instrument.kind === 'currency') return 'fx';
  if (
    instrument.kind === 'bond' &&
    broker.isZero() &&
    instrument.maturityDate &&
    instrument.maturityDate <= today
  )
    return 'redemption';
  if (wholeRatio(ledger, broker)) return 'split';
  if (broker.gt(ledger)) return 'transfer';
  return 'unknown';
}

/**
 * Journal against broker for one account: every instrument either side holds, except the excluded.
 * Quantities equal within 1e-9 match.
 */
export function reconcile(
  ledger: Holding[],
  broker: Holding[],
  instruments: Map<string, ReconcileInstrument>,
  excluded: Set<string>,
  today: string,
): Discrepancy[] {
  const sum = (list: Holding[]) => {
    const m = new Map<string, Decimal>();
    for (const h of list) m.set(h.instrumentId, (m.get(h.instrumentId) ?? new Decimal(0)).plus(h.quantity));
    return m;
  };
  const mine = sum(ledger);
  const theirs = sum(broker);
  const out: Discrepancy[] = [];
  for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
    if (excluded.has(id)) continue;
    const l = mine.get(id) ?? new Decimal(0);
    const b = theirs.get(id) ?? new Decimal(0);
    if (l.minus(b).abs().lte(EPSILON)) continue;
    out.push({
      instrumentId: id,
      ledgerQty: l,
      brokerQty: b,
      guess: guessReason(l, b, instruments.get(id) ?? { kind: 'share' }, today),
    });
  }
  return out.sort((a, b) => a.instrumentId.localeCompare(b.instrumentId));
}
