'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TargetBar } from '@/components/ui/target-bar';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input } from '@/components/ui/field';
import { Pill } from '@/components/ui/pill';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { Decimal } from '@/domain/decimal';
import { Money } from '@/domain/money';
import { cn } from '@/lib/cn';
import { approx, formatMoney, formatPlain, formatShareOfTarget } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { parseDecimalInput } from '@/lib/parse';
import { deletePortfolio, previewPortfolio, savePortfolio } from '@/server/actions/portfolios';

const CLASSES = ['stocks', 'bonds', 'funds', 'crypto', 'cash'] as const;
type Mode = 'all' | 'tag' | 'none';

export interface AccountChoice {
  id: string;
  name: string;
  sourceLabel: string;
}

export interface PortfolioFormValues {
  name: string;
  modes: Record<string, { mode: Mode; tagId: string | null }>;
  targetsEnabled: boolean;
  targets: Record<string, string>;
  threshold: string;
}

interface Preview {
  value: string;
  approx: boolean;
  positions: number;
  classes: { assetClass: string; share: string; target: string | null; offTarget: boolean }[];
}

const sumOf = (targets: Record<string, string>) =>
  CLASSES.reduce((s, c) => s.plus(new Decimal(parseDecimalInput(targets[c] ?? '') ?? '0')), new Decimal(0));

export function PortfolioForm({
  id,
  initial,
  accounts,
  tags,
}: {
  id?: string;
  initial: PortfolioFormValues;
  accounts: AccountChoice[];
  tags: { id: string; name: string }[];
}) {
  const router = useRouter();
  const notify = useToast();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const rules = Object.entries(values.modes)
    .filter(([, r]) => r.mode !== 'none')
    .map(([accountId, r]) => ({
      accountId,
      mode: r.mode as 'all' | 'tag',
      tagId: r.mode === 'tag' ? r.tagId : null,
    }));
  const targets = values.targetsEnabled
    ? Object.fromEntries(CLASSES.map((c) => [c, values.targets[c] ?? '']))
    : {};
  const sum = sumOf(values.targets);
  const sumOk = sum.eq(100);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (rules.length === 0) return setPreview(null);
      const result = await previewPortfolio(null, {
        rules: rules.filter((r) => r.mode === 'all' || r.tagId),
        targets,
      });
      setPreview(result.ok ? result.data : null);
    }, 300);
    return () => clearTimeout(timer);
    // rules and targets derive from values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const setMode = (accountId: string, mode: Mode) =>
    setValues((v) => ({
      ...v,
      modes: {
        ...v.modes,
        [accountId]: {
          mode,
          tagId: mode === 'tag' ? (v.modes[accountId]?.tagId ?? tags[0]?.id ?? null) : null,
        },
      },
    }));

  async function save() {
    setBusy(true);
    setError(null);
    const result = await savePortfolio(null, {
      ...(id ? { id } : {}),
      name: values.name,
      rules,
      targetsEnabled: values.targetsEnabled,
      targets,
      deviationThreshold: values.threshold || '0',
    });
    setBusy(false);
    if (!result.ok) {
      setError(ru.portfolios.errors[result.code] ?? ru.portfolios.errors.INVALID_INPUT!);
      return;
    }
    notify({ tone: 'success', title: ru.portfolios.saved });
    router.push(`/portfolios/${result.data.id}`);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-start gap-4 pb-24 wide:pb-0">
      <div className="flex min-w-0 flex-[3_1_480px] flex-col gap-3 wide:gap-4">
        {error ? <Alert>{error}</Alert> : null}
        <section className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 wide:p-6">
          <h2 className="m-0 text-card font-semibold">{ru.portfolios.basics}</h2>
          <Field label={ru.portfolios.name}>
            {(f) => (
              <Input
                id={f.id}
                maxLength={64}
                placeholder={ru.portfolios.namePlaceholder}
                value={values.name}
                onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              />
            )}
          </Field>
        </section>

        <section
          className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
          data-testid="composition"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <h2 className="m-0 text-card font-semibold">{ru.portfolios.composition}</h2>
            <span className="text-caption text-muted">{ru.portfolios.compositionHint}</span>
          </div>
          <div className="flex flex-col">
            {accounts.map((a) => {
              const rule = values.modes[a.id] ?? { mode: 'none' as Mode, tagId: null };
              const off = rule.mode === 'none';
              return (
                <div
                  key={a.id}
                  className={cn(
                    'flex min-h-[60px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle py-1.5 last:border-b-0',
                    off && 'text-muted',
                  )}
                >
                  <span className="flex flex-[1_1_140px] flex-col gap-0.5">
                    <span className={cn(!off && 'font-medium')}>{a.name}</span>
                    <span className="text-small text-muted">{a.sourceLabel}</span>
                  </span>
                  <div className="flex-[1_1_150px]">
                    <Select
                      aria-label={ru.portfolios.modeLabel(a.name)}
                      value={rule.mode}
                      onValueChange={(m) => setMode(a.id, m as Mode)}
                      options={(['all', 'tag', 'none'] as const).map((m) => ({
                        value: m,
                        label: ru.portfolios.modes[m]!,
                        disabled: m === 'tag' && tags.length === 0,
                      }))}
                    />
                  </div>
                  <div className="flex-[1_1_150px]">
                    {rule.mode === 'tag' ? (
                      <Select
                        aria-label={ru.portfolios.tagLabel(a.name)}
                        value={rule.tagId ?? undefined}
                        onValueChange={(t) =>
                          setValues((v) => ({
                            ...v,
                            modes: { ...v.modes, [a.id]: { mode: 'tag', tagId: t } },
                          }))
                        }
                        options={tags.map((t) => ({ value: t.id, label: t.name }))}
                        placeholder={ru.portfolios.noTags}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 wide:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 text-card font-semibold">{ru.portfolios.targets}</h2>
            {values.targetsEnabled ? (
              <Pill
                tone={sumOk ? 'gain' : 'loss'}
                className="gap-[7px] px-2.5 py-1"
                data-testid="targets-sum"
              >
                <span className={cn('size-[7px] rounded-full', sumOk ? 'bg-gain' : 'bg-loss')} />
                {ru.portfolios.targetsSum(formatPlain(sum, sum.isInteger() ? 0 : 1))}
              </Pill>
            ) : null}
          </div>
          {values.targetsEnabled ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(120px,100%),1fr))] gap-3">
              {CLASSES.map((c) => (
                <Field key={c} label={ru.portfolios.targetLabel(ru.classesShort[c]!)}>
                  {(f) => (
                    <Input
                      id={f.id}
                      inputMode="decimal"
                      mono
                      value={values.targets[c] ?? ''}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, targets: { ...v.targets, [c]: e.target.value } }))
                      }
                    />
                  )}
                </Field>
              ))}
              <Field label={ru.portfolios.threshold}>
                {(f) => (
                  <Input
                    id={f.id}
                    inputMode="decimal"
                    mono
                    value={values.threshold}
                    onChange={(e) => setValues((v) => ({ ...v, threshold: e.target.value }))}
                  />
                )}
              </Field>
            </div>
          ) : null}
          <Checkbox
            label={ru.portfolios.noTargets}
            checked={!values.targetsEnabled}
            onChange={(e) => setValues((v) => ({ ...v, targetsEnabled: !e.target.checked }))}
          />
        </section>

        <div className="hidden flex-wrap items-center justify-between gap-2 wide:flex">
          {id ? <DeleteButton id={id} name={initial.name} /> : <span />}
          <div className="flex gap-2">
            <Button asChild variant="secondary">
              <Link href={id ? `/portfolios/${id}` : '/portfolios'}>{ru.portfolios.cancel}</Link>
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {ru.portfolios.save}
            </Button>
          </div>
        </div>
        {id ? (
          <div className="wide:hidden">
            <DeleteButton id={id} name={initial.name} />
          </div>
        ) : null}
      </div>

      <section
        className="flex min-w-0 flex-[2_1_320px] flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
        data-testid="portfolio-preview"
      >
        <h2 className="m-0 text-card font-semibold">{ru.portfolios.preview}</h2>
        {preview ? (
          <>
            <div className="flex min-h-11 items-center justify-between border-b border-border-subtle">
              <span className="text-muted">{ru.portfolios.previewValue}</span>
              <span className="num">
                {preview.approx
                  ? approx(formatMoney(Money.of(preview.value, 'RUB')))
                  : formatMoney(Money.of(preview.value, 'RUB'))}
              </span>
            </div>
            <div className="flex min-h-11 items-center justify-between border-b border-border-subtle">
              <span className="text-muted">{ru.portfolios.previewPositions}</span>
              <span className="num">{preview.positions}</span>
            </div>
            {values.targetsEnabled ? (
              <>
                <span className="text-small text-muted">{ru.portfolios.previewFact}</span>
                {preview.classes.map((c) => (
                  <TargetBar
                    key={c.assetClass}
                    label={ru.classesShort[c.assetClass] ?? c.assetClass}
                    valueLabel={formatShareOfTarget(c.share, c.target)}
                    actual={Number(c.share)}
                    target={Number(c.target ?? 0)}
                    scaleMax={50}
                    offTarget={c.offTarget}
                  />
                ))}
              </>
            ) : null}
          </>
        ) : (
          <div className="text-caption text-muted">{ru.portfolios.previewEmpty}</div>
        )}
      </section>

      {/* Phones: a pinned action bar instead of the tab bar. */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-border-subtle bg-bg-nav px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] wide:hidden">
        <Button asChild variant="secondary-raised" size="lg" className="flex-1">
          <Link href={id ? `/portfolios/${id}` : '/portfolios'}>{ru.portfolios.cancel}</Link>
        </Button>
        <Button variant="primary" size="lg" className="flex-1" disabled={busy} onClick={() => void save()}>
          {ru.portfolios.save}
        </Button>
      </div>
    </div>
  );
}

function DeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const notify = useToast();
  return (
    <ConfirmDialog
      trigger={<Button variant="danger">{ru.portfolios.delete}</Button>}
      title={ru.portfolios.deleteTitle(name)}
      description={ru.portfolios.deleteText}
      confirmLabel={ru.portfolios.delete}
      danger
      onConfirm={async () => {
        const result = await deletePortfolio(null, { id });
        if (!result.ok) {
          notify({ tone: 'error', title: ru.journal.failed });
          return;
        }
        notify({ tone: 'success', title: ru.portfolios.deleted });
        router.push('/portfolios');
        router.refresh();
      }}
    />
  );
}
