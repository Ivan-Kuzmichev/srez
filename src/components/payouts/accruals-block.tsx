import { Table, Td, Th } from '@/components/ui/table';
import type { Decimal } from '@/domain/decimal';
import { Money } from '@/domain/money';
import { approx, formatChange, formatCrypto, formatMoney, formatPercent } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import type { AccrualRow } from '@/server/accruals-data';

const rub = (v: Decimal) => formatChange(Money.of(v.round(), 'RUB'));

/** «Начисления по крипте» (Payouts, MPayouts; FR-PAY-5): kept in the position, not in the totals above. */
export function AccrualsBlock({
  rows,
  total,
  year,
  monthName,
}: {
  rows: AccrualRow[];
  total: Decimal;
  year: string;
  /** «октябрь». */
  monthName: string;
}) {
  const t = ru.accruals;
  const how = (r: AccrualRow) => (r.accrues === 'rate' ? t.how.rate(r.unitSymbol) : t.how[r.accrues]);
  const rate = (r: AccrualRow) => (r.rate ? formatPercent(r.rate.times(100).toFixed(1)) : null);
  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
      data-testid="crypto-accruals"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="m-0 text-card font-semibold">{t.title}</h2>
        <span className="text-caption text-muted">
          <span className="wide:hidden">{t.hintShort}</span>
          <span className="max-wide:hidden">{t.hint}</span>
        </span>
      </div>
      <div className="max-wide:hidden">
        <Table minWidth={760}>
          <thead>
            <tr>
              <Th>{t.columns.position}</Th>
              <Th>{t.columns.how}</Th>
              <Th align="right">{t.columns.month(monthName)}</Th>
              <Th align="right">{t.columns.year(year)}</Th>
              <Th align="right">{t.columns.forecast}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.instrumentId} className="[&:last-child>td]:border-b-0">
                <Td className="whitespace-nowrap">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">
                      {r.protocol}, {r.symbol}
                    </span>
                    <span className="text-small text-muted">
                      {t.held(formatCrypto(r.quantity), r.tokenSymbol, r.networks.join(', '))}
                    </span>
                  </div>
                </Td>
                <Td className="text-text-2">{how(r)}</Td>
                {[r.month, r.year].map((p, i) => (
                  <Td key={i} align="right" className="whitespace-nowrap">
                    <div className="num flex flex-col gap-0.5">
                      <span className={p.rub.gt(0) ? 'text-caption text-gain' : 'text-caption'}>
                        {rub(p.rub)}
                      </span>
                      <span className="text-small text-muted">
                        {formatCrypto(p.units)} {r.unitSymbol}
                      </span>
                    </div>
                  </Td>
                ))}
                <Td align="right" className="whitespace-nowrap">
                  <div className="num flex flex-col gap-0.5">
                    <span className="text-caption">
                      {r.forecastRub
                        ? approx(formatMoney(Money.of(r.forecastRub.round(), 'RUB')))
                        : ru.common.none}
                    </span>
                    <span className="text-small text-muted">
                      {rate(r) ? t.rateNow(rate(r)!) : t.noForecast}
                    </span>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <div className="flex flex-col wide:hidden">
        {rows.map((r) => (
          <div
            key={r.instrumentId}
            className="flex min-h-14 items-center justify-between gap-3 border-b border-border-subtle last:border-b-0"
          >
            <span className="flex flex-col gap-0.5">
              <span>
                {r.protocol}, {r.symbol}
              </span>
              <span className="text-small text-muted">
                {t.howShort[r.accrues]}
                {rate(r) ? ` · ≈ ${rate(r)}` : ''}
              </span>
            </span>
            <span className="num flex flex-col items-end gap-0.5">
              <span className={r.year.rub.gt(0) ? 'text-gain' : ''}>{rub(r.year.rub)}</span>
              <span className="text-small text-muted">{t.forYear(year)}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-3.5 text-caption max-wide:hidden">
        <span className="text-pretty text-muted">{t.note}</span>
        <span className="num whitespace-nowrap">{t.total(year, rub(total))}</span>
      </div>
    </section>
  );
}
