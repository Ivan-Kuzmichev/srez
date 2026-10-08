import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** Big faint number above the title, e.g. «0 ₽» on the empty overview. */
  figure?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Empty section (MainEmpty, OperationsEmpty). */
export function EmptyState({ title, description, figure, actions, className }: EmptyStateProps) {
  return (
    <section
      className={cn(
        'flex flex-col gap-7 rounded-card border border-border bg-surface px-4 py-8 wide:px-8 wide:py-10',
        className,
      )}
    >
      <div className="flex max-w-[560px] flex-col gap-2.5">
        {figure ? (
          <div className="num text-hero-phone font-medium tracking-[-0.02em] text-faint wide:text-hero">
            {figure}
          </div>
        ) : null}
        <h2 className="m-0 text-section font-semibold">{title}</h2>
        {description ? <div className="text-pretty text-muted">{description}</div> : null}
      </div>
      {actions}
    </section>
  );
}

export interface ActionTileProps {
  href: string;
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** The recommended first step gets an accent border. */
  primary?: boolean;
}

export function ActionTile({ href, icon, title, description, primary }: ActionTileProps) {
  return (
    <Link
      href={href}
      className={cn(
        'flex flex-col gap-2 rounded-tile border bg-surface-2 p-5 text-text no-underline hover:text-text',
        primary ? 'border-accent' : 'border-border',
      )}
    >
      <span className={cn('flex', primary ? 'text-accent' : 'text-muted')}>{icon}</span>
      <span className="text-card font-semibold">{title}</span>
      {description ? <span className="text-caption text-muted">{description}</span> : null}
    </Link>
  );
}
