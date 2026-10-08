import Link from 'next/link';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';

/** The four steps at the top of the wizard; finished and current ones can be opened. */
export function StepsNav({ current, reachable }: { current: number; reachable: number }) {
  return (
    <nav
      aria-label={ru.onboarding.stepsLabel}
      className="grid grid-cols-[repeat(auto-fit,minmax(min(140px,100%),1fr))] gap-2"
    >
      {ru.onboarding.steps.map((label, i) => {
        const n = i + 1;
        const active = n === current;
        const body = (
          <>
            <span
              className={cn(
                'num flex size-7 shrink-0 items-center justify-center rounded-full border text-caption',
                active
                  ? 'border-accent bg-accent text-bg'
                  : n < current
                    ? 'border-accent text-accent'
                    : 'border-border-strong text-muted',
              )}
            >
              {n}
            </span>
            <span>{label}</span>
          </>
        );
        const cls = cn(
          'flex min-h-11 items-center gap-2.5 px-1 text-row no-underline',
          active ? 'font-medium text-text' : 'text-muted',
        );
        // Steps 1 and 2 can be revisited; 3 and 4 follow from the server's state.
        return n <= reachable && n <= 2 && !active ? (
          <Link key={n} href={`/onboarding?step=${n}`} className={cn(cls, 'hover:text-text')}>
            {body}
          </Link>
        ) : (
          <span key={n} className={cls} aria-current={active ? 'step' : undefined}>
            {body}
          </span>
        );
      })}
    </nav>
  );
}

export function StepCard({
  title,
  aside,
  children,
  testId,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="flex flex-col gap-5 rounded-card border border-border bg-surface p-4 wide:p-7"
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[18px] font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-control bg-surface-2 px-4 py-3.5 text-caption text-pretty text-text-2">
      {children}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-small text-muted">{label}</span>
      <span className="num text-section">{value}</span>
    </div>
  );
}
