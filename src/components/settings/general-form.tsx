'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox, ChoiceGroup, Radio } from '@/components/ui/choice';
import { Field, Input } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { saveGeneralSettings } from '@/server/actions/settings';
import { NotifyCard, type NotifyState } from './notify-card';

export const SETTINGS_FORM_ID = 'settings-form';

type Extra = 'USD' | 'EUR' | 'BTC';

export interface GeneralSettings {
  returns: {
    primaryMetric: 'xirr' | 'twr';
    includeCash: boolean;
    deductFees: boolean;
    defaultBenchmarkId: string;
  };
  display: { baseCurrency: 'RUB' | 'USD' | 'EUR'; extraCurrencies: Extra[] };
  prices: { refreshMinutes: number; snapshotTime: string };
  limits: { issuerPct: number; singleStockPct: number; cryptoPct: number; notify: boolean };
  notify: NotifyState;
}

const card = 'flex flex-col gap-4 rounded-card border border-border bg-surface p-4 wide:p-6';

/** «Общие» from the Settings mockup: returns, currencies, prices; saved by «Сохранить» in the header. */
export function GeneralSettingsForm({
  initial,
  benchmarks,
}: {
  initial: GeneralSettings;
  benchmarks: { value: string; label: string }[];
}) {
  const notify = useToast();
  const [, start] = useTransition();
  const [returns, setReturns] = useState(initial.returns);
  const [display, setDisplay] = useState(initial.display);
  const [refresh, setRefresh] = useState(String(initial.prices.refreshMinutes));
  const [notifyLimits, setNotifyLimits] = useState(initial.limits.notify);
  const [events, setEvents] = useState(initial.notify.events);
  const r = ru.settings;
  const toggleExtra = (c: Extra, on: boolean) =>
    setDisplay((d) => ({
      ...d,
      extraCurrencies: on ? [...d.extraCurrencies, c] : d.extraCurrencies.filter((x) => x !== c),
    }));

  return (
    <form
      id={SETTINGS_FORM_ID}
      action={(form) =>
        start(async () => {
          const result = await saveGeneralSettings(null, {
            returns,
            display,
            prices: { refreshMinutes: refresh, snapshotTime: form.get('snapshotTime') },
            notify: {
              events,
              thresholds: { deviationPp: form.get('deviationPp'), dayMovePct: form.get('dayMovePct') },
            },
            limits: {
              issuerPct: form.get('issuerPct'),
              singleStockPct: form.get('singleStockPct'),
              cryptoPct: form.get('cryptoPct'),
              notify: notifyLimits,
            },
          });
          notify(result.ok ? { tone: 'success', title: r.saved } : { tone: 'error', title: r.failed });
        })
      }
      className="contents"
    >
      <section className={card} data-testid="settings-returns">
        <h2 className="m-0 text-card font-semibold">{r.returnsTitle}</h2>
        <ChoiceGroup legend={r.primaryMetric}>
          <Radio
            name="metric"
            label={r.metricXirr}
            checked={returns.primaryMetric === 'xirr'}
            onChange={() => setReturns({ ...returns, primaryMetric: 'xirr' })}
          />
          <Radio
            name="metric"
            label={r.metricTwr}
            checked={returns.primaryMetric === 'twr'}
            onChange={() => setReturns({ ...returns, primaryMetric: 'twr' })}
          />
        </ChoiceGroup>
        <div className="flex flex-col gap-0.5">
          <Checkbox
            label={r.includeCash}
            checked={returns.includeCash}
            onChange={(e) => setReturns({ ...returns, includeCash: e.target.checked })}
          />
          <Checkbox
            label={r.deductFees}
            checked={returns.deductFees}
            onChange={(e) => setReturns({ ...returns, deductFees: e.target.checked })}
          />
        </div>
        <Field label={r.defaultBenchmark}>
          {(f) => (
            <Select
              id={f.id}
              value={returns.defaultBenchmarkId}
              onValueChange={(v) => setReturns({ ...returns, defaultBenchmarkId: v })}
              options={benchmarks}
            />
          )}
        </Field>
      </section>

      <section className={card} data-testid="settings-currencies">
        <h2 className="m-0 text-card font-semibold">{r.currenciesTitle}</h2>
        <Field label={r.baseCurrency}>
          {(f) => (
            <Select
              id={f.id}
              value={display.baseCurrency}
              onValueChange={(v) =>
                setDisplay({ ...display, baseCurrency: v as GeneralSettings['display']['baseCurrency'] })
              }
              options={(['RUB', 'USD', 'EUR'] as const).map((c) => ({ value: c, label: ru.currencies[c]! }))}
            />
          )}
        </Field>
        <ChoiceGroup legend={r.extraCurrencies}>
          {(['USD', 'EUR', 'BTC'] as const).map((c) => (
            <Checkbox
              key={c}
              label={r.extraNames[c]}
              checked={display.extraCurrencies.includes(c)}
              onChange={(e) => toggleExtra(c, e.target.checked)}
            />
          ))}
        </ChoiceGroup>
      </section>

      <section className={card} data-testid="settings-prices">
        <h2 className="m-0 text-card font-semibold">{r.pricesTitle}</h2>
        <div className="flex flex-col">
          {[
            [r.sourcesSecurities, r.sourcesSecuritiesValue],
            [r.sourcesCrypto, 'CoinGecko'],
            [r.sourcesFx, r.sourcesFxValue],
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex min-h-11 items-center justify-between gap-3 border-b border-border-subtle last:border-b-0"
            >
              <span className="text-muted">{label}</span>
              <span className="text-right">{value}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] gap-3">
          <Field label={r.refresh}>
            {(f) => (
              <Select
                id={f.id}
                value={refresh}
                onValueChange={setRefresh}
                options={['15', '60', '1440'].map((v) => ({ value: v, label: r.refreshOptions[v]! }))}
              />
            )}
          </Field>
          <Field label={r.snapshot}>
            {(f) => (
              <Input
                id={f.id}
                name="snapshotTime"
                type="time"
                mono
                required
                defaultValue={initial.prices.snapshotTime}
                className="[color-scheme:dark]"
              />
            )}
          </Field>
        </div>
      </section>
      <NotifyCard state={initial.notify} events={events} onEvents={setEvents} />

      <section id="limits" className={card} data-testid="settings-limits">
        <h2 className="m-0 text-card font-semibold">{r.limitsTitle}</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(140px,100%),1fr))] gap-3">
          {(
            [
              ['issuerPct', r.limitIssuer],
              ['singleStockPct', r.limitStock],
              ['cryptoPct', r.limitCrypto],
            ] as const
          ).map(([name, label]) => (
            <Field
              key={name}
              label={
                <>
                  <span className="wide:hidden">{r.limitShort[name]}</span>
                  <span className="max-wide:hidden">{label}</span>
                </>
              }
            >
              {(f) => (
                <Input
                  id={f.id}
                  name={name}
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={100}
                  step="any"
                  required
                  mono
                  defaultValue={initial.limits[name]}
                />
              )}
            </Field>
          ))}
        </div>
        <Checkbox
          label={
            <>
              <span className="wide:hidden">{r.limitNotifyShort}</span>
              <span className="max-wide:hidden">{r.limitNotify}</span>
            </>
          }
          checked={notifyLimits}
          onChange={(e) => setNotifyLimits(e.target.checked)}
        />
      </section>
      <section className={card} data-testid="settings-data">
        <h2 className="m-0 text-card font-semibold">{ru.data.title}</h2>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary-raised">
            <a href="/settings/data/operations" download>
              {ru.data.exportCsv}
            </a>
          </Button>
          <Button asChild variant="secondary-raised">
            <a href="/settings/data/backup" download>
              {ru.data.backup}
            </a>
          </Button>
        </div>
        <div className="text-caption text-pretty text-muted">
          <span className="wide:hidden">{ru.data.noteShort}</span>
          <span className="max-wide:hidden">{ru.data.note}</span>
        </div>
      </section>
    </form>
  );
}
