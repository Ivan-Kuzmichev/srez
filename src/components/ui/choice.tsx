import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface ChoiceProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
}

function Choice({
  type,
  label,
  description,
  className,
  ...props
}: ChoiceProps & { type: 'checkbox' | 'radio' }) {
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-center gap-2.5', className)}>
      <input type={type} className="m-0 size-[18px] shrink-0 accent-accent" {...props} />
      <span className="flex flex-col">
        <span>{label}</span>
        {description ? <span className="text-caption text-muted">{description}</span> : null}
      </span>
    </label>
  );
}

export function Checkbox(props: ChoiceProps) {
  return <Choice type="checkbox" {...props} />;
}

export function Radio(props: ChoiceProps) {
  return <Choice type="radio" {...props} />;
}

export function ChoiceGroup({ legend, children }: { legend: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex flex-col gap-0.5 border-0 p-0">
      <legend className="mb-1 p-0 text-small text-muted">{legend}</legend>
      {children}
    </fieldset>
  );
}
