'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { createAccount } from '@/server/actions/accounts';
import { TagSelect, type TagOption } from './tag-select';

export interface ManualAccountItem {
  id: string;
  name: string;
  kind: string;
  /** «2 окт» or null, formatted on the server. */
  last: string | null;
  operations: number;
}

const KINDS = ['wallet', 'deposit', 'broker', 'other'] as const;
const CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY'] as const;

function HiddenSelect({
  name,
  ...props
}: { name: string } & Omit<Parameters<typeof Select>[0], 'value' | 'onValueChange'>) {
  const [value, setValue] = useState(props.defaultValue ?? props.options[0]?.value ?? '');
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Select {...props} value={value} onValueChange={setValue} />
    </>
  );
}

/** «Ручные счета» on the Sources screen, with the add dialog (docs/08-ui.md, section 5). */
export function ManualAccountsCard({ accounts, tags }: { accounts: ManualAccountItem[]; tags: TagOption[] }) {
  const router = useRouter();
  const notify = useToast();

  return (
    <section
      className="flex flex-col gap-1 rounded-card border border-border bg-surface px-4 pt-4 pb-1.5 wide:gap-3 wide:p-6"
      data-testid="manual-accounts"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-card font-semibold">{ru.accounts.manualTitle}</h2>
        <FormDialog
          trigger={<Button variant="secondary-raised">{ru.accounts.add}</Button>}
          title={ru.accounts.addTitle}
          description={ru.accounts.addText}
          submitLabel={ru.accounts.add}
          onSubmit={async (form) => {
            const result = await createAccount(null, form);
            if (!result.ok) return ru.security.failedToast;
            notify({ tone: 'success', title: ru.accounts.created });
            router.refresh();
            return null;
          }}
        >
          <Field label={ru.accounts.name}>
            {(f) => (
              <Input
                id={f.id}
                name="name"
                required
                maxLength={64}
                placeholder={ru.accounts.namePlaceholder}
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={ru.accounts.kind}>
              {(f) => (
                <HiddenSelect
                  id={f.id}
                  name="kind"
                  options={KINDS.map((k) => ({ value: k, label: ru.accounts.kinds[k]! }))}
                />
              )}
            </Field>
            <Field label={ru.accounts.currency}>
              {(f) => (
                <HiddenSelect
                  id={f.id}
                  name="currency"
                  options={CURRENCIES.map((c) => ({ value: c, label: ru.currencies[c]! }))}
                />
              )}
            </Field>
          </div>
          <Field label={ru.accounts.defaultTag}>
            {(f) => <TagSelect id={f.id} name="defaultTagId" tags={tags} />}
          </Field>
        </FormDialog>
      </div>
      {accounts.length === 0 ? (
        <div className="py-3 text-caption text-muted">{ru.accounts.empty}</div>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {accounts.map((a) => (
            <li
              key={a.id}
              className="flex min-h-14 items-center justify-between gap-3 border-b border-border-subtle py-1 last:border-b-0"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium">{a.name}</span>
                <span className="hidden text-small text-muted wide:inline">
                  {ru.accounts.meta(ru.accounts.kinds[a.kind] ?? a.kind, a.last)}
                </span>
                <span className="text-small text-muted wide:hidden">
                  {ru.accounts.metaPhone(ru.accounts.kinds[a.kind] ?? a.kind, a.last)}
                </span>
              </span>
              <span className="num text-caption whitespace-nowrap text-muted">
                {ru.accounts.operations(a.operations)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
