import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Decimal } from '@/domain/decimal';
import {
  leadingBlanks,
  type DepositCell,
  type DepositGoal,
  type DepositLevel,
  type DepositView,
} from '@/domain/deposit-goal';
import { Money } from '@/domain/money';
import { cn } from '@/lib/cn';
import {
  formatDateLong,
  formatInMonth,
  formatMoney,
  formatMonthGenitive,
  formatMonthAxis,
  formatMonthName,
  formatPlain,
} from '@/lib/format';
import { ru } from '@/lib/i18n/ru';

const rub = (v: Decimal) => formatMoney(Money.of(v.toDecimalPlaces(0), 'RUB'));
const plain = (v: Decimal) => formatPlain(v, 0);
const day = (date: string) => new Date(`${date}T12:00:00Z`);

/** Fill by level: the track, a light and a deeper tint of «рост», the goal in full. */
const LEVEL: Record<DepositLevel, string> = {
  0: 'bg-track',
  1: 'bg-gain/15',
  2: 'bg-gain/45',
  3: 'bg-gain',
};
const LEVEL_TEXT: Record<DepositLevel, string> = {
  0: 'text-muted',
  1: 'text-text-2',
  2: 'text-text',
  3: 'text-accent-fg',
};

/** «Пополнения» (FR-PRT-12): the portfolio's deposits against its goal, per docs/04 section 18. */
export function DepositsCard({
  view,
  goal,
  iis,
  editHref,
}: {
  view: DepositView;
  goal: DepositGoal | null;
  /** The portfolio holds an ИИС: a year goal reminds of the calendar year of the deduction. */
  iis: boolean;
  editHref: string;
}) {
  const t = ru.deposits;
  const goalText = goal ? t.goal(rub(goal.amount), ru.portfolios.depositPeriods[goal.period]!) : null;
  return (
    <section
      className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-surface p-4 wide:p-6"
      data-testid="deposits"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-card font-semibold">{t.title}</h2>
        <Link
          href={`${editHref}#deposit-goal`}
          className="-my-3 flex min-h-11 items-center text-caption whitespace-nowrap no-underline"
        >
          {goalText ?? t.setGoal}
        </Link>
      </div>
      {view.kind === 'year' && goal ? (
        <YearBody view={view} goal={goal} iis={iis} />
      ) : view.kind === 'day' && goal ? (
        <DaysBody view={view} goal={goal} />
      ) : view.kind === 'month' || view.kind === 'none' ? (
        <MonthsBody view={view} goal={goal} />
      ) : null}
    </section>
  );
}

function YearBody({
  view,
  goal,
  iis,
}: {
  view: Extract<DepositView, { kind: 'year' }>;
  goal: DepositGoal;
  iis: boolean;
}) {
  const t = ru.deposits;
  const slice = goal.amount.div(12);
  const pos = `${(view.elapsed * 100).toFixed(1)}%`;
  // The pace label sits on the side of the marker with room for it.
  const labelLeft = view.elapsed > 0.5;
  const pace = view.behind.abs().lt(1)
    ? t.onPace
    : view.behind.gt(0)
      ? t.behind(rub(view.behind))
      : t.ahead(rub(view.behind.abs()));
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="num relative h-4 text-[10px] text-muted" aria-hidden>
          <span className="absolute top-2 -ml-px h-2 w-0.5 bg-text" style={{ left: pos }} />
          <span
            className={cn(
              'absolute top-0 whitespace-nowrap',
              labelLeft ? '-translate-x-full pr-1.5' : 'pl-1.5',
            )}
            style={{ left: pos }}
          >
            {t.pace}
          </span>
        </div>
        <div
          role="img"
          aria-label={t.yearLabel(rub(goal.amount), rub(slice), plain(view.deposited))}
          className="grid grid-cols-12 gap-1"
        >
          {view.slices.map((fill, i) => {
            const from = plain(slice.times(i));
            const to = rub(slice.times(i + 1));
            const state =
              fill >= 1 ? t.sliceDone : fill > 0 ? t.slicePart(`${Math.round(fill * 100)} %`) : t.sliceNone;
            return (
              <span
                key={i}
                title={t.sliceTitle(from, to, state)}
                className="aspect-square rounded-[4px] bg-track"
                style={
                  fill > 0
                    ? ({
                        background: `linear-gradient(90deg, var(--color-gain) ${fill * 100}%, var(--color-track) ${fill * 100}%)`,
                      } as CSSProperties)
                    : undefined
                }
              />
            );
          })}
        </div>
        <div className="num flex justify-between gap-2 text-[10px] text-muted">
          <span>{t.zero}</span>
          <span>{t.slice(rub(slice))}</span>
          <span>{rub(goal.amount)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1 text-caption text-text-2">
        <span>
          {t.yearOf(plain(view.deposited), rub(goal.amount))}
          {' · '}
          {view.left.gt(0) ? t.yearLeft(formatDateLong(day(view.to), 'UTC'), rub(view.left)) : t.yearDone}
        </span>
        <span className="text-pretty text-muted">
          {view.left.gt(0) ? pace : null}
          {iis ? `${view.left.gt(0) ? ' ' : ''}${t.iis}` : null}
        </span>
      </div>
    </>
  );
}

function cellClass(c: DepositCell, withText: boolean) {
  return cn(
    'box-border aspect-square rounded-[4px]',
    c.state === 'future' ? 'border border-dashed border-border-strong' : LEVEL[c.level],
    c.state === 'current' && 'shadow-[inset_0_0_0_2px_var(--color-text)]',
    withText &&
      cn(
        'num flex items-center justify-center text-[11px]',
        c.state === 'future' ? 'text-muted' : LEVEL_TEXT[c.level],
      ),
  );
}

function Legend({ top }: { top: string }) {
  const t = ru.deposits;
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted" aria-hidden>
      <span>{t.zero}</span>
      <span className="flex gap-[3px]">
        {([0, 1, 2, 3] as const).map((l) => (
          <span key={l} className={cn('size-3 rounded-[3px]', LEVEL[l])} />
        ))}
      </span>
      <span>{top}</span>
    </span>
  );
}

function MonthsBody({
  view,
  goal,
}: {
  view: Extract<DepositView, { kind: 'month' | 'none' }>;
  goal: DepositGoal | null;
}) {
  const t = ru.deposits;
  const year = view.cells[0]!.date.slice(0, 4);
  const lastYear = view.cells[11]!.date.slice(0, 4);
  const years = year === lastYear ? `${year} года` : `${year}–${lastYear} годов`;
  const title = (c: DepositCell) => {
    const name = formatMonthName(c.date);
    if (c.state === 'future') return t.monthAhead(name);
    return goal ? t.cellOf(name, plain(c.amount), rub(goal.amount)) : t.cellAmount(name, rub(c.amount));
  };
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div
          role="img"
          aria-label={goal ? t.monthsLabel(years, rub(goal.amount)) : t.monthsLabelNone(years)}
          className="grid grid-cols-12 gap-1"
        >
          {view.cells.map((c) => (
            <span key={c.date} title={title(c)} className={cellClass(c, false)} />
          ))}
        </div>
        <div className="num grid grid-cols-12 gap-1 text-center text-[10px] text-muted" aria-hidden>
          {view.cells.map((c) => (
            <span key={c.date}>{formatMonthAxis(c.date)}</span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="text-caption text-text-2">
          {view.total.isZero() ? (
            t.empty
          ) : (
            <>
              {view.kind === 'month' && view.counted > 0 ? `${t.monthsMet(view.met, view.counted)} · ` : ''}
              <span className="num">{t.forYear(rub(view.total))}</span>
            </>
          )}
        </span>
        <Legend top={goal ? t.goalMark : t.maxMark} />
      </div>
    </>
  );
}

function DaysBody({ view, goal }: { view: Extract<DepositView, { kind: 'day' }>; goal: DepositGoal }) {
  const t = ru.deposits;
  const month = formatInMonth(view.month);
  const title = (c: DepositCell) => {
    const name = formatDateLong(day(c.date), 'UTC');
    return c.state === 'future' ? t.dayAhead(name) : t.cellOf(name, plain(c.amount), rub(goal.amount));
  };
  const columns = 'grid grid-cols-[repeat(7,minmax(0,44px))] gap-1';
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className={cn(columns, 'num text-center text-[10px] text-muted')} aria-hidden>
          {t.weekdays.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div
          role="img"
          aria-label={t.daysLabel(formatMonthGenitive(Number(view.month.slice(5, 7))), rub(goal.amount))}
          className={columns}
        >
          {Array.from({ length: leadingBlanks(view.month) }, (_, i) => (
            <span key={`blank-${i}`} />
          ))}
          {view.cells.map((c) => (
            <span key={c.date} title={title(c)} className={cellClass(c, true)}>
              {Number(c.date.slice(8))}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="text-caption text-text-2">
          {t.daysMet(view.met, view.counted)}
          {' · '}
          <span className="num">{t.ofIn(plain(view.total), rub(view.due), month)}</span>
        </span>
        <Legend top={t.goalMark} />
      </div>
    </>
  );
}
