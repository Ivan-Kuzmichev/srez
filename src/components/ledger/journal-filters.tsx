'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { IconSettings } from '@/components/icons';
import { Button, IconButton } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';

export interface FilterChoices {
  accounts: { id: string; name: string }[];
  origins: string[];
}

const TYPE_KEYS = ['buy', 'sell', 'payout', 'accrual', 'cashflow', 'charge'];
const PERIOD_KEYS = ['30d', 'year', 'all'];
const ALL = 'all';

/** Journal filters live in the address bar, so a filtered view can be bookmarked (docs/08-ui.md, section 8). */
export function useFilterParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || value === ALL) next.delete(key);
      else next.set(key, value);
    }
    next.delete('page'); // a new filter starts from the first page
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };
  return { params, update, pending };
}

function SearchBox({ className, label }: { className?: string; label?: string }) {
  const { params, update } = useFilterParams();
  const current = params.get('q') ?? '';
  const [text, setText] = useState(current);
  // The address bar can change without typing («Сбросить фильтры», back button): follow it.
  const [seen, setSeen] = useState(current);
  if (current !== seen) {
    setSeen(current);
    setText(current);
  }

  useEffect(() => {
    if (text === current) return;
    const timer = setTimeout(() => update({ q: text.trim() || null }), 350);
    return () => clearTimeout(timer);
    // `update` is recreated on every render; the text is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const input = (id?: string) => (
    <Input
      id={id}
      type="search"
      tone="page"
      aria-label={label ? undefined : ru.journal.searchAria}
      placeholder={ru.journal.searchPlaceholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
    />
  );
  return label ? (
    <Field label={label} className={className}>
      {(f) => input(f.id)}
    </Field>
  ) : (
    <div className={className}>{input()}</div>
  );
}

function FilterSelect({
  name,
  label,
  options,
  allLabel,
  fallback = ALL,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  allLabel?: string;
  fallback?: string;
}) {
  const { params, update } = useFilterParams();
  return (
    <Field label={label} className="flex-[1_1_150px]">
      {(f) => (
        <Select
          id={f.id}
          tone="page"
          value={params.get(name) ?? fallback}
          onValueChange={(v) => update({ [name]: v === fallback && name === 'period' ? null : v })}
          options={[...(allLabel ? [{ value: ALL, label: allLabel }] : []), ...options]}
        />
      )}
    </Field>
  );
}

export function JournalFilters({ choices }: { choices: FilterChoices }) {
  const { params, update } = useFilterParams();
  const accountOptions = choices.accounts.map((a) => ({ value: a.id, label: a.name }));
  const originOptions = choices.origins.map((o) => ({ value: o, label: ru.journal.origins[o] ?? o }));
  const periodOptions = PERIOD_KEYS.map((p) => ({ value: p, label: ru.journal.periods[p]! }));
  const activeType = params.get('type') ?? ALL;

  return (
    <>
      {/* Wide: one row of fields (Operations mockup). */}
      <div className="hidden flex-wrap items-end gap-3 wide:flex">
        <SearchBox className="flex-[2_1_220px]" label={ru.journal.search} />
        <FilterSelect
          name="type"
          label={ru.journal.type}
          allLabel={ru.journal.allTypes}
          options={TYPE_KEYS.map((t) => ({ value: t, label: ru.journal.typeGroups[t]! }))}
        />
        <FilterSelect
          name="account"
          label={ru.journal.account}
          allLabel={ru.journal.allAccounts}
          options={accountOptions}
        />
        <FilterSelect
          name="source"
          label={ru.journal.source}
          allLabel={ru.journal.allSources}
          options={originOptions}
        />
        <FilterSelect name="period" label={ru.journal.period} options={periodOptions} fallback="30d" />
      </div>

      {/* Phone: search, type chips, the rest behind «Фильтры» (MOperations mockup). */}
      <div className="flex flex-col gap-3 wide:hidden">
        <SearchBox />
        <div className="-mx-4 overflow-x-auto px-4">
          <div className="flex w-max gap-2">
            {[ALL, ...TYPE_KEYS].map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={activeType === t}
                onClick={() => update({ type: t })}
                className={cn(
                  'min-h-11 cursor-pointer rounded-pill border border-border px-3.5 text-row whitespace-nowrap',
                  activeType === t ? 'bg-pressed text-text' : 'bg-transparent text-muted',
                )}
              >
                {t === ALL ? ru.journal.all : ru.journal.typeChips[t]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/** The phone header button: account, source and period in a dialog. */
export function PhoneFiltersButton({ choices }: { choices: FilterChoices }) {
  const { params, update } = useFilterParams();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const value = (key: string, fallback: string) => draft[key] ?? params.get(key) ?? fallback;

  return (
    <FormDialog
      trigger={
        <IconButton label={ru.journal.filters}>
          <IconSettings />
        </IconButton>
      }
      title={ru.journal.filters}
      submitLabel={ru.common.confirm}
      onSubmit={async () => {
        update(draft);
        setDraft({});
        return null;
      }}
    >
      {(
        [
          [
            'account',
            ru.journal.account,
            [
              { value: ALL, label: ru.journal.allAccounts },
              ...choices.accounts.map((a) => ({ value: a.id, label: a.name })),
            ],
            ALL,
          ],
          [
            'source',
            ru.journal.source,
            [
              { value: ALL, label: ru.journal.allSources },
              ...choices.origins.map((o) => ({ value: o, label: ru.journal.origins[o] ?? o })),
            ],
            ALL,
          ],
          [
            'period',
            ru.journal.period,
            PERIOD_KEYS.map((p) => ({ value: p, label: ru.journal.periods[p]! })),
            '30d',
          ],
        ] as const
      ).map(([key, label, options, fallback]) => (
        <Field key={key} label={label}>
          {(f) => (
            <Select
              id={f.id}
              value={value(key, fallback)}
              onValueChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
              options={[...options]}
            />
          )}
        </Field>
      ))}
      <Button
        variant="text"
        className="self-start"
        onClick={() => setDraft({ account: ALL, source: ALL, period: '30d' })}
      >
        {ru.journal.reset}
      </Button>
    </FormDialog>
  );
}
