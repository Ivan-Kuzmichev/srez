'use client';

import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Table, Td, Th } from '@/components/ui/table';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import type { AssetClass } from '@/domain/allocation';
import { Decimal } from '@/domain/decimal';
import { Money } from '@/domain/money';
import { ordersFor, rebalance, type Candidate } from '@/domain/rebalance';
import { cn } from '@/lib/cn';
import {
  formatMoney,
  formatPercent,
  formatPlain,
  formatPp,
  formatQuantity,
  formatTradeAmount,
} from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { parseDecimalInput } from '@/lib/parse';
import { saveRebalancePlan } from '@/server/actions/rebalance';

export interface CalculatorProps {
  portfolioId: string;
  values: [AssetClass, string][];
  targets: [AssetClass, string][];
  candidates: [
    AssetClass,
    {
      instrumentId: string;
      ticker: string | null;
      name: string;
      kind: string;
      price: string;
      lot: string;
      quantity: string;
    },
  ][];
  lastPlan: string | null;
}

const rub = (v: Decimal) => formatMoney(Money.of(v.round(), 'RUB'));

/** «Расчёт ребаланса» (Rebalance, MRebalance; FR-RBL-1…4): recomputed on every keystroke with the domain function. */
export function RebalanceCalculator(props: CalculatorProps) {
  const notify = useToast();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'buy-only' | 'buy-sell'>('buy-only');
  const [useCash, setUseCash] = useState(false);
  const contribution = new Decimal(parseDecimalInput(amount) ?? '0');
  const valid = contribution.gte(0);

  const { plan, orders } = useMemo(() => {
    const values = new Map(props.values.map(([c, v]) => [c, new Decimal(v)]));
    const targets = new Map(props.targets.map(([c, v]) => [c, new Decimal(v)]));
    const candidates = new Map<AssetClass, Candidate>(
      props.candidates.map(([c, x]) => [
        c,
        { ...x, price: new Decimal(x.price), lot: new Decimal(x.lot), quantity: new Decimal(x.quantity) },
      ]),
    );
    const parsed = new Decimal(parseDecimalInput(amount) ?? '0');
    const plan = rebalance({
      values,
      targets,
      contribution: parsed.gte(0) ? parsed : new Decimal(0),
      mode,
      useExcessCash: useCash,
    });
    return { plan, orders: ordersFor(plan, candidates) };
  }, [props.values, props.targets, props.candidates, amount, mode, useCash]);

  const rows = [...plan.classes].sort((a, b) => b.trade.comparedTo(a.trade));
  const missing = rows.filter(
    (r) => r.assetClass !== 'cash' && !r.trade.isZero() && !orders.some((o) => o.assetClass === r.assetClass),
  );
  const text = orders
    .map(
      (o) =>
        `${o.side === 'sell' ? `${ru.rebalance.sell} ` : ''}${o.ticker ?? o.name}: ${formatQuantity(o.quantity)} × ${formatTradeAmount(o.price)} ≈ ${rub(o.amount)}`,
    )
    .join('\n');

  return (
    <>
      <section className="flex flex-wrap items-end gap-x-7 gap-y-4 rounded-card border border-border bg-surface p-4 wide:p-6">
        <Field label={ru.rebalance.contribution} className="flex-[1_1_200px]">
          {(f) => (
            <Input
              id={f.id}
              inputMode="numeric"
              mono
              size="lg"
              value={amount}
              placeholder="0"
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <fieldset className="m-0 flex flex-[2_1_320px] flex-col gap-0.5 border-0 p-0">
          <legend className="mb-1 p-0 text-small text-muted">{ru.rebalance.mode}</legend>
          <div className="flex flex-wrap gap-x-6">
            {(['buy-only', 'buy-sell'] as const).map((m) => (
              <label key={m} className="flex min-h-11 cursor-pointer items-center gap-2.5">
                <input
                  type="radio"
                  name="mode"
                  className="m-0 size-[18px] accent-accent"
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                <span>{m === 'buy-only' ? ru.rebalance.buyOnly : ru.rebalance.buySell}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {mode === 'buy-only' ? (
          <label className="flex min-h-11 flex-[1_1_260px] cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              className="m-0 size-[18px] accent-accent"
              checked={useCash}
              onChange={(e) => setUseCash(e.target.checked)}
              disabled={plan.excessCash.isZero()}
            />
            <span>{ru.rebalance.useCash(rub(plan.excessCash))}</span>
          </label>
        ) : null}
      </section>

      <section
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
        data-testid="rebalance-classes"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-card font-semibold">{ru.rebalance.byClass}</h2>
          <span className="text-caption text-muted">
            {ru.rebalance.deviation(
              formatPp(plan.maxDeviationBefore).replace('+', ''),
              formatPp(plan.maxDeviationAfter).replace('+', ''),
            )}
          </span>
        </div>
        <div className="max-wide:hidden">
          <Table minWidth={640}>
            <thead>
              <tr>
                <Th>{ru.rebalance.columns.class}</Th>
                <Th align="right">{ru.rebalance.columns.now}</Th>
                <Th align="right">{ru.rebalance.columns.target}</Th>
                <Th align="right">
                  {mode === 'buy-only' ? ru.rebalance.columns.buy : ru.rebalance.columns.trade}
                </Th>
                <Th align="right">{ru.rebalance.columns.after}</Th>
                <Th align="right">{ru.rebalance.columns.gap}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const quiet = r.trade.isZero() || (mode === 'buy-only' && r.assetClass === 'cash');
                return (
                  <tr key={r.assetClass} className="[&:last-child>td]:border-b-0">
                    <Td>{ru.classesShort[r.assetClass] ?? r.assetClass}</Td>
                    <Td align="right" mono>
                      {formatPercent(r.beforeShare)}
                    </Td>
                    <Td align="right" mono>
                      {formatPercent(r.target, { digits: 0 })}
                    </Td>
                    <Td
                      align="right"
                      mono
                      className={cn(quiet && 'text-muted', !quiet && r.trade.lt(0) && 'text-loss')}
                    >
                      {quiet
                        ? mode === 'buy-only'
                          ? ru.rebalance.noTrade
                          : ru.rebalance.keep
                        : rub(r.trade)}
                    </Td>
                    <Td align="right" mono>
                      {formatPercent(r.afterShare)}
                    </Td>
                    <Td align="right" mono className="text-muted">
                      {formatPp(r.deviation)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
        <ul className="m-0 flex list-none flex-col p-0 wide:hidden">
          {rows.map((r) => {
            const quiet = r.trade.isZero() || (mode === 'buy-only' && r.assetClass === 'cash');
            return (
              <li
                key={r.assetClass}
                className="flex min-h-14 items-center justify-between gap-3 border-b border-border-subtle last:border-b-0"
              >
                <span className="flex flex-col gap-0.5">
                  <span>{ru.classesShort[r.assetClass] ?? r.assetClass}</span>
                  <span className="num text-small text-muted">
                    {ru.rebalance.phoneShares(
                      formatPlain(r.beforeShare, 1),
                      formatPlain(r.afterShare, 1),
                      formatPlain(r.target, 0),
                    )}
                  </span>
                </span>
                <span
                  className={cn(
                    'num text-row whitespace-nowrap',
                    quiet && 'text-muted',
                    !quiet && r.trade.lt(0) && 'text-loss',
                  )}
                >
                  {quiet ? (mode === 'buy-only' ? ru.rebalance.noTrade : ru.rebalance.keep) : rub(r.trade)}
                </span>
              </li>
            );
          })}
        </ul>
        {plan.leftover.gte(100) ? (
          <div className="text-caption text-muted">{ru.rebalance.leftover(rub(plan.leftover))}</div>
        ) : null}
      </section>

      <section
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
        data-testid="rebalance-orders"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-card font-semibold">{ru.rebalance.orders}</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary-raised"
              disabled={orders.length === 0}
              onClick={async () => {
                await navigator.clipboard.writeText(text);
                notify({ tone: 'success', title: ru.rebalance.copied });
              }}
            >
              {ru.rebalance.copy}
            </Button>
            <Button
              variant="primary"
              disabled={pending || !valid}
              onClick={() =>
                start(async () => {
                  const r = await saveRebalancePlan(null, {
                    portfolioId: props.portfolioId,
                    contribution: contribution.toString(),
                    mode,
                    useExcessCash: useCash,
                  });
                  notify(
                    r.ok
                      ? { tone: 'success', title: ru.rebalance.saved }
                      : { tone: 'error', title: ru.rebalance.invalid },
                  );
                })
              }
            >
              {ru.rebalance.save}
            </Button>
          </div>
        </div>
        {orders.length === 0 && missing.length === 0 ? (
          <div className="text-caption text-muted">{ru.rebalance.ordersEmpty}</div>
        ) : null}
        <ul className="m-0 flex list-none flex-col p-0">
          {orders.map((o) => (
            <li
              key={o.instrumentId}
              className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-border-subtle py-1.5 last:border-b-0"
            >
              <span className="flex flex-col gap-0.5">
                <span>
                  {o.side === 'sell' ? <span className="text-loss">{ru.rebalance.sell} </span> : null}
                  {o.ticker && o.ticker !== o.name && o.kind !== 'bond' ? (
                    <>
                      <span className="num text-caption font-medium">{o.ticker}</span>{' '}
                      <span className="text-text-2">{o.name}</span>
                    </>
                  ) : (
                    <span className="font-medium">{o.name}</span>
                  )}
                </span>
                <span className="text-small text-muted">
                  {ru.rebalance.held(ru.classesShort[o.assetClass] ?? o.assetClass)}
                </span>
              </span>
              <span className="num text-row whitespace-nowrap">
                {ru.rebalance.line(formatQuantity(o.quantity), formatTradeAmount(o.price), rub(o.amount))}
              </span>
            </li>
          ))}
          {missing.map((r) => (
            <li
              key={r.assetClass}
              className="flex min-h-[60px] items-center justify-between gap-3 border-b border-border-subtle text-caption text-muted last:border-b-0"
            >
              <span>
                {ru.classesShort[r.assetClass] ?? r.assetClass}: {ru.rebalance.noCandidate}
              </span>
              <span className="num">{rub(r.trade)}</span>
            </li>
          ))}
        </ul>
        <div className="text-small text-muted">
          {ru.rebalance.note}
          {props.lastPlan ? ` ${ru.rebalance.lastPlan(props.lastPlan)}` : ''}
        </div>
      </section>
    </>
  );
}
