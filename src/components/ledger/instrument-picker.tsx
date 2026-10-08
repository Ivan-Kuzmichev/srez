'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { controlClass } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';
import { pickInstrument, searchInstruments } from '@/server/actions/instruments';
import type { DirectoryHit, InstrumentSummary } from '@/server/instruments';

export const instrumentLabel = (i: Pick<InstrumentSummary, 'ticker' | 'name'>) =>
  i.ticker && i.ticker !== i.name ? `${i.ticker} ${i.name}` : i.name;

const SOURCE_LABEL: Record<DirectoryHit['source'], string | null> = {
  local: null,
  moex: ru.operation.assetSourceExchange,
  coingecko: ru.operation.assetSourceCrypto,
};

/**
 * Asset search (ARIA combobox): the local directory and the public ones as you type.
 * Picking an outside hit stores it in the directory first.
 */
export function InstrumentPicker({
  id,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  value: InstrumentSummary | null;
  onChange: (instrument: InstrumentSummary | null) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const [query, setQuery] = useState(value ? instrumentLabel(value) : '');
  const [hits, setHits] = useState<DirectoryHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<'idle' | 'searching' | 'error'>('idle');
  const seq = useRef(0);

  // Keep the text in step when the parent sets the value (a new custom asset, a reset).
  const shown = value ? instrumentLabel(value) : null;
  const [lastShown, setLastShown] = useState(shown);
  if (shown !== lastShown) {
    setLastShown(shown);
    setQuery(shown ?? '');
  }

  useEffect(() => {
    if (value || query.trim().length < 2) return;
    const current = ++seq.current;
    const timer = setTimeout(async () => {
      setStatus('searching');
      const result = await searchInstruments(null, { q: query });
      if (current !== seq.current) return;
      setHits(result.ok ? result.data : []);
      setActive(0);
      setStatus('idle');
    }, 300);
    return () => clearTimeout(timer);
  }, [query, value]);

  async function choose(hit: DirectoryHit) {
    setOpen(false);
    setStatus('searching');
    const result = await pickInstrument(null, { key: hit.key });
    setStatus(result.ok ? 'idle' : 'error');
    if (result.ok) onChange(result.data);
  }

  const showList = open && !value && query.trim().length >= 2;

  return (
    <div className="relative">
      <input
        id={id}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && hits[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        className={controlClass('card', invalid)}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!showList || hits.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % hits.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a - 1 + hits.length) % hits.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            void choose(hits[active]!);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {status === 'error' ? (
        <div className="mt-1.5 text-small text-loss">{ru.operation.assetUnavailable}</div>
      ) : null}
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 m-0 mt-1 max-h-72 list-none overflow-y-auto rounded-control border border-border bg-surface-2 p-1"
        >
          {status === 'searching' && hits.length === 0 ? (
            <li className="px-3 py-2.5 text-caption text-muted">{ru.operation.assetSearching}</li>
          ) : hits.length === 0 ? (
            <li className="px-3 py-2.5 text-caption text-muted">{ru.operation.assetNothing}</li>
          ) : (
            hits.map((hit, i) => (
              <li
                key={hit.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void choose(hit)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-nav px-3',
                  i === active && 'bg-pressed',
                )}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  {hit.ticker ? <span className="num text-row">{hit.ticker}</span> : null}
                  <span className="truncate text-row text-text-2">{hit.name}</span>
                </span>
                {SOURCE_LABEL[hit.source] ? (
                  <span className="shrink-0 text-small text-muted">{SOURCE_LABEL[hit.source]}</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
