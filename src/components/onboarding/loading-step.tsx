'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ru } from '@/lib/i18n/ru';
import { retryTinvestImport } from '@/server/actions/onboarding';
import { Note, Stat, StepCard } from './steps';

export interface LoadingView {
  label: string;
  percent: number;
  operations: string;
  instruments: string;
  remaining: string;
  error: string | null;
}

/** Step 3: the server's numbers, refreshed every two seconds while the worker loads (FR-ONB-3). */
export function LoadingStep({ view }: { view: LoadingView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => {
    if (view.error) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [router, view.error]);

  return (
    <StepCard title={ru.onboarding.loadingTitle} testId="onboarding-loading">
      <div className="flex flex-col gap-2.5">
        <div className="flex justify-between gap-3 text-row">
          <span data-testid="onboarding-stage">{view.label}</span>
          <span className="num">{view.percent}&nbsp;%</span>
        </div>
        <div
          className="h-2.5 rounded-[5px] bg-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.percent}
          aria-label={ru.onboarding.loadingTitle}
        >
          <div
            className="h-full rounded-[5px] bg-accent transition-[width]"
            style={{ width: `${view.percent}%` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-4">
        <Stat label={ru.onboarding.loadedOps} value={view.operations} />
        <Stat label={ru.onboarding.instruments} value={view.instruments} />
        <Stat label={ru.onboarding.remaining} value={view.remaining} />
      </div>
      {view.error ? <Alert tone="error">{view.error}</Alert> : <Note>{ru.onboarding.closeNote}</Note>}
      <div className="flex flex-wrap justify-between gap-2">
        {view.error ? (
          <Button asChild variant="secondary">
            <Link href="/onboarding?step=2">{ru.onboarding.back}</Link>
          </Button>
        ) : (
          <Button variant="secondary" disabled>
            {ru.onboarding.back}
          </Button>
        )}
        {view.error ? (
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await retryTinvestImport(null, {});
                router.refresh();
              })
            }
          >
            {ru.onboarding.retry}
          </Button>
        ) : (
          <Button variant="secondary-raised" disabled>
            {ru.onboarding.showResult}
          </Button>
        )}
      </div>
    </StepCard>
  );
}
