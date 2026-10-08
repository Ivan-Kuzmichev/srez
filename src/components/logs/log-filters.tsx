'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Field, Input } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';

function useParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, start] = useTransition();
  return (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '' || v === 'all' || (k === 'period' && v === 'today')) next.delete(k);
      else next.set(k, v);
    }
    next.delete('n');
    const q = next.toString();
    start(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
  };
}

function SearchBox({ id, label, initial }: { id?: string; label?: string; initial: string }) {
  const set = useParam();
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Input
      id={id}
      aria-label={label}
      type="search"
      tone="page"
      value={value}
      placeholder={ru.logs.searchPlaceholder}
      onChange={(e) => {
        setValue(e.target.value);
        clearTimeout(timer.current);
        const v = e.target.value;
        timer.current = setTimeout(() => set({ q: v.trim() || null }), 350);
      }}
    />
  );
}

/** Search, level, source, period (Logs); search and quick chips on phones (MLogs). Kept in the address. */
export function LogFilters({
  q,
  level,
  source,
  period,
}: {
  q: string;
  level: string;
  source: string;
  period: string;
}) {
  const set = useParam();
  const chip = level === 'error' ? 'error' : source !== 'all' && ru.logs.chips[source] ? source : 'all';
  return (
    <>
      <div className="hidden flex-wrap items-end gap-3 wide:flex">
        <Field label={ru.logs.search} className="flex-[2_1_240px]">
          {(f) => <SearchBox id={f.id} initial={q} />}
        </Field>
        <Field label={ru.logs.level} className="flex-[1_1_150px]">
          {(f) => (
            <Select
              id={f.id}
              tone="page"
              value={level}
              onValueChange={(v) => set({ level: v })}
              options={Object.entries(ru.logs.levels).map(([value, label]) => ({ value, label }))}
            />
          )}
        </Field>
        <Field label={ru.logs.source} className="flex-[1_1_150px]">
          {(f) => (
            <Select
              id={f.id}
              tone="page"
              value={source}
              onValueChange={(v) => set({ source: v })}
              options={Object.entries(ru.logs.sources).map(([value, label]) => ({ value, label }))}
            />
          )}
        </Field>
        <Field label={ru.logs.period} className="flex-[1_1_150px]">
          {(f) => (
            <Select
              id={f.id}
              tone="page"
              value={period}
              onValueChange={(v) => set({ period: v })}
              options={Object.entries(ru.logs.periods).map(([value, label]) => ({ value, label }))}
            />
          )}
        </Field>
      </div>
      <div className="flex flex-col gap-3 wide:hidden">
        <SearchBox label={ru.logs.searchLabel} initial={q} />
        <div className="-mx-4 overflow-x-auto px-4" role="group" aria-label={ru.logs.filtersLabel}>
          <div className="flex w-max gap-2">
            {Object.entries(ru.logs.chips).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={chip === key}
                onClick={() =>
                  set(
                    key === 'all'
                      ? { level: null, source: null }
                      : key === 'error'
                        ? { level: 'error', source: null }
                        : { level: null, source: key },
                  )
                }
                className={cn(
                  'min-h-9 rounded-pill border px-3.5 text-caption whitespace-nowrap',
                  chip === key
                    ? 'border-accent bg-accent-bg text-accent-text'
                    : 'border-border bg-surface text-text-2',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
