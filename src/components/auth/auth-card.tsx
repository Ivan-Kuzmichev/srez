import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** The card on sign-in screens (Login, TwoFactor, Passkey mockups). */
export function AuthCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        'flex flex-col gap-5 rounded-card border border-border bg-surface p-6 min-[420px]:p-8',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function AuthTitle({ title, text }: { title: ReactNode; text?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="m-0 text-page-phone font-semibold tracking-[-0.01em]">{title}</h1>
      {text ? <div className="text-pretty text-muted">{text}</div> : null}
    </div>
  );
}

/** Round badge with an icon: lock (danger) or key (accent). */
export function AuthBadge({ tone, children }: { tone: 'danger' | 'accent'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'flex size-16 items-center justify-center rounded-full border',
        tone === 'danger'
          ? 'border-loss-border bg-loss-bg text-loss'
          : 'border-accent bg-surface-2 text-accent',
      )}
    >
      {children}
    </span>
  );
}

export function OrDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-small text-muted">
      <span className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
