'use client';

import { Fragment, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LevelTag, type PillTone } from '@/components/ui/pill';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';

export interface LogItem {
  id: number;
  time: string;
  /** Full timestamp for the copy. */
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
  details: [string, string][];
  /** The whole record as JSON, for «Скопировать запись». */
  json: string;
}

const tone: Record<LogItem['level'], PillTone> = {
  debug: 'neutral',
  info: 'neutral',
  warn: 'warn',
  error: 'loss',
};

function Details({ item }: { item: LogItem }) {
  const notify = useToast();
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-control bg-bg px-4 py-3.5">
      {item.details.length ? (
        <dl className="num m-0 grid grid-cols-[auto_1fr] gap-x-[18px] gap-y-1.5 text-caption text-text-2">
          {item.details.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-muted">{k}</dt>
              <dd className="m-0 break-all">{v}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <span />
      )}
      <Button
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(item.json);
          notify({ tone: 'success', title: ru.logs.copied });
        }}
      >
        {ru.logs.copy}
      </Button>
    </div>
  );
}

/** A table with a row that opens on click (Logs); cards on phones (MLogs). */
export function LogList({ items }: { items: LogItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const toggle = (id: number) => setOpen((o) => (o === id ? null : id));
  return (
    <>
      <div className="hidden overflow-x-auto wide:block">
        <table className="w-full min-w-[780px] border-collapse text-caption">
          <thead>
            <tr className="text-left text-small text-muted">
              <th scope="col" className="border-b border-border py-2.5 pr-3 font-medium">
                {ru.logs.columns.time}
              </th>
              <th scope="col" className="border-b border-border px-3 py-2.5 font-medium">
                {ru.logs.columns.level}
              </th>
              <th scope="col" className="border-b border-border px-3 py-2.5 font-medium">
                {ru.logs.columns.source}
              </th>
              <th scope="col" className="border-b border-border py-2.5 pl-3 font-medium">
                {ru.logs.columns.message}
              </th>
            </tr>
          </thead>
          <tbody className="num">
            {items.map((i) => {
              const expanded = open === i.id;
              const cell = cn('py-3 align-top', expanded ? 'bg-surface-2' : 'border-b border-border-subtle');
              return (
                <Fragment key={i.id}>
                  <tr className="cursor-pointer" onClick={() => toggle(i.id)} data-testid="log-row">
                    <td className={cn(cell, 'pr-3 whitespace-nowrap text-muted')}>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={ru.logs.expand}
                        className="cursor-pointer text-inherit"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(i.id);
                        }}
                      >
                        {i.time}
                      </button>
                    </td>
                    <td className={cn(cell, 'px-3 whitespace-nowrap')}>
                      <LevelTag
                        tone={tone[i.level]}
                        className={
                          i.level === 'debug' ? 'border border-border bg-surface text-muted' : undefined
                        }
                      >
                        {i.level.toUpperCase()}
                      </LevelTag>
                    </td>
                    <td className={cn(cell, 'px-3 whitespace-nowrap text-text-2')}>{i.source}</td>
                    <td className={cn(cell, 'pl-3 break-words', i.level === 'debug' && 'text-muted')}>
                      {i.message}
                    </td>
                  </tr>
                  {expanded ? (
                    <tr>
                      <td colSpan={4} className="border-b border-border-subtle bg-surface-2 px-3 pb-3.5">
                        <Details item={i} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="m-0 flex list-none flex-col p-0 wide:hidden">
        {items.map((i) => {
          const expanded = open === i.id;
          return (
            <li
              key={i.id}
              className={cn(
                'border-b border-border-subtle py-2.5 last:border-b-0',
                expanded && '-mx-4 bg-surface-2 px-4',
              )}
            >
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => toggle(i.id)}
                className="flex w-full cursor-pointer flex-col gap-1 text-left text-text"
              >
                <span className="num flex items-center gap-2.5 text-small text-muted">
                  <span>{i.time}</span>
                  <LevelTag tone={tone[i.level]}>{i.level.toUpperCase()}</LevelTag>
                  <span>{i.source}</span>
                </span>
                <span className={cn('num text-caption break-words', i.level === 'debug' && 'text-muted')}>
                  {i.message}
                </span>
              </button>
              {expanded ? (
                <div className="pt-2.5">
                  <Details item={i} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
