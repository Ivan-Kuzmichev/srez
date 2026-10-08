import type { Metadata } from 'next';
import Link from 'next/link';
import { AccountsStep } from '@/components/onboarding/accounts-step';
import { LoadingStep } from '@/components/onboarding/loading-step';
import { Stat, StepCard, StepsNav } from '@/components/onboarding/steps';
import { TokenStep } from '@/components/onboarding/token-step';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { db } from '@/db/client';
import { formatPlain } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { onboardingState, type OnboardingState } from '@/server/onboarding';
import { requireSession } from '@/server/session';

export const metadata: Metadata = { title: ru.pages.onboarding };

const asList = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function loadingView(state: OnboardingState) {
  const run = state.run;
  const p = run?.status === 'running' ? run.progress : null;
  const stages = ru.onboarding.loadingStage;
  const label = !p
    ? ru.onboarding.queued
    : p.stage === 'operations'
      ? stages.operations(p.accountName ?? '', p.year)
      : p.stage === 'instruments'
        ? stages.instruments(p.accountName ?? '')
        : p.stage === 'accounts'
          ? stages.accounts
          : p.stage === 'done'
            ? stages.done
            : stages[p.stage];
  const percent = p?.percent ?? 0;
  const elapsed = run?.status === 'running' ? Date.now() - run.startedAt.getTime() : 0;
  const remaining =
    percent >= 5 && elapsed > 0
      ? ru.onboarding.remainingMin(Math.round((elapsed * (100 - percent)) / percent / 60_000))
      : ru.onboarding.remainingUnknown;
  return {
    label,
    percent,
    operations: formatPlain(state.stats.operations, 0),
    instruments: formatPlain(state.stats.instruments, 0),
    remaining,
    error: !state.queued && run?.status === 'error' ? run.error : null,
  };
}

export default async function OnboardingPage({ searchParams }: PageProps<'/onboarding'>) {
  const session = await requireSession();
  const sp = await searchParams;
  const requested = Number(asList(sp.step)[0]) || undefined;
  const state = onboardingState(db(), session.user.id, requested);
  const reachable = state.sourceId ? (state.run ? 4 : 2) : 1;
  const s = state.stats;

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-col gap-7 px-4 py-8 wide:px-6 wide:py-14">
      <Logo />
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-page-phone font-semibold tracking-[-0.01em] wide:text-page">
          {ru.onboarding.title}
        </h1>
        <div className="text-pretty text-muted">{ru.onboarding.lead}</div>
      </div>
      <StepsNav current={state.step} reachable={reachable} />

      {state.step === 1 ? <TokenStep /> : null}
      {state.step === 2 ? (
        <AccountsStep accounts={state.accounts} unsupported={asList(sp.unsupported).slice(0, 10)} />
      ) : null}
      {state.step === 3 ? <LoadingStep view={loadingView(state)} /> : null}
      {state.step === 4 ? (
        <StepCard title={ru.onboarding.doneTitle} testId="onboarding-done">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-4">
            <Stat label={ru.onboarding.operations} value={formatPlain(s.operations, 0)} />
            <Stat
              label={ru.onboarding.period}
              value={
                s.fromYear === null
                  ? ru.common.none
                  : s.fromYear === s.toYear
                    ? String(s.fromYear)
                    : `${s.fromYear}–${s.toYear}`
              }
            />
            <Stat label={ru.onboarding.positionsNow} value={formatPlain(s.positions, 0)} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button asChild variant="primary">
              <Link href="/">{ru.onboarding.toOverview}</Link>
            </Button>
          </div>
        </StepCard>
      ) : null}
    </main>
  );
}
