import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Decimal } from '@/domain/decimal';
import { OperationItem } from './client';
import { mapOperations, type MappedOperation } from './map';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../tests/fixtures/tinvest/operations.json'), 'utf8'),
);
const items = (fixture.operations as unknown[]).map((o) => OperationItem.parse(o));
const { operations, warnings } = mapOperations(items);
const A1 = '2000000001';
const A3 = '2000000003';
const find = (pred: (m: MappedOperation) => boolean) => {
  const hits = operations.filter(pred);
  expect(hits).toHaveLength(1);
  return hits[0]!;
};
const str = (d: Decimal) => d.toString();

describe('T-Invest operation mapping', () => {
  it('folds the broker fee into its trade and keeps no separate fee entry', () => {
    const buy = find((m) => m.brokerAccountId === A1 && m.type === 'buy' && m.instrument?.ticker === 'SBER');
    expect(str(buy.quantity)).toBe('40');
    expect(str(buy.price)).toBe('250');
    expect(str(buy.fee)).toBe('7.5');
    expect(str(buy.amount)).toBe('-10007.5');
    expect(buy.raw.map((r) => r.type)).toEqual(['OPERATION_TYPE_BUY', 'OPERATION_TYPE_BROKER_FEE']);
    expect(operations.some((m) => m.raw[0]!.type === 'OPERATION_TYPE_BROKER_FEE')).toBe(false);
  });

  it('counts only the filled part of an order and skips cancelled ones', () => {
    const lkoh = find((m) => m.type === 'buy' && m.instrument?.ticker === 'LKOH');
    expect(str(lkoh.quantity)).toBe('1');
    expect(str(lkoh.amount)).toBe('-5402.7');
    const cancelled = items.find((o) => o.state === 'OPERATION_STATE_CANCELED')!;
    expect(operations.some((m) => m.externalId === cancelled.id)).toBe(false);
  });

  it('keeps accrued interest of a bond purchase', () => {
    const ofz = find((m) => m.type === 'buy' && m.instrument?.ticker === 'SU26238RMFS4');
    expect(str(ofz.accruedInterest)).toBe('85.9');
    expect(str(ofz.amount)).toBe('-6142.72');
  });

  it('turns a currency purchase into fx_buy', () => {
    const usd = find((m) => m.instrument?.ticker === 'USD000UTSTOM');
    expect(usd.type).toBe('fx_buy');
    expect(str(usd.quantity)).toBe('100');
    expect(usd.currency).toBe('RUB');
  });

  it('treats a purchase «с карты» as an ordinary purchase from the account', () => {
    const card = find((m) => m.raw[0]!.type === 'OPERATION_TYPE_BUY_CARD');
    expect(card.type).toBe('buy');
    expect(str(card.amount)).toBe('-3050.92');
  });

  it('attaches coupon and dividend taxes to the payout of the same day', () => {
    const coupon = find((m) => m.brokerAccountId === A1 && m.type === 'coupon');
    expect(str(coupon.tax)).toBe('46');
    expect(str(coupon.amount)).toBe('310.5');
    const dividend = find((m) => m.type === 'dividend' && m.instrument?.ticker === 'SBER');
    expect(str(dividend.tax)).toBe('431');
    expect(str(dividend.amount)).toBe('2884');
    expect(operations.some((m) => m.type === 'tax' && m.instrument)).toBe(false);
  });

  it('books a dividend paid to a card as income that leaves at once', () => {
    const div = find((m) => m.type === 'dividend' && m.instrument?.ticker === 'LKOH');
    const out = find((m) => m.externalId === `${div.externalId}:card`);
    expect(out.type).toBe('withdrawal');
    expect(str(out.amount)).toBe('-1200');
    expect(out.fingerprint).not.toBe(div.fingerprint);
  });

  it('reads transfers between own accounts by the sign of the payment', () => {
    const out = find(
      (m) => m.brokerAccountId === A3 && m.type === 'transfer_out' && m.instrument?.ticker === 'SBER',
    );
    const into = find(
      (m) => m.brokerAccountId === A1 && m.type === 'transfer_in' && m.instrument?.ticker === 'SBER',
    );
    for (const t of [out, into]) {
      expect(str(t.quantity)).toBe('60');
      expect(str(t.price)).toBe('260');
      expect(str(t.amount)).toBe('0');
    }
    const cashOut = find((m) => m.brokerAccountId === A3 && m.type === 'withdrawal');
    const cashIn = find(
      (m) =>
        m.brokerAccountId === A1 && m.raw[0]!.type === 'OPERATION_TYPE_TRANS_IIS_BS' && m.type === 'deposit',
    );
    expect(cashIn.amount.plus(cashOut.amount).isZero()).toBe(true);
  });

  it('leaves the redemption quantity to the importer when the broker sends none', () => {
    const r = find((m) => m.type === 'redemption');
    expect(r.quantityFromHolding).toBe(true);
    expect(str(r.amount)).toBe('20000');
  });

  it('maps fees, taxes and corrections without a security', () => {
    const track = find((m) => m.raw[0]!.type === 'OPERATION_TYPE_TRACK_MFEE');
    expect([track.type, str(track.fee), str(track.amount)]).toEqual(['fee', '120.5', '-120.5']);
    const tax = find((m) => m.raw[0]!.type === 'OPERATION_TYPE_TAX');
    expect([tax.type, str(tax.tax), tax.instrument]).toEqual(['tax', '1820', null]);
    const refund = find((m) => m.raw[0]!.type === 'OPERATION_TYPE_TAX_CORRECTION');
    expect([refund.type, str(refund.tax), str(refund.amount)]).toEqual(['tax', '-240', '240']);
  });

  it('keeps an unknown type as «other» with a warning', () => {
    expect(warnings).toEqual([
      expect.objectContaining({ brokerType: 'OPERATION_TYPE_SOMETHING_NEW', reason: 'UNKNOWN_TYPE' }),
    ]);
    expect(find((m) => m.type === 'other').note).toBe('Тип, которого нет в таблице соответствия');
  });

  it('reproduces the broker cash of every account', () => {
    const portfolio = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../../tests/fixtures/tinvest/portfolio.json'), 'utf8'),
    );
    for (const [account, pf] of Object.entries(portfolio) as [
      string,
      { positions: { ticker: string; quantity: { units: string; nano: number } }[] },
    ][]) {
      const rub = pf.positions.find((p) => p.ticker === 'RUB000UTSTOM')!.quantity;
      const journal = operations
        .filter((m) => m.brokerAccountId === account && m.currency === 'RUB')
        .reduce((s, m) => s.plus(m.amount), new Decimal(0));
      expect(journal.toFixed(2)).toBe(new Decimal(rub.units).plus(new Decimal(rub.nano).div(1e9)).toFixed(2));
    }
  });

  it('is deterministic: the same input gives the same ids and fingerprints', () => {
    const again = mapOperations([...items].reverse()).operations;
    expect(again.map((m) => [m.externalId, m.fingerprint])).toEqual(
      operations.map((m) => [m.externalId, m.fingerprint]),
    );
  });

  it('attaches a fee to a trade outside the batch later', () => {
    const fee = items.find((o) => o.type === 'OPERATION_TYPE_BROKER_FEE')!;
    const { operations: alone } = mapOperations([fee]);
    expect(alone).toHaveLength(1);
    expect(alone[0]).toMatchObject({ type: 'fee', parentExternalId: fee.parentOperationId });
  });
});
