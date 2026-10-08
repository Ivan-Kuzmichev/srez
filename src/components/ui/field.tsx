import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Where the control sits: inside a card (page-colored fill) or on the page (surface fill). */
export type ControlTone = 'card' | 'page';

export const controlClass = (tone: ControlTone, invalid?: boolean) =>
  cn(
    'box-border w-full min-h-11 rounded-control border px-3 text-row text-text placeholder:text-faint',
    'max-wide:min-h-12 max-wide:text-body',
    tone === 'card' ? 'bg-bg' : 'bg-surface',
    invalid ? 'border-loss' : 'border-border',
  );

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Label above, control, then an error or a hint below. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-small text-muted">
        {label}
      </label>
      {children({ id, describedBy: note ? noteId : undefined, invalid: Boolean(error) })}
      {note ? (
        <span id={noteId} className={cn('text-small', error ? 'text-loss' : 'text-muted')}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  tone?: ControlTone;
  invalid?: boolean;
  /** Numbers, tickers, dates: monospace with tabular digits. */
  mono?: boolean;
}

export function Input({ tone = 'card', invalid, mono, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(controlClass(tone, invalid), mono && 'num', className)}
      {...props}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  tone?: ControlTone;
  invalid?: boolean;
}

export function Textarea({ tone = 'card', invalid, className, ...props }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(controlClass(tone, invalid), 'py-2.5', className)}
      {...props}
    />
  );
}
