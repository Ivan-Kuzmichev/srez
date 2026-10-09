'use client';

import { useState } from 'react';
import { Pill } from '@/components/ui/pill';
import { Td } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';

export interface AccrualGroupItem {
  kind: 'accruals';
  id: string;
  /** «1–5 окт». */
  date: string;
  day: string;
  /** For the toggle's label: «октябрь 2026». */
  monthLabel: string;
  assets: string;
  count: number;
  amount: string;
  account: string;
  rows: { id: string; date: string; asset: string; units: string; amount: string }[];
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('transition-transform', open && 'rotate-90')}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** FR-OPS-6: a month of chain accruals as one row, opening into its days (Operations mockup). */
export function AccrualGroupRows({ g }: { g: AccrualGroupItem }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="bg-surface-2 [&:last-child>td]:border-b-0" data-testid="accrual-group">
        <Td mono className="text-caption text-muted">
          {g.date}
        </Td>
        <Td>
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? ru.accruals.collapse : ru.accruals.expand(g.monthLabel)}
            className="-ml-2 flex min-h-11 cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-2 text-text"
            onClick={() => setOpen((v) => !v)}
          >
            <Chevron open={open} />
            {ru.accruals.groupType}
          </button>
        </Td>
        <Td>{g.assets}</Td>
        <Td align="right" className="text-caption text-muted">
          {ru.accruals.groupCount(g.count)}
        </Td>
        <Td align="right" mono className="text-caption text-gain">
          {g.amount}
        </Td>
        <Td>{g.account}</Td>
        <Td className="text-muted">{ru.common.none}</Td>
        <Td>
          <Pill tone="accent" className="px-[9px] py-[3px]">
            {ru.accruals.origin}
          </Pill>
        </Td>
        <Td />
      </tr>
      {open
        ? g.rows.map((r) => (
            <tr key={r.id} className="bg-surface-2">
              <Td mono className="pl-6 text-caption text-muted">
                {r.date}
              </Td>
              <Td className="text-text-2">{ru.journal.types.accrual}</Td>
              <Td className="num text-caption">{r.asset}</Td>
              <Td align="right" mono className="text-caption text-muted">
                {r.units}
              </Td>
              <Td align="right" mono className="text-caption text-gain">
                {r.amount}
              </Td>
              <Td colSpan={4} />
            </tr>
          ))
        : null}
    </>
  );
}

/** The same group in the phone list: one line, opening into its days. */
export function AccrualGroupItemPhone({ g }: { g: AccrualGroupItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border-subtle last:border-b-0" data-testid="accrual-group-phone">
      <button
        type="button"
        aria-expanded={open}
        className="flex min-h-[60px] w-full cursor-pointer items-center justify-between gap-3 border-0 bg-transparent p-0 text-left text-text"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 font-medium">
            <Chevron open={open} />
            {ru.accruals.groupType} · {g.date}
          </span>
          <span className="truncate text-small text-muted">
            {g.assets} · {ru.accruals.groupCount(g.count)}
          </span>
        </span>
        <span className="num text-row whitespace-nowrap text-gain">{g.amount}</span>
      </button>
      {open ? (
        <ul className="m-0 list-none pb-2 pl-5">
          {g.rows.map((r) => (
            <li key={r.id} className="flex justify-between gap-3 py-1 text-small text-muted">
              <span>
                {r.date} · {r.asset} {r.units}
              </span>
              <span className="num text-gain">{r.amount}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
