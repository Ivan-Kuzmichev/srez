'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox, ChoiceGroup, Radio } from '@/components/ui/choice';
import { Field, Input } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { Money } from '@/domain/money';
import { cn } from '@/lib/cn';
import { formatCrypto, formatDateYear, formatMoney } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { addWalletAction, previewWalletAction } from '@/server/actions/wallets';
import type { WalletPreview } from '@/server/wallets';

const NEW = 'new';
const BTC_RE = /^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/i;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

export interface WalletFormProps {
  networks: { id: string; name: string; history: boolean }[];
  disabled: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
  threshold: string;
  timeZone: string;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'bad' }
  | { kind: 'failed' }
  | { kind: 'done'; preview: WalletPreview };

/** «Кошелёк по адресу» (Wallet, MWallet; FR-CRY-1…5, 8). Asks for a public address only, never a key. */
export function WalletForm(props: WalletFormProps) {
  const router = useRouter();
  const notify = useToast();
  const [pending, start] = useTransition();
  const [family, setFamily] = useState<'bitcoin' | 'evm'>('evm');
  const [address, setAddress] = useState('');
  const [networks, setNetworks] = useState(props.networks.filter((n) => n.history).map((n) => n.id));
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState(props.accounts[0]?.id ?? NEW);
  const [mode, setMode] = useState<'history' | 'balances'>('history');
  const [hideSpam, setHideSpam] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const looksValid = family === 'bitcoin' ? BTC_RE.test(address.trim()) : EVM_RE.test(address.trim());
  const key = `${family}|${address.trim()}|${networks.join(',')}`;
  useEffect(() => {
    if (!looksValid || (family === 'evm' && networks.length === 0)) return;
    let live = true;
    const timer = setTimeout(async () => {
      setStatus({ kind: 'loading' });
      const r = await previewWalletAction(null, { family, address: address.trim(), networks });
      if (!live) return;
      if (r.ok) setStatus({ kind: 'done', preview: r.data });
      else setStatus({ kind: r.code === 'INVALID_INPUT' ? 'bad' : 'failed' });
    }, 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown =
    address.trim() === '' ? { kind: 'idle' as const } : !looksValid ? { kind: 'bad' as const } : status;
  const preview = shown.kind === 'done' ? shown.preview : null;
  const visible = preview?.coins.filter((c) => !hideSpam || !c.hidden) ?? [];
  const hidden = hideSpam ? (preview?.coins.filter((c) => c.hidden) ?? []) : [];
  // The manual entries that would count twice: in the chosen account, or anywhere for a new one.
  const dups = useMemo(
    () => (preview?.duplicates ?? []).filter((d) => accountId === NEW || d.accountId === accountId),
    [preview, accountId],
  );
  const w = ru.wallet;

  const submit = () =>
    start(async () => {
      const r = await addWalletAction(null, {
        family,
        address: address.trim(),
        networks: family === 'evm' ? networks : [],
        name: name.trim() || (family === 'bitcoin' ? 'Bitcoin' : 'EVM'),
        accountId: accountId === NEW ? null : accountId,
        mode,
        hideSpam,
        replace: dups
          .filter((d) => !keep[`${d.accountId}|${d.coingeckoId}`])
          .map((d) => ({ accountId: d.accountId, coingeckoId: d.coingeckoId })),
      });
      if (r.ok) {
        notify({ tone: 'success', title: w.added });
        router.push('/sources');
      } else notify({ tone: 'error', title: w.errors[r.code] ?? w.errors.INVALID_INPUT! });
    });

  return (
    <div className="flex flex-wrap items-start gap-3 wide:gap-4">
      <section className="flex min-w-0 flex-[3_1_480px] flex-col gap-[22px] rounded-card border border-border bg-surface p-4 wide:p-7">
        <ChoiceGroup legend={w.network}>
          <div className="flex flex-wrap gap-x-[22px]">
            {(['evm', 'bitcoin'] as const).map((f) => (
              <Radio
                key={f}
                name="family"
                label={w.families[f]}
                checked={family === f}
                onChange={() => setFamily(f)}
              />
            ))}
            {props.disabled.map((d) => (
              <Radio key={d.id} name="family" label={d.name} disabled description={w.soon} />
            ))}
          </div>
        </ChoiceGroup>

        <div className="flex flex-col gap-2">
          <Field label={w.address}>
            {(f) => (
              <Input
                id={f.id}
                mono
                size="lg"
                value={address}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                onChange={(e) => setAddress(e.target.value)}
                aria-invalid={shown.kind === 'bad'}
              />
            )}
          </Field>
          {address.trim() ? (
            <div
              className={cn(
                'text-caption',
                shown.kind === 'bad' ? 'text-loss' : looksValid ? 'text-gain' : 'text-muted',
              )}
              role="status"
            >
              {shown.kind === 'bad' ? w.addressBad[family] : family === 'evm' ? w.addressOkEvm : w.addressOk}
            </div>
          ) : null}
        </div>

        {family === 'evm' ? (
          <ChoiceGroup legend={w.networks}>
            <div className="flex flex-wrap gap-x-[22px]">
              {props.networks.map((n) => (
                <Checkbox
                  key={n.id}
                  label={n.name}
                  description={n.history ? undefined : w.noHistory}
                  checked={networks.includes(n.id)}
                  onChange={(e) =>
                    setNetworks((cur) => (e.target.checked ? [...cur, n.id] : cur.filter((x) => x !== n.id)))
                  }
                />
              ))}
            </div>
          </ChoiceGroup>
        ) : null}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
          <Field label={w.name}>
            {(f) => (
              <Input
                id={f.id}
                value={name}
                maxLength={60}
                placeholder={w.namePlaceholder}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label={w.account}>
            {(f) => (
              <Select
                id={f.id}
                value={accountId}
                onValueChange={setAccountId}
                options={[
                  ...props.accounts.map((a) => ({ value: a.id, label: w.existing(a.name) })),
                  { value: NEW, label: w.newAccount },
                ]}
              />
            )}
          </Field>
        </div>

        <ChoiceGroup legend={w.mode}>
          <Radio
            name="mode"
            label={
              <>
                <span className="wide:hidden">{w.modeHistoryShort}</span>
                <span className="max-wide:hidden">{w.modeHistory}</span>
              </>
            }
            checked={mode === 'history'}
            onChange={() => setMode('history')}
          />
          <Radio
            name="mode"
            label={w.modeBalances}
            checked={mode === 'balances'}
            onChange={() => setMode('balances')}
          />
        </ChoiceGroup>

        <div className="border-t border-border pt-3">
          <Checkbox
            label={w.hideSpam(props.threshold)}
            checked={hideSpam}
            onChange={(e) => setHideSpam(e.target.checked)}
          />
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => router.push('/sources')}>
            {w.cancel}
          </Button>
          <Button variant="primary" disabled={pending || shown.kind !== 'done'} onClick={submit}>
            {w.submit}
          </Button>
        </div>
      </section>

      <div className="flex min-w-0 flex-[2_1_340px] flex-col gap-3 wide:gap-4">
        <section
          className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
          data-testid="wallet-preview"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="m-0 text-card font-semibold">{w.found}</h2>
            {preview ? <span className="text-small text-muted">{w.checkedNow}</span> : null}
          </div>
          {shown.kind === 'loading' ? (
            <div className="text-caption text-muted" role="status">
              {w.checking}
            </div>
          ) : shown.kind === 'failed' ? (
            <div className="text-caption text-loss" role="alert">
              {w.failed}
            </div>
          ) : !preview ? (
            <div className="text-caption text-muted">{w.enterAddress}</div>
          ) : (
            <>
              <div className="flex flex-col">
                {visible.length === 0 && hidden.length === 0 ? (
                  <div className="text-caption text-muted">{w.nothing}</div>
                ) : null}
                {[...visible, ...(showHidden ? hidden : [])].map((c) => (
                  <div
                    key={`${c.network}|${c.symbol}`}
                    className={cn(
                      'flex min-h-14 items-center justify-between gap-3 border-b border-border-subtle',
                      c.hidden && 'text-muted',
                    )}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate">
                        <span className="num text-caption font-medium">{c.symbol}</span>{' '}
                        <span className="text-text-2">{c.name}</span>
                      </span>
                      <span className="text-small text-muted">
                        {w.networkLine(c.networkName)}
                        {c.hidden === 'dust' ? ` · ${w.hiddenDust}` : ''}
                      </span>
                    </span>
                    <span className="num flex flex-col items-end gap-0.5 whitespace-nowrap">
                      <span className="text-row">{formatCrypto(c.amount)}</span>
                      {c.valueRub ? (
                        <span className="text-small text-muted">
                          {formatMoney(Money.of(c.valueRub, 'RUB'))}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ))}
                {hidden.length > 0 ? (
                  <div className="flex min-h-12 items-center justify-between gap-3 text-caption text-muted">
                    <span>{w.hiddenRow}</span>
                    <button
                      type="button"
                      className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-caption text-accent-text"
                      onClick={() => setShowHidden((v) => !v)}
                    >
                      {showHidden ? w.hiddenHide : w.hiddenShow(hidden.length)}
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-border pt-3.5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-small text-muted">{w.txs}</span>
                  <span className={preview.txCount === null ? 'text-muted' : 'num'}>
                    {preview.txCount ?? w.historyLater}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-small text-muted">{w.first}</span>
                  <span className={preview.firstAt ? 'num' : 'text-muted'}>
                    {preview.firstAt
                      ? formatDateYear(new Date(preview.firstAt), props.timeZone)
                      : w.historyLater}
                  </span>
                </div>
              </div>
            </>
          )}
        </section>

        {dups.map((d) => {
          const k = `${d.accountId}|${d.coingeckoId}`;
          return (
            <section
              key={k}
              className="flex flex-col gap-3 rounded-card border border-loss-border bg-surface p-4 wide:p-6"
              data-testid="wallet-duplicate"
            >
              <div className="flex items-center gap-2.5">
                <svg
                  className="text-loss"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 8v5M12 16.5h.01" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
                <h2 className="m-0 text-card font-semibold">{w.dupTitle}</h2>
              </div>
              <div className="text-pretty text-text-2">
                {w.dupText(d.accountName, formatCrypto(d.quantity), d.symbol)}
              </div>
              <ChoiceGroup legend={w.dupLegend(d.symbol)}>
                <Radio
                  name={`dup-${k}`}
                  label={w.dupReplace}
                  checked={!keep[k]}
                  onChange={() => setKeep((s) => ({ ...s, [k]: false }))}
                />
                <Radio
                  name={`dup-${k}`}
                  label={w.dupKeep}
                  checked={!!keep[k]}
                  onChange={() => setKeep((s) => ({ ...s, [k]: true }))}
                />
              </ChoiceGroup>
            </section>
          );
        })}

        <div className="px-1 text-caption text-pretty text-muted">{w.privacy}</div>
      </div>
    </div>
  );
}
