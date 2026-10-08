import { Slot } from 'radix-ui';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'secondary-raised' | 'text' | 'danger' | 'danger-text';
export type ButtonSize = 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-control text-row whitespace-nowrap no-underline cursor-pointer select-none disabled:cursor-not-allowed disabled:text-faint aria-disabled:cursor-not-allowed aria-disabled:text-faint';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg font-semibold hover:text-accent-fg disabled:bg-pressed aria-disabled:bg-pressed px-[18px]',
  // On the page background.
  secondary: 'border border-border bg-surface text-text hover:text-text px-4',
  // Inside a card.
  'secondary-raised': 'border border-border bg-surface-2 text-text hover:text-text px-4',
  text: 'bg-transparent text-accent-text hover:text-accent-text-hover px-0',
  danger: 'border border-loss-border bg-transparent text-loss hover:text-loss px-4',
  'danger-text': 'bg-transparent text-loss hover:text-loss px-2 text-caption',
};

const sizes: Record<ButtonSize, string> = {
  md: 'min-h-11',
  lg: 'min-h-12 text-body',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render the child element (a Link) with button styles. */
  asChild?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  asChild,
  className,
  type,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name; icon buttons have no visible text. */
  label: string;
}

export function IconButton({ label, className, type, children, ...props }: IconButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-11 items-center justify-center rounded-control border border-border bg-surface text-muted hover:text-text cursor-pointer',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
