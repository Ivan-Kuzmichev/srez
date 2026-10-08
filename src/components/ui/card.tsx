import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'div' | 'article';
  /** Error tone: border in loss-border (e.g. «Похоже на дубль»). */
  tone?: 'default' | 'danger';
}

export function Card({ as: Tag = 'section', tone = 'default', className, ...props }: CardProps) {
  return (
    <Tag
      className={cn(
        'flex flex-col gap-4 rounded-card border bg-surface p-4 wide:gap-5 wide:p-6',
        tone === 'danger' ? 'border-loss-border' : 'border-border',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  aside,
  as: H = 'h2',
}: {
  title: ReactNode;
  aside?: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <H className="m-0 text-card font-semibold">{title}</H>
      {aside ? <div className="text-small text-muted">{aside}</div> : null}
    </div>
  );
}
